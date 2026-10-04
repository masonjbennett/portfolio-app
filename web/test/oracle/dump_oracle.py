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
RF = 0.0389          # the 3-month bill the app's rf fetch filled on Sep 6 2026 (c0fcada); the published
                     # walk-forward and the Sep 6 Sensitivity reading predate it: 2.0% (see walkforward.py).
                     # The literal, not the app's 3.89 / 100.0 (4e-18 away): every fixture carries this
                     # float as its "rf" and t-parity hands that same float to the port, so both engines
                     # solve at one rate whichever spelling is used here.
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


# -- the scorecard's figures, restated in numpy / pandas ----------------------
# The app has none of these, so there is no shipping function to slice: each is written here from
# its textbook definition, as differently from the TypeScript as the arithmetic allows (vectorised
# runs, groupby, np.percentile, np.corrcoef), and t-metrics.mjs holds the port to it.
def longest_spell(cum, when):
    """Longest run below the running peak, from the peak's close to the first close back at or above
    it, or to the last day. Longest on trading days, then calendar days, then the earlier run."""
    cum = np.asarray(cum, dtype=float)
    under = cum < np.maximum.accumulate(cum)
    edges = np.diff(np.concatenate([[0], under.astype(int), [0]]))
    best = {"trading": 0, "calendar": 0, "peak": None, "end": None, "recovered": True}
    for s, e in zip(np.where(edges == 1)[0], np.where(edges == -1)[0]):
        pk, rec = int(s) - 1, bool(e < len(cum))
        stop = int(e) if rec else len(cum) - 1
        trading, cal = stop - pk, int((when[stop] - when[pk]).days)
        if (trading, cal) > (best["trading"], best["calendar"]):
            best = {"trading": trading, "calendar": cal, "peak": when[pk].strftime("%Y-%m-%d"),
                    "end": when[stop].strftime("%Y-%m-%d"), "recovered": rec}
    return best


def worst_fall(cum):
    peak = cum.cummax()
    return float(((cum - peak) / peak).min())


def monthly(r):
    """Calendar months: trading days compounded, the first and last month flagged partial."""
    per = r.index.to_period("M")
    mo = (1 + r).groupby(per).prod() - 1
    days = r.groupby(per).size()
    last = len(mo) - 1
    return mo, [[str(p), f(v), int(days[p]), i in (0, last)] for i, (p, v) in enumerate(mo.items())]


def scorecard(r, b, start, rf):
    """Every scorecard figure for the daily series r against the benchmark b (both on the return
    dates). start is the first price's date: the drawdown 'with start' counts from 1 on that day."""
    T = len(r)
    rf_d = rf / 252
    mu, sig, sh, so = ship["annualized_stats"](r, rf)
    cum = (1 + r).cumprod()
    growth = float(cum.iloc[-1])
    annual = growth ** (252 / T) - 1
    cum_s = pd.concat([pd.Series([1.0], index=pd.DatetimeIndex([start])), cum])
    dd, dd_s = worst_fall(cum), worst_fall(cum_s)
    mo, _ = monthly(r)
    bm, _ = monthly(b)
    full, bfull = mo.iloc[1:-1], bm.iloc[1:-1]
    up, dn = bfull > 0, bfull < 0
    a = r - b
    te = a.std(ddof=1) * np.sqrt(252)
    q = np.percentile(r.values, 5)
    sd = r.std(ddof=1)
    sr = (r.mean() - rf_d) / sd
    g1, g2 = r.skew(), r.kurt()
    slope, intercept, _, _, _ = stats.linregress(b - rf_d, r - rf_d)
    corr = np.corrcoef(r.values, b.values)[0, 1]
    return {
        "annual": f(annual), "cumulative": f(growth - 1), "mu": f(mu), "sigma": f(sig),
        "sharpe": f(sh), "sortino": f(so),
        "downside": f(np.sqrt(np.mean(np.minimum(r - rf_d, 0) ** 2)) * np.sqrt(252)),
        "best": f(full.max()) if len(full) else None, "worst": f(full.min()) if len(full) else None,
        "positive": f((full > 0).mean()) if len(full) else None, "months": int(len(full)),
        "mdd": f(dd), "mddStart": f(dd_s),
        "longest": longest_spell(cum.values, list(cum.index)),
        "longestStart": longest_spell(cum_s.values, list(cum_s.index)),
        "calmar": f(annual / abs(dd)) if dd < 0 else None,
        "calmarStart": f(annual / abs(dd_s)) if dd_s < 0 else None,
        "beta": f(slope), "alphaAnn": f(intercept * 252), "corr": f(corr), "r2": f(corr ** 2),
        "te": f(te), "ir": f(a.mean() * 252 / te) if te > 0 else None,
        "up": f(full[up].mean() / bfull[up].mean()) if up.any() else None,
        "down": f(full[dn].mean() / bfull[dn].mean()) if dn.any() else None,
        "upMonths": int(up.sum()), "downMonths": int(dn.sum()),
        "var": f(-q), "es": f(-r[r <= q].mean()),
        "sharpeSE": f(np.sqrt((1 + sr ** 2 / 2 - g1 * sr + g2 / 4 * sr ** 2) / T) * np.sqrt(252)),
    }


