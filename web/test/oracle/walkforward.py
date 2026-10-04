"""Rebuild the walk-forward test quoted in the site's Method Note, on the app's own functions.

What the study was. On Sep 6 2026 the Method Note on masonjbennett.com published an out-of-sample
test of this app's optimiser on three baskets: five mega-caps (AAPL MSFT GOOGL AMZN JPM), seven
sector ETFs (XLK XLF XLV XLE XLI XLP XLY) and a cross-asset five (VTI AGG GLD VNQ EFA). In its own
words: each portfolio was fitted on all history up to a point in time, its weights were held
untouched for the following year, then it was re-fitted and rolled forward, six times, with no
lookahead. It printed one out-of-sample Sharpe ratio per basket and construction (equal weight,
minimum variance, maximum Sharpe), the mega-cap maximum-Sharpe portfolio's in-sample Sharpe of
1.107, and minimum variance's AGG weight going into 2022 on the cross-asset basket (first printed
as 95.3%, the app's full-window weight; the fold itself held 95.1%). The script that produced those numbers did not survive. This file rebuilds it.

Why a grid. The published text fixes the method but not every convention under it: where the six
one-year holds sit, what "held untouched" means for the weights, how six holds become one Sharpe,
which risk-free rate, where the return series is cut, and how tightly the solver runs. `grid`
computes every combination, so the published figures can be matched against all of them rather
than against one guess. A figure counts as reproduced only when the computed value, printed to
three decimals, is exactly the published string.

The math is never copied. compute_returns, annualized_stats, portfolio_performance, optimize_gmv
and optimize_tangency are sliced out of portfolio_app.py and run as shipped (see _slice.py), the
same way dump_oracle.py holds the web port to the app; only the walk-forward driver around them is
written here. The returns frame's .mean() and .cov() feed the optimisers exactly as the app's own
tabs do.

A grid key is E|A|H|S|R|J|O:
  E  the last bar. e0904 = Fri 2026-09-04, the last bar a run on Sun Sep 6 could hold (Sep 7 was
     Labor Day, and yfinance's end date is exclusive). e0925 = 2026-09-25, the fixtures' last bar.
     The first bar is always the first on or after 2019-01-01, the app's default Start.
  A  where the six holds sit. Every fit is EXPANDING: all bars before the hold's first bar.
     cal20    calendar years 2020..2025 (2026 is not used)
     cal21p   calendar years 2021..2025, then 2026 through the last bar (a partial sixth year)
     back365  six calendar years counted back from the last bar: b_k = last bar's date minus k
              years; hold k is the bars in (b_k, b_(k-1)], fitted on every bar on or before b_k
     back252  six holds of 252 bars each, counted back from the last bar
     fwd252   the first fit is the first 504 daily returns, which are the 505 price bars of
              2019 and 2020 (2019 had 252 sessions, 2020 had 253); then holds of 252 returns
              each, counted FORWARD, each fitted on every return before it, and the sixth hold
              runs on to the last bar. The 252-day year drifts a few days against the calendar,
              so the re-fits land on Jan 3 2022, Jan 4 2023, Jan 5 2024, Jan 7 2025 and Jan 9
              2026, and with the Sep 4 last bar the sixth hold is 165 bars. On these prices
              "the first 504 returns" and "the first hold starts on the first bar of 2021" are
              the same schedule; on a basket that starts elsewhere they part, and this code
              takes the bar count.
  H  what "held untouched" means. rebal: the weights are constant, so a day's return is r_t . w,
     the app's own wealth-line convention. drift: bought at the re-fit and left to drift with
     prices until the next re-fit.
  S  how six holds give one Sharpe. concat: the six holds' daily returns joined end to end,
     (mean x 252 - rf) / (std x sqrt 252), through the app's annualized_stats. meanfold: the mean
     of the six holds' Sharpes, each by that formula. annual: each hold's compounded return R_k,
     then (mean R_k - rf) / std R_k (a partial hold's return as it is).
  R  the risk-free rate, used both inside the tangency objective and in the score. rf389 = 3.89%,
     what the app's live 3-month bill fetch filled on Sep 6 2026; rf200 = 2%, the app's fallback
     and, until c0fcada added the live fetch, its hardcoded default;
     rf0 = none; rfhist = FRED's daily DGS3MO, where each fit's tangency uses the last value on or
     before its last bar and the score subtracts each day's rate / 252, carried forward over
     missing days (for `annual`, each hold's mean rate).
  J  where returns are cut. joined: returns are computed once on the whole price frame and then
     cut, so a hold's first return runs from the fit's last close. split: prices are cut first
     and returns computed inside each window, so every window loses its first day.
  O  the solver. ship: the app's own SLSQP calls with scipy's default tolerances. tight: the same
     calls given ftol 1e-15 and maxiter 1000, as dump_oracle.py's reference run.
Equal weight is 1/N under the same H, S, R and J.

    python web/test/oracle/walkforward.py grid <out.json> [--rf-csv saved.csv]
        every key, three baskets; FRED's DGS3MO CSV is saved beside the output, and --rf-csv
        reads a saved one instead of fetching
    python web/test/oracle/walkforward.py read <grid.json>   which keys print the published figures
    python web/test/oracle/walkforward.py sensitivity [--end YYYY-MM-DD] [--rf 0.0389] [--tight]
        the Sensitivity tab's five lookback windows on the five mega-caps: each window's weights,
        plus the basket's average pairwise correlation and betas against the S&P 500
    python web/test/oracle/walkforward.py check [--key KEY]
        exits 1 unless the nine Sharpes, the 1.107, the five Apple weights and the AGG weight
        going into 2022 print under the pinned key (or KEY). Prints each figure's distance to its rounding edge and, for a run walkforward.json
        records, how far each raw value has moved from it
    python web/test/oracle/walkforward.py dump [out.json]
        writes web/test/fixtures/walkforward.json: the pinned run fold by fold, both solvers
"""
import argparse
import io
import itertools
import json
import math
import pathlib
import sys
import types
import urllib.request

