"""Offline tests for the market-data layer in portfolio_app.py.

These drive the SHIPPING source text — the two functions are sliced out of
portfolio_app.py and exec'd with `yfinance`, `streamlit` and `time` stubbed —
so a change to the real file that breaks a rule fails here rather than in
production. portfolio_app.py runs Streamlit at import time, which is why the
functions are extracted rather than imported.

    python test_download.py
"""

import pathlib
import sys

import pandas as pd

FAILURES = []
CHECKS = [0]


def check(cond, label):
    CHECKS[0] += 1
    if not cond:
        FAILURES.append(label)
        print("  FAIL  " + label)


# -- Load the real functions out of portfolio_app.py -------------------------
SRC = pathlib.Path(__file__).with_name("portfolio_app.py").read_text(encoding="utf-8")
SEGMENT = SRC[SRC.index("# A series shorter than this"):SRC.index("def compute_returns(")]

assert "def _fetch_prices(" in SEGMENT, "extraction missed _fetch_prices"
assert "def download_data(" in SEGMENT, "extraction missed download_data"


# -- Stubs -------------------------------------------------------------------
class FakeYF:
    """Records every call and replays a scripted list of responses."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def download(self, tickers, **kwargs):
        self.calls.append((list(tickers), kwargs))
        if not self.responses:
            return pd.DataFrame()
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class FakeCache:
    """Stands in for st.cache_data: a pass-through decorator with .clear()."""

    def __init__(self):
        self.cleared = 0

    def __call__(self, *dargs, **dkwargs):
        def deco(fn):
            fn.clear = self._clear
            return fn
        return deco

    def _clear(self):
        self.cleared += 1


class FakeST:
    def __init__(self):
        self.cache_data = FakeCache()


class FakeClock:
    def __init__(self):
        self.sleeps = []

    def sleep(self, s):
        self.sleeps.append(s)


def build(responses):
    """exec the extracted source with stubs; return (namespace, yf, clock)."""
    yf = FakeYF(responses)
    clock = FakeClock()
    ns = {"pd": pd, "yf": yf, "st": FakeST(), "time": clock}
    exec(compile(SEGMENT, "portfolio_app.py[extract]", "exec"), ns)
    return ns, yf, clock


# -- Fixtures ----------------------------------------------------------------
IDX = pd.bdate_range("2019-01-01", periods=200)


def multi(tickers, rows=200):
    """A yfinance-shaped MultiIndex frame: level 0 = field, level 1 = ticker."""
    fields = ["Close", "High", "Low", "Open", "Volume"]
    cols = pd.MultiIndex.from_product([fields, tickers])
    data = {}
    for f in fields:
        for i, t in enumerate(tickers):
            data[(f, t)] = [100.0 + i + n for n in range(rows)]
    return pd.DataFrame(data, index=IDX[:rows], columns=cols)


def flat(rows=200):
    """The shape yfinance returns for a single ticker: flat columns."""
    return pd.DataFrame(
        {"Close": [100.0 + n for n in range(rows)], "Open": [1.0] * rows},
        index=IDX[:rows],
    )


TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM"]
BENCH = "^GSPC"
ALL = TICKERS + [BENCH]

print("Market-data layer")

# 1 -- one batched request, not one per ticker -------------------------------
ns, yf, clock = build([multi(ALL)])
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(len(yf.calls) == 1, "6 tickers cost exactly ONE request (was 6)")
check(sorted(yf.calls[0][0]) == sorted(ALL), "the single request carries every ticker")
check(missing == [], "nothing reported as failed")
check(prices is not None and list(prices.columns) == ALL, "all six columns returned")
check(len(prices) == 200, "200 rows kept")
check(yf.calls[0][1].get("auto_adjust") is True, "auto_adjust stays on (adjusted closes)")

# 2 -- a throttled (empty) first batch is retried, not reported as failure ----
ns, yf, clock = build([pd.DataFrame(), multi(ALL)])
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(len(yf.calls) == 2, "an empty batch triggers a retry")
check(missing == [], "the retry's data means NOTHING is reported as a bad ticker")
check(prices is not None and len(prices.columns) == 6, "retry fills every column")
check(clock.sleeps == [1.0], "backoff slept once before retrying")

# 3 -- partial batch: only the missing names are retried ---------------------
ns, yf, clock = build([multi(["AAPL", "MSFT", "GOOGL"]), multi(["AMZN", "JPM", BENCH])])
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(sorted(yf.calls[1][0]) == sorted(["AMZN", "JPM", BENCH]),
      "the retry asks only for what is still missing")
check(missing == [], "partial first batch + retry = no reported failures")
check(list(prices.columns) == ALL, "column order follows the requested order")

# 4 -- a genuinely bad ticker survives both retries and is reported ----------
good = list(ALL)
ns, yf, clock = build([multi(good), multi(good), multi(good)])
prices, missing = ns["download_data"](TICKERS + ["ZZZZ"], "2019-01-01", "2026-08-01", BENCH)
check(len(yf.calls) == 3, "a persistent miss is retried twice, then given up on")
check(missing == ["ZZZZ"], "only the bad ticker is reported")
check("ZZZZ" not in prices.columns and len(prices.columns) == 6,
      "the good tickers still come back")
check(clock.sleeps == [1.0, 3.0], "backoff grows between retries")

# 5 -- single ticker: yfinance returns FLAT columns --------------------------
ns, yf, clock = build([flat()])
out = ns["_fetch_prices"](["AAPL"], "2019-01-01", "2026-08-01")
check(list(out) == ["AAPL"], "flat single-ticker frame is labelled correctly")
check(len(out["AAPL"]) == 200, "flat frame keeps its rows")

# 6 -- a series shorter than MIN_TRADING_DAYS is no data, not a stub ---------
ns, yf, clock = build([multi(ALL, rows=10)] * 3)
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(ns["MIN_TRADING_DAYS"] == 30, "MIN_TRADING_DAYS threshold is 30")
check(prices is None and sorted(missing) == sorted(ALL),
      "a 10-row series counts as missing, not as a usable column")

# 7 -- an exception from yfinance is contained, not propagated ---------------
ns, yf, clock = build([RuntimeError("429 Too Many Requests"), multi(ALL)])
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(missing == [], "a raised 429 is retried and recovers")
check(prices is not None, "no exception escapes download_data")

# 8 -- total failure returns (None, everything) ------------------------------
ns, yf, clock = build([pd.DataFrame()] * 3)
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(prices is None, "no data at all returns None")
check(sorted(missing) == sorted(ALL), "every ticker including the benchmark is reported")

# 9 -- a benchmark already in the ticker list is not requested twice ---------
ns, yf, clock = build([multi(["AAPL", "MSFT", "SPY"])])
prices, missing = ns["download_data"](["AAPL", "MSFT", "SPY"], "2019-01-01", "2026-08-01", "SPY")
check(yf.calls[0][0].count("SPY") == 1, "the benchmark is requested once, not twice")
check(list(prices.columns) == ["AAPL", "MSFT", "SPY"], "no duplicate column")

# 10 -- a frame with no Close column is not mistaken for data ----------------
ns, yf, clock = build([pd.DataFrame({"Open": [1.0] * 200}, index=IDX)] * 3)
prices, missing = ns["download_data"](TICKERS, "2019-01-01", "2026-08-01", BENCH)
check(prices is None, "a frame without Close yields no prices")

# 11 -- the caller evicts a failed result from the cache --------------------
CALLER = SRC[SRC.index('    with st.spinner("Downloading market data'):]
CALLER = CALLER[:CALLER.index("if prices is None or prices.shape[1] < 4:")]
check("download_data.clear()" in CALLER,
      "a failed download is cleared from the cache so a retry re-contacts Yahoo")
check(CALLER.index("download_data.clear()") < CALLER.index("bench_failed ="),
      "the cache is cleared before anything else branches on the failure")

# 12 -- the failure message leads with the real cause -----------------------
WARNING = SRC[SRC.index("Could not download data for:"):][:700]
check("rate-limiting" in WARNING, "the warning names rate-limiting as the likely cause")
check("Run Analysis" in WARNING, "the warning tells the user the retry is worth making")
check(WARNING.index("rate-limiting") < WARNING.index("spelled correctly"),
      "rate-limiting is offered BEFORE blaming the user's spelling")

# 13 -- no per-ticker loop survives -----------------------------------------
check("time.sleep(0.15)" not in SRC, "the old per-request 0.15s sleep is gone")
check(SEGMENT.count("yf.download(") == 1, "exactly one download call site remains")

print("\n%d checks, %d failed" % (CHECKS[0], len(FAILURES)))
if FAILURES:
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("all passing")
