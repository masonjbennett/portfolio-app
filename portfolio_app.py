import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
import plotly.io as pio
import yfinance as yf
from scipy import optimize, stats
from datetime import date, timedelta
import io

# ── Page Config ──────────────────────────────────────────────────────────────
st.set_page_config(page_title="Portfolio Analytics", page_icon="📊", layout="wide")

# ── Knowledge Level State ────────────────────────────────────────────────────
if "knowledge" not in st.session_state:
    st.session_state.knowledge = "Beginner"

# ── Color Palettes ───────────────────────────────────────────────────────────
LIGHT_COLORS = {
    "primary":       "#1B2A4A",
    "secondary":     "#2E86AB",
    "accent":        "#F18F01",
    "success":       "#2ECC71",
    "danger":        "#E74C3C",
    "surface":       "#F8F9FC",
    "card":          "#FFFFFF",
    "text":          "#1B2A4A",
    "text_muted":    "#6C7A96",
    "border":        "#E2E8F0",
    "bg":            "#FFFFFF",
    "sidebar_bg":    "linear-gradient(180deg, #1B2A4A 0%, #243B63 100%)",
    "sidebar_text":  "#E2E8F0",
    "sidebar_input": "rgba(255,255,255,0.92)",
    "input_text":    "#1B2A4A",
    "tab_bg":        "#F1F5F9",
    "tab_active_bg": "#FFFFFF",
    "chart_bg":      "#FFFFFF",
    "grid":          "rgba(226,232,240,0.6)",
    "metric_bg":     "#FFFFFF",
}

COLORS = LIGHT_COLORS

# Chart palette — professional and accessible
CHART_COLORS = [
    "#2E86AB", "#F18F01", "#E74C3C", "#2ECC71", "#9B59B6",
    "#1ABC9C", "#E67E22", "#3498DB", "#E91E63", "#00BCD4",
]

# ── Preset Ticker Lists ─────────────────────────────────────────────────────
PRESETS = {
    "FAANG+": {
        "tickers": "AAPL, AMZN, GOOGL, META, NFLX, MSFT",
        "desc": "Big tech giants",
    },
    "Mag 7": {
        "tickers": "AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA",
        "desc": "Top 7 mega caps",
    },
    "Sectors": {
        "tickers": "XLK, XLF, XLV, XLE, XLI, XLP, XLY",
        "desc": "7 sector ETFs",
    },
    "Dividend": {
        "tickers": "JNJ, KO, PG, PEP, MMM, ABT, WMT",
        "desc": "Dividend kings",
    },
    "Growth": {
        "tickers": "NVDA, AMD, SHOP, CRWD, DDOG, NET, PLTR",
        "desc": "High-growth tech",
    },
    "Blue Chip": {
        "tickers": "AAPL, MSFT, JPM, JNJ, V, UNH, PG",
        "desc": "Stable large caps",
    },
}

# ── Custom Plotly Template ───────────────────────────────────────────────────
custom_template = go.layout.Template()
custom_template.layout = go.Layout(
    font=dict(family="Inter, SF Pro Display, -apple-system, sans-serif", color=COLORS["text"]),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    colorway=CHART_COLORS,
    title=dict(font=dict(size=16, color=COLORS["primary"])),
    xaxis=dict(
        gridcolor=COLORS["grid"], gridwidth=1,
        linecolor=COLORS["border"], linewidth=1,
        title_font=dict(size=12, color=COLORS["text_muted"]),
        tickfont=dict(size=11, color=COLORS["text_muted"]),
        title_standoff=15,
        automargin=True,
    ),
    yaxis=dict(
        gridcolor=COLORS["grid"], gridwidth=1,
        linecolor=COLORS["border"], linewidth=1,
        title_font=dict(size=12, color=COLORS["text_muted"]),
        tickfont=dict(size=11, color=COLORS["text_muted"]),
        title_standoff=10,
        automargin=True,
    ),
    legend=dict(
        bgcolor="rgba(0,0,0,0)", bordercolor=COLORS["border"],
        borderwidth=1, font=dict(size=11, color=COLORS["text"]),
    ),
    hoverlabel=dict(bgcolor=COLORS["card"], font_size=12, font_color=COLORS["text"], bordercolor=COLORS["border"]),
    margin=dict(l=50, r=50, t=50, b=60),
)
pio.templates["portfolio"] = custom_template
pio.templates.default = "portfolio"

# ── Custom CSS ───────────────────────────────────────────────────────────────
st.markdown(f"""
<style>
    /* ── Import Fonts ─────────────────────────────────────────────────── */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    /* ── Global ───────────────────────────────────────────────────────── */
    html, body, [class*="css"] {{
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }}
    .block-container {{
        padding-top: 1rem;
        padding-bottom: 2rem;
        max-width: 1200px;
    }}
    .stApp {{
        background-color: {COLORS["bg"]};
    }}

    /* ── Sidebar ──────────────────────────────────────────────────────── */
    [data-testid="stSidebar"] {{
        background: {COLORS["sidebar_bg"]};
    }}
    [data-testid="stSidebar"] * {{
        color: {COLORS["sidebar_text"]} !important;
    }}
    [data-testid="stSidebar"] h1 {{
        font-size: 1.35rem !important;
        font-weight: 700 !important;
        letter-spacing: -0.02em;
        color: #FFFFFF !important;
    }}
    [data-testid="stSidebar"] h2 {{
        font-size: 0.85rem !important;
        font-weight: 600 !important;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94A3C0 !important;
        margin-top: 1rem;
    }}
    [data-testid="stSidebar"] label {{
        font-size: 0.82rem !important;
        font-weight: 500 !important;
        color: #CBD5E1 !important;
    }}
    [data-testid="stSidebar"] .stTextInput input {{
        background: {COLORS["sidebar_input"]} !important;
        border: 1px solid rgba(255,255,255,0.3) !important;
        border-radius: 8px !important;
        color: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] .stTextInput input::placeholder {{
        color: #6C7A96 !important;
    }}
    [data-testid="stSidebar"] .stTextInput input:focus {{
        border-color: #2E86AB !important;
        box-shadow: 0 0 0 2px rgba(46,134,171,0.3) !important;
    }}
    [data-testid="stSidebar"] .stDateInput input {{
        background: {COLORS["sidebar_input"]} !important;
        border: 1px solid rgba(255,255,255,0.3) !important;
        border-radius: 8px !important;
        color: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] .stNumberInput input {{
        background: {COLORS["sidebar_input"]} !important;
        border: 1px solid rgba(255,255,255,0.3) !important;
        border-radius: 8px !important;
        color: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] .stSelectbox [data-baseweb="select"] {{
        background: {COLORS["sidebar_input"]} !important;
        border-radius: 8px !important;
    }}
    [data-testid="stSidebar"] .stSelectbox [data-baseweb="select"] * {{
        color: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] .stSelectbox [data-baseweb="select"] svg {{
        fill: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] .stMultiSelect [data-baseweb="select"] {{
        background: {COLORS["sidebar_input"]} !important;
        border-radius: 8px !important;
    }}
    [data-testid="stSidebar"] .stMultiSelect [data-baseweb="select"] * {{
        color: {COLORS["input_text"]} !important;
    }}
    [data-testid="stSidebar"] hr {{
        border-color: rgba(255,255,255,0.12) !important;
    }}
    /* ── Sidebar preset buttons (secondary) ─────────────────────────── */
    [data-testid="stSidebar"] .stButton > button {{
        background: rgba(255,255,255,0.08) !important;
        color: #CBD5E1 !important;
        border: 1px solid rgba(255,255,255,0.15) !important;
        border-radius: 8px !important;
        font-weight: 500 !important;
        font-size: 0.72rem !important;
        padding: 0.35rem 0.2rem !important;
        min-height: 36px !important;
        height: 36px !important;
        transition: all 0.2s ease !important;
        box-shadow: none !important;
        overflow: hidden !important;
    }}
    [data-testid="stSidebar"] .stButton > button:hover {{
        background: rgba(255,255,255,0.15) !important;
        border-color: rgba(255,255,255,0.3) !important;
        color: #FFFFFF !important;
        box-shadow: none !important;
        transform: none !important;
    }}
    /* ── Sidebar Run Analysis button (primary) ───────────────────────── */
    [data-testid="stSidebar"] .stButton > button[kind="primary"],
    [data-testid="stSidebar"] .stButton > button[data-testid="stBaseButton-primary"] {{
        background: linear-gradient(135deg, #2E86AB 0%, #1B6E93 100%) !important;
        color: #FFFFFF !important;
        border: none !important;
        border-radius: 10px !important;
        font-weight: 600 !important;
        font-size: 0.95rem !important;
        padding: 0.6rem 1.2rem !important;
        min-height: unset !important;
        height: unset !important;
        transition: all 0.2s ease !important;
        box-shadow: 0 2px 8px rgba(46,134,171,0.3) !important;
    }}
    [data-testid="stSidebar"] .stButton > button[kind="primary"]:hover,
    [data-testid="stSidebar"] .stButton > button[data-testid="stBaseButton-primary"]:hover {{
        background: linear-gradient(135deg, #3A9BC4 0%, #2E86AB 100%) !important;
        box-shadow: 0 4px 14px rgba(46,134,171,0.45) !important;
        transform: translateY(-1px) !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"],
    [data-testid="stSidebar"] [data-testid="stExpander"] *,
    [data-testid="stSidebar"] [data-testid="stExpander"] details,
    [data-testid="stSidebar"] [data-testid="stExpander"] summary,
    [data-testid="stSidebar"] [data-testid="stExpander"] [data-testid="stExpanderDetails"],
    [data-testid="stSidebar"] [data-testid="stExpander"] div {{
        background: transparent !important;
        background-color: transparent !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"] {{
        border: 1px solid rgba(255,255,255,0.1) !important;
        border-radius: 8px !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"] p,
    [data-testid="stSidebar"] [data-testid="stExpander"] span,
    [data-testid="stSidebar"] [data-testid="stExpander"] li,
    [data-testid="stSidebar"] [data-testid="stExpander"] strong {{
        color: #E2E8F0 !important;
    }}
    [data-testid="stSidebar"] code {{
        background: rgba(255,255,255,0.12) !important;
        background-color: rgba(255,255,255,0.12) !important;
        color: #7DD3FC !important;
        border: none !important;
    }}

    /* ── Main Headers ─────────────────────────────────────────────────── */
    h1 {{
        font-weight: 700 !important;
        color: {COLORS["primary"]} !important;
        letter-spacing: -0.03em;
    }}
    h2 {{
        font-weight: 600 !important;
        color: {COLORS["primary"]} !important;
        font-size: 1.3rem !important;
        margin-top: 0.5rem !important;
        letter-spacing: -0.02em;
    }}
    h3 {{
        font-weight: 600 !important;
        color: {COLORS["text"]} !important;
        font-size: 1.05rem !important;
    }}

    /* ── Tabs ─────────────────────────────────────────────────────────── */
    [data-baseweb="tab-list"] {{
        gap: 0px;
        background: {COLORS["tab_bg"]};
        border-radius: 12px;
        padding: 4px;
        overflow-x: auto;
    }}
    [data-baseweb="tab"] {{
        border-radius: 8px !important;
        font-weight: 500 !important;
        font-size: 0.85rem !important;
        padding: 0.45rem 1rem !important;
        color: {COLORS["text_muted"]} !important;
    }}
    [data-baseweb="tab"][aria-selected="true"] {{
        background: {COLORS["tab_active_bg"]} !important;
        color: {COLORS["primary"]} !important;
        font-weight: 600 !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
    }}
    [data-baseweb="tab-highlight"] {{
        display: none !important;
    }}
    [data-baseweb="tab-border"] {{
        display: none !important;
    }}

    /* ── Metric Cards ─────────────────────────────────────────────────── */
    [data-testid="stMetricValue"] {{
        font-size: 1.25rem !important;
        font-weight: 700 !important;
        color: {COLORS["primary"]} !important;
    }}
    [data-testid="stMetricLabel"] {{
        font-size: 0.78rem !important;
        font-weight: 500 !important;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: {COLORS["text_muted"]} !important;
    }}
    [data-testid="stMetricDelta"] {{
        font-size: 0.78rem !important;
    }}
    [data-testid="metric-container"] {{
        background: {COLORS["metric_bg"]};
        border: 1px solid {COLORS["border"]};
        border-radius: 10px;
        padding: 16px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }}

    /* ── Data Frames ──────────────────────────────────────────────────── */
    [data-testid="stDataFrame"] {{
        border: 1px solid {COLORS["border"]};
        border-radius: 10px;
        overflow: hidden;
    }}

    /* ── Info / Warning / Error ────────────────────────────────────────── */
    .stAlert {{
        border-radius: 10px !important;
    }}

    /* ── Expanders (main area) ────────────────────────────────────────── */
    .main [data-testid="stExpander"] {{
        background: {COLORS["card"]};
        border: 1px solid {COLORS["border"]} !important;
        border-radius: 10px !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }}

    /* ── Sliders ──────────────────────────────────────────────────────── */
    [data-testid="stSlider"] > div > div > div > div {{
        background-color: #2E86AB !important;
    }}

    /* ── Plotly Charts ────────────────────────────────────────────────── */
    [data-testid="stPlotlyChart"] {{
        background: {COLORS["chart_bg"]};
        border: 1px solid {COLORS["border"]};
        border-radius: 12px;
        padding: 12px 12px 20px 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        overflow: visible !important;
    }}

    /* ── Dividers ─────────────────────────────────────────────────────── */
    hr {{
        border-color: {COLORS["border"]} !important;
    }}

    /* ── Selectbox / Multiselect / Radio ──────────────────────────────── */
    [data-baseweb="select"] {{
        border-radius: 8px !important;
    }}
    .stRadio > label {{
        font-weight: 500 !important;
    }}

    /* ── Hide default Streamlit branding for cleaner look ─────────────── */
    #MainMenu {{visibility: hidden;}}
    footer {{visibility: hidden;}}
    header[data-testid="stHeader"] {{
        background: transparent !important;
        backdrop-filter: none !important;
    }}

    /* ── Section Divider ──────────────────────────────────────────────── */
    .section-divider {{
        height: 3px;
        background: linear-gradient(90deg, #2E86AB, #F18F01);
        border: none;
        border-radius: 2px;
        margin: 0.5rem 0 1.5rem 0;
        opacity: 0.7;
    }}

    /* ── Caption ──────────────────────────────────────────────────────── */
    .stCaption, [data-testid="stCaptionContainer"] {{
        color: {COLORS["text_muted"]} !important;
        font-size: 0.82rem !important;
        line-height: 1.5;
    }}

    /* ── Download Buttons ─────────────────────────────────────────────── */
    .stDownloadButton > button {{
        background: transparent !important;
        border: 1px solid {COLORS["border"]} !important;
        color: {COLORS["text_muted"]} !important;
        font-size: 0.8rem !important;
        padding: 0.3rem 0.8rem !important;
        border-radius: 6px !important;
    }}
    .stDownloadButton > button:hover {{
        border-color: {COLORS["secondary"]} !important;
        color: {COLORS["secondary"]} !important;
    }}

    /* ── Paragraph / general text color ───────────────────────────────── */
    .stMarkdown, .stMarkdown p, .stText {{
        color: {COLORS["text"]} !important;
    }}
</style>
""", unsafe_allow_html=True)


