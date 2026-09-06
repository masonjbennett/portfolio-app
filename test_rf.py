"""Tests for the live risk-free-rate lookup in portfolio_app.py.

The function is sliced out of the real file (the trick test_download.py uses)
so a change that breaks a rule fails here rather than in production.
"""
import pathlib, sys, types, io, urllib.request
from datetime import date, timedelta

APP = pathlib.Path(__file__).with_name("portfolio_app.py")
SRC = APP.read_text(encoding="utf-8")
SEG = SRC[SRC.index("# \u2500\u2500 Live risk-free rate"):SRC.index("# " + "\u2550" * 10)]
assert "def fetch_rf_rate(" in SEG, "extraction missed fetch_rf_rate"

FAILS, N = [], [0]
def check(cond, label):
    N[0] += 1
    if not cond:
        FAILS.append(label); print("  FAIL  " + label)

# -- stub streamlit so the cache decorator is a passthrough with .clear() ------
class FakeCache:
    def __call__(self, **kw):
        def deco(fn):
            fn.clear = lambda: None
            return fn
        return deco
st_stub = types.SimpleNamespace(cache_data=FakeCache())
ns = {"st": st_stub, "date": date, "timedelta": timedelta}
exec(SEG, ns)
fetch_rf_rate = ns["fetch_rf_rate"]
RF_FALLBACK = ns["RF_FALLBACK"]

# ============ 1. against REAL FRED ============
print("== live FRED ==")
got = fetch_rf_rate()
check(got is not None, "live FRED returns a value")
if got:
    rate, asof = got
    print(f"  DGS3MO = {rate}%  as of {asof}")
    check(isinstance(rate, float), "rate is a float")
    check(0.0 <= rate <= 25.0, f"rate in a sane band (got {rate})")
    check(len(asof) == 10 and asof[4] == "-", f"date looks like YYYY-MM-DD (got {asof})")
    d = date.fromisoformat(asof)
    check((date.today() - d).days <= 14, f"observation is recent (got {(date.today()-d).days}d old)")
    check(rate != RF_FALLBACK, "live rate is not silently the fallback")

# ============ 2. parsing edge cases ============
print("== parsing ==")
real_open = urllib.request.urlopen
class FakeResp:
    def __init__(self, body): self.body = body.encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False

def with_body(body):
    urllib.request.urlopen = lambda *a, **k: FakeResp(body)
    try:
        return fetch_rf_rate()
    finally:
        urllib.request.urlopen = real_open

# takes the LAST non-missing row, not the last row
r = with_body("DATE,DGS3MO\n2026-09-01,4.10\n2026-09-02,4.20\n2026-09-03,.\n")
check(r == (4.20, "2026-09-02"), f"skips trailing '.' and takes last real value (got {r})")

# every row missing -> None, not a crash and not a zero
r = with_body("DATE,DGS3MO\n2026-09-01,.\n2026-09-02,.\n")
check(r is None, f"all-missing window returns None (got {r})")

# newer FRED header name still parses (observation_date)
r = with_body("observation_date,DGS3MO\n2026-09-02,4.33\n")
check(r == (4.33, "2026-09-02"), f"handles observation_date header (got {r})")

# header only
check(with_body("DATE,DGS3MO\n") is None, "header-only body returns None")
# junk
check(with_body("total nonsense") is None, "junk body returns None")
# a zero rate is a legitimate reading, not a failure
r = with_body("DATE,DGS3MO\n2026-09-02,0.00\n")
check(r == (0.0, "2026-09-02"), f"0.00 is kept as a real rate (got {r})")

# ============ 3. network failure ============
print("== failure ==")
def boom(*a, **k): raise OSError("network down")
urllib.request.urlopen = boom
try:
    check(fetch_rf_rate() is None, "network error returns None rather than raising")
finally:
    urllib.request.urlopen = real_open

# ============ 4. the request itself ============
print("== request shape ==")
seen = {}
def capture(url, timeout=None):
    seen["url"] = url
    return FakeResp("DATE,DGS3MO\n2026-09-02,4.0\n")
urllib.request.urlopen = capture
try:
    fetch_rf_rate()
finally:
    urllib.request.urlopen = real_open
u = seen.get("url", "")
check("id=DGS3MO" in u, "requests DGS3MO")
check(u.count("id=") == 1, "ONE series per request (the ZIP trap)")
check("cosd=" in u, "pins a short window rather than pulling since 1982")

print(f"\n{N[0]} checks, {len(FAILS)} failed")
if FAILS:
    sys.exit(1)