# -- the periods: drawdown episodes, returns over fixed stretches, calendar years, the month grid -----
# Written from the definitions with pandas (running maximum, run edges, groupby, pivot), not from the
# TypeScript; t-periods.mjs holds src/lib/episodes.ts and the year and grid helpers in monthly.ts to it.
ISO = "%Y-%m-%d"
FALL_CLOSES = json.loads((FIX / "gspc-falls.json").read_text("utf-8"))


def named_falls():
    """Each named fall found from the index's own closes: within the span of closes kept for it, the close
    furthest below the running maximum is the low, and the highest close before it (the first, on a tie)
    is the high."""
    out = []
    for fx in FALL_CLOSES["falls"]:
        s = pd.Series([c for _, c in fx["rows"]], index=pd.to_datetime([d for d, _ in fx["rows"]]))
        low = (s / s.cummax() - 1).idxmin()
        high = s.loc[:low].idxmax()
        out.append({"id": fx["id"], "from": high.strftime(ISO), "to": low.strftime(ISO)})
    return out


def with_start(r, start):
    """Wealth on every close, 1 on the first price's date, so a first-day loss is a fall."""
    return pd.concat([pd.Series([1.0], index=pd.DatetimeIndex([start])), (1 + r).cumprod()])


def episodes(r, start, k=5):
    """Runs of closes below the running maximum of wealth. Each is dated from the close that set the
    maximum to the first close no longer below it (None when the run reaches the last day); the trough
    is the run's first lowest close. The k deepest, deepest first, the earlier first on equal depth."""
    cum = with_start(r, start)
    top = cum.cummax()
    dd = (cum - top) / top
    under = (dd < 0).astype(int).values
    edges = np.diff(np.concatenate([[0], under, [0]]))
    idx = cum.index
    rows = []
    for s, e in zip(np.where(edges == 1)[0], np.where(edges == -1)[0]):
        hi, lo = int(s) - 1, int(s) + int(np.argmin(cum.values[s:e]))
        rec = int(e) if e < len(cum) else None
        rows.append({"start": idx[hi].strftime(ISO), "trough": idx[lo].strftime(ISO),
                     "recovery": None if rec is None else idx[rec].strftime(ISO), "depth": f(dd.iloc[lo]),
                     "down": [lo - hi, int((idx[lo] - idx[hi]).days)],
                     "recover": None if rec is None else [rec - lo, int((idx[rec] - idx[lo]).days)]})
    rows.sort(key=lambda x: (x["depth"], x["start"]))
    return rows[:k]


def stretch_return(r, start, first, last):
    """Compounded return from the last close on or before `first` to the last close on or before `last`;
    None unless the closes reach back to `first` and on to `last`."""
    closes = pd.DatetimeIndex([start]).append(r.index)
    a_day, b_day = pd.Timestamp(first), pd.Timestamp(last)
    if closes[0] > a_day or closes[-1] < b_day:
        return None
    a, b = closes[closes <= a_day][-1], closes[closes <= b_day][-1]
    inside = r[(r.index > a) & (r.index <= b)]
    return f((1 + inside).prod() - 1)


