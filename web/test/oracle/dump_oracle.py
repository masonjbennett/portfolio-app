"""Compute the oracle's numbers on the frozen fixtures, for web/test/t-parity.mjs.

Everything that is a FUNCTION in portfolio_app.py is sliced out and run as shipped (see _slice.py).
The Run-time cleaning block (`if run_button:` down to the MAIN CONTENT banner) is sliced and
exec'd too, with a fake `st` that records its messages and turns st.stop() into an exception, so
the port's cleaning is held to the app's real branch order and wording. Only the few lines of tab
glue (pandas one-liners such as `r.skew()`, `R @ w`, the window list) are re-expressed here; each
cites the app line it mirrors.

Two solver runs per problem:
  shipping  the app's own SLSQP calls, default ftol 1e-6: what the live app DISPLAYS
  tight     the same slice exec'd again with `optimize.minimize` given ftol 1e-15 / maxiter 1000
            whenever the call passed no options: the reference the exact QP is held to

    python web/test/oracle/dump_oracle.py
"""
import json
import math
import pathlib
import sys
import textwrap
import types
from datetime import date

import numpy as np
import pandas as pd
import scipy
import scipy.optimize
from scipy import stats

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _slice import load, segment  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parents[1] / "fixtures"
RF = 0.0389          # the 3-month bill the app's rf fetch filled on Sep 6 2026 (c0fcada)
RF_HIGH = 0.30       # above every asset's mean in `cross`: nothing beats the risk-free rate
W0 = 10000           # sidebar "Initial Amount ($)" default
SAMPLE = 50          # long series are compared at every 50th row and the last

SETS = ["megacap", "sectors", "cross", "cross_vti", "dirty"]
BENCH_LABEL = {"^GSPC": "S&P 500", "VTI": "Total Market (VTI)"}


# -- the app's functions ------------------------------------------------------
MATH = ("def compute_returns(", "# ── Chart styling helper")
MATH_DEFS = ["compute_returns", "annualized_stats", "max_drawdown", "drawdown_series",
             "portfolio_performance", "optimize_gmv", "optimize_tangency",
             "efficient_frontier", "risk_contribution"]
ship = load(*MATH, MATH_DEFS, np=np, pd=pd, optimize=scipy.optimize)


def _tight_minimize(*a, **kw):
    if "options" not in kw:
        kw["options"] = {"ftol": 1e-15, "maxiter": 1000}
    return scipy.optimize.minimize(*a, **kw)


tight = load(*MATH, MATH_DEFS, np=np, pd=pd,
             optimize=types.SimpleNamespace(minimize=_tight_minimize))


# -- the Run block, exec'd with a recording st -------------------------------
class Stop(Exception):
    pass


class Spinner:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run_block(prices, missing, tickers_raw, start, end, bench, label, rf):
    msgs = []

    def say(kind):
        return lambda text: msgs.append({"kind": kind, "text": text})

    def stop():
        raise Stop()

    st = types.SimpleNamespace(error=say("error"), warning=say("warning"), info=say("info"),
                               stop=stop, spinner=lambda *_: Spinner(),
                               session_state=types.SimpleNamespace())

    def download_data(t, s, e, b):
        return (None if prices is None else prices.copy()), list(missing)

    download_data.clear = lambda: None
    src = segment("if run_button:", "MAIN CONTENT")
    ns = {"st": st, "run_button": True, "tickers_raw": tickers_raw, "start_date": start,
          "end_date": end, "bench_ticker": bench, "bench_label": label, "rf_annual": rf,
          "download_data": download_data, "pd": pd}
    try:
        exec(compile(textwrap.dedent(src), "portfolio_app.py[run]", "exec"), ns)
        ss = st.session_state
        return msgs, ss.prices, ss.valid_tickers
    except Stop:
        return msgs, None, None


# -- helpers ------------------------------------------------------------------
def f(x):
    x = float(x)
    return None if math.isnan(x) else x


def vec(a):
    return [f(x) for x in np.asarray(a, dtype=float).ravel()]


def mat(a):
    return [vec(r) for r in np.asarray(a, dtype=float)]


def sampled(series):
    s = pd.Series(series)
    idx = list(range(0, len(s), SAMPLE))
    if idx[-1] != len(s) - 1:
        idx.append(len(s) - 1)
    return {"i": idx, "v": [f(s.iloc[i]) for i in idx]}


def res(r):
    return {"x": vec(r.x), "success": bool(r.success), "nit": int(r.nit), "status": int(r.status),
            "fun": f(r.fun)}


def perf_row(ns, w, m, S, R, rf):
    mu, sig, sh = ns["portfolio_performance"](w, m, S, rf)
    pr = R @ w
    return {"mu": f(mu), "sigma": f(sig), "sharpe": f(sh),
            "sortino": f(ns["annualized_stats"](pr, rf)[3]), "mdd": f(ns["max_drawdown"](pr))}


