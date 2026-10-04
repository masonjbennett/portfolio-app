"""Freeze the price fixtures the parity suite computes on. Run ONCE; the output is committed.

Why frozen: Yahoo restates adjusted closes on every dividend, so two live pulls an hour apart
are not the same input, and a parity check between two live apps proves nothing. Both sides
compute on these files instead.

The pull goes through the app's OWN download_data (sliced out of portfolio_app.py), so the
fixture carries exactly what the app would have held before its Run-time cleaning: the outer
join of every series on the union of dates, NaN where a ticker had no bar, and the app's actual
column order (first-batch successes in input order with the benchmark last among them, then
anything a retry recovered). The cleaning itself is NOT applied here; dump_oracle.py applies it,
so the port's cleaning is tested too.

    python web/test/oracle/freeze_prices.py [set ...]
"""
import json
import math
import pathlib
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _slice import load  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[1] / "fixtures"

# yfinance's end is EXCLUSIVE: 2026-09-26 (a Saturday) makes Friday Sep 25 the last bar.
START, END = "2019-01-01", "2026-09-26"

SETS = {
    # The three presets the site's method note tested, in their current spelling.
    "megacap": ("AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA", "^GSPC"),
    "sectors": ("XLK, XLF, XLV, XLE, XLI, XLP, XLY, XLU, XLRE", "^GSPC"),
    "cross": ("VTI, AGG, GLD, VNQ, EFA", "^GSPC"),
    # The five mega-caps the published walk-forward actually used. They are not the mega-cap
    # preset above: JPM in place of NVDA, META and TSLA.
    "megacap5": ("AAPL, MSFT, GOOGL, AMZN, JPM", "^GSPC"),
    # The same assets benchmarked against one of themselves: the app merges VTI into the
    # benchmark column and silently drops it from the portfolio (ledger: benchmark-as-ticker).
    "cross_vti": ("VTI, AGG, GLD, VNQ, EFA", "VTI"),
    # Exercises every cleaning branch: UBER listed May 2019 (under 5% missing, so it stays and
    # truncates the range), ABNB Dec 2020 (far over 5%, so dropped), ZZZQX does not exist.
    "dirty": ("AAPL, MSFT, JPM, KO, UBER, ABNB, ZZZQX", "^GSPC"),
}


def tickers_of(s: str) -> list:
    # The app's own parse (portfolio_app.py, the tickers_raw line at Run).
    return list(dict.fromkeys(t.strip().upper() for t in s.split(",") if t.strip()))


def main():
    ns = load("# A series shorter than this", "def compute_returns(",
              ["_fetch_prices", "download_data"], pd=pd, yf=yf, time=time)
    download_data = ns["download_data"]
    only = sys.argv[1:]  # e.g. `freeze_prices.py dirty` re-pulls one set
    for name, (raw, bench) in SETS.items():
        if only and name not in only:
            continue
        tickers = tickers_of(raw)
        prices, missing = download_data(tickers, START, END, bench)
        assert prices is not None, f"{name}: nothing downloaded"
        rows = []
        for ts, row in prices.iterrows():
            rows.append([ts.strftime("%Y-%m-%d")] +
                        [None if (v is None or math.isnan(v)) else float(v) for v in row.tolist()])
        doc = {
            "set": name,
            "input": raw,
            "tickers": tickers,
            "benchmark": bench,
            "start": START,
            "end": END,
            "pulledAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "portfolio_app.download_data -> yfinance.download(auto_adjust=True)",
            "yfinance": yf.__version__,
            "missing": missing,
            "columns": [str(c) for c in prices.columns],
            "rows": rows,
        }
        path = OUT / f"prices-{name}.json"
        # json.dumps writes floats with repr, which round-trips a double exactly.
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        print(f"{name}: {len(rows)} rows x {len(doc['columns'])} cols {doc['columns']} missing={missing}")


if __name__ == "__main__":
    main()