def calendar_years(r):
    """Trading days compounded within each calendar year; the first and the last year flagged partial."""
    grp = r.groupby(r.index.year)
    ret = (1 + r).groupby(r.index.year).prod() - 1
    first, last, size = grp.apply(lambda s: s.index.min()), grp.apply(lambda s: s.index.max()), grp.size()
    n = len(ret)
    return [[int(y), f(ret[y]), first[y].strftime(ISO), last[y].strftime(ISO), int(size[y]), i in (0, n - 1)]
            for i, y in enumerate(ret.index)]


def month_grid(r):
    """Months pivoted to years down and January..December across, every year from first to last; a cell is
    [return, days, partial] or None where the window has no day of that month."""
    per = r.index.to_period("M")
    mo = (1 + r).groupby(per).prod() - 1
    tab = pd.DataFrame({"y": [p.year for p in mo.index], "m": [p.month for p in mo.index], "v": mo.values,
                        "d": r.groupby(per).size().values, "p": [0.0] * len(mo)})
    tab.loc[[0, len(tab) - 1], "p"] = 1.0
    years = range(int(tab.y.min()), int(tab.y.max()) + 1)
    piv = {c: tab.pivot(index="y", columns="m", values=c).reindex(index=years, columns=range(1, 13))
           for c in ("v", "d", "p")}
    return [[y, [None if pd.isna(piv["v"].loc[y, m]) else
                 [f(piv["v"].loc[y, m]), int(piv["d"].loc[y, m]), bool(piv["p"].loc[y, m])]
                 for m in range(1, 13)]] for y in years]


def related(worst, falls):
    """The named fall sharing the most calendar days with the worst fall (high to trough), more than one
    date in common, the earlier fall on a tie; None when none does."""
    if worst is None:
        return None
    a, z = pd.Timestamp(worst["start"]), pd.Timestamp(worst["trough"])
    best, most = None, 0
    for fl in sorted(falls, key=lambda x: x["from"]):
        lo, hi = max(a, pd.Timestamp(fl["from"])), min(z, pd.Timestamp(fl["to"]))
        if lo < hi and (hi - lo).days > most:
            best, most = fl["id"], (hi - lo).days
    return best


def periods(series, start):
    """Per series: the five deepest episodes, the return over every named fall and a few other stretches
    (ends on non-trading days, and ends the window does not reach), calendar years, the month grid, and the
    named fall its worst episode overlaps."""
    falls = named_falls()
    any_r = next(iter(series.values()))
    first, last = start, any_r.index[-1]
    day = pd.Timedelta(days=1)
    extra = [(first, last), (first, first + 40 * day), (first - day, last), (first, last + day),
             (pd.Timestamp("2020-02-22"), pd.Timestamp("2020-03-28")),
             (pd.Timestamp("2020-01-01"), pd.Timestamp("2020-12-31")), (last - 10 * day, last - 10 * day)]
    stretches = [[fl["from"], fl["to"]] for fl in falls] + [[a.strftime(ISO), b.strftime(ISO)] for a, b in extra]
    out = {}
    for k, r in series.items():
        eps = episodes(r, start)
        out[k] = {"episodes": eps,
                  "stretches": [stretch_return(r, start, a, b) for a, b in stretches],
                  "years": calendar_years(r), "grid": month_grid(r),
                  "related": related(eps[0] if eps else None, falls)}
    return {"falls": falls, "stretches": stretches, "series": out}


def load_of(R, h=0.02):
    """How much a mean-variance fit estimates, against the days it has."""
    days, n = len(R), R.shape[1]
    years = days / 252
    sig = R.std(ddof=1) * np.sqrt(252)
    return {"n": n, "days": days, "years": f(years), "means": n, "covariances": n * (n + 1) // 2,
            "daysPerAsset": f(days / n), "h": h,
            "se": vec(sig / np.sqrt(years)), "yearsNeeded": vec((sig / h) ** 2)}