import numpy as np
import pandas as pd
import scipy
import scipy.optimize

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _slice import load  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parents[1] / "fixtures"

# -- the app's functions, as shipped and with the tight solver ----------------
MATH = ("def compute_returns(", "# ── Chart styling helper")
MATH_DEFS = ["compute_returns", "annualized_stats", "portfolio_performance", "optimize_gmv",
             "optimize_tangency"]
SHIP = load(*MATH, MATH_DEFS, np=np, pd=pd, optimize=scipy.optimize)


def _tight_minimize(*a, **kw):
    if "options" not in kw:
        kw["options"] = {"ftol": 1e-15, "maxiter": 1000}
    return scipy.optimize.minimize(*a, **kw)


TIGHT = load(*MATH, MATH_DEFS, np=np, pd=pd,
             optimize=types.SimpleNamespace(minimize=_tight_minimize))
SOLVERS = {"ship": SHIP, "tight": TIGHT}

# -- what the Method Note printed, as strings ----------------------------------
BENCH = "^GSPC"
SETS = {
    # set name: (fixture, tickers in the study's order)
    "megacap5": ("prices-megacap5.json", ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM"]),
    "sectors7": ("prices-sectors.json", ["XLK", "XLF", "XLV", "XLE", "XLI", "XLP", "XLY"]),
    "cross": ("prices-cross.json", ["VTI", "AGG", "GLD", "VNQ", "EFA"]),
}
PUBLISHED = {
    "megacap5": {"ew": "0.864", "gmv": "0.710", "tan": "0.659"},
    "sectors7": {"ew": "0.915", "gmv": "0.450", "tan": "0.661"},
    "cross": {"ew": "0.704", "gmv": "−0.247", "tan": "0.883"},
}
# The mega-cap maximum-Sharpe portfolio, in sample: fitted and scored on the whole window, first bar
# to last, as the app's own page does. That window takes in the years the walk-forward held out, so
# it is not any one fold's in-sample figure ("is" in a grid cell records those readings too).
IN_SAMPLE = "1.107"
# Minimum variance's AGG weight going into 2022, cross-asset: the fold fitted through Dec 31 2021
# holds 95.08%. The note first printed 95.3%, which is the app's full-window weight, not the fold's.
AGG_2022 = "95.1%"
APPLE_SENS = ["41.7%", "3.8%", "6.4%", "21.0%", "44.8%"]   # Sensitivity tab, Sep 6 2026

# -- the grid's dimensions ----------------------------------------------------
ENDS = {"e0904": "2026-09-04", "e0925": "2026-09-25"}
START = "2019-01-01"
ANCHORS = ["cal20", "cal21p", "back365", "back252", "fwd252"]
HOLDS = ["rebal", "drift"]
SCORES = ["concat", "meanfold", "annual"]
# Each rate as the app forms it: the sidebar's percent divided by 100.0. That is not always the
# literal: 3.89 / 100.0 is 0.038900000000000004, and the solver's stopping point follows the
# difference by about 1e-8. 2.0 / 100.0 is exactly 0.02.
RATES = {"rf389": 3.89 / 100.0, "rf200": 2.0 / 100.0, "rf0": 0.0, "rfhist": None}
CUTS = ["joined", "split"]
OPTS = ["ship", "tight"]
DGS3MO = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS3MO&cosd=2018-12-01"

# The one key under which all nine published Sharpes print, found by running the grid (Oct 4 2026):
# the last bar Sep 4 2026; a first fit on the 504 returns of 2019 and 2020, then six holds of 252
# returns counted forward, the sixth running to the last bar, every fit expanding; constant weights;
# the six holds' daily returns joined into one series and scored once; a 2% risk-free rate in both the
# tangency objective and the score (the app's fallback rate, which is also the rate that reproduces
# the Sensitivity tab's Apple weights and the 1.107); returns computed once on the whole frame; the
# app's own solver settings. Two of the nine sit close to a rounding edge: the sector ETFs' minimum
# variance is 0.449504 (4e-6 above the 0.4495 that prints 0.450) and their equal weight 0.914541
# (4e-5 above 0.9145); so does the Sensitivity tab's two-year Apple weight, 0.038491 (9e-6 below the
# 0.0385 that would print 3.9%). Four of the nine rest on where the shipping SLSQP stops rather than on the
# exact optimum: solved exactly (the tight solver, which an active-set solve with its optimality
# conditions checked confirms to 3e-8), the mega-caps' maximum Sharpe prints 0.660, the sector ETFs'
# 0.662, and the cross-asset minimum variance and maximum Sharpe -0.248 and 0.884; the Sensitivity
# tab's two-year Apple weight prints 3.9%. The sector ETFs' minimum variance is not among them:
# solved exactly it is 0.450143, which prints 0.450 too. Its only risk is the edge, which is why
# `check` prints each figure's distance to it and holds the raw values to walkforward.json.
PINNED = "e0904|fwd252|rebal|concat|rf200|joined|ship"
PINNED_WORDS = (
    "Prices from the first bar on or after 2019-01-01 through Fri 2026-09-04. Daily returns computed "
    "once on the whole frame. The first fit uses the first 504 returns (2019 and 2020); then six holds "
    "of 252 returns each are counted forward, the sixth running on to the last bar, and each is fitted "
    "on every return before it. Weights are constant through a hold (a day's return is r_t . w). The "
    "six holds' daily returns are joined into one series and scored once: (mean x 252 - rf) / "
    "(std x sqrt 252), std with ddof 1. rf = 2% in the tangency objective and in the score. The app's "
    "own SLSQP calls, scipy default tolerances, w0 = 1/N, long-only bounds [0, 1].")


def printed(x):
    """The string the site prints for a Sharpe: three decimals, a true minus sign."""
    s = f"{x:.3f}"
    return s.replace("-", "−")


def as_float(s):
    return float(s.replace("−", "-").rstrip("%"))


# -- data ---------------------------------------------------------------------
def prices_for(set_name, end):
    """The frozen adjusted closes, first bar on or after the app's default Start through `end`."""
    fixture, tickers = SETS[set_name]
    fx = json.loads((FIX / fixture).read_text("utf-8"))
    df = pd.DataFrame([r[1:] for r in fx["rows"]], columns=fx["columns"],
                      index=pd.to_datetime([r[0] for r in fx["rows"]]), dtype=float)
    df = df.loc[START:end]
    keep = tickers + ([BENCH] if BENCH in df.columns else [])
    df = df[keep]
    assert not df.isna().any().any(), f"{set_name}: the fixture has gaps; clean it as the app does"
    return df, tickers


def fetch_rf_text():
    """FRED's daily 3-month bill as FRED sends it (CSV, percent). One series per request."""
    with urllib.request.urlopen(DGS3MO, timeout=30) as resp:
        return resp.read().decode("utf-8")


def fetch_rf_history(text=None):
    """FRED's daily 3-month bill as a decimal, blanks dropped: from `text` (a saved copy of
    FRED's CSV) when given, else fetched live."""
    if text is None:
        text = fetch_rf_text()
    s = pd.read_csv(io.StringIO(text), index_col=0, parse_dates=True).iloc[:, 0]
    s = pd.to_numeric(s, errors="coerce").dropna() / 100.0
    assert len(s) > 1000, "the DGS3MO pull came back short"
    return s


# -- folds --------------------------------------------------------------------
def folds_for(dates, anchor):
    """Six holds as (fit_last, hold_first, hold_last) price-bar dates. A fit is every bar up to and
    including fit_last; a hold is every bar from hold_first through hold_last."""
    dates = pd.DatetimeIndex(dates)
    last = dates[-1]
    spans = []
    if anchor in ("cal20", "cal21p"):
        years = range(2020, 2026) if anchor == "cal20" else range(2021, 2027)
        for y in years:
            inside = dates[(dates.year == y)]
            spans.append((inside[0], inside[-1]))
    elif anchor == "back365":
        b = [last - pd.DateOffset(years=k) for k in range(6, -1, -1)]   # b_6 .. b_0
        for lo, hi in zip(b[:-1], b[1:]):
            inside = dates[(dates > lo) & (dates <= hi)]
            spans.append((inside[0], inside[-1]))
    elif anchor == "back252":
        n = len(dates)
        for k in range(6, 0, -1):
            spans.append((dates[n - 252 * k], dates[n - 252 * (k - 1) - 1]))
    elif anchor == "fwd252":
        # Price bar i closes return i - 1, so the first held return (return 504) is price bar 505.
        n = len(dates)
        starts = [505 + 252 * k for k in range(6)]
        assert starts[-1] < n, "fwd252: fewer than six holds fit before the last bar"
        for k, i in enumerate(starts):
            spans.append((dates[i], dates[starts[k + 1] - 1] if k < 5 else last))
    else:
        raise ValueError(anchor)
    out = []
    for first, hold_last in spans:
        i = dates.get_loc(first)
        assert i > 0, f"{anchor}: a hold starts on the first bar, leaving nothing to fit"
        out.append((dates[i - 1], first, hold_last))
    return out


# -- one walk-forward ---------------------------------------------------------
class Walk:
    """Every cell for one basket and one last bar. Fits are cached: they depend only on the fit
    window, the solver and the rate inside the tangency objective."""

    def __init__(self, set_name, end, rf_hist):
        self.set_name = set_name
        self.prices, self.tickers = prices_for(set_name, end)
        self.n = len(self.tickers)
        self.rf_hist = rf_hist
        self.joined = SHIP["compute_returns"](self.prices)[self.tickers]
        self._fits = {}
        self.failures = []

    # returns inside a window, joined or split
    def fit_returns(self, fit_last, cut):
        if cut == "joined":
            return self.joined.loc[:fit_last]
        return SHIP["compute_returns"](self.prices.loc[:fit_last])[self.tickers]

    def hold_returns(self, first, last, cut):
        if cut == "joined":
            return self.joined.loc[first:last]
        return SHIP["compute_returns"](self.prices.loc[first:last])[self.tickers]

    def fit_rate(self, rkey, fit_last):
        if rkey != "rfhist":
            return RATES[rkey]
        return float(self.rf_hist.loc[:fit_last].iloc[-1])

    def daily_rate(self, rkey, index):
        """The rate each day carries, as an annual decimal."""
        if rkey != "rfhist":
            return pd.Series(RATES[rkey], index=index)
        full = self.rf_hist.reindex(self.rf_hist.index.union(index)).ffill()
        return full.reindex(index)

    def fit(self, fit_last, cut, opt, rf):
        key = (fit_last, cut, opt, rf)
        if key not in self._fits:
            ns = SOLVERS[opt]
            R = self.fit_returns(fit_last, cut)
            m, S = R.mean(), R.cov()
            g = ns["optimize_gmv"](m, S, self.n)
            t = ns["optimize_tangency"](m, S, rf, self.n)
            for tag, res in (("gmv", g), ("tan", t)):
                if not res.success:
                    self.failures.append((self.set_name, str(fit_last.date()), cut, opt, rf, tag,
                                          res.message))
            self._fits[key] = {"gmv": np.asarray(g.x, float), "tan": np.asarray(t.x, float),
                               "m": m, "S": S, "R": R}
        return self._fits[key]

    @staticmethod
    def path(R, w, hold):
        """The portfolio's daily returns over a hold."""
        if hold == "rebal":
            return R @ w                                       # the app's wealth line
        grown = (1.0 + R).cumprod() @ w                        # value of $1 bought at the re-fit
        prev = grown.shift(1)
        prev.iloc[0] = float(np.sum(w))                        # what was bought: sum(w), 1 when the weights sum to 1
        return grown / prev - 1.0

    def sharpe_daily(self, r, rkey):
        """(mean x 252 - rf) / (std x sqrt 252), through the app's annualized_stats."""
        if rkey == "rfhist":
            excess = r - self.daily_rate(rkey, r.index) / 252.0
            return float(SHIP["annualized_stats"](excess, 0.0)[2])
        return float(SHIP["annualized_stats"](r, RATES[rkey])[2])

    def score(self, paths, rkey, how):
        if how == "concat":
            return self.sharpe_daily(pd.concat(paths), rkey)
        if how == "meanfold":
            return float(np.mean([self.sharpe_daily(p, rkey) for p in paths]))
        if how == "annual":
            Rk = np.array([float((1.0 + p).prod() - 1.0) for p in paths])
            if rkey == "rfhist":
                rk = np.array([float(self.daily_rate(rkey, p.index).mean()) for p in paths])
            else:
                rk = np.full(len(paths), RATES[rkey])
            ex = Rk - rk
            return float(ex.mean() / ex.std(ddof=1))
        raise ValueError(how)

    def in_sample(self, R, rkey, w):
        """A fitted portfolio scored on its own fit window, constant weights, S=concat's formula."""
        return self.sharpe_daily(R @ w, rkey)

    def cell(self, anchor, hold, how, rkey, cut, opt):
        folds = folds_for(self.prices.index, anchor)
        paths = {"ew": [], "gmv": [], "tan": []}
        fits = []
        for fit_last, first, last in folds:
            f = self.fit(fit_last, cut, opt, self.fit_rate(rkey, fit_last))
            fits.append(f)
            R = self.hold_returns(first, last, cut)
            for name, w in (("ew", np.ones(self.n) / self.n), ("gmv", f["gmv"]), ("tan", f["tan"])):
                paths[name].append(self.path(R, w, hold))
        rec = {name: self.score(paths[name], rkey, how) for name in paths}
        rec["folds"] = [[str(a.date()), str(b.date()), str(c.date())] for c, a, b in folds]
        rec["weights"] = {"ew": [[1.0 / self.n] * self.n for _ in fits],
                          "gmv": [f["gmv"].tolist() for f in fits],
                          "tan": [f["tan"].tolist() for f in fits]}
        rec["fold_sharpe"] = {name: [self.sharpe_daily(p, rkey) for p in paths[name]]
                              for name in paths} if how == "concat" else None
        rec["agg2022"] = None
        if self.set_name == "cross":
            first_2022 = self.prices.index[self.prices.index.year == 2022][0]
            for (fit_last, first, last), f in zip(folds, fits):
                if first <= first_2022 <= last:
                    rec["agg2022"] = float(f["gmv"][self.tickers.index("AGG")])
        rec["is"] = None
        if self.set_name == "megacap5":
            whole = self.fit(self.prices.index[-1], cut, opt,
                             self.fit_rate(rkey, self.prices.index[-1]))
            each = [self.in_sample(f["R"], rkey, f["tan"]) for f in fits]
            rec["is"] = {"full": self.in_sample(whole["R"], rkey, whole["tan"]),
                         "lastfit": each[-1], "firstfit": each[0],
                         "meanfold": float(np.mean(each))}
        return rec


def key_of(e, a, h, s, r, j, o):
    return "|".join((e, a, h, s, r, j, o))


def rf_csv_beside(out_path):
    """Where `grid` keeps the DGS3MO CSV it used: next to its output, so the rfhist cells can be
    recomputed offline, or after FRED revises a value, with --rf-csv."""
    p = pathlib.Path(out_path)
    return p.with_name(p.stem + ".dgs3mo.csv")


def run_grid(out_path, rf_csv=None):
    if rf_csv is not None:
        # A saved copy was asked for: read it or stop. Falling back to a live fetch here would
        # mix two vintages of the rate without saying so.
        text = pathlib.Path(rf_csv).read_text("utf-8")
        rf_hist = fetch_rf_history(text)
        rates = list(RATES)
        print(f"DGS3MO from {rf_csv}: {len(rf_hist)} values, "
              f"{rf_hist.index[0].date()} .. {rf_hist.index[-1].date()}")
    else:
        try:
            text = fetch_rf_text()
            rf_hist = fetch_rf_history(text)
            rates = list(RATES)
            saved = rf_csv_beside(out_path)
            saved.write_text(text, "utf-8", newline="")
            print(f"DGS3MO: {len(rf_hist)} values, {rf_hist.index[0].date()} .. "
                  f"{rf_hist.index[-1].date()}; FRED's CSV saved to {saved}")
        except Exception as exc:                       # noqa: BLE001
            rf_hist = None
            rates = [r for r in RATES if r != "rfhist"]
            print(f"DGS3MO could not be fetched ({exc}); rfhist is left out of the grid")
    cells, failures = [], []
    for set_name in SETS:
        for e, end in ENDS.items():
            walk = Walk(set_name, end, rf_hist)
            for a, h, s, r, j, o in itertools.product(ANCHORS, HOLDS, SCORES, rates, CUTS, OPTS):
                rec = walk.cell(a, h, s, r, j, o)
                rec.pop("weights")
                rec.pop("fold_sharpe")
                cells.append({"key": key_of(e, a, h, s, r, j, o), "set": set_name,
                              "ew": rec["ew"], "gmv": rec["gmv"], "tan": rec["tan"],
                              "folds": rec["folds"], "agg2022": rec["agg2022"], "is": rec["is"]})
            failures += walk.failures
    pathlib.Path(out_path).write_text(json.dumps({"generator": "reconstruct", "cells": cells}),
                                      "utf-8")
    print(f"{len(cells)} cells written to {out_path}")
    print(f"{len(failures)} solver calls reported success=False")
    for f in failures[:20]:
        print("  ", f)


# -- reading a grid -----------------------------------------------------------
def deviations(by_set, key):
    out = {}
    for set_name, pub in PUBLISHED.items():
        c = by_set[set_name].get(key)
        if c is None:
            return None
        for name, target in pub.items():
            out[(set_name, name)] = (c[name], target, printed(c[name]) == target,
                                     abs(c[name] - as_float(target)))
    return out


def read_grid(path):
    cells = json.loads(pathlib.Path(path).read_text("utf-8"))["cells"]
    by_set = {s: {} for s in PUBLISHED}
    for c in cells:
        by_set[c["set"]][c["key"]] = c
    keys = sorted(set.intersection(*(set(v) for v in by_set.values())))
    rows = []
    for k in keys:
        d = deviations(by_set, k)
        rows.append((max(v[3] for v in d.values()), sum(v[2] for v in d.values()), k, d))
    full = [r for r in rows if r[1] == 9]
    print(f"{len(keys)} keys in all three baskets; {len(full)} print all nine published strings")
    for r in full:
        print("  FULL MATCH", r[2])
    print("\nmost of the nine strings matched by any key:", max(r[1] for r in rows))
    for set_name, pub in PUBLISHED.items():
        print(f"\n{set_name}: the five nearest keys by max |deviation| over its three figures")
        ranked = []
        for k, c in by_set[set_name].items():
            dev = max(abs(c[n] - as_float(t)) for n, t in pub.items())
            hits = sum(printed(c[n]) == t for n, t in pub.items())
            ranked.append((dev, k, hits, c))
        ranked.sort()
        for dev, k, hits, c in ranked[:5]:
            print(f"  {k:46s} ew {c['ew']:.6f} gmv {c['gmv']:.6f} tan {c['tan']:.6f}"
                  f"  max|dev| {dev:.6f}  strings {hits}/3")
    rows.sort(key=lambda r: (-r[1], r[0]))
    print("\nthe ten nearest keys over all nine (most strings first, then max |deviation|)")
    for dev, hits, k, d in rows[:10]:
        print(f"  {k:46s} strings {hits}/9  max|dev| {dev:.6f}")
    best = rows[0][2]
    print(f"\nbest key {best}")
    for (s, n), (raw, tgt, ok, dv) in deviations(by_set, best).items():
        print(f"  {s:9s} {n:4s} raw {raw: .6f}  prints {printed(raw):>7s}  published {tgt:>7s}"
              f"  {'ok' if ok else 'MISS'}  |dev| {dv:.6f}")
    mc, cr = by_set["megacap5"][best], by_set["cross"][best]
    print("  in-sample readings:", {k: round(v, 6) for k, v in mc["is"].items()}, "target", IN_SAMPLE)
    print(f"  AGG weight in the 2022 hold: {cr['agg2022']:.6f} target {AGG_2022}")
    dims = [list(ENDS), ANCHORS, HOLDS, SCORES, list(RATES), CUTS, OPTS]
    names = ["E", "A", "H", "S", "R", "J", "O"]
    parts = best.split("|")
    print("\neach dimension moved alone from the best key (raw values, then strings matched)")
    for i, (nm, opts) in enumerate(zip(names, dims)):
        print(f" {nm}")
        for o in opts:
            k = "|".join(parts[:i] + [o] + parts[i + 1:])
            d = deviations(by_set, k)
            if d is None:
                continue
            vals = " ".join(f"{v[0]: .4f}" for v in d.values())
            print(f"   {o:9s} {vals}  strings {sum(v[2] for v in d.values())}/9"
                  f"  max|dev| {max(v[3] for v in d.values()):.6f}")


# -- the Sensitivity tab ------------------------------------------------------
def sensitivity_windows(end, rf, opt):
    """The app's tab 6 on the five mega-caps: returns over the whole price frame (benchmark
    included), the stock columns, and each lookback window as the LAST lb rows of that frame."""
    prices, tickers = prices_for("megacap5", end)
    ns = SOLVERS[opt]
    returns = SHIP["compute_returns"](prices)
    stock = returns[tickers]
    total = len(stock)
    wins = [(lb, lab) for lb, lab, need in ((252, "1 Year", 1), (504, "2 Years", 2),
                                            (756, "3 Years", 3), (1260, "5 Years", 5))
            if total / 252 >= need] + [(total, "Full Sample")]
    rows = []
    for lb, lab in wins:
        sub = stock.iloc[-lb:]
        m, S = sub.mean(), sub.cov()
        g = ns["optimize_gmv"](m, S, len(tickers))
        t = ns["optimize_tangency"](m, S, rf, len(tickers))
        rows.append({"label": lab, "lb": lb, "gmv": g, "tan": t,
                     "tan_sharpe": float(ns["portfolio_performance"](t.x, m, S, rf)[2])})
    return prices, tickers, returns, rows


def sensitivity(end, rf, opt):
    prices, tickers, returns, rows = sensitivity_windows(end, rf, opt)
    stock = returns[tickers]
    print(f"five mega-caps, {prices.index[0].date()} .. {prices.index[-1].date()}, "
          f"{len(stock)} returns, rf {rf}, solver {opt}")
    print(f"{'window':12s} {'bars':>5s}  " + "  ".join(f"{t:>7s}" for t in tickers))
    for r in rows:
        g, t = r["gmv"], r["tan"]
        print(f"{r['label']:12s} {r['lb']:5d}  tan " + " ".join(f"{x:7.2%}" for x in t.x)
              + f"   Sharpe {r['tan_sharpe']:.6f}  success {t.success}")
        print(f"{'':18s} gmv " + " ".join(f"{x:7.2%}" for x in g.x) + f"   success {g.success}")
    apple = [r["tan"].x[0] for r in rows]
    shown = [f"{x:.1%}" for x in apple]
    print("Apple, maximum Sharpe:", " -> ".join(shown), "   raw", " ".join(f"{x:.6f}" for x in apple))
    print("published            :", " -> ".join(APPLE_SENS),
          "   all five print" if shown == APPLE_SENS else "   DIFFERENT")
    c = stock.corr().values
    off = c[np.triu_indices(len(tickers), 1)]
    print(f"average pairwise correlation {off.mean():.6f}")
    mkt = returns[BENCH]
    betas = {t: float(stock[t].cov(mkt) / mkt.var()) for t in tickers}
    print("betas against the S&P 500:", {t: round(b, 6) for t, b in betas.items()})


# -- holding the pinned key to the published figures --------------------------
def pinned_cells(key, rf_hist=None):
    e, a, h, s, r, j, o = key.split("|")
    if r == "rfhist" and rf_hist is None:
        rf_hist = fetch_rf_history()
    out = {}
    for set_name in SETS:
        walk = Walk(set_name, ENDS[e], rf_hist)
        out[set_name] = (walk, walk.cell(a, h, s, r, j, o))
    return out


RECORD = FIX / "walkforward.json"
DRIFT_TOL = 1e-7     # how far a raw value may sit from walkforward.json before `check` names it


def edge(x):
    """Signed distance from x to the nearest boundary where its three-decimal print changes (an
    x.xxx5), positive above it. A Sharpe printed to three decimals and a weight printed as a percent
    to one decimal turn over at the same boundaries."""
    return x - (round(x / 1e-3 - 0.5) + 0.5) * 1e-3


def recorded(key):
    """The raw values walkforward.json holds for `key`, or None when it does not record that run.
    It records the pinned key under both solvers; the Apple weights only under the pinned solver."""
    if not RECORD.exists():
        return None
    rec = json.loads(RECORD.read_text("utf-8"))
    parts, o = key.split("|"), key.split("|")[6]
    if rec["key"].split("|")[:6] != parts[:6] or any(o not in v for v in rec["sets"].values()):
        return None
    out = {(set_name, name): v for set_name, entry in rec["sets"].items()
           for name, v in entry[o]["sharpe"].items()}
    out["in_sample"] = rec["sets"]["megacap5"][o]["in_sample_tangency"]
    out["agg"] = rec["sets"]["cross"][o]["gmv_agg_into_2022"]
    if rec["key"] == key:
        for w in rec["sets"]["megacap5"]["sensitivity_apple"]["windows"]:
            out[("apple", w["label"])] = w["tangency_aapl"]
    return out


def check(key):
    """Exit 1 unless every published figure prints under `key`. Beside each figure: its distance to
    the rounding edge, and, where walkforward.json records the run, how far the raw value has moved
    from the recorded one (more than DRIFT_TOL is named DRIFT: a solver or library change has moved
    where the run stops, which can flip a figure that sits near its edge)."""
    e, a, h, s, r, j, o = key.split("|")
    cells = pinned_cells(key)
    rec_raw = recorded(key)
    bad = drift = 0

    def line(label, raw, shown, target, record_key=None):
        nonlocal bad, drift
        ok = shown == target
        if not ok:
            bad += 1
        tag = "ok" if ok else "FAIL"
        vs = ""
        if rec_raw is not None and record_key in rec_raw:
            moved = raw - rec_raw[record_key]
            vs = f"  vs record {moved:+.1e}"
            if abs(moved) > DRIFT_TOL:
                drift += 1
                tag += " DRIFT"
        print(f"  {label:28s} raw {raw: .6f}  prints {shown:>7s}  published {target:>7s}"
              f"  edge {edge(raw):+.1e}{vs}  {tag}")

    print(f"key {key}")
    if rec_raw is None:
        print(f"  ({RECORD.name} does not record this key: raw values are not compared with it)")
    for set_name, pub in PUBLISHED.items():
        rec = cells[set_name][1]
        for name, target in pub.items():
            line(f"{set_name} {name}", rec[name], printed(rec[name]), target,
                 record_key=(set_name, name))
    full = cells["megacap5"][1]["is"]["full"]
    line("megacap5 tangency in sample", full, printed(full), IN_SAMPLE, record_key="in_sample")
    if r != "rfhist":
        _, _, _, rows = sensitivity_windows(ENDS[e], RATES[r], o)
        for row, target in zip(rows, APPLE_SENS):
            x = row["tan"].x[0]
            line(f"Apple weight, {row['label']}", x, f"{x:.1%}", target,
                 record_key=("apple", row["label"]))
    else:
        print("  Apple weights skipped: the Sensitivity tab solves at one constant rf, and an "
              "rfhist key has none")
    agg = cells["cross"][1]["agg2022"]
    line("cross GMV AGG into 2022", agg, f"{agg:.1%}", AGG_2022, record_key="agg")
    if drift:
        print(f"{drift} raw value(s) moved more than {DRIFT_TOL:g} from {RECORD.name}: the run no "
              "longer stops where the recorded one did. Find out why before re-dumping it.")
    if bad:
        print(f"{bad} published figure(s) do not print")
    else:
        print("every published figure prints")
    return 0 if bad == 0 else 1


def dump(path):
    """Write the pinned run fold by fold, so another engine can be held to it."""
    e, a, h, s, r, j, o = PINNED.split("|")
    out = {"what": "The walk-forward test quoted in the site's Method Note (published Sep 6 2026), "
                   "rebuilt from the app's own functions by web/test/oracle/walkforward.py.",
           "key": PINNED, "conventions": PINNED_WORDS, "rf": RATES[r],
           "versions": {"python": sys.version.split()[0], "numpy": np.__version__,
                        "scipy": scipy.__version__, "pandas": pd.__version__},
           "sets": {}}
    for opt in ("ship", "tight"):
        key = "|".join((e, a, h, s, r, j, opt))
        for set_name, (walk, rec) in pinned_cells(key).items():
            entry = out["sets"].setdefault(set_name, {
                "tickers": walk.tickers, "first_bar": str(walk.prices.index[0].date()),
                "last_bar": str(walk.prices.index[-1].date()),
                "folds": [{"fit_last": f[2], "hold_first": f[0], "hold_last": f[1]}
                          for f in rec["folds"]],
                "published": dict(PUBLISHED[set_name])})
            entry[opt] = {
                "weights": rec["weights"],
                "fold_sharpe": rec["fold_sharpe"],
                "sharpe": {k: rec[k] for k in ("ew", "gmv", "tan")},
                "prints": {k: printed(rec[k]) for k in ("ew", "gmv", "tan")},
            }
            if set_name == "megacap5":
                entry[opt]["in_sample_tangency"] = rec["is"]["full"]
            if set_name == "cross":
                entry[opt]["gmv_agg_into_2022"] = rec["agg2022"]
    mc = out["sets"]["megacap5"]
    mc["published_in_sample"] = IN_SAMPLE
    _, _, _, rows = sensitivity_windows(ENDS[e], RATES[r], o)
    mc["sensitivity_apple"] = {"published": APPLE_SENS,
                               "windows": [{"label": row["label"], "bars": row["lb"],
                                            "tangency_aapl": float(row["tan"].x[0])}
                                           for row in rows]}
    out["sets"]["cross"]["published_agg_into_2022"] = AGG_2022
    pathlib.Path(path).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n",
                                  encoding="utf-8", newline="\n")
    print(f"wrote {path}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # the published minus sign is not cp1252
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grid")
    g.add_argument("out")
    g.add_argument("--rf-csv", default=None,
                   help="read DGS3MO from this saved CSV instead of fetching it from FRED")
    r = sub.add_parser("read")
    r.add_argument("grid")
    s = sub.add_parser("sensitivity")
    s.add_argument("--end", default=ENDS["e0904"])
    s.add_argument("--rf", type=float, default=None)
    s.add_argument("--tight", action="store_true")
    c = sub.add_parser("check")
    c.add_argument("--key", default=PINNED)
    d = sub.add_parser("dump")
    d.add_argument("out", nargs="?", default=str(FIX / "walkforward.json"))
    a = ap.parse_args()
    if a.cmd == "grid":
        run_grid(a.out, a.rf_csv)
    elif a.cmd == "read":
        read_grid(a.grid)
    elif a.cmd == "sensitivity":
        # By default both rates the app could have held on Sep 6: 3.89% (its live bill fetch) and
        # 2% (its fallback). Only 2% reproduces the published Apple weights.
        for rf in ([a.rf] if a.rf is not None else [RATES["rf389"], RATES["rf200"]]):
            sensitivity(a.end, rf, "tight" if a.tight else "ship")
            print()
    elif a.cmd == "check":
        sys.exit(check(a.key))
    elif a.cmd == "dump":
        dump(a.out)


if __name__ == "__main__":
    main()
