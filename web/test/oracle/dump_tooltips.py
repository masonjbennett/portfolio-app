"""Write the app's tiered tooltips to web/src/content/tooltips.json, for src/content/tooltips.ts.

TOOLTIPS (portfolio_app.py 525-581) is a pure dict literal, key -> {"Beginner", "Intermediate",
"Advanced"} -> text. It is sliced out of the shipping file and exec'd, never retyped: a copy would
pass forever while the app it claims to match moved on (see _slice.py). The END anchor is searched
for FROM the START anchor.

The three levels are renamed to the port's ids, in the app's order (the knowledge radio, 650-656):
Beginner -> plain, Intermediate -> finance, Advanced -> formula. Keys keep the dict's order.
Standard library only, so the freshness check in test/t-tooltips.mjs runs on any Python 3.

    python web/test/oracle/dump_tooltips.py            write src/content/tooltips.json
    python web/test/oracle/dump_tooltips.py --print    print it instead (what t-tooltips compares)
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _slice import segment  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "src" / "content" / "tooltips.json"
LEVELS = {"Beginner": "plain", "Intermediate": "finance", "Advanced": "formula"}


def dump() -> str:
    ns: dict = {}
    exec(compile(segment("TOOLTIPS = {", "def tip("), "portfolio_app.py[TOOLTIPS]", "exec"), ns)
    tips = ns["TOOLTIPS"]
    out = {}
    for key, by_level in tips.items():
        assert set(by_level) == set(LEVELS), f"TOOLTIPS[{key!r}] has levels {sorted(by_level)}"
        out[key] = {LEVELS[name]: by_level[name] for name in LEVELS}
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    text = dump()
    if "--print" in sys.argv[1:]:
        sys.stdout.buffer.write(text.encode("utf-8"))
    else:
        OUT.write_bytes(text.encode("utf-8"))
        print(f"wrote {OUT} ({len(text.encode('utf-8'))} bytes)")