# ── Helper: Section Header with gradient divider ─────────────────────────────
def section_header(title: str):
    """Render a styled section header with a gradient underline."""
    st.subheader(title)
    st.markdown('<div class="section-divider"></div>', unsafe_allow_html=True)


def df_to_excel(df: pd.DataFrame) -> bytes:
    """Convert a DataFrame to Excel bytes for download."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=True)
    return buf.getvalue()


# ── Tiered Tooltip System ────────────────────────────────────────────────────
TOOLTIPS = {
    "return": {
        "Beginner":      "How much money this investment made (or lost) per year on average, shown as a percentage.",
        "Intermediate":  "Annualized arithmetic mean return — the average daily return scaled to a yearly figure (×252 trading days).",
        "Advanced":      "Annualized arithmetic mean: μ = r̄_daily × 252. Simple returns used (not log). Does not account for compounding drag.",
    },
    "volatility": {
        "Beginner":      "How wildly the investment's value swings up and down. Higher = more unpredictable.",
        "Intermediate":  "Annualized standard deviation of daily returns (×√252). Measures total risk — both upside and downside moves.",
        "Advanced":      "σ_annual = σ_daily × √252. Assumes i.i.d. returns for scaling. Full (symmetric) dispersion measure including upside variance.",
    },
    "sharpe": {
        "Beginner":      "A score that shows if the returns are worth the risk. Higher is better — above 1.0 is generally good.",
        "Intermediate":  "Excess return per unit of total risk: (Rₚ − Rf) / σₚ. Compares how much extra return you get for each unit of volatility taken.",
        "Advanced":      "Ex-post Sharpe: (μₚ − Rf) / σₚ using annualized values. Assumes normally distributed returns; can be misleading with skewed or fat-tailed distributions.",
    },
    "sortino": {
        "Beginner":      "Like Sharpe, but only counts the bad volatility (losses). Higher is better.",
        "Intermediate":  "Excess return divided by downside deviation only — ignores upside volatility, focusing purely on harmful risk.",
        "Advanced":      "Sortino = (μₚ − Rf) / σ_down, where σ_down = √(Σ min(rᵢ − Rf_daily, 0)² / N) × √252. Better for asymmetric return distributions.",
    },
    "max_dd": {
        "Beginner":      "The biggest drop from a high point to a low point — the worst loss you could have experienced.",
        "Intermediate":  "Maximum peak-to-trough decline in cumulative returns. Shows worst-case drawdown over the entire period.",
        "Advanced":      "Max DD = min_t [(cum_t − peak_t) / peak_t]. Path-dependent measure; sensitive to sequence of returns, not just distribution.",
    },
    "best_sharpe": {
        "Beginner":      "The best possible risk-vs-reward score achievable by mixing these stocks optimally.",
        "Intermediate":  "The Sharpe ratio of the tangency portfolio — the point where the Capital Allocation Line is steepest.",
        "Advanced":      "Sharpe of the tangency portfolio: max_w (w′μ − Rf) / √(w′Σw), s.t. Σwᵢ=1, wᵢ≥0. Slope of the CAL.",
    },
    "tangency_return": {
        "Beginner":      "The expected yearly return of the best risk-adjusted portfolio mix.",
        "Intermediate":  "Annualized expected return of the maximum-Sharpe portfolio found via constrained optimization.",
        "Advanced":      "μ_tan = w_tan′ μ × 252, where w_tan = argmax Sharpe subject to full-investment and long-only constraints.",
    },
    "bench_return": {
        "Beginner":      "How much the benchmark index returned per year on average — a baseline to compare your portfolio against.",
        "Intermediate":  "Annualized mean return of the selected benchmark index over the analysis period.",
        "Advanced":      "Benchmark annualized arithmetic mean return. Used as the passive alternative in active-vs-passive comparison.",
    },
    "bench_vol": {
        "Beginner":      "How much the benchmark index's value swings around year to year.",
        "Intermediate":  "Annualized standard deviation of the benchmark's daily returns.",
        "Advanced":      "Benchmark σ_annual = σ_daily × √252. Represents systematic market risk for the chosen index.",
    },
    "beta": {
        "Beginner":      "How much a stock moves when the market moves. Beta of 1.0 = moves with the market; above 1.0 = more volatile than the market.",
        "Intermediate":  "Sensitivity of the stock's returns to benchmark returns. Estimated via OLS regression: β = Cov(rᵢ, rₘ) / Var(rₘ).",
        "Advanced":      "CAPM beta from OLS: rᵢ − rf = α + β(rₘ − rf) + ε. Measures systematic risk exposure. Does not capture nonlinear or tail dependencies.",
    },
    "alpha": {
        "Beginner":      "Extra return above (or below) what you'd expect given the stock's risk level. Positive = outperforming, negative = underperforming.",
        "Intermediate":  "Annualized Jensen's alpha — the intercept from regressing excess stock returns on excess benchmark returns. Measures manager/stock skill.",
        "Advanced":      "Jensen's α (annualized): α_annual = â × 252, where â is the daily OLS intercept from rᵢ − rf = α + β(rₘ − rf) + ε. Significance depends on sample size and residual structure.",
    },
}


def tip(key: str) -> str:
    """Return the tooltip string for the current knowledge level."""
    level = st.session_state.get("knowledge", "Beginner")
    return TOOLTIPS.get(key, {}).get(level, "")


# ══════════════════════════════════════════════════════════════════════════════
# SIDEBAR — Inputs
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.title("📊 Portfolio Analytics")
    st.markdown("---")

    # ── Knowledge Level ──────────────────────────────────────────────────
    knowledge = st.radio(
        "Tooltip Detail Level",
        options=["Beginner", "Intermediate", "Advanced"],
        index=["Beginner", "Intermediate", "Advanced"].index(st.session_state.knowledge),
        horizontal=True,
        key="knowledge_radio",
    )
    st.markdown(
        "<span style='font-size:0.78rem; color:#94A3C0; line-height:1.4;'>"
        "Controls the detail level of the info tooltips next to each metric. "
        "Beginner = plain English. Intermediate = finance terms. Advanced = formulas."
        "</span>",
        unsafe_allow_html=True,
    )
    if knowledge != st.session_state.knowledge:
        st.session_state.knowledge = knowledge
        st.rerun()

    st.markdown("---")

    st.subheader("1 · Ticker Selection")

    # Preset buttons — always 3 columns for uniform sizing
    st.markdown(f"<span style='font-size:0.75rem; color:#94A3C0;'>Quick presets:</span>", unsafe_allow_html=True)
    preset_names = list(PRESETS.keys())
    for i in range(0, len(preset_names), 3):
        row = preset_names[i:i+3]
        cols = st.columns(3)  # always 3 columns
        for j, name in enumerate(row):
            with cols[j]:
                if st.button(name, key=f"preset_{name}", use_container_width=True):
                    st.session_state["ticker_input_box"] = PRESETS[name]["tickers"]
                    st.rerun()
                st.markdown(
                    f"<div style='font-size:0.75rem; color:#94A3C0; margin-top:-8px; margin-bottom:6px; line-height:1.4;'>"
                    f"{PRESETS[name]['desc']}</div>",
                    unsafe_allow_html=True,
                )

    # Initialize default if not set by a preset
    if "ticker_input_box" not in st.session_state:
        st.session_state["ticker_input_box"] = "AAPL, MSFT, GOOGL, AMZN, JPM"

    ticker_input = st.text_input(
        "Enter 3–10 tickers (comma-separated)",
        help="Example: AAPL, MSFT, GOOGL",
        key="ticker_input_box",
    )

    st.subheader("2 · Date Range")
    col_d1, col_d2 = st.columns(2)
    with col_d1:
        start_date = st.date_input("Start", value=date(2019, 1, 1))
    with col_d2:
        end_date = st.date_input("End", value=date.today())

    st.subheader("3 · Risk-Free Rate")
    rf_annual = st.number_input("Annualized Rf (%)", value=2.0, step=0.25) / 100.0

    st.subheader("4 · Starting Investment")
    initial_investment = st.number_input("Initial Amount ($)", value=10000, min_value=100, step=1000,
                                          help="Starting dollar amount for cumulative wealth charts")

    st.subheader("5 · Benchmark")
    bench_options = {
        "S&P 500 (Recommended)": "^GSPC",
        "Nasdaq 100": "^NDX",
        "Dow Jones": "^DJI",
        "Russell 2000": "^RUT",
        "MSCI World (URTH)": "URTH",
        "Total Market (VTI)": "VTI",
    }
    bench_label_raw = st.selectbox(
        "Benchmark Index",
        list(bench_options.keys()),
        index=0,
        help="S&P 500 is the most common benchmark for U.S. large-cap equity portfolios",
    )
    bench_ticker = bench_options[bench_label_raw]
    # Clean display name (strip " (Recommended)" suffix for use in charts/tables)
    bench_label = bench_label_raw.replace(" (Recommended)", "")

    st.subheader("6 · Short Selling")
    allow_short = st.toggle(
        "Allow short positions",
        value=False,
        help="When enabled, portfolio weights can go negative (short selling). "
             "The unconstrained frontier is always at least as efficient as long-only.",
    )
    st.markdown(
        "<span style='font-size:0.78rem; color:#94A3C0; line-height:1.4;'>"
        "Can be toggled after running analysis without re-downloading data. "
        "The app may take a moment to recalculate optimizations."
        "</span>",
        unsafe_allow_html=True,
    )

    run_button = st.button("Run Analysis", type="primary", use_container_width=True)

    st.markdown("---")
    with st.expander("ℹ️ About / Methodology"):
        st.markdown("""
        **Data Source**: Yahoo Finance (adjusted close prices).

        **Return Convention**: Simple (arithmetic) daily returns.

        **Annualization**: Mean × 252, Std × √252.

        **Sharpe Ratio**: (Rₚ − Rf) / σₚ using annualized values.

        **Sortino Ratio**: (Rₚ − Rf) / σ downside, where downside
        deviation uses the root-mean-square of negative excess returns
        (returns above the risk-free rate are set to zero).

        **Portfolio Variance**: Full quadratic form w′Σw.

        **Optimization**: `scipy.optimize.minimize` (SLSQP) with
        weights summing to 1. Long-only bounds [0,1] by default;
        when short selling is enabled, bounds become [−1,1].

        **Efficient Frontier**: Constrained optimization at each target
        return level (not random simulation).

        **Risk Contribution**: PRCᵢ = wᵢ(Σw)ᵢ / σ²ₚ

        **CAPM Beta**: β = Cov(rᵢ, rₘ) / Var(rₘ), from OLS regression
        of excess stock returns on excess benchmark returns.

        **Jensen's Alpha**: Annualized intercept from the CAPM regression.
        Positive α indicates outperformance vs. the benchmark after
        adjusting for systematic risk.
        """)

    # ── Author Branding ──────────────────────────────────────────────────
    st.markdown("---")
    st.markdown(
        "<div style='text-align:center; padding:0.3rem 0;'>"
        "<div style='font-size:0.85rem; font-weight:600; color:#FFFFFF;'>Mason Bennett</div>"
        "<div style='font-size:0.75rem; color:#94A3C0; margin-top:2px;'>M.S. in Finance · University of Arkansas</div>"
        "</div>",
        unsafe_allow_html=True,
    )

# ══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

@st.cache_data(ttl=3600, show_spinner=False)
def download_data(tickers: list, start: str, end: str, benchmark: str):
    """Download adjusted close prices; returns (prices_df, failed_tickers)."""
    import time
    all_tickers = tickers + [benchmark]
    data = {}
    failed = []
    for t in all_tickers:
        try:
            df = yf.download(t, start=start, end=end, progress=False, auto_adjust=True)
            # Handle MultiIndex columns from newer yfinance versions
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            if df.empty or len(df) < 30:
                failed.append(t)
            else:
                data[t] = df["Close"].squeeze()
            time.sleep(0.15)  # small delay to avoid Yahoo Finance rate limiting
        except Exception:
            failed.append(t)
    if not data:
        return None, failed
    prices = pd.DataFrame(data)
    prices.index = pd.to_datetime(prices.index)
    if prices.index.tz is not None:
        prices.index = prices.index.tz_localize(None)
    return prices, failed


def compute_returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.pct_change().dropna()


def annualized_stats(returns: pd.Series, rf: float):
    mu = returns.mean() * 252
    sigma = returns.std() * np.sqrt(252)
    rf_daily = rf / 252
    sharpe = (mu - rf) / sigma if sigma > 0 else np.nan
    shortfalls = np.minimum(returns - rf_daily, 0)
    downside = np.sqrt(np.mean(shortfalls ** 2)) * np.sqrt(252)
    sortino = (mu - rf) / downside if downside > 0 else np.nan
    return mu, sigma, sharpe, sortino


def max_drawdown(returns: pd.Series) -> float:
    cum = (1 + returns).cumprod()
    peak = cum.cummax()
    dd = (cum - peak) / peak
    return dd.min()


def drawdown_series(returns: pd.Series) -> pd.Series:
    cum = (1 + returns).cumprod()
    peak = cum.cummax()
    return (cum - peak) / peak


def portfolio_performance(weights, mean_returns, cov_matrix, rf):
    w = np.array(weights)
    mu = np.dot(w, mean_returns) * 252
    var = np.dot(w, cov_matrix @ w) * 252
    sigma = np.sqrt(var)
    sharpe = (mu - rf) / sigma if sigma > 0 else np.nan
    return mu, sigma, sharpe


def optimize_gmv(mean_returns, cov_matrix, n, allow_short=False):
    def port_vol(w):
        return np.sqrt(np.dot(w, cov_matrix @ w) * 252)
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1}]
    bounds = [(-1, 1) if allow_short else (0, 1)] * n
    w0 = np.ones(n) / n
    res = optimize.minimize(port_vol, w0, method="SLSQP", bounds=bounds, constraints=constraints)
    return res


def optimize_tangency(mean_returns, cov_matrix, rf, n, allow_short=False):
    def neg_sharpe(w):
        mu, sigma, _ = portfolio_performance(w, mean_returns, cov_matrix, rf)
        return -((mu - rf) / sigma) if sigma > 0 else 1e6
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1}]
    bounds = [(-1, 1) if allow_short else (0, 1)] * n
    w0 = np.ones(n) / n
    res = optimize.minimize(neg_sharpe, w0, method="SLSQP", bounds=bounds, constraints=constraints)
    return res


@st.cache_data(show_spinner=False)
def efficient_frontier(mean_returns, cov_matrix, rf, n, n_points=80, allow_short=False):
    gmv = optimize_gmv(mean_returns, cov_matrix, n, allow_short=allow_short)
    mu_min = np.dot(gmv.x, mean_returns) * 252
    mu_max = np.max(mean_returns) * 252
    if allow_short:
        mu_max *= 1.5  # extend range for short portfolios
    targets = np.linspace(mu_min, mu_max, n_points)
    frontier_sigma = []
    frontier_mu = []
    for target in targets:
        def port_vol(w):
            return np.sqrt(np.dot(w, cov_matrix @ w) * 252)
        constraints = [
            {"type": "eq", "fun": lambda w: np.sum(w) - 1},
            {"type": "eq", "fun": lambda w, t=target: np.dot(w, mean_returns) * 252 - t},
        ]
        bounds = [(-1, 1) if allow_short else (0, 1)] * n
        w0 = np.ones(n) / n
        res = optimize.minimize(port_vol, w0, method="SLSQP", bounds=bounds, constraints=constraints,
                                options={"maxiter": 1000, "ftol": 1e-12})
        if res.success:
            frontier_sigma.append(res.fun)
            frontier_mu.append(target)
    return frontier_mu, frontier_sigma


def risk_contribution(weights, cov_matrix):
    w = np.array(weights)
    port_var = np.dot(w, cov_matrix @ w)
    marginal = cov_matrix @ w
    rc = w * marginal / port_var
    return rc


# ── Chart styling helper ─────────────────────────────────────────────────────
def style_chart(fig, height=480):
    """Apply consistent professional styling to a Plotly figure."""
    fig.update_layout(
        height=height,
        hovermode="x unified",
        margin=dict(b=70),
        legend=dict(
            orientation="h", yanchor="bottom", y=1.02,
            xanchor="center", x=0.5,
            font=dict(size=11),
        ),
    )
    return fig


# ══════════════════════════════════════════════════════════════════════════════
# STATE INIT
# ══════════════════════════════════════════════════════════════════════════════
if "data_loaded" not in st.session_state:
    st.session_state.data_loaded = False

# ══════════════════════════════════════════════════════════════════════════════
# INPUT VALIDATION & DATA LOAD
# ══════════════════════════════════════════════════════════════════════════════
tickers_raw = list(dict.fromkeys(t.strip().upper() for t in ticker_input.split(",") if t.strip()))

if run_button:
    if len(tickers_raw) < 3:
        st.error("Please enter at least 3 unique tickers.")
        st.stop()
    if len(tickers_raw) > 10:
        st.error("Please enter no more than 10 tickers.")
        st.stop()
    if (end_date - start_date).days < 730:
        st.error("Date range must be at least 2 years.")
        st.stop()
    if end_date <= start_date:
        st.error("End date must be after start date.")
        st.stop()

    with st.spinner("Downloading market data…"):
        prices, failed = download_data(tickers_raw, str(start_date), str(end_date), bench_ticker)

    if failed:
        bench_failed = bench_ticker in failed
        ticker_failed = [t for t in failed if t != bench_ticker]
        if ticker_failed:
            st.warning(
                f"Could not download data for: **{', '.join(ticker_failed)}**. These tickers were dropped. "
                f"Common causes: the ticker symbol is misspelled, the company has been delisted, "
                f"or the stock does not have enough trading history for the selected date range."
            )
        if bench_failed:
            st.error(f"Could not download {bench_label} benchmark data. The benchmark index may be temporarily unavailable. Please try again or select a different benchmark.")
            st.stop()

    if prices is None or prices.shape[1] < 4:
        st.error("Not enough valid data. Ensure at least 3 tickers return data. Check that your ticker symbols are correct and that the stocks were publicly traded during the selected date range.")
        st.stop()

    # Drop tickers with >5% missing data before truncating
    max_len = len(prices)
    if max_len > 0:
        missing_pct = prices.isnull().sum() / max_len
        high_missing = [c for c in missing_pct.index if c != bench_ticker and missing_pct[c] > 0.05]
        if high_missing:
            st.warning(
                f"Dropped tickers with >5% missing data: **{', '.join(high_missing)}**. "
                f"This usually means these stocks were not publicly traded for the entire date range "
                f"(e.g., recent IPOs). Try a shorter date range or replace these tickers."
            )
            prices = prices.drop(columns=high_missing)

    rows_before = len(prices)
    prices = prices.dropna()
    rows_after = len(prices)
    if rows_after < rows_before:
        st.info(
            f"Date range truncated to overlapping period across all tickers "
            f"({prices.index.min().strftime('%b %d, %Y')} to {prices.index.max().strftime('%b %d, %Y')}, "
            f"{rows_after} trading days)."
        )
    if len(prices) < 252:
        st.error("Insufficient overlapping data after alignment. This happens when stocks have very different trading histories. Try a broader date range, use a more recent start date, or choose tickers that were all publicly traded during the same period.")
        st.stop()

    valid_tickers = [c for c in prices.columns if c != bench_ticker]
    if len(valid_tickers) < 3:
        st.error("Fewer than 3 valid tickers remain after data cleaning. Too many tickers were removed due to missing data or failed downloads. Try a shorter date range, add more tickers, or replace tickers that may not have been publicly traded during the selected period.")
        st.stop()

    st.session_state.prices = prices
    st.session_state.valid_tickers = valid_tickers
    st.session_state.rf = rf_annual
    st.session_state.data_loaded = True
    st.session_state.start = start_date
    st.session_state.end = end_date
    st.session_state.bench_ticker = bench_ticker
    st.session_state.bench_label = bench_label

# ══════════════════════════════════════════════════════════════════════════════
# MAIN CONTENT
# ══════════════════════════════════════════════════════════════════════════════
if not st.session_state.data_loaded:
    # ── Welcome / Landing State ──────────────────────────────────────────
    st.markdown(f"""
    <div style="text-align:center; padding: 3rem 1rem 1rem 1rem;">
        <h1 style="font-size:2.2rem; font-weight:700; color:{COLORS['primary']}; margin-bottom:0.3rem;">
            Portfolio Analytics
        </h1>
        <p style="color:{COLORS['text_muted']}; font-size:1.05rem; margin-bottom:0.3rem;">
            Mean-Variance Optimization & Risk Analysis
        </p>
        <p style="color:{COLORS['text_muted']}; font-size:0.85rem; margin-bottom:2rem;">
            Mason Bennett · M.S. in Finance · University of Arkansas
        </p>
    </div>
    """, unsafe_allow_html=True)

    col_l, col_c, col_r = st.columns([1, 2, 1])
    with col_c:
        st.info("Configure your portfolio in the **sidebar** and click **Run Analysis** to begin.")

    # Feature highlights
    st.markdown("<br>", unsafe_allow_html=True)
    c1, c2, c3, c4 = st.columns(4)
    card_style = f"text-align:center; padding:1.5rem 1rem; background:{COLORS['card']}; border:1px solid {COLORS['border']}; border-radius:12px;"
    with c1:
        st.markdown(f"""
        <div style="{card_style}">
            <div style="font-size:1.8rem; margin-bottom:0.4rem;">📈</div>
            <div style="font-weight:600; color:{COLORS['primary']}; font-size:0.9rem;">Returns Analysis</div>
            <div style="color:{COLORS['text_muted']}; font-size:0.78rem; margin-top:0.3rem;">Summary statistics,<br>distributions & growth</div>
        </div>
        """, unsafe_allow_html=True)
    with c2:
        st.markdown(f"""
        <div style="{card_style}">
            <div style="font-size:1.8rem; margin-bottom:0.4rem;">⚠️</div>
            <div style="font-weight:600; color:{COLORS['primary']}; font-size:0.9rem;">Risk Metrics</div>
            <div style="color:{COLORS['text_muted']}; font-size:0.78rem; margin-top:0.3rem;">Volatility, drawdowns,<br>Sharpe & Sortino</div>
        </div>
        """, unsafe_allow_html=True)
    with c3:
        st.markdown(f"""
        <div style="{card_style}">
            <div style="font-size:1.8rem; margin-bottom:0.4rem;">💼</div>
            <div style="font-weight:600; color:{COLORS['primary']}; font-size:0.9rem;">Optimization</div>
            <div style="color:{COLORS['text_muted']}; font-size:0.78rem; margin-top:0.3rem;">GMV, tangency &<br>efficient frontier</div>
        </div>
        """, unsafe_allow_html=True)
    with c4:
        st.markdown(f"""
        <div style="{card_style}">
            <div style="font-size:1.8rem; margin-bottom:0.4rem;">🔬</div>
            <div style="font-weight:600; color:{COLORS['primary']}; font-size:0.9rem;">Sensitivity</div>
            <div style="color:{COLORS['text_muted']}; font-size:0.78rem; margin-top:0.3rem;">Estimation window<br>robustness tests</div>
        </div>
        """, unsafe_allow_html=True)
    st.stop()

# ── Unpack state ─────────────────────────────────────────────────────────────
prices = st.session_state.prices
tickers = st.session_state.valid_tickers
rf = st.session_state.rf
bench_ticker_saved = st.session_state.bench_ticker
bench_label_saved = st.session_state.bench_label
returns = compute_returns(prices)
stock_returns = returns[tickers]
bench_returns = returns[bench_ticker_saved]
cov_matrix = stock_returns.cov()
mean_rets = stock_returns.mean()
n_assets = len(tickers)

# Benchmark stats (used across tabs)
mu_b, sig_b, sh_b, so_b = annualized_stats(bench_returns, rf)

# ── Page Title Bar ───────────────────────────────────────────────────────────
st.markdown(f"""
<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.2rem;">
    <div>
        <h1 style="margin:0; font-size:1.6rem; color:{COLORS['primary']};">Portfolio Analytics</h1>
        <div style="font-size:0.82rem; color:{COLORS['text_muted']}; margin-top:2px;">
            Mason Bennett &nbsp;·&nbsp; M.S. in Finance &nbsp;·&nbsp; University of Arkansas
        </div>
    </div>
    <div style="text-align:right;">
        <span style="background:{COLORS['tab_bg']}; padding:4px 12px; border-radius:20px; font-size:0.78rem; color:{COLORS['text_muted']}; font-weight:500;">
            {len(tickers)} assets &nbsp;·&nbsp; {bench_label_saved} &nbsp;·&nbsp; {st.session_state.start:%b %Y} – {st.session_state.end:%b %Y}
        </span>
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown('<div class="section-divider"></div>', unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT SUMMARY — Key metrics at a glance
# ══════════════════════════════════════════════════════════════════════════════
with st.spinner("Computing portfolio snapshots…"):
    ew_w_snap = np.ones(n_assets) / n_assets
    ew_mu_snap, ew_sig_snap, ew_sh_snap = portfolio_performance(ew_w_snap, mean_rets, cov_matrix, rf)

    tan_res_snap = optimize_tangency(mean_rets, cov_matrix, rf, n_assets, allow_short=allow_short)
    if tan_res_snap.success:
        tan_w_snap = tan_res_snap.x
        tan_mu_snap, tan_sig_snap, tan_sh_snap = portfolio_performance(tan_w_snap, mean_rets, cov_matrix, rf)
    else:
        tan_w_snap = ew_w_snap
        tan_mu_snap, tan_sig_snap, tan_sh_snap = ew_mu_snap, ew_sig_snap, ew_sh_snap

snap_cols = st.columns(4)
snap_cols[0].metric("Best Sharpe (Tangency)", f"{tan_sh_snap:.3f}", help=tip("best_sharpe"))
snap_cols[1].metric("Tangency Return", f"{tan_mu_snap:.2%}", help=tip("tangency_return"))
snap_cols[2].metric(f"{bench_label_saved} Return", f"{mu_b:.2%}", help=tip("bench_return"))
snap_cols[3].metric(f"{bench_label_saved} Volatility", f"{sig_b:.2%}", help=tip("bench_vol"))

st.markdown("---")

# ── Tabs ─────────────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([
    "  Returns & Statistics  ",
    "  Risk Analysis  ",
    "  Correlation  ",
    "  Portfolio Optimization  ",
    "  Custom Portfolio  ",
    "  Sensitivity  ",
])

