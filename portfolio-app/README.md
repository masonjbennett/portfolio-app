# Portfolio Analytics

An interactive portfolio analytics application built with Streamlit for real-time equity portfolio construction, optimization, and risk analysis.

**Mason Bennett | M.S. in Finance | University of Arkansas**

## Features

- **Returns & Exploratory Analysis** — Summary statistics, cumulative wealth charts, return distributions with normal fit and Q-Q plots
- **Risk Analysis** — Rolling volatility, drawdown analysis, Sharpe/Sortino ratios, CAPM Beta & Alpha
- **Correlation & Covariance** — Pairwise correlation heatmaps, rolling correlations, covariance matrices
- **Portfolio Optimization** — Equal-weight, Global Minimum Variance, and Maximum Sharpe (Tangency) portfolios with efficient frontier and Capital Allocation Line
- **Custom Portfolio Builder** — User-defined portfolio weights with dynamic performance metrics
- **Estimation Window Sensitivity** — Analyze how lookback periods affect optimization results

## Tech Stack

- **Streamlit** — Interactive web framework
- **yfinance** — Market data from Yahoo Finance
- **scipy** — Portfolio optimization (SLSQP)
- **Plotly** — Interactive charts
- **pandas / NumPy** — Data processing

## Run Locally

```bash
pip install -r requirements.txt
streamlit run portfolio_app.py
```

## Methodology

- Simple (arithmetic) daily returns
- Annualization: mean x 252, std x sqrt(252)
- Portfolio variance: full quadratic form w'Sigma*w
- Optimization: scipy.optimize.minimize with SLSQP, no-short-selling constraints
- Efficient frontier: constrained optimization at each target return level
- Sortino ratio: downside deviation using returns below the daily risk-free rate
