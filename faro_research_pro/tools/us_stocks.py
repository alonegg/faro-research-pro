"""US-stock ToolSpecs backed by Financial Datasets AI (api.financialdatasets.ai).

Pro-only layer. The OSS Faro side ships Tushare-backed A-share tools; this
module mirrors that shape for US tickers so an agent can mix both.

Conventions copied from `faro_research/tools/builtin/tushare/__init__.py`:

  * Each tool returns a plain dict; on failure returns ``{"error": "..."}``
    instead of raising — the registry surfaces that to the agent gracefully.
  * Each tool has a markdown ``formatter`` so the LLM never sees raw JSON.
  * ``cache_ttl_sec`` reflects upstream freshness (prices ~5min, fundamentals
    1 day — once a 10-Q is filed it's immutable).

Endpoints used (all verified live 2026-05-03 with the project key):

  GET /prices/snapshot/                  → spot price
  GET /prices/                           → daily OHLCV (used to compute 52w hi/lo)
  GET /financial-metrics/snapshot/       → market_cap, PE, margins, ROE, ...
  GET /company/facts                     → name, sector, industry, exchange, location
  GET /financials/income-statements      → revenue / margins / EPS by period
  GET /financials/balance-sheets         → assets / debt / equity by period
  GET /insider-trades                    → Form 4 filings
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import httpx

from faro_research.tools.types import ToolSpec

# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

_BASE_URL = "https://api.financialdatasets.ai"


def _call_fd(path: str, params: dict[str, Any] | None = None,
             timeout: float = 15.0) -> dict:
    """Internal Financial Datasets AI client.

    Reads ``FINANCIAL_DATASETS_API_KEY`` from env at call time (so a late-set
    key is picked up). Raises ``RuntimeError`` on non-2xx — callers wrap this
    in try/except and convert to ``{"error": ...}`` for the tool contract.
    """
    key = os.getenv("FINANCIAL_DATASETS_API_KEY")
    if not key:
        raise RuntimeError("FINANCIAL_DATASETS_API_KEY env var not set")
    url = _BASE_URL + path
    with httpx.Client(timeout=timeout) as c:
        r = c.get(url, params=params or {}, headers={"X-API-KEY": key})
    if r.status_code // 100 != 2:
        raise RuntimeError(
            f"FD.ai {path} → HTTP {r.status_code}: {r.text[:200]}"
        )
    try:
        return r.json()
    except ValueError as e:
        raise RuntimeError(f"FD.ai {path} → non-JSON body: {e}") from e


# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------

def _money(n: Any, *, precision: int = 2) -> str:
    """Format a USD amount with K / M / B / T suffix."""
    if n is None or n == "":
        return "—"
    try:
        x = float(n)
    except (TypeError, ValueError):
        return "—"
    sign = "-" if x < 0 else ""
    a = abs(x)
    if a >= 1e12:
        return f"{sign}${a / 1e12:.{precision}f}T"
    if a >= 1e9:
        return f"{sign}${a / 1e9:.{precision}f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.{precision}f}M"
    if a >= 1e3:
        return f"{sign}${a / 1e3:.{precision}f}K"
    return f"{sign}${a:.2f}"


def _pct_frac(n: Any, *, precision: int = 2) -> str:
    """FD.ai returns margins/yields as fractions (0.71 = 71%). Render as %."""
    if n is None or n == "":
        return "—"
    try:
        x = float(n)
    except (TypeError, ValueError):
        return "—"
    return f"{x * 100:.{precision}f}%"


def _ratio(n: Any, *, precision: int = 2, suffix: str = "x") -> str:
    if n is None or n == "":
        return "—"
    try:
        x = float(n)
    except (TypeError, ValueError):
        return "—"
    return f"{x:.{precision}f}{suffix}"


def _num(n: Any) -> str:
    if n is None or n == "":
        return "—"
    try:
        return f"{float(n):.2f}"
    except (TypeError, ValueError):
        return "—"


# ---------------------------------------------------------------------------
# Tool 1 — get_us_stock_quote
# ---------------------------------------------------------------------------

def _tool_get_us_stock_quote(ticker: str) -> dict:
    t = (ticker or "").strip().upper()
    if not t:
        return {"error": "ticker is required"}
    try:
        spot = _call_fd("/prices/snapshot/", {"ticker": t}).get("snapshot") or {}
        metrics = _call_fd("/financial-metrics/snapshot/",
                           {"ticker": t}).get("snapshot") or {}
        # 52w range from daily OHLCV
        end = date.today()
        start = end - timedelta(days=400)
        hist = _call_fd("/prices/", {
            "ticker": t,
            "interval": "day",
            "interval_multiplier": 1,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        }).get("prices") or []
        wk52_high: float | None = None
        wk52_low: float | None = None
        if hist:
            # Trim to last ~252 trading days
            recent = hist[-252:]
            wk52_high = max((p.get("high") for p in recent
                             if p.get("high") is not None), default=None)
            wk52_low = min((p.get("low") for p in recent
                            if p.get("low") is not None), default=None)
        return {
            "ticker": t,
            "spot": spot,
            "valuation": {
                "market_cap": metrics.get("market_cap"),
                "enterprise_value": metrics.get("enterprise_value"),
                "pe": metrics.get("price_to_earnings_ratio"),
                "ps": metrics.get("price_to_sales_ratio"),
                "pb": metrics.get("price_to_book_ratio"),
                "ev_ebitda": metrics.get("enterprise_value_to_ebitda_ratio"),
                "peg": metrics.get("peg_ratio"),
            },
            "range_52w": {"high": wk52_high, "low": wk52_low,
                          "bars": len(hist)},
            "note": "spot from /prices/snapshot/, multiples from "
                    "/financial-metrics/snapshot/, 52w from /prices/ daily bars",
        }
    except Exception as e:
        return {"error": str(e)}


def _fmt_us_stock_quote(out: dict, args: dict) -> str:
    if "error" in out:
        return f"**Quote lookup failed for {args.get('ticker', '?')}**: {out['error']}"
    t = out.get("ticker", "?")
    s = out.get("spot") or {}
    v = out.get("valuation") or {}
    rng = out.get("range_52w") or {}

    price = s.get("price")
    chg = s.get("day_change")
    chg_pct = s.get("day_change_percent")
    when = s.get("time", "—")

    arrow = ""
    if isinstance(chg, (int, float)):
        arrow = " ▲" if chg > 0 else (" ▼" if chg < 0 else " ·")

    lines = [
        f"## {t} — quote",
        "",
        f"- **Price**: ${_num(price)} ({_num(chg)}{arrow} / "
        f"{_num(chg_pct)}%) · as of {when}",
        f"- **52w range**: ${_num(rng.get('low'))} – ${_num(rng.get('high'))}  "
        f"(over {rng.get('bars', 0)} bars)",
        "",
        "| Market cap | EV | P/E | P/S | P/B | EV/EBITDA | PEG |",
        "|---|---|---|---|---|---|---|",
        f"| {_money(v.get('market_cap'))} | {_money(v.get('enterprise_value'))} "
        f"| {_ratio(v.get('pe'))} | {_ratio(v.get('ps'))} "
        f"| {_ratio(v.get('pb'))} | {_ratio(v.get('ev_ebitda'))} "
        f"| {_ratio(v.get('peg'))} |",
    ]
    return "\n".join(lines)


_GET_US_STOCK_QUOTE = ToolSpec(
    name="get_us_stock_quote",
    description=(
        "Real-time spot price + valuation multiples + 52-week range for a US "
        "ticker.\n\n"
        "## When to use\n"
        "Any short-term price / valuation question on a US-listed stock: "
        "current quote, market cap, P/E, where the price sits in its 52-week "
        "range. First-choice tool for 'how expensive is X right now'.\n\n"
        "## When NOT to use\n"
        "Long historical analysis (use a quant pipeline). Detailed financials "
        "→ `get_us_financials`. Sector / business description → "
        "`get_us_company_facts`.\n\n"
        "## Returns\n"
        "Spot quote (price, day change, timestamp), valuation snapshot "
        "(market cap, EV, P/E, P/S, P/B, EV/EBITDA, PEG), and 52-week "
        "high/low computed from daily bars."
    ),
    compact_description=(
        "US stock quote: price + market cap + P/E + 52w range. "
        "First tool for 'how expensive is X today'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "US ticker symbol, e.g. 'NVDA', 'AAPL', 'TSLA'",
            },
        },
        "required": ["ticker"],
    },
    fn=_tool_get_us_stock_quote,
    formatter=_fmt_us_stock_quote,
    cache_ttl_sec=300,   # 5 min — intraday prices
    timeout_sec=15,
)


# ---------------------------------------------------------------------------
# Tool 2 — get_us_company_facts  (NEEDED by Agent B for cross-market matching)
# ---------------------------------------------------------------------------

def _tool_get_us_company_facts(ticker: str) -> dict:
    t = (ticker or "").strip().upper()
    if not t:
        return {"error": "ticker is required"}
    try:
        facts = _call_fd("/company/facts", {"ticker": t}).get("company_facts") or {}
        metrics = _call_fd("/financial-metrics/snapshot/",
                           {"ticker": t}).get("snapshot") or {}
        return {
            "ticker": t,
            "name": facts.get("name"),
            "sector": facts.get("sector"),
            "industry": facts.get("industry"),
            "sic_sector": facts.get("sic_sector"),
            "sic_industry": facts.get("sic_industry"),
            "exchange": facts.get("exchange"),
            "country": facts.get("location"),
            "category": facts.get("category"),
            "is_active": facts.get("is_active"),
            "cik": facts.get("cik"),
            "sec_filings_url": facts.get("sec_filings_url"),
            "market_cap": metrics.get("market_cap"),
            "gross_margin": metrics.get("gross_margin"),
            "operating_margin": metrics.get("operating_margin"),
            "net_margin": metrics.get("net_margin"),
            "return_on_equity": metrics.get("return_on_equity"),
            "revenue_growth": metrics.get("revenue_growth"),
            "earnings_growth": metrics.get("earnings_growth"),
            "note": "FD.ai /company/facts has no business-description text; "
                    "if narrative is needed, fetch SEC filings via "
                    "sec_filings_url. Margins / market_cap come from "
                    "/financial-metrics/snapshot/.",
        }
    except Exception as e:
        return {"error": str(e)}


def _fmt_us_company_facts(out: dict, args: dict) -> str:
    if "error" in out:
        return f"**Facts lookup failed for {args.get('ticker', '?')}**: {out['error']}"
    t = out.get("ticker", "?")
    name = out.get("name") or "?"
    lines = [
        f"## {name} ({t}) — company facts",
        "",
        f"- **Sector / industry**: {out.get('sector') or '—'} · "
        f"{out.get('industry') or '—'}",
        f"- **SIC sector / industry**: {out.get('sic_sector') or '—'} · "
        f"{out.get('sic_industry') or '—'}",
        f"- **Exchange**: {out.get('exchange') or '—'}  ·  "
        f"**Country**: {out.get('country') or '—'}  ·  "
        f"**Active**: {out.get('is_active')}",
        f"- **Market cap**: {_money(out.get('market_cap'))}",
        f"- **CIK**: {out.get('cik') or '—'}  ·  "
        f"[SEC filings]({out.get('sec_filings_url') or '#'})",
        "",
        "| Gross margin | Operating margin | Net margin | ROE | Revenue YoY | EPS YoY |",
        "|---|---|---|---|---|---|",
        f"| {_pct_frac(out.get('gross_margin'))} "
        f"| {_pct_frac(out.get('operating_margin'))} "
        f"| {_pct_frac(out.get('net_margin'))} "
        f"| {_pct_frac(out.get('return_on_equity'))} "
        f"| {_pct_frac(out.get('revenue_growth'))} "
        f"| {_pct_frac(out.get('earnings_growth'))} |",
    ]
    return "\n".join(lines)


_GET_US_COMPANY_FACTS = ToolSpec(
    name="get_us_company_facts",
    description=(
        "Identity + classification + size of a US-listed company in one call. "
        "Combines /company/facts (sector / industry / exchange / SIC / SEC "
        "filings URL) with /financial-metrics/snapshot/ (market cap + headline "
        "margins + growth).\n\n"
        "## When to use\n"
        "* You need to know what business a ticker represents (sector, "
        "  industry, exchange, country).\n"
        "* Cross-market matching: deciding which A-share / H-share comp lines "
        "  up with this US name (sector + size).\n"
        "* Quick sanity check on profitability before going deeper.\n\n"
        "## When NOT to use\n"
        "Detailed period-by-period financials → `get_us_financials`. Today's "
        "price / valuation multiples → `get_us_stock_quote`.\n\n"
        "## Returns\n"
        "Name, sector, industry (both GICS-style and SIC), exchange, country, "
        "active flag, CIK, SEC filings link, market cap, and the four headline "
        "margins (gross / operating / net / ROE) plus revenue & earnings YoY.\n\n"
        "## Caveat\n"
        "FD.ai does NOT return a free-text business description here. If the "
        "agent needs the narrative, follow `sec_filings_url` to the latest 10-K."
    ),
    compact_description=(
        "US company identity: sector, industry, exchange, country, market cap, "
        "headline margins. Use for cross-market matching."
    ),
    parameters={
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "US ticker symbol, e.g. 'NVDA', 'AAPL'",
            },
        },
        "required": ["ticker"],
    },
    fn=_tool_get_us_company_facts,
    formatter=_fmt_us_company_facts,
    cache_ttl_sec=86400,   # 1 day — sector/industry rarely change
    timeout_sec=15,
)


# ---------------------------------------------------------------------------
# Tool 3 — get_us_financials
# ---------------------------------------------------------------------------

_ALLOWED_PERIODS = {"annual", "quarterly", "ttm"}


def _tool_get_us_financials(ticker: str, period_type: str = "annual",
                            limit: int = 4) -> dict:
    t = (ticker or "").strip().upper()
    if not t:
        return {"error": "ticker is required"}
    period = (period_type or "annual").lower()
    if period not in _ALLOWED_PERIODS:
        period = "annual"
    n = max(1, min(int(limit or 4), 12))
    try:
        income = _call_fd("/financials/income-statements", {
            "ticker": t, "period": period, "limit": n,
        }).get("income_statements") or []
        balance = _call_fd("/financials/balance-sheets", {
            "ticker": t, "period": period, "limit": n,
        }).get("balance_sheets") or []
        # Slim each row down to the cells our formatter needs (saves agent tokens
        # if the LLM ever sees raw JSON, e.g. when no formatter applied).
        income_keep = (
            "report_period", "fiscal_period", "currency",
            "revenue", "gross_profit", "operating_income", "net_income",
            "earnings_per_share_diluted",
        )
        balance_keep = (
            "report_period", "fiscal_period", "currency",
            "total_assets", "total_liabilities", "shareholders_equity",
            "total_debt", "cash_and_equivalents",
        )
        return {
            "ticker": t,
            "period": period,
            "income_statements": [
                {k: row.get(k) for k in income_keep} for row in income
            ],
            "balance_sheets": [
                {k: row.get(k) for k in balance_keep} for row in balance
            ],
            "note": "amounts in row.currency (almost always USD); diluted EPS "
                    "is per-share USD; period_type='ttm' = trailing 12 months "
                    "rolling.",
        }
    except Exception as e:
        return {"error": str(e)}


def _fmt_us_financials(out: dict, args: dict) -> str:
    if "error" in out:
        return f"**Financials lookup failed for {args.get('ticker', '?')}**: {out['error']}"
    t = out.get("ticker", "?")
    period = out.get("period", "?")
    inc = out.get("income_statements") or []
    bs = out.get("balance_sheets") or []

    # Order oldest → newest so trends read left-to-right
    inc_sorted = sorted(inc, key=lambda r: r.get("report_period") or "")
    bs_sorted = sorted(bs, key=lambda r: r.get("report_period") or "")

    def _hdr(rows: list) -> str:
        return " | ".join((r.get("fiscal_period") or r.get("report_period") or "—")
                          for r in rows)

    lines = [f"## {t} — financials ({period}, {len(inc_sorted)} periods)"]

    if inc_sorted:
        lines += [
            "",
            "### Income statement",
            "",
            "| Metric | " + _hdr(inc_sorted) + " |",
            "|---|" + "|".join(["---"] * len(inc_sorted)) + "|",
            "| Revenue | " + " | ".join(_money(r.get("revenue"))
                                        for r in inc_sorted) + " |",
            "| Gross profit | " + " | ".join(_money(r.get("gross_profit"))
                                              for r in inc_sorted) + " |",
            "| Operating income | " + " | ".join(_money(r.get("operating_income"))
                                                  for r in inc_sorted) + " |",
            "| Net income | " + " | ".join(_money(r.get("net_income"))
                                            for r in inc_sorted) + " |",
            "| Diluted EPS | " + " | ".join(_num(r.get("earnings_per_share_diluted"))
                                             for r in inc_sorted) + " |",
        ]
    else:
        lines += ["", "_(no income-statement rows returned)_"]

    if bs_sorted:
        lines += [
            "",
            "### Balance sheet",
            "",
            "| Metric | " + _hdr(bs_sorted) + " |",
            "|---|" + "|".join(["---"] * len(bs_sorted)) + "|",
            "| Total assets | " + " | ".join(_money(r.get("total_assets"))
                                              for r in bs_sorted) + " |",
            "| Total liabilities | " + " | ".join(_money(r.get("total_liabilities"))
                                                   for r in bs_sorted) + " |",
            "| Shareholders' equity | " + " | ".join(_money(r.get("shareholders_equity"))
                                                      for r in bs_sorted) + " |",
            "| Total debt | " + " | ".join(_money(r.get("total_debt"))
                                            for r in bs_sorted) + " |",
            "| Cash & equivalents | " + " | ".join(_money(r.get("cash_and_equivalents"))
                                                    for r in bs_sorted) + " |",
        ]
    else:
        lines += ["", "_(no balance-sheet rows returned)_"]

    return "\n".join(lines)


_GET_US_FINANCIALS = ToolSpec(
    name="get_us_financials",
    description=(
        "Income statement + balance sheet over the last N reporting periods.\n\n"
        "## Parameters\n"
        "- period_type='annual'    : 10-K filings (year-end)\n"
        "- period_type='quarterly' : 10-Q filings\n"
        "- period_type='ttm'       : trailing-twelve-months rolling figures\n"
        "- limit: 1-12 periods (default 4)\n\n"
        "## When to use\n"
        "Revenue / margin / EPS / debt / cash trends across periods. Pick "
        "'ttm' for the freshest snapshot of profitability, 'annual' for "
        "long trend, 'quarterly' for seasonality.\n\n"
        "## When NOT to use\n"
        "Single-shot valuation question → `get_us_stock_quote`. Sector / "
        "classification → `get_us_company_facts`.\n\n"
        "## Returns\n"
        "Two compact tables — income (revenue / gross / operating / net / "
        "diluted EPS) and balance sheet (assets / liabilities / equity / "
        "total debt / cash) — columns oldest → newest."
    ),
    compact_description=(
        "US 10-K/10-Q/TTM financials: revenue, margins, EPS, assets, debt over "
        "N periods. Default annual / 4 periods."
    ),
    parameters={
        "type": "object",
        "properties": {
            "ticker": {"type": "string", "description": "US ticker, e.g. 'NVDA'"},
            "period_type": {
                "type": "string",
                "enum": ["annual", "quarterly", "ttm"],
                "default": "annual",
                "description": "Reporting cadence",
            },
            "limit": {
                "type": "integer",
                "default": 4,
                "description": "Number of periods, 1-12",
            },
        },
        "required": ["ticker"],
    },
    fn=_tool_get_us_financials,
    formatter=_fmt_us_financials,
    cache_ttl_sec=86400,   # statements are immutable once filed
    timeout_sec=15,
)


# ---------------------------------------------------------------------------
# Tool 4 — get_us_insider_trades
# ---------------------------------------------------------------------------

def _tool_get_us_insider_trades(ticker: str, limit: int = 20) -> dict:
    t = (ticker or "").strip().upper()
    if not t:
        return {"error": "ticker is required"}
    n = max(1, min(int(limit or 20), 100))
    try:
        rows = _call_fd("/insider-trades", {
            "ticker": t, "limit": n,
        }).get("insider_trades") or []
        return {
            "ticker": t,
            "limit": n,
            "trades": rows,
            "field_glossary": {
                "transaction_type": "Human-readable string from FD.ai, e.g. "
                                    "'Open market purchase', 'Open market sale', "
                                    "'Gift', 'Tax or exercise-price share "
                                    "withholding', 'Award' — not the raw SEC "
                                    "Form 4 single-letter code.",
                "transaction_shares": "signed share count (positive = buy)",
                "transaction_value": "USD value at filing-day price; null if unknown",
            },
        }
    except Exception as e:
        return {"error": str(e)}


def _fmt_us_insider_trades(out: dict, args: dict) -> str:
    if "error" in out:
        return f"**Insider lookup failed for {args.get('ticker', '?')}**: {out['error']}"
    t = out.get("ticker", "?")
    rows = out.get("trades") or []
    if not rows:
        return f"## {t} — insider trades\n\n_(no trades returned)_"
    lines = [
        f"## {t} — last {len(rows)} insider trades",
        "",
        "| Date | Insider | Title | Type | Shares | Px | Value |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows[: args.get("limit", len(rows))]:
        date_s = r.get("transaction_date") or r.get("filing_date") or "—"
        name = r.get("name") or "—"
        title = (r.get("title") or "—")[:30]
        ttype = r.get("transaction_type") or "—"
        shares = _num(r.get("transaction_shares"))
        px = _num(r.get("transaction_price_per_share"))
        val = _money(r.get("transaction_value"))
        lines.append(f"| {date_s} | {name} | {title} | {ttype} | "
                     f"{shares} | {px} | {val} |")
    return "\n".join(lines)


_GET_US_INSIDER_TRADES = ToolSpec(
    name="get_us_insider_trades",
    description=(
        "Recent SEC Form 4 filings — directors / officers / 10%+ holders "
        "buying or selling the company's stock.\n\n"
        "## When to use\n"
        "Questions about insider conviction or risk signals: 'is the CEO "
        "selling?', 'any cluster buying recently?', 'how aggressive is the "
        "10b5-1 ladder?'.\n\n"
        "## When NOT to use\n"
        "Institutional 13F holdings (different endpoint, not wired here). "
        "Deep forensic accounting questions.\n\n"
        "## Returns\n"
        "Up to `limit` rows (default 20, max 100): transaction date, insider "
        "name, role, human-readable transaction type ('Open market purchase', "
        "'Open market sale', 'Gift', 'Tax or exercise-price share "
        "withholding', etc.), share count, price per share, total USD value."
    ),
    compact_description=(
        "US insider Form-4 trades (directors / officers). Use for management "
        "buy/sell signals."
    ),
    parameters={
        "type": "object",
        "properties": {
            "ticker": {"type": "string", "description": "US ticker, e.g. 'NVDA'"},
            "limit": {
                "type": "integer",
                "default": 20,
                "description": "Max trades to return; 1-100",
            },
        },
        "required": ["ticker"],
    },
    fn=_tool_get_us_insider_trades,
    formatter=_fmt_us_insider_trades,
    cache_ttl_sec=3600,   # Form 4 filings update intra-day; 1h is safe
    timeout_sec=15,
)


# ---------------------------------------------------------------------------
# Public registry
# ---------------------------------------------------------------------------

US_TOOLS: list[ToolSpec] = [
    _GET_US_STOCK_QUOTE,
    _GET_US_COMPANY_FACTS,
    _GET_US_FINANCIALS,
    _GET_US_INSIDER_TRADES,
]


__all__ = ["US_TOOLS", "_call_fd"]