# ══════════════════════════════════════════════════════════════════════════════
# TAB 1: Returns & Exploratory
# ══════════════════════════════════════════════════════════════════════════════
with tab1:
    section_header("Return Computation & Exploratory Analysis")

    # Summary statistics table
    st.subheader("Summary Statistics")
    stats_rows = {}
    for t in tickers:
        r = returns[t]
        mu, sig, sharpe, sortino = annualized_stats(r, rf)
        stats_rows[t] = {
            "Ann. Return": f"{mu:.2%}", "Ann. Volatility": f"{sig:.2%}",
            "Skewness": f"{r.skew():.3f}", "Kurtosis": f"{r.kurtosis():.3f}",
            "Min Daily": f"{r.min():.2%}", "Max Daily": f"{r.max():.2%}",
        }
    stats_rows[bench_label_saved] = {
        "Ann. Return": f"{mu_b:.2%}", "Ann. Volatility": f"{sig_b:.2%}",
        "Skewness": f"{bench_returns.skew():.3f}", "Kurtosis": f"{bench_returns.kurtosis():.3f}",
        "Min Daily": f"{bench_returns.min():.2%}", "Max Daily": f"{bench_returns.max():.2%}",
    }
    stats_df = pd.DataFrame(stats_rows).T
    st.dataframe(stats_df, use_container_width=True)

    # Export
    col_dl1, col_dl2, _ = st.columns([1, 1, 4])
    with col_dl1:
        st.download_button("Download CSV", stats_df.to_csv(), "summary_statistics.csv", "text/csv", key="dl_stats_csv")
    with col_dl2:
        st.download_button("Download Excel", df_to_excel(stats_df), "summary_statistics.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="dl_stats_xl")

    st.markdown("---")

    # Cumulative wealth
    st.subheader(f"Cumulative Growth of ${initial_investment:,.0f}")
    show_tickers = st.multiselect("Select stocks to display", tickers + [bench_ticker_saved], default=tickers + [bench_ticker_saved])
    if show_tickers:
        cum = ((1 + returns[show_tickers]).cumprod()) * initial_investment
        cum.rename(columns={bench_ticker_saved: bench_label_saved}, inplace=True)
        fig_cum = px.line(cum, title=f"Cumulative Growth of ${initial_investment:,.0f}", labels={"value": "Value ($)", "variable": "Asset"})
        fig_cum.update_layout(legend_title_text="")
        style_chart(fig_cum)
        st.plotly_chart(fig_cum, use_container_width=True, key="cum_wealth_tab1")

    st.markdown("---")

    # Distribution plot
    st.subheader("Return Distribution")
    col_dist1, col_dist2 = st.columns([1, 2])
    with col_dist1:
        sel_stock = st.selectbox("Select a stock", tickers, key="dist_stock")
        dist_view = st.radio("View", ["Histogram + Normal Fit", "Q-Q Plot"], key="dist_view")
    with col_dist2:
        r_sel = returns[sel_stock].dropna()
        if dist_view == "Histogram + Normal Fit":
            fig_hist = go.Figure()
            fig_hist.add_trace(go.Histogram(
                x=r_sel, nbinsx=80, histnorm="probability density",
                name="Returns", marker_color=COLORS["secondary"], opacity=0.75,
            ))
            x_range = np.linspace(r_sel.min(), r_sel.max(), 200)
            fig_hist.add_trace(go.Scatter(
                x=x_range, y=stats.norm.pdf(x_range, r_sel.mean(), r_sel.std()),
                mode="lines", name="Normal Fit", line=dict(color=COLORS["danger"], width=2.5),
            ))
            fig_hist.update_layout(
                title=f"{sel_stock} Daily Return Distribution",
                xaxis_title="Daily Return", yaxis_title="Density", bargap=0.02,
            )
            style_chart(fig_hist)
            st.plotly_chart(fig_hist, use_container_width=True, key="hist_tab1")
        else:
            (osm, osr), (slope, intercept, _) = stats.probplot(r_sel, dist="norm")
            fig_qq = go.Figure()
            fig_qq.add_trace(go.Scatter(
                x=osm, y=osr, mode="markers", name="Data",
                marker=dict(size=4, color=COLORS["secondary"], opacity=0.6),
            ))
            line_x = np.array([osm.min(), osm.max()])
            fig_qq.add_trace(go.Scatter(
                x=line_x, y=slope * line_x + intercept, mode="lines",
                name="Normal Line", line=dict(color=COLORS["danger"], width=2),
            ))
            fig_qq.update_layout(
                title=f"{sel_stock} Q-Q Plot",
                xaxis_title="Theoretical Quantiles", yaxis_title="Sample Quantiles",
            )
            style_chart(fig_qq)
            st.plotly_chart(fig_qq, use_container_width=True, key="qq_tab1")

# ══════════════════════════════════════════════════════════════════════════════
# TAB 2: Risk Analysis
# ══════════════════════════════════════════════════════════════════════════════
with tab2:
    section_header("Risk Analysis")

    # Rolling volatility
    st.subheader("Rolling Annualized Volatility")
    vol_window = st.select_slider("Window (days)", options=[30, 60, 90, 120], value=60, key="vol_win",
                                   help="Adjusts in increments of 30 days")
    rolling_vol = stock_returns.rolling(vol_window).std() * np.sqrt(252)
    fig_vol = px.line(rolling_vol, title=f"{vol_window}-Day Rolling Annualized Volatility", labels={"value": "Annualized Volatility", "variable": "Stock"})
    fig_vol.update_layout(legend_title_text="")
    style_chart(fig_vol)
    st.plotly_chart(fig_vol, use_container_width=True, key="vol_tab2")

    st.markdown("---")

    # Drawdown
    st.subheader("Drawdown Analysis")
    dd_stock = st.selectbox("Select a stock", tickers, key="dd_stock")
    dd = drawdown_series(returns[dd_stock])
    max_dd = dd.min()
    st.metric("Maximum Drawdown", f"{max_dd:.2%}", help=tip("max_dd"))
    fig_dd = go.Figure()
    fig_dd.add_trace(go.Scatter(
        x=dd.index, y=dd.values, fill="tozeroy",
        fillcolor="rgba(231,76,60,0.15)",
        line=dict(color=COLORS["danger"], width=1.2), name="Drawdown",
    ))
    fig_dd.update_layout(
        title=f"{dd_stock} Drawdown", xaxis_title="Date", yaxis_title="Drawdown", yaxis_tickformat=".0%",
    )
    style_chart(fig_dd, height=350)
    st.plotly_chart(fig_dd, use_container_width=True, key="dd_tab2")

    st.markdown("---")

    # Risk-adjusted metrics
    st.subheader("Risk-Adjusted Metrics")
    risk_rows = {}
    for t in tickers:
        mu, sig, sharpe, sortino = annualized_stats(returns[t], rf)
        risk_rows[t] = {"Sharpe Ratio": f"{sharpe:.3f}", "Sortino Ratio": f"{sortino:.3f}"}
    risk_rows[bench_label_saved] = {"Sharpe Ratio": f"{sh_b:.3f}", "Sortino Ratio": f"{so_b:.3f}"}
    risk_df = pd.DataFrame(risk_rows).T
    st.dataframe(risk_df, use_container_width=True)

    col_rdl1, col_rdl2, _ = st.columns([1, 1, 4])
    with col_rdl1:
        st.download_button("Download CSV", risk_df.to_csv(), "risk_metrics.csv", "text/csv", key="dl_risk_csv")
    with col_rdl2:
        st.download_button("Download Excel", df_to_excel(risk_df), "risk_metrics.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="dl_risk_xl")

    st.markdown("---")

    # CAPM: Beta & Alpha
    st.subheader("CAPM Beta & Alpha")
    st.caption(
        "Beta and Alpha are estimated by regressing each stock's excess returns (over the risk-free rate) "
        "on the benchmark's excess returns. Beta measures market sensitivity; Alpha measures excess performance."
    )
    rf_daily = rf / 252
    capm_rows = {}
    for t in tickers:
        excess_stock = returns[t] - rf_daily
        excess_bench = bench_returns - rf_daily
        # Drop NaN for aligned regression
        aligned = pd.concat([excess_stock, excess_bench], axis=1).dropna()
        aligned.columns = ["stock", "bench"]
        slope, intercept, r_value, p_value, std_err = stats.linregress(aligned["bench"], aligned["stock"])
        alpha_annual = intercept * 252
        capm_rows[t] = {
            "Beta": f"{slope:.3f}",
            "Alpha (Ann.)": f"{alpha_annual:.2%}",
            "R²": f"{r_value**2:.3f}",
        }
    capm_df = pd.DataFrame(capm_rows).T
    st.dataframe(capm_df, use_container_width=True)

    # Beta bar chart
    beta_vals = {t: float(capm_rows[t]["Beta"]) for t in tickers}
    fig_beta = go.Figure()
    colors_beta = [COLORS["danger"] if v > 1 else COLORS["secondary"] for v in beta_vals.values()]
    fig_beta.add_trace(go.Bar(
        x=list(beta_vals.keys()), y=list(beta_vals.values()),
        marker_color=colors_beta, name="Beta",
    ))
    fig_beta.add_hline(y=1.0, line_dash="dash", line_color=COLORS["text_muted"],
                       annotation_text="Market (β=1)", annotation_position="top right")
    fig_beta.update_layout(
        title="CAPM Beta by Stock",
        xaxis_title="Stock", yaxis_title="Beta",
    )
    style_chart(fig_beta, height=380)
    st.plotly_chart(fig_beta, use_container_width=True, key="beta_tab2")

    # Metrics row for quick glance
    muted = COLORS["text_muted"]
    st.markdown(f"<span style='font-size:0.8rem; color:{muted};'>"
                f"Stocks with β > 1 (red) are more volatile than the benchmark; β &lt; 1 (blue) are less volatile.</span>",
                unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# TAB 3: Correlation
# ══════════════════════════════════════════════════════════════════════════════
with tab3:
    section_header("Correlation & Covariance Analysis")

    # Heatmap
    st.subheader("Pairwise Correlation Heatmap")
    corr = stock_returns.corr()
    fig_corr = px.imshow(
        corr, text_auto=".2f",
        color_continuous_scale=["#2E86AB", "#FFFFFF", "#E74C3C"],
        zmin=-1, zmax=1, aspect="equal",
    )
    fig_corr.update_layout(
        coloraxis_colorbar=dict(title="Corr", tickformat=".1f"),
    )
    style_chart(fig_corr, height=500)
    st.plotly_chart(fig_corr, use_container_width=True, key="corr_tab3")

    st.markdown("---")

    # Rolling correlation
    st.subheader("Rolling Pairwise Correlation")
    col_r1, col_r2, col_r3 = st.columns(3)
    with col_r1:
        rc_s1 = st.selectbox("Stock A", tickers, index=0, key="rc1")
    with col_r2:
        rc_s2 = st.selectbox("Stock B", tickers, index=min(1, n_assets - 1), key="rc2")
    with col_r3:
        rc_win = st.select_slider("Window", options=[30, 60, 90, 120], value=60, key="rc_win",
                                         help="Adjusts in increments of 30 days")
    if rc_s1 != rc_s2:
        rc = stock_returns[rc_s1].rolling(rc_win).corr(stock_returns[rc_s2])
        fig_rc = px.line(rc, labels={"value": "Correlation"})
        fig_rc.update_traces(line_color=COLORS["secondary"])
        fig_rc.update_layout(showlegend=False, title=f"{rc_win}-Day Rolling Correlation: {rc_s1} vs {rc_s2}")
        style_chart(fig_rc, height=380)
        st.plotly_chart(fig_rc, use_container_width=True, key="rc_tab3")
    else:
        st.info("Select two different stocks.")

    # Covariance matrix
    with st.expander("Daily Covariance Matrix"):
        st.dataframe(cov_matrix.style.format("{:.6f}"), use_container_width=True)

# ══════════════════════════════════════════════════════════════════════════════
# TAB 4: Portfolio Optimization
# ══════════════════════════════════════════════════════════════════════════════
with tab4:
    section_header("Portfolio Construction & Optimization")

    try:
      with st.spinner("Running optimizations…"):
        # ── Equal Weight ─────────────────────────────────────────────────
        ew_weights = np.ones(n_assets) / n_assets
        ew_mu, ew_sig, ew_sharpe = portfolio_performance(ew_weights, mean_rets, cov_matrix, rf)
        ew_port_ret = stock_returns @ ew_weights
        ew_sortino = annualized_stats(ew_port_ret, rf)[3]
        ew_mdd = max_drawdown(ew_port_ret)

        # ── GMV ──────────────────────────────────────────────────────────
        gmv_res = optimize_gmv(mean_rets, cov_matrix, n_assets, allow_short=allow_short)
        if not gmv_res.success:
            st.error("GMV optimization did not converge. Try different tickers or a longer date range.")
            st.stop()
        gmv_w = gmv_res.x
        gmv_mu, gmv_sig, gmv_sharpe = portfolio_performance(gmv_w, mean_rets, cov_matrix, rf)
        gmv_port_ret = stock_returns @ gmv_w
        gmv_sortino = annualized_stats(gmv_port_ret, rf)[3]
        gmv_mdd = max_drawdown(gmv_port_ret)

        # ── Tangency ─────────────────────────────────────────────────────
        tan_res = optimize_tangency(mean_rets, cov_matrix, rf, n_assets, allow_short=allow_short)
        if not tan_res.success:
            st.error("Tangency optimization did not converge. Try different tickers or a longer date range.")
            st.stop()
        tan_w = tan_res.x
        tan_mu, tan_sig, tan_sharpe = portfolio_performance(tan_w, mean_rets, cov_matrix, rf)
        tan_port_ret = stock_returns @ tan_w
        tan_sortino = annualized_stats(tan_port_ret, rf)[3]
        tan_mdd = max_drawdown(tan_port_ret)
    except Exception as e:
        st.error(f"Optimization failed: {e}. Try different tickers or a longer date range.")
        st.stop()

    # ── Equal-Weight Portfolio ───────────────────────────────────────────
    st.subheader("Equal-Weight Portfolio (1/N)")
    cols_ew = st.columns(5)
    cols_ew[0].metric("Return", f"{ew_mu:.2%}", help=tip("return"))
    cols_ew[1].metric("Volatility", f"{ew_sig:.2%}", help=tip("volatility"))
    cols_ew[2].metric("Sharpe", f"{ew_sharpe:.3f}", help=tip("sharpe"))
    cols_ew[3].metric("Sortino", f"{ew_sortino:.3f}", help=tip("sortino"))
    cols_ew[4].metric("Max DD", f"{ew_mdd:.2%}", help=tip("max_dd"))

    st.markdown("---")

    # ── GMV & Tangency side by side ──────────────────────────────────────
    col_gmv, col_tan = st.columns(2)
    with col_gmv:
        st.subheader("Global Min Variance")
        st.metric("Return", f"{gmv_mu:.2%}", help=tip("return"))
        st.metric("Volatility", f"{gmv_sig:.2%}", help=tip("volatility"))
        st.metric("Sharpe", f"{gmv_sharpe:.3f}", help=tip("sharpe"))
        st.metric("Sortino", f"{gmv_sortino:.3f}", help=tip("sortino"))
        st.metric("Max DD", f"{gmv_mdd:.2%}", help=tip("max_dd"))
    with col_tan:
        st.subheader("Max Sharpe (Tangency)")
        st.metric("Return", f"{tan_mu:.2%}", help=tip("return"))
        st.metric("Volatility", f"{tan_sig:.2%}", help=tip("volatility"))
        st.metric("Sharpe", f"{tan_sharpe:.3f}", help=tip("sharpe"))
        st.metric("Sortino", f"{tan_sortino:.3f}", help=tip("sortino"))
        st.metric("Max DD", f"{tan_mdd:.2%}", help=tip("max_dd"))

    st.markdown("---")

    # Weights bar chart
    st.subheader("Portfolio Weights")
    wt_df = pd.DataFrame({"GMV": gmv_w, "Tangency": tan_w, "Equal-Weight": ew_weights}, index=tickers)
    fig_wt = px.bar(wt_df, barmode="group", labels={"value": "Weight", "index": "Asset"},
                     color_discrete_sequence=[COLORS["success"], COLORS["accent"], COLORS["secondary"]])
    fig_wt.update_layout(yaxis_tickformat=".0%", legend_title_text="")
    style_chart(fig_wt, height=400)
    st.plotly_chart(fig_wt, use_container_width=True, key="wt_tab4")

    # Export weights
    wt_export = wt_df.copy()
    wt_export = wt_export.map(lambda x: f"{x:.4f}")
    col_wdl1, col_wdl2, _ = st.columns([1, 1, 4])
    with col_wdl1:
        st.download_button("Download Weights CSV", wt_df.to_csv(), "portfolio_weights.csv", "text/csv", key="dl_wt_csv")
    with col_wdl2:
        st.download_button("Download Weights Excel", df_to_excel(wt_df), "portfolio_weights.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="dl_wt_xl")

    st.markdown("---")

    # Risk contribution
    st.subheader("Risk Contribution (PRC)")
    st.caption(
        "A stock's Percentage Risk Contribution (PRC) shows how much of total portfolio risk it accounts for. "
        "A stock with 10% weight but 25% PRC is a disproportionate source of volatility."
    )
    gmv_prc = risk_contribution(gmv_w, cov_matrix)
    tan_prc = risk_contribution(tan_w, cov_matrix)
    prc_df = pd.DataFrame({
        "GMV Weight": gmv_w, "GMV PRC": gmv_prc,
        "Tangency Weight": tan_w, "Tangency PRC": tan_prc,
    }, index=tickers)
    fig_prc = px.bar(prc_df[["GMV PRC", "Tangency PRC"]], barmode="group",
                      labels={"value": "PRC", "index": "Asset"},
                      color_discrete_sequence=[COLORS["success"], COLORS["accent"]])
    fig_prc.update_layout(yaxis_tickformat=".0%", legend_title_text="")
    style_chart(fig_prc, height=400)
    st.plotly_chart(fig_prc, use_container_width=True, key="prc_tab4")

    # Save optimized portfolios
    st.session_state.gmv_w = gmv_w
    st.session_state.tan_w = tan_w
    st.session_state.ew_weights = ew_weights

    # Compute custom portfolio weights for use on this tab's frontier
    # Read slider values from session state (default to equal weight if not yet set)
    cust_w_tab4 = np.array([st.session_state.get(f"cw_{t}", 1.0 / n_assets) for t in tickers])
    cust_total = cust_w_tab4.sum()
    if cust_total != 0:
        cust_w_tab4 = cust_w_tab4 / cust_total
    else:
        cust_w_tab4 = ew_weights
    cust_mu_t4, cust_sig_t4, _ = portfolio_performance(cust_w_tab4, mean_rets, cov_matrix, rf)
    cust_port_ret_t4 = stock_returns @ cust_w_tab4

    st.markdown("---")

    # Efficient frontier
    st.subheader("Efficient Frontier")
    st.caption(
        "The efficient frontier shows the set of portfolios offering the highest expected return for each level of risk. "
        "The Capital Allocation Line (CAL) extends from the risk-free rate through the tangency portfolio — "
        "any point on this line can be achieved by mixing the tangency portfolio with a risk-free asset."
    )
    with st.spinner("Computing efficient frontier…"):
        ef_mu, ef_sig = efficient_frontier(mean_rets, cov_matrix, rf, n_assets, allow_short=allow_short)

    fig_ef = go.Figure()
    fig_ef.add_trace(go.Scatter(
        x=ef_sig, y=ef_mu, mode="lines", name="Efficient Frontier",
        line=dict(color=COLORS["secondary"], width=3),
    ))
    cal_x = np.linspace(0, max(ef_sig) * 1.15, 50)
    cal_slope = (tan_mu - rf) / tan_sig if tan_sig > 0 else 0
    cal_y = rf + cal_slope * cal_x
    fig_ef.add_trace(go.Scatter(
        x=cal_x, y=cal_y, mode="lines", name="CAL",
        line=dict(color=COLORS["text_muted"], dash="dash", width=1.5),
    ))
    fig_ef.add_trace(go.Scatter(
        x=[gmv_sig], y=[gmv_mu], mode="markers", name="GMV",
        marker=dict(size=14, symbol="diamond", color=COLORS["success"],
                    line=dict(width=2, color="white")),
    ))
    fig_ef.add_trace(go.Scatter(
        x=[tan_sig], y=[tan_mu], mode="markers", name="Tangency",
        marker=dict(size=16, symbol="star", color=COLORS["accent"],
                    line=dict(width=2, color="white")),
    ))
    fig_ef.add_trace(go.Scatter(
        x=[ew_sig], y=[ew_mu], mode="markers", name="Equal-Weight",
        marker=dict(size=12, symbol="square", color="#9B59B6",
                    line=dict(width=2, color="white")),
    ))
    fig_ef.add_trace(go.Scatter(
        x=[cust_sig_t4], y=[cust_mu_t4], mode="markers", name="Custom",
        marker=dict(size=14, symbol="hexagon2", color="#E91E63",
                    line=dict(width=2, color="white")),
    ))
    for i, t in enumerate(tickers):
        mu_i = returns[t].mean() * 252
        sig_i = returns[t].std() * np.sqrt(252)
        fig_ef.add_trace(go.Scatter(
            x=[sig_i], y=[mu_i], mode="markers+text", name=t,
            marker=dict(size=8, color=CHART_COLORS[i % len(CHART_COLORS)], opacity=0.7),
            text=[t], textposition="top center", textfont=dict(size=10),
        ))
    fig_ef.add_trace(go.Scatter(
        x=[sig_b], y=[mu_b], mode="markers+text", name=bench_label_saved,
        marker=dict(size=11, symbol="x", color=COLORS["primary"], line=dict(width=2)),
        text=[bench_label_saved], textposition="top center", textfont=dict(size=10),
    ))
    fig_ef.update_traces(
        hovertemplate="Volatility: %{x:.2%}<br>Return: %{y:.2%}<extra>%{fullData.name}</extra>"
    )
    fig_ef.update_layout(
        xaxis_title="Annualized Volatility", yaxis_title="Annualized Return",
        xaxis_tickformat=".0%", yaxis_tickformat=".0%", showlegend=True,
        hovermode="closest",
    )
    style_chart(fig_ef, height=520)
    st.plotly_chart(fig_ef, use_container_width=True, key="ef_main")

    st.markdown("---")

    # Portfolio comparison cumulative
    st.subheader("Portfolio Comparison — Cumulative Wealth")
    port_rets = pd.DataFrame({
        "Equal-Weight": stock_returns @ ew_weights,
        "GMV": stock_returns @ gmv_w,
        "Tangency": stock_returns @ tan_w,
        "Custom": cust_port_ret_t4,
        bench_label_saved: bench_returns,
    })
    cum_ports = (1 + port_rets).cumprod() * initial_investment
    fig_comp = px.line(cum_ports, title=f"Growth of ${initial_investment:,.0f}", labels={"value": "Value ($)", "variable": "Portfolio"},
                        color_discrete_sequence=["#9B59B6", COLORS["success"], COLORS["accent"], "#E91E63", COLORS["primary"]])
    fig_comp.update_layout(legend_title_text="")
    style_chart(fig_comp)
    st.plotly_chart(fig_comp, use_container_width=True, key="comp_tab4")

    st.markdown("---")

    # Summary comparison table
    st.subheader("Summary Comparison")
    comp_data = {}
    for name, w in [("Equal-Weight", ew_weights), ("GMV", gmv_w), ("Tangency", tan_w), ("Custom", cust_w_tab4)]:
        pr = stock_returns @ w
        mu_p, sig_p, sh_p = portfolio_performance(w, mean_rets, cov_matrix, rf)
        so_p = annualized_stats(pr, rf)[3]
        md_p = max_drawdown(pr)
        comp_data[name] = {
            "Ann. Return": f"{mu_p:.2%}", "Ann. Volatility": f"{sig_p:.2%}",
            "Sharpe": f"{sh_p:.3f}", "Sortino": f"{so_p:.3f}", "Max DD": f"{md_p:.2%}",
        }
    comp_data[bench_label_saved] = {
        "Ann. Return": f"{mu_b:.2%}", "Ann. Volatility": f"{sig_b:.2%}",
        "Sharpe": f"{sh_b:.3f}", "Sortino": f"{so_b:.3f}",
        "Max DD": f"{max_drawdown(bench_returns):.2%}",
    }
    comp_df = pd.DataFrame(comp_data).T
    st.dataframe(comp_df, use_container_width=True)

    col_cdl1, col_cdl2, _ = st.columns([1, 1, 4])
    with col_cdl1:
        st.download_button("Download CSV", comp_df.to_csv(), "portfolio_comparison.csv", "text/csv", key="dl_comp_csv")
    with col_cdl2:
        st.download_button("Download Excel", df_to_excel(comp_df), "portfolio_comparison.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="dl_comp_xl")

# ══════════════════════════════════════════════════════════════════════════════
# TAB 5: Custom Portfolio
# ══════════════════════════════════════════════════════════════════════════════
with tab5:
    section_header("Custom Portfolio Builder")
    st.caption(
        "Adjust sliders to set portfolio weights. Weights are automatically normalized to sum to 1 "
        "(as required for a fully invested portfolio). Portfolio metrics update dynamically as you adjust."
    )

    raw_weights = {}
    cols_sl = st.columns(min(n_assets, 5))
    for i, t in enumerate(tickers):
        with cols_sl[i % len(cols_sl)]:
            slider_min = -1.0 if allow_short else 0.0
            raw_weights[t] = st.slider(t, slider_min, 1.0, 1.0 / n_assets, 0.01, key=f"cw_{t}")

    raw_total = sum(raw_weights.values())

    # Show raw total and normalization info
    if raw_total == 0:
        st.warning("All weights are zero. Adjust at least one slider.")
        st.stop()

    st.markdown(f"**Raw weight total: {raw_total:.2f}** — weights will be normalized to sum to 1.00")

    # Normalize weights (required by rubric)
    custom_w = np.array([raw_weights[t] / raw_total for t in tickers])

    st.subheader("Normalized Weights")
    nw_df = pd.DataFrame({"Ticker": tickers, "Weight": custom_w})
    nw_df["Weight"] = nw_df["Weight"].map("{:.2%}".format)
    st.dataframe(nw_df.set_index("Ticker").T, use_container_width=True)

    cust_mu, cust_sig, cust_sharpe = portfolio_performance(custom_w, mean_rets, cov_matrix, rf)
    cust_port_ret = stock_returns @ custom_w
    cust_sortino = annualized_stats(cust_port_ret, rf)[3]
    cust_mdd = max_drawdown(cust_port_ret)

    cols_c = st.columns(5)
    cols_c[0].metric("Return", f"{cust_mu:.2%}", help=tip("return"))
    cols_c[1].metric("Volatility", f"{cust_sig:.2%}", help=tip("volatility"))
    cols_c[2].metric("Sharpe", f"{cust_sharpe:.3f}", help=tip("sharpe"))
    cols_c[3].metric("Sortino", f"{cust_sortino:.3f}", help=tip("sortino"))
    cols_c[4].metric("Max DD", f"{cust_mdd:.2%}", help=tip("max_dd"))

    st.markdown("---")

    # Custom portfolio on efficient frontier
    st.subheader("Custom Portfolio on Efficient Frontier")
    with st.spinner("Computing frontier…"):
        ef_mu2, ef_sig2 = efficient_frontier(mean_rets, cov_matrix, rf, n_assets, n_points=60, allow_short=allow_short)

    gmv_w2 = st.session_state.get("gmv_w", ew_weights)
    tan_w2 = st.session_state.get("tan_w", ew_weights)
    gmv_mu2, gmv_sig2, _ = portfolio_performance(gmv_w2, mean_rets, cov_matrix, rf)
    tan_mu2, tan_sig2, _ = portfolio_performance(tan_w2, mean_rets, cov_matrix, rf)
    ew_mu2, ew_sig2, _ = portfolio_performance(ew_weights, mean_rets, cov_matrix, rf)

    fig_ef2 = go.Figure()
    fig_ef2.add_trace(go.Scatter(
        x=ef_sig2, y=ef_mu2, mode="lines", name="Efficient Frontier",
        line=dict(color=COLORS["secondary"], width=3),
    ))
    # CAL
    cal_x2 = np.linspace(0, max(ef_sig2) * 1.15, 50)
    cal_slope2 = (tan_mu2 - rf) / tan_sig2 if tan_sig2 > 0 else 0
    cal_y2 = rf + cal_slope2 * cal_x2
    fig_ef2.add_trace(go.Scatter(
        x=cal_x2, y=cal_y2, mode="lines", name="CAL",
        line=dict(color=COLORS["text_muted"], dash="dash", width=1.5),
    ))
    fig_ef2.add_trace(go.Scatter(
        x=[gmv_sig2], y=[gmv_mu2], mode="markers", name="GMV",
        marker=dict(size=12, symbol="diamond", color=COLORS["success"],
                    line=dict(width=2, color="white")),
    ))
    fig_ef2.add_trace(go.Scatter(
        x=[tan_sig2], y=[tan_mu2], mode="markers", name="Tangency",
        marker=dict(size=14, symbol="star", color=COLORS["accent"],
                    line=dict(width=2, color="white")),
    ))
    fig_ef2.add_trace(go.Scatter(
        x=[ew_sig2], y=[ew_mu2], mode="markers", name="Equal-Weight",
        marker=dict(size=10, symbol="square", color="#9B59B6",
                    line=dict(width=2, color="white")),
    ))
    fig_ef2.add_trace(go.Scatter(
        x=[cust_sig], y=[cust_mu], mode="markers", name="Custom",
        marker=dict(size=16, symbol="hexagon2", color="#E91E63",
                    line=dict(width=2, color="white")),
    ))
    for i, t in enumerate(tickers):
        mu_i = returns[t].mean() * 252
        sig_i = returns[t].std() * np.sqrt(252)
        fig_ef2.add_trace(go.Scatter(
            x=[sig_i], y=[mu_i], mode="markers+text", name=t,
            marker=dict(size=7, color=CHART_COLORS[i % len(CHART_COLORS)], opacity=0.7),
            text=[t], textposition="top center", textfont=dict(size=10),
        ))
    fig_ef2.add_trace(go.Scatter(
        x=[sig_b], y=[mu_b], mode="markers+text", name=bench_label_saved,
        marker=dict(size=11, symbol="x", color=COLORS["primary"], line=dict(width=2)),
        text=[bench_label_saved], textposition="top center", textfont=dict(size=10),
    ))
    fig_ef2.update_traces(
        hovertemplate="Volatility: %{x:.2%}<br>Return: %{y:.2%}<extra>%{fullData.name}</extra>"
    )
    fig_ef2.update_layout(
        xaxis_title="Annualized Volatility", yaxis_title="Annualized Return",
        xaxis_tickformat=".0%", yaxis_tickformat=".0%",
        hovermode="closest",
    )
    style_chart(fig_ef2, height=520)
    st.plotly_chart(fig_ef2, use_container_width=True, key="ef_tab5")

    st.markdown("---")

    # Cumulative wealth with custom
    st.subheader("Cumulative Wealth — All Portfolios")
    port_rets_cust = pd.DataFrame({
        "Equal-Weight": stock_returns @ ew_weights,
        "GMV": stock_returns @ gmv_w2,
        "Tangency": stock_returns @ tan_w2,
        "Custom": cust_port_ret,
        bench_label_saved: bench_returns,
    })
    cum_cust = (1 + port_rets_cust).cumprod() * initial_investment
    fig_cc = px.line(cum_cust, title=f"Growth of ${initial_investment:,.0f}", labels={"value": "Value ($)", "variable": "Portfolio"},
                      color_discrete_sequence=["#9B59B6", COLORS["success"], COLORS["accent"], "#E91E63", COLORS["primary"]])
    fig_cc.update_layout(legend_title_text="")
    style_chart(fig_cc)
    st.plotly_chart(fig_cc, use_container_width=True, key="cc_tab5")

# ══════════════════════════════════════════════════════════════════════════════
# TAB 6: Estimation Window Sensitivity
# ══════════════════════════════════════════════════════════════════════════════
with tab6:
    section_header("Estimation Window Sensitivity")
    st.caption(
        "Mean-variance optimization is sensitive to its inputs. Small changes in the lookback period used "
        "to estimate returns and covariances can produce very different portfolio weights. "
        "This section lets you see that instability directly."
    )

    total_days = len(stock_returns)
    total_years = total_days / 252

    lookback_options = []
    labels = []
    if total_years >= 1:
        lookback_options.append(252)
        labels.append("1 Year")
    if total_years >= 2:
        lookback_options.append(504)
        labels.append("2 Years")
    if total_years >= 3:
        lookback_options.append(756)
        labels.append("3 Years")
    if total_years >= 5:
        lookback_options.append(1260)
        labels.append("5 Years")
    lookback_options.append(total_days)
    labels.append("Full Sample")

    if len(lookback_options) < 2:
        st.info("Need at least 2 years of overlapping data to show multiple lookback windows. Try a longer date range.")
        st.stop()

    sensitivity_rows = []
    portfolio_metrics_rows = []

    for lb, lbl in zip(lookback_options, labels):
        sub_rets = stock_returns.iloc[-lb:]
        sub_mean = sub_rets.mean()
        sub_cov = sub_rets.cov()
        gmv_r = optimize_gmv(sub_mean, sub_cov, n_assets, allow_short=allow_short)
        tan_r = optimize_tangency(sub_mean, sub_cov, rf, n_assets, allow_short=allow_short)
        if gmv_r.success:
            g_mu, g_sig, g_sh = portfolio_performance(gmv_r.x, sub_mean, sub_cov, rf)
            portfolio_metrics_rows.append({
                "Window": lbl, "Portfolio": "GMV",
                "Ann. Return": f"{g_mu:.2%}", "Ann. Volatility": f"{g_sig:.2%}", "Sharpe": f"{g_sh:.3f}",
            })
            for i, t in enumerate(tickers):
                sensitivity_rows.append({"Window": lbl, "Portfolio": "GMV", "Ticker": t, "Weight": gmv_r.x[i]})
        if tan_r.success:
            t_mu, t_sig, t_sh = portfolio_performance(tan_r.x, sub_mean, sub_cov, rf)
            portfolio_metrics_rows.append({
                "Window": lbl, "Portfolio": "Tangency",
                "Ann. Return": f"{t_mu:.2%}", "Ann. Volatility": f"{t_sig:.2%}", "Sharpe": f"{t_sh:.3f}",
            })
            for i, t in enumerate(tickers):
                sensitivity_rows.append({"Window": lbl, "Portfolio": "Tangency", "Ticker": t, "Weight": tan_r.x[i]})

    sens_df = pd.DataFrame(sensitivity_rows)
    metrics_df = pd.DataFrame(portfolio_metrics_rows)

    # Portfolio metrics per window
    st.subheader("Portfolio Metrics Across Windows")
    st.caption("Annualized return, volatility, and Sharpe ratio for each optimized portfolio under different estimation windows.")
    gmv_metrics = metrics_df[metrics_df["Portfolio"] == "GMV"].set_index("Window").drop(columns="Portfolio")
    tan_metrics = metrics_df[metrics_df["Portfolio"] == "Tangency"].set_index("Window").drop(columns="Portfolio")
    col_gm, col_tm = st.columns(2)
    with col_gm:
        st.markdown("**GMV Portfolio**")
        st.dataframe(gmv_metrics, use_container_width=True)
    with col_tm:
        st.markdown("**Tangency Portfolio**")
        st.dataframe(tan_metrics, use_container_width=True)

    st.markdown("---")

    # Weight tables
    st.subheader("GMV Weights Across Windows")
    gmv_sens = sens_df[sens_df["Portfolio"] == "GMV"].pivot(index="Ticker", columns="Window", values="Weight")
    st.dataframe(gmv_sens.style.format("{:.2%}"), use_container_width=True)

    st.subheader("Tangency Weights Across Windows")
    tan_sens = sens_df[sens_df["Portfolio"] == "Tangency"].pivot(index="Ticker", columns="Window", values="Weight")
    st.dataframe(tan_sens.style.format("{:.2%}"), use_container_width=True)

    # Export sensitivity data
    col_sdl1, col_sdl2, _ = st.columns([1, 1, 4])
    with col_sdl1:
        st.download_button("Download GMV CSV", gmv_sens.to_csv(), "gmv_sensitivity.csv", "text/csv", key="dl_gmv_csv")
    with col_sdl2:
        st.download_button("Download Tangency CSV", tan_sens.to_csv(), "tangency_sensitivity.csv", "text/csv", key="dl_tan_csv")

    st.markdown("---")

    # Grouped bar chart
    st.subheader("Weight Comparison Chart")
    port_choice = st.radio("Portfolio", ["GMV", "Tangency"], horizontal=True, key="sens_port")
    sub = sens_df[sens_df["Portfolio"] == port_choice]
    fig_sens = px.bar(sub, x="Ticker", y="Weight", color="Window", barmode="group",
                       color_discrete_sequence=CHART_COLORS)
    fig_sens.update_layout(yaxis_tickformat=".0%")
    style_chart(fig_sens, height=420)
    st.plotly_chart(fig_sens, use_container_width=True, key="sens_tab6")

    st.markdown("---")

    # ── Optional: Custom Portfolio Sensitivity ───────────────────────────
    show_custom_sens = st.checkbox(
        "Include Custom Portfolio in sensitivity analysis",
        value=False,
        key="custom_sens_toggle",
        help="Compare your custom portfolio weights against GMV and Tangency across different estimation windows.",
    )

    if show_custom_sens:
        st.subheader("Custom Portfolio Sensitivity")
        st.caption(
            "Your current custom portfolio weights are held fixed and evaluated against the mean returns "
            "and covariance matrix estimated from each lookback window. This shows how your chosen allocation "
            "would have performed under different estimation periods — unlike GMV and Tangency, the weights "
            "do not change, only the risk/return estimates do."
        )

        # Read current custom weights from sliders
        cust_w_sens = np.array([st.session_state.get(f"cw_{t}", 1.0 / n_assets) for t in tickers])
        cust_total_sens = cust_w_sens.sum()
        if cust_total_sens != 0:
            cust_w_sens = cust_w_sens / cust_total_sens
        else:
            cust_w_sens = np.ones(n_assets) / n_assets

        # Show the weights being evaluated
        cust_w_display = pd.DataFrame({"Ticker": tickers, "Weight": cust_w_sens})
        cust_w_display["Weight"] = cust_w_display["Weight"].map("{:.2%}".format)
        st.markdown("**Custom weights being evaluated:**")
        st.dataframe(cust_w_display.set_index("Ticker").T, use_container_width=True)

        # Compute custom portfolio metrics for each window
        custom_sens_rows = []
        for lb, lbl in zip(lookback_options, labels):
            sub_rets = stock_returns.iloc[-lb:]
            sub_mean = sub_rets.mean()
            sub_cov = sub_rets.cov()
            c_mu, c_sig, c_sh = portfolio_performance(cust_w_sens, sub_mean, sub_cov, rf)
            custom_sens_rows.append({
                "Window": lbl,
                "Ann. Return": f"{c_mu:.2%}",
                "Ann. Volatility": f"{c_sig:.2%}",
                "Sharpe": f"{c_sh:.3f}",
            })

        custom_sens_df = pd.DataFrame(custom_sens_rows).set_index("Window")

        # Side-by-side comparison: Custom vs GMV vs Tangency
        col_cs1, col_cs2, col_cs3 = st.columns(3)
        with col_cs1:
            st.markdown("**GMV Portfolio**")
            st.dataframe(gmv_metrics, use_container_width=True)
        with col_cs2:
            st.markdown("**Tangency Portfolio**")
            st.dataframe(tan_metrics, use_container_width=True)
        with col_cs3:
            st.markdown("**Custom Portfolio**")
            st.dataframe(custom_sens_df, use_container_width=True)

        # Sharpe comparison chart
        sharpe_comparison = pd.DataFrame({
            "Window": labels,
            "GMV": [float(gmv_metrics.loc[lbl, "Sharpe"]) if lbl in gmv_metrics.index else np.nan for lbl in labels],
            "Tangency": [float(tan_metrics.loc[lbl, "Sharpe"]) if lbl in tan_metrics.index else np.nan for lbl in labels],
            "Custom": [float(custom_sens_df.loc[lbl, "Sharpe"]) if lbl in custom_sens_df.index else np.nan for lbl in labels],
        })
        fig_sharpe_comp = px.bar(
            sharpe_comparison.melt(id_vars="Window", var_name="Portfolio", value_name="Sharpe"),
            x="Window", y="Sharpe", color="Portfolio", barmode="group",
            title="Sharpe Ratio Comparison Across Estimation Windows",
            color_discrete_sequence=[COLORS["success"], COLORS["accent"], "#E91E63"],
        )
        style_chart(fig_sharpe_comp, height=400)
        st.plotly_chart(fig_sharpe_comp, use_container_width=True, key="sharpe_comp_tab6")