# -- the added constructions, restated in numpy / scipy ----------------------------------------------
# Written from their definitions, not from the TypeScript, and by other methods: the shrunk means in closed
# form through a matrix inverse (the port uses Cholesky solves); every maximum Sharpe ratio by SLSQP on the
# Sharpe ratio itself, with its analytic gradient, from several starts, then made exact on the bounds SLSQP
# left active by one linear KKT solve (the port uses Goldfarb-Idnani on a homogenised QP); risk parity by
# MINPACK's hybrid root finder on the contribution equations x_i (A x)_i = 1/n (the port minimises a
# log-barrier objective by Newton). t-constructions.mjs holds the port to these.
CAP = 0.25
YEAR = 252


def bayes_stein(m, S, T):
    """Jorion (1986) on daily moments: shrink every mean toward the minimum-variance portfolio's mean."""
    n = len(m)
    sig_inv = np.linalg.inv(S * (T - 1) / (T - n - 2))
    one = np.ones(n)
    mu0 = float(one @ sig_inv @ m / (one @ sig_inv @ one))
    gap = m - mu0
    phi = float((n + 2) / ((n + 2) + T * (gap @ sig_inv @ gap)))
    return phi, mu0, (1 - phi) * m + phi * mu0


def max_sharpe(m, S, rf, lo, hi):
    """The highest Sharpe ratio with lo <= w_i <= hi and sum(w) = 1; None when no such mix earns more than
    rf. Returns the weights and whether the exact step on the active set was accepted."""
    n = len(m)
    e = (m - rf / 252) * 252
    A = S * 252
    los, his = np.full(n, float(lo)), np.full(n, float(hi))
    # The mix with the most excess return the bounds allow: lower bounds first, the rest by excess mean.
    top = los.copy()
    left = 1 - top.sum()
    for i in np.argsort(-e, kind="stable"):
        add = min(his[i] - los[i], left)
        top[i] += add
        left -= add
    if not top @ e > 0:
        return None

    def neg(w):
        return -(e @ w) / np.sqrt(w @ A @ w)

    def neg_grad(w):
        v = w @ A @ w
        return -(e / np.sqrt(v) - (e @ w) * (A @ w) / v ** 1.5)

    ew = np.ones(n) / n
    top_run = None
    for w0 in (ew, top, 0.5 * (ew + top), 0.25 * ew + 0.75 * top, 0.75 * ew + 0.25 * top):
        r = scipy.optimize.minimize(neg, w0, jac=neg_grad, method="SLSQP",
                                    bounds=list(zip(los, his)),
                                    constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1,
                                                  "jac": lambda w: np.ones(n)}],
                                    options={"ftol": 1e-15, "maxiter": 1000})
        if top_run is None or r.fun < top_run.fun:
            top_run = r
    w = np.clip(top_run.x, los, his)
    # The exact optimum on SLSQP's active set. With y = s w (s > 0) scaled so that e'y = 1, maximising the
    # Sharpe ratio is minimising y'Ay; the assets SLSQP left at a bound are y_i = bound_i * s, the rest free.
    at_lo, at_hi = w <= los + 1e-7, w >= his - 1e-7
    free = ~(at_lo | at_hi)
    fixed = np.where(at_lo, los, np.where(at_hi, his, 0.0))
    k = int(free.sum())
    if k == 0:
        # Every asset sits at a bound: the optimum is that vertex, exactly, when its weights sum to 1.
        ok = abs(fixed.sum() - 1) < 1e-12 and -neg(fixed) >= -neg(w) - 1e-12
        return (fixed, True) if ok else (w, False)
    P = np.zeros((n, k + 1))
    P[np.where(free)[0], np.arange(k)] = 1
    P[:, k] = fixed
    E = np.vstack([P.T @ e, P.T @ np.ones(n) - np.eye(k + 1)[k]])
    kkt = np.block([[2 * P.T @ A @ P, E.T], [E, np.zeros((2, 2))]])
    try:
        z = np.linalg.solve(kkt, np.concatenate([np.zeros(k + 1), [1.0, 0.0]]))[: k + 1]
        exact = (P @ z) / z[k]
        ok = (z[k] > 0 and np.all(exact >= los - 1e-12) and np.all(exact <= his + 1e-12)
              and abs(exact.sum() - 1) < 1e-12 and np.max(np.abs(exact - w)) < 1e-4
              and -neg(exact) >= -neg(w) - 1e-12)
    except np.linalg.LinAlgError:
        ok = False
    return (exact, True) if ok else (w, False)