def frontier(ns, m, S, n, allow_short, points):
    """efficient_frontier returns only the kept (mu, sigma) pairs. Recover which grid indices were
    kept by rebuilding the grid exactly as the app does (947-971) and matching the targets."""
    ef_mu, ef_sig = ns["efficient_frontier"](m, S, RF, n, n_points=points, allow_short=allow_short)
    gmv = ns["optimize_gmv"](m, S, n, allow_short)
    mu_min = float(np.dot(gmv.x, m) * 252)
    mu_max = float(m.max() * 252)
    if allow_short:
        mu_max *= 1.5
    grid = np.linspace(mu_min, mu_max, points)
    kept = [int(np.where(grid == t)[0][0]) for t in ef_mu]
    return {"muMin": mu_min, "muMax": mu_max, "targets": vec(grid), "kept": kept,
            "sigma": vec(ef_sig)}


def custom_vectors(n):
    long_uneven = [round(0.1 + 0.9 * i / max(1, n - 1), 2) for i in range(n)]
    neg = [-0.2] * n
    tiny = [0.3, -0.29] + [0.0] * (n - 2)
    return {"default": [1.0 / n] * n, "uneven": long_uneven, "negTotal": neg, "tinyTotal": tiny}


# -- per set ------------------------------------------------------------------
def dump(name):
    fx = json.loads((FIX / f"prices-{name}.json").read_text("utf-8"))
    cols = fx["columns"]
    raw = pd.DataFrame([r[1:] for r in fx["rows"]], columns=cols,
                       index=pd.to_datetime([r[0] for r in fx["rows"]]), dtype=float)
    bench = fx["benchmark"]
    label = BENCH_LABEL[bench]
    start, end = date.fromisoformat(fx["start"]), date.fromisoformat(fx["end"])
    msgs, prices, tickers = run_block(raw, fx["missing"], fx["tickers"], start, end, bench, label, RF)
    out = {"set": name, "benchmark": bench, "benchLabel": label, "rf": RF, "w0": W0,
           "versions": {"numpy": np.__version__, "scipy": scipy.__version__, "pandas": pd.__version__,
                        "python": sys.version.split()[0]},
           "clean": {"messages": msgs,
                     "columns": None if prices is None else [str(c) for c in prices.columns],
                     "tickers": tickers,
                     "rows": None if prices is None else len(prices),
                     "first": None if prices is None else prices.index[0].strftime("%Y-%m-%d"),
                     "last": None if prices is None else prices.index[-1].strftime("%Y-%m-%d")}}
    if prices is None:
        return out

    # Derived state on every rerun (1156-1169).
    returns = ship["compute_returns"](prices)
    R = returns[tickers]
    b = returns[bench]
    S = R.cov()
    m = R.mean()
    n = len(tickers)
    mu_b, sig_b, sh_b, so_b = ship["annualized_stats"](b, RF)
    out["returns"] = {"rows": len(returns), "first": returns.index[0].strftime("%Y-%m-%d"),
                      "columns": [str(c) for c in returns.columns],
                      "head": mat(returns.iloc[:3].values), "tail": mat(returns.iloc[-3:].values),
                      "colSums": vec(returns.sum().values)}
    out["mean"] = vec(m.values)
    out["cov"] = mat(S.values)
    out["corr"] = mat(R.corr().values)

    # T1 / T2 per column, tickers then benchmark (1229-1253, 1353-1367).
    per = {}
    for c in tickers + [bench]:
        r = returns[c]
        mu, sig, sh, so = ship["annualized_stats"](r, RF)
        dd = ship["drawdown_series"](r)
        cum = (1 + r).cumprod() * W0                              # 1261
        per[c] = {"mu": f(mu), "sigma": f(sig), "sharpe": f(sh), "sortino": f(so),
                  "skew": f(r.skew()), "kurt": f(r.kurtosis()), "min": f(r.min()), "max": f(r.max()),
                  "mdd": f(ship["max_drawdown"](r)), "drawdown": sampled(dd.values),
                  "cumulative": sampled(cum.values)}
    out["perColumn"] = per

    # T3 CAPM (1377-1392).
    rf_d = RF / 252
    capm = {}
    for t in tickers:
        dfx = pd.concat([R[t] - rf_d, b - rf_d], axis=1).dropna()
        slope, intercept, rv, _, _ = stats.linregress(dfx.iloc[:, 1], dfx.iloc[:, 0])
        capm[t] = {"beta": f(slope), "alphaAnn": f(intercept * 252), "r2": f(rv ** 2)}
    out["capm"] = capm

    # C4 / C8 rolling (1324, 1451), C3 probplot (1296) on the first ticker.
    out["rolling"] = {}
    for w in (30, 60, 120):
        rv = R.rolling(w).std() * np.sqrt(252)
        rc = R[tickers[0]].rolling(w).corr(R[tickers[1]])
        out["rolling"][str(w)] = {"vol": {t: sampled(rv[t].values) for t in tickers},
                                  "corr01": sampled(rc.values)}
    (osm, osr), (slope, intercept, _) = stats.probplot(R[tickers[0]], dist="norm")
    out["probplot"] = {"ticker": tickers[0], "osm": sampled(osm), "osr": sampled(osr),
                       "slope": f(slope), "intercept": f(intercept)}

    # Tabs 4-6, both short settings.
    out["modes"] = {}
    for allow_short in (False, True):
        mode = {}
        ew = np.ones(n) / n
        for tag, ns in (("shipping", ship), ("tight", tight)):
            g = ns["optimize_gmv"](m, S, n, allow_short)
            t = ns["optimize_tangency"](m, S, RF, n, allow_short)
            mode[tag] = {"gmv": res(g), "tan": res(t)}
        g, t = mode["shipping"]["gmv"]["x"], mode["shipping"]["tan"]["x"]
        mode["perf"] = {"ew": perf_row(ship, ew, m, S, R, RF),
                        "gmv": perf_row(ship, np.array(g), m, S, R, RF),
                        "tan": perf_row(ship, np.array(t), m, S, R, RF)}
        mode["prc"] = {"gmv": vec(ship["risk_contribution"](np.array(g), S)),
                       "tan": vec(ship["risk_contribution"](np.array(t), S))}
        mode["frontier80"] = frontier(ship, m, S, n, allow_short, 80)
        mode["frontier60"] = frontier(ship, m, S, n, allow_short, 60)
        mode["frontier80tight"] = frontier(tight, m, S, n, allow_short, 80)
        # Wealth paths of the comparison chart (1660-1669), sampled.
        mode["wealth"] = {k: sampled(((1 + R @ np.array(w)).cumprod() * W0).values)
                          for k, w in (("ew", ew), ("gmv", g), ("tan", t))}
        # Custom portfolio (1722-1749): raw slider vector over its plain sum.
        cust = {}
        for k, rawv in custom_vectors(n).items():
            if not allow_short and min(rawv) < 0:
                continue
            tot = sum(rawv)
            w = np.array(rawv) / tot
            cust[k] = {"raw": rawv, "total": tot, "w": vec(w), "perf": perf_row(ship, w, m, S, R, RF)}
        mode["custom"] = cust
        # Tab 6 windows (1850-1901).
        total_days = len(R)
        total_years = total_days / 252
        wins = []
        for lb, lab, need in ((252, "1 Year", 1), (504, "2 Years", 2), (756, "3 Years", 3),
                              (1260, "5 Years", 5)):
            if total_years >= need:
                wins.append((lb, lab))
        wins.append((total_days, "Full Sample"))
        wrows = []
        for lb, lab in wins:
            sub = R.iloc[-lb:]
            sm, sc = sub.mean(), sub.cov()
            row = {"label": lab, "lb": lb, "mean": vec(sm.values), "cov": mat(sc.values)}
            for tag, ns in (("shipping", ship), ("tight", tight)):
                row[tag] = {"gmv": res(ns["optimize_gmv"](sm, sc, n, allow_short)),
                            "tan": res(ns["optimize_tangency"](sm, sc, RF, n, allow_short))}
            gs, ts = row["shipping"]["gmv"]["x"], row["shipping"]["tan"]["x"]
            row["perf"] = {k: dict(zip(("mu", "sigma", "sharpe"),
                                       vec(ship["portfolio_performance"](np.array(w), sm, sc, RF))))
                           for k, w in (("gmv", gs), ("tan", ts))}
            wrows.append(row)
        mode["windows"] = wrows
        out["modes"]["short" if allow_short else "long"] = mode

    # Nothing beats the risk-free rate: what the app's tangency returns then.
    hi = {}
    for allow_short in (False, True):
        r = ship["optimize_tangency"](m, S, RF_HIGH, n, allow_short)
        _, _, sh = ship["portfolio_performance"](r.x, m, S, RF_HIGH)
        hi["short" if allow_short else "long"] = {"res": res(r), "sharpe": f(sh)}
    out["rfHigh"] = {"rf": RF_HIGH, "maxAssetMu": f(m.max() * 252), **hi}

    # The benchmark row.
    out["bench"] = {"mu": f(mu_b), "sigma": f(sig_b), "sharpe": f(sh_b), "sortino": f(so_b),
                    "mdd": f(ship["max_drawdown"](b)), "wealth": sampled(((1 + b).cumprod() * W0).values)}
    return out


def main():
    for name in SETS:
        doc = dump(name)
        path = FIX / f"oracle-{name}.json"
        path.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        c = doc["clean"]
        print(f"{name}: {c['columns']} rows={c['rows']} msgs={[m['kind'] for m in c['messages']]} "
              f"{path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
