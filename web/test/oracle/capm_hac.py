# Reference values for olsHAC / capmFit (test/t-capm.mjs): OLS with Newey-West standard errors, computed
# once by statsmodels and committed as test/fixtures/capm-hac.json.
#
#   cd portfolio-app && .venv/Scripts/python.exe web/test/oracle/capm_hac.py
#
# Three seeded cases: 93 "months" with autocorrelated errors (lag 3), 40 months (lag 3), and 600 "days"
# (lag 5). The lag is floor(4 (T/100)^(2/9)), the page's rule, passed to statsmodels as maxlags.
import json
import math
from pathlib import Path

import numpy as np
import statsmodels
import statsmodels.api as sm

rng = np.random.default_rng(20261015)


def case(name, T, scale, beta, alpha, rho):
    x = rng.normal(0.0, scale, T)
    u = rng.normal(0.0, scale * 0.6, T)
    e = np.empty(T)
    e[0] = u[0]
    for t in range(1, T):
        e[t] = rho * e[t - 1] + u[t]
    y = alpha + beta * x + e
    L = math.floor(4 * (T / 100) ** (2 / 9))
    X = sm.add_constant(x)
    hac = sm.OLS(y, X).fit(cov_type="HAC", cov_kwds={"maxlags": L})
    return {
        "name": name,
        "x": x.tolist(),
        "y": y.tolist(),
        "lag": L,
        "intercept": float(hac.params[0]),
        "slope": float(hac.params[1]),
        "interceptSE": float(hac.bse[0]),
        "slopeSE": float(hac.bse[1]),
        "interceptT": float(hac.tvalues[0]),
        "r2": float(hac.rsquared),
    }


out = {
    "source": f"statsmodels {statsmodels.__version__}: OLS(y, add_constant(x)).fit(cov_type='HAC', cov_kwds={{'maxlags': L}})",
    "cases": [
        case("93 months, AR(1) errors", 93, 0.045, 1.1, 0.002, 0.4),
        case("40 months", 40, 0.05, 0.7, -0.001, 0.1),
        case("600 days", 600, 0.012, 0.9, 0.0002, 0.2),
    ],
}
dest = Path(__file__).resolve().parents[1] / "fixtures" / "capm-hac.json"
dest.write_text(json.dumps(out, indent=1) + "\n")
print(f"wrote {dest}: " + ", ".join(f"{c['name']} L={c['lag']}" for c in out["cases"]))
