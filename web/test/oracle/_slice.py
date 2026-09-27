"""Load the SHIPPING functions out of portfolio_app.py, never a copy of them.

The web port is held to the Streamlit app's own code, the way test_download.py and
test_rf.py already hold themselves to it: slice the source between two anchor strings
and exec the slice with stubs for the Streamlit and network globals. A copy would pass
forever while the app it claims to match moved on.

Every END anchor is searched for FROM its START anchor. `SRC.index(end)` alone finds the
first occurrence in the whole file, which works in test_rf.py only because no banner
happens to precede its segment.
"""
import pathlib
import types

APP = pathlib.Path(__file__).resolve().parents[3] / "portfolio_app.py"
SRC = APP.read_text(encoding="utf-8")


def segment(start: str, end: str) -> str:
    i = SRC.index(start)
    j = SRC.index(end, i)
    return SRC[i:j]


class _Cache:
    """Stands in for st.cache_data in all three spellings the app uses:
    @st.cache_data, @st.cache_data(ttl=...), and .clear() on the result."""

    def __call__(self, *args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs:
            fn = args[0]
            fn.clear = lambda: None
            return fn

        def wrap(fn):
            fn.clear = lambda: None
            return fn

        return wrap


FAKE_ST = types.SimpleNamespace(cache_data=_Cache())


def load(start: str, end: str, must_define: list, **globs) -> dict:
    seg = segment(start, end)
    for name in must_define:
        assert f"def {name}(" in seg, f"slice {start!r}..{end!r} missed {name}"
    ns = dict(globs)
    ns.setdefault("st", FAKE_ST)
    exec(compile(seg, "portfolio_app.py[slice]", "exec"), ns)
    return ns
