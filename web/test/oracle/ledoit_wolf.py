# Reference values for ledoitWolf (test/t-constructions.mjs): the Ledoit-Wolf shrinkage of the sample covariance
# toward the constant-correlation target, computed once here and committed as test/fixtures/ledoit-wolf.json.
#
#   cd portfolio-app && .venv/Scripts/python.exe web/test/oracle/ledoit_wolf.py
#
# The intensity is Ledoit and Wolf (2004), "Honey, I Shrunk the Sample Covariance Matrix", Journal of Portfolio
# Management 30(4), computed as their own covCor.m does: moments over T (not T - 1), on demeaned returns,
#   delta = max(0, min(1, (pi - rho) / gamma / T)).
# It is computed twice, once vectorised as covCor.m writes it and once as the paper's sums written out pair by
# pair, and the script stops unless the two agree. The shrunk matrix is then the page's: that intensity applied to
# the engine's sample covariance S (ddof 1) and the target built from S, delta F + (1 - delta) S. F keeps S's
# variances, so the diagonal is S's.
#
# Three seeded cases, returns from one shared factor plus noise with very different volatilities per asset (as in a
# basket of stocks and bonds): 5 assets over 600 days, 3 over 300, 10 over 120 (few rows for the assets, so a large
# intensity).
import json
from pathlib import Path

import numpy as np

rng = np.random.default_rng(20261015)


def cov_cor(x):
    """covCor.m, vectorised: (intensity, rBar) on T x n returns."""
    t, n = x.shape
    x = x - x.mean(axis=0)
    sample = x.T @ x / t
    var = np.diag(sample)
    sd = np.sqrt(var)
    rbar = ((sample / np.outer(sd, sd)).sum() - n) / (n * (n - 1))
    prior = rbar * np.outer(sd, sd)
    np.fill_diagonal(prior, var)
    y = x**2
    phi_mat = y.T @ y / t - sample**2
    phi = phi_mat.sum()
    theta = (x**3).T @ x / t - var[:, None] * sample
    np.fill_diagonal(theta, 0.0)
    rho = np.diag(phi_mat).sum() + rbar * ((np.outer(1 / sd, sd)) * theta).sum()
    gamma = np.linalg.norm(sample - prior, "fro") ** 2
    kappa = (phi - rho) / gamma
    return max(0.0, min(1.0, kappa / t)), rbar


def by_hand(x):
    """The paper's pi, rho and gamma written out sum by sum, for the cross-check."""
    t, n = x.shape
    d = x - x.mean(axis=0)
    s = np.array([[np.mean(d[:, i] * d[:, j]) for j in range(n)] for i in range(n)])
    r = np.array([[s[i, j] / np.sqrt(s[i, i] * s[j, j]) for j in range(n)] for i in range(n)])
    rbar = sum(r[i, j] for i in range(n) for j in range(n) if i != j) / (n * (n - 1))
    f = np.array([[s[i, i] if i == j else rbar * np.sqrt(s[i, i] * s[j, j]) for j in range(n)] for i in range(n)])
    pi = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            pi[i, j] = np.mean((d[:, i] * d[:, j] - s[i, j]) ** 2)
    rho = sum(pi[i, i] for i in range(n))
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            th_ii = np.mean((d[:, i] ** 2 - s[i, i]) * (d[:, i] * d[:, j] - s[i, j]))
            th_jj = np.mean((d[:, j] ** 2 - s[j, j]) * (d[:, i] * d[:, j] - s[i, j]))
            rho += rbar / 2 * (np.sqrt(s[j, j] / s[i, i]) * th_ii + np.sqrt(s[i, i] / s[j, j]) * th_jj)
    gamma = ((f - s) ** 2).sum()
    return max(0.0, min(1.0, (pi.sum() - rho) / gamma / t)), rbar


def case(name, T, vols, loads):
    n = len(vols)
    f = rng.standard_t(5, T) * 0.01
    e = rng.standard_t(5, (T, n)) * 0.01
    x = 0.0003 + f[:, None] * np.array(loads) + e * np.array(vols)
    delta, rbar = cov_cor(x)
    delta2, rbar2 = by_hand(x)
    assert abs(delta - delta2) < 1e-12 and abs(rbar - rbar2) < 1e-12, (name, delta, delta2, rbar, rbar2)
    S = np.cov(x, rowvar=False, ddof=1)
    sd = np.sqrt(np.diag(S))
    F = rbar * np.outer(sd, sd)
    np.fill_diagonal(F, np.diag(S))
    return {
        "name": name,
        "cols": x.T.tolist(),
        "intensity": delta,
        "rBar": rbar,
        "shrunk": (delta * F + (1 - delta) * S).tolist(),
    }


out = {
    "source": f"numpy {np.__version__}: Ledoit-Wolf (2004) covCor.m, cross-checked against the paper's sums written out",
    "cases": [
        case("5 assets, 600 days", 600, [1.0, 1.6, 0.4, 0.9, 2.2], [1.0, 1.3, 0.1, 0.8, 1.5]),
        case("3 assets, 300 days", 300, [0.8, 0.3, 1.4], [0.9, -0.2, 1.1]),
        case("10 assets, 120 days", 120, [1.0, 1.2, 0.5, 0.9, 1.8, 0.7, 1.1, 0.3, 1.5, 1.0], [1.0, 1.1, 0.2, 0.7, 1.4, 0.9, 1.0, 0.1, 1.3, 0.6]),
    ],
}
dest = Path(__file__).resolve().parents[1] / "fixtures" / "ledoit-wolf.json"
dest.write_text(json.dumps(out, indent=1) + "\n")
print(f"wrote {dest}: " + ", ".join(f"{c['name']} delta={c['intensity']:.4f} rBar={c['rBar']:.3f}" for c in out["cases"]))