def risk_parity(S):
    """Equal risk contributions, long-only: the positive root of x_i (A x)_i = 1/n, then w = x / sum(x)."""
    A = S * 252
    n = len(A)
    r = scipy.optimize.root(lambda x: x * (A @ x) - 1 / n, 1 / np.sqrt(n * np.diag(A)),
                            jac=lambda x: np.diag(A @ x) + x[:, None] * A, method="hybr",
                            options={"xtol": 1e-13})
    w = r.x / r.x.sum()
    # xtol 1e-15 is below what hybr can certify and it reports failure there with the same answer.
    assert r.success and np.all(r.x > 0) and np.max(np.abs(r.fun)) < 1e-14
    return w, (w * (A @ w)) / (w @ A @ w)


def constructions(R, rf):
    T, n = R.shape
    m, S = R.mean().values, R.cov().values
    m1, S1 = R.iloc[-YEAR:].mean().values, R.iloc[-YEAR:].cov().values
    phi, mu0, shrunk = bayes_stein(m, S, T)

    def solved(x):
        return None if x is None else {"w": vec(x[0]), "exact": bool(x[1])}

    out = {"T": T, "n": n, "cap": CAP, "bayesStein": {"phi": f(phi), "mu0": f(mu0), "means": vec(shrunk)}}
    for allow_short in (False, True):
        lo = -1 if allow_short else 0
        out["short" if allow_short else "long"] = {
            "tan1y": solved(max_sharpe(m1, S1, rf, lo, 1)),
            "tanBs": solved(max_sharpe(shrunk, S, rf, lo, 1)),
        }
    out["capped"] = solved(max_sharpe(m, S, rf, 0, CAP)) if n * CAP >= 1 else None
    w, share = risk_parity(S)
    out["riskParity"] = {"w": vec(w), "share": vec(share)}
    return out


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

    # The scorecard: every column, the benchmark, and the solved portfolios of both short settings.
    start = prices.index[0]
    series = {c: returns[c] for c in tickers + [bench]}
    for mode in ("long", "short"):
        sol = out["modes"][mode]["shipping"]
        ws = {"gmv": sol["gmv"]["x"], "tan": sol["tan"]["x"]}
        if mode == "long":
            ws = {"ew": [1.0 / n] * n, **ws}
        for k, w in ws.items():
            series[f"{mode}.{k}"] = R @ np.array(w)
    months = {k: monthly(series[k])[1] for k in [bench] + [k for k in series if "." in k]}
    share = {}
    for mode in ("long", "short"):
        sol = out["modes"][mode]["shipping"]
        ws = {"ew": [1.0 / n] * n, "gmv": sol["gmv"]["x"], "tan": sol["tan"]["x"],
              "uneven": out["modes"][mode]["custom"]["uneven"]["w"]}
        share[mode] = {}
        for k, w in ws.items():
            parts = np.array(w) * m.values
            share[mode][k] = {"w": vec(w), "share": vec(parts / parts.sum()), "total": f(parts.sum())}
    out["metrics"] = {"start": start.strftime("%Y-%m-%d"),
                      "series": {k: scorecard(s, b, start, RF) for k, s in series.items()},
                      "months": months, "share": share,
                      "load": {"full": load_of(R), "1y": load_of(R.iloc[-252:])}}

    # Drawdown episodes, returns over fixed stretches, calendar years and the month grid, same series.
    out["periods"] = periods(series, start)

    # The added constructions, last so every key above is written exactly as before.
    out["constructions"] = constructions(R, RF)
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
