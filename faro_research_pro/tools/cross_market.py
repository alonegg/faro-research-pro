"""Cross-market comparable lookup for Faro Research Pro.

Given a US sector / industry (GICS-ish), return ranked A-share companies that
sit in conceptually adjacent Tushare SW industries — optionally filtered to a
peer market-cap band. Used to answer prompts like:

    "与 NVDA 对标的 A 股公司有哪些"

The mapping table is hard-coded against the actual industry strings returned
by ``client.stock_basic()`` (Tushare's old SW1 categorisation, ~110 buckets,
e.g. "半导体" / "软件服务" / "白酒"). The companion ``list_sw_industries``
tool lets the LLM discover the raw vocabulary when SECTOR_MAPPING misses.
"""

from __future__ import annotations

from typing import Any

from faro_research.tools.builtin.tushare import client as ts
from faro_research.tools.types import ToolSpec

# ────────────────────────────────────────────────────────────────────────────
# Sector mapping (GICS-ish US sector → list of Tushare SW industry names)
#
# All Chinese strings in the value lists are verified to appear in
# ``client.stock_basic()`` output. Casing on the keys is normalised at lookup
# time (lower + stripped) — so callers can pass "AI" / "ai" / "Information
# Technology" interchangeably.
# ────────────────────────────────────────────────────────────────────────────

SECTOR_MAPPING: dict[str, list[str]] = {
    # ── GICS sectors ─────────────────────────────────────────────────────
    "information technology": [
        "半导体", "元器件", "软件服务", "IT设备", "通信设备", "互联网",
    ],
    "technology": [
        "半导体", "元器件", "软件服务", "IT设备", "通信设备", "互联网",
    ],
    "health care": [
        "化学制药", "生物制药", "中成药", "医疗保健", "医药商业",
    ],
    "healthcare": [
        "化学制药", "生物制药", "中成药", "医疗保健", "医药商业",
    ],
    "consumer discretionary": [
        "汽车整车", "汽车配件", "家用电器", "服饰", "家居用品",
        "酒店餐饮", "旅游景点", "百货", "文教休闲",
    ],
    "consumer staples": [
        "白酒", "食品", "乳制品", "饲料", "软饮料", "啤酒", "红黄酒",
    ],
    "financials": ["银行", "证券", "保险", "多元金融"],
    "energy": ["石油开采", "石油加工", "煤炭开采", "焦炭加工", "石油贸易"],
    "materials": [
        "化工原料", "化学制药", "钢加工", "普钢", "特种钢", "铝", "铜",
        "铅锌", "黄金", "小金属", "水泥", "玻璃", "矿物制品", "其他建材",
        "造纸", "化纤", "塑料", "橡胶", "染料涂料", "农药化肥",
    ],
    "industrials": [
        "电气设备", "专用机械", "机械基件", "工程机械", "机床制造",
        "农用机械", "化工机械", "纺织机械", "轻工机械", "运输设备",
        "电器仪表", "建筑工程", "装修装饰", "航空", "船舶", "铁路",
        "公路", "港口", "水运", "空运", "公共交通", "仓储物流", "机场",
    ],
    "real estate": ["区域地产", "全国地产", "园区开发", "房产服务"],
    "utilities": [
        "火力发电", "水力发电", "新型电力", "供气供热", "水务", "环境保护",
    ],
    "communication services": [
        "通信设备", "电信运营", "互联网", "影视音像", "出版业", "广告包装",
    ],

    # ── Sub-sector / theme aliases ───────────────────────────────────────
    "semiconductors": ["半导体"],
    "semiconductor": ["半导体"],
    "software": ["软件服务", "互联网"],
    "internet": ["互联网", "软件服务"],
    "ev": ["汽车整车", "汽车配件", "电气设备"],
    "electric vehicles": ["汽车整车", "汽车配件", "电气设备"],
    "ai": ["半导体", "软件服务", "互联网", "通信设备", "IT设备"],
    "artificial intelligence": [
        "半导体", "软件服务", "互联网", "通信设备", "IT设备",
    ],
    "biotech": ["生物制药", "化学制药"],
    "biotechnology": ["生物制药", "化学制药"],
    "pharmaceuticals": ["化学制药", "生物制药", "中成药"],
    "banks": ["银行"],
    "insurance": ["保险"],
    "automobiles": ["汽车整车", "汽车配件"],
    "media": ["影视音像", "出版业", "广告包装"],
    "telecom": ["电信运营", "通信设备"],
    "oil & gas": ["石油开采", "石油加工"],
    "oil and gas": ["石油开采", "石油加工"],
    "metals & mining": ["铝", "铜", "铅锌", "黄金", "小金属", "普钢", "特种钢"],
    "steel": ["普钢", "特种钢", "钢加工"],
    "chemicals": ["化工原料", "染料涂料", "农药化肥"],
    "food & beverage": [
        "白酒", "食品", "乳制品", "软饮料", "啤酒", "红黄酒",
    ],
    "beverages": ["白酒", "软饮料", "啤酒", "红黄酒"],
    "retail": ["百货", "超市连锁", "电器连锁", "其他商业", "商品城"],
    "apparel": ["服饰", "纺织"],
    "machinery": ["专用机械", "机械基件", "工程机械", "机床制造"],
    "aerospace & defense": ["航空"],
    "construction": ["建筑工程", "装修装饰"],
    "hardware": ["元器件", "IT设备", "通信设备"],
    "cloud": ["软件服务", "互联网", "IT设备"],
    "fintech": ["软件服务", "多元金融"],
}

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

# 万元 → USD billion factor (USDCNY ≈ 7.2; 万元 = 1e4 CNY)
_WAN_CNY_TO_USD_BILLION = 1e4 / 7.2 / 1e9
# 万元 → CNY billion factor
_WAN_TO_CNY_BILLION = 1e4 / 1e9
_USDCNY = 7.2


def _resolve_sectors(query: str) -> list[str] | None:
    """Case-insensitive lookup with light fuzzy fall-through.

    1. Exact (case-folded) hit on SECTOR_MAPPING.
    2. Substring match: any key contained in the query, or vice versa.
    3. None ⇒ caller returns an "unknown sector" error.
    """
    if not query:
        return None
    q = query.strip().lower()
    if q in SECTOR_MAPPING:
        return SECTOR_MAPPING[q]
    # substring fall-through (longest key first to prefer specific over generic)
    for key in sorted(SECTOR_MAPPING.keys(), key=len, reverse=True):
        if key in q or q in key:
            return SECTOR_MAPPING[key]
    return None


def _safe_float(x: Any) -> float | None:
    try:
        if x is None:
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


# ────────────────────────────────────────────────────────────────────────────
# Tool functions
# ────────────────────────────────────────────────────────────────────────────


def find_a_share_peers(
    us_sector_or_industry: str,
    market_cap_usd_billion: float | None = None,
    max_results: int = 10,
) -> dict[str, Any]:
    """Rank A-share companies that map to a US sector / industry."""

    sw_industries = _resolve_sectors(us_sector_or_industry)
    if sw_industries is None:
        return {
            "error": (
                f"unknown sector {us_sector_or_industry!r}. "
                f"Call list_sw_industries to see the raw Tushare vocabulary, "
                f"or pass one of: {sorted(SECTOR_MAPPING.keys())[:15]} ..."
            )
        }

    # 1. Filter the universe to candidate SW industries.
    all_stocks = ts.stock_basic()
    sw_set = set(sw_industries)
    candidates = [r for r in all_stocks if r.get("industry") in sw_set]
    if not candidates:
        return {
            "error": (
                f"no A-share listings under SW industries "
                f"{sw_industries} (mapping may be stale)"
            ),
            "sw_industries_tried": sw_industries,
        }

    # 2. Sample a sane upper bound for the price-snapshot fan-out.
    #    Naive symbol-asc misses STAR-Market mega-caps (688xxx codes sort
    #    LAST), so per SW industry we take a hybrid slice: the oldest
    #    mainboard tickers (low symbol) AND any 688xxx STAR tickers (often
    #    house the new-economy mega-caps like 中芯国际/寒武纪/海光信息).
    #    Then round-robin across industries so one big bucket can't eat
    #    the whole probe budget. Total fan-out capped at 25 daily_basic
    #    calls — hard upper bound to keep latency bounded.
    by_ind: dict[str, list[dict]] = {}
    for r in candidates:
        by_ind.setdefault(r.get("industry") or "?", []).append(r)

    per_ind_pool: list[list[dict]] = []
    for ind_name, rows in by_ind.items():
        # nonstar: oldest first (low symbol = old listing = often big legacy)
        # star: newest first (DESC) — recent STAR-board listings tend to be
        # the high-profile new-economy mega-caps (中芯国际/寒武纪/海光).
        nonstar = sorted(
            [r for r in rows if not (r.get("symbol") or "").startswith("688")],
            key=lambda r: r.get("symbol") or "999999",
        )
        star = sorted(
            [r for r in rows if (r.get("symbol") or "").startswith("688")],
            key=lambda r: r.get("symbol") or "000000",
            reverse=True,
        )
        # Star first so they aren't crowded out by the round-robin cap.
        slice_ = (star[:6] + nonstar[:6])[:10]
        per_ind_pool.append(slice_)

    interleaved: list[dict] = []
    pos = 0
    while True:
        added = False
        for bucket in per_ind_pool:
            if pos < len(bucket):
                interleaved.append(bucket[pos])
                added = True
                if len(interleaved) >= 30:
                    break
        if not added or len(interleaved) >= 30:
            break
        pos += 1
    probe_set = interleaved[:30]

    # 3. Fetch market cap snapshot for each probe (sequential — the Tushare
    #    HTTP client already serialises to respect rate limits).
    enriched: list[dict[str, Any]] = []
    for row in probe_set:
        ts_code = row.get("ts_code")
        if not ts_code:
            continue
        snap = ts.daily_basic_latest(ts_code) or {}
        total_mv_wan = _safe_float(snap.get("total_mv"))  # 万元
        if total_mv_wan is None:
            continue
        enriched.append(
            {
                "ts_code": ts_code,
                "name": row.get("name"),
                "sw_industry": row.get("industry"),
                "total_mv_cny_billion": round(
                    total_mv_wan * _WAN_TO_CNY_BILLION, 2
                ),
                "total_mv_usd_billion": round(
                    total_mv_wan * _WAN_CNY_TO_USD_BILLION, 2
                ),
                "pe_ttm": _safe_float(snap.get("pe_ttm")),
                "pb": _safe_float(snap.get("pb")),
                "dv_ratio": _safe_float(snap.get("dv_ratio")),
            }
        )

    if not enriched:
        return {
            "error": "all probes returned empty daily_basic snapshots",
            "sw_industries_tried": sw_industries,
        }

    # 4. Optional market-cap band filter (0.3x – 3x of the US peer).
    target_cny_billion: float | None = None
    if market_cap_usd_billion is not None:
        target_cny_billion = market_cap_usd_billion * _USDCNY
        lo = target_cny_billion * 0.3
        hi = target_cny_billion * 3.0
        banded = [
            r for r in enriched
            if lo <= r["total_mv_cny_billion"] <= hi
        ]
        # If banding wipes out everything (US mega-cap vs A-share mid-caps),
        # keep the unbanded list but mark it.
        if banded:
            enriched = banded
            band_applied = True
        else:
            band_applied = False
    else:
        band_applied = False

    # 5. Rank — by proximity to the target (if provided) else by absolute size.
    if target_cny_billion is not None:
        enriched.sort(
            key=lambda r: abs(r["total_mv_cny_billion"] - target_cny_billion)
        )
        peak = max(
            abs(r["total_mv_cny_billion"] - target_cny_billion)
            for r in enriched
        ) or 1.0
        for r in enriched:
            gap = abs(r["total_mv_cny_billion"] - target_cny_billion)
            r["match_score"] = round(1.0 - gap / peak, 3)
    else:
        enriched.sort(key=lambda r: -r["total_mv_cny_billion"])
        peak = enriched[0]["total_mv_cny_billion"] or 1.0
        for r in enriched:
            r["match_score"] = round(r["total_mv_cny_billion"] / peak, 3)

    matches = enriched[: max(1, int(max_results))]

    return {
        "us_sector_or_industry": us_sector_or_industry,
        "sw_industries_used": sw_industries,
        "probe_size": len(probe_set),
        "candidates_in_universe": len(candidates),
        "market_cap_band_applied": band_applied,
        "target_cap_cny_billion": (
            round(target_cny_billion, 2) if target_cny_billion else None
        ),
        "matches": matches,
        "field_glossary": {
            "total_mv_cny_billion": "total market cap, CNY billion",
            "total_mv_usd_billion": "total market cap, USD billion (USDCNY≈7.2)",
            "pe_ttm": "trailing-twelve-month P/E",
            "dv_ratio": "dividend yield (%)",
            "match_score": (
                "1.0 = closest to target cap (or largest in sector if no "
                "target supplied); 0.0 = furthest"
            ),
        },
    }


def list_sw_industries() -> dict[str, Any]:
    """Distinct SW industry names + their A-share listing counts."""
    rows = ts.stock_basic()
    counts: dict[str, int] = {}
    for r in rows:
        ind = r.get("industry") or "(未分类)"
        counts[ind] = counts.get(ind, 0) + 1
    industries = [
        {"name": name, "stock_count": cnt}
        for name, cnt in sorted(counts.items(), key=lambda x: -x[1])
    ]
    return {
        "industries": industries,
        "total_industries": len(industries),
        "total_stocks": sum(counts.values()),
        "note": (
            "These are Tushare's stock_basic 'industry' values (old SW1 "
            "scheme, ~110 buckets). Pass any of these names — or the GICS "
            "alias from SECTOR_MAPPING — into find_a_share_peers."
        ),
    }


# ────────────────────────────────────────────────────────────────────────────
# Formatters
# ────────────────────────────────────────────────────────────────────────────


def _fmt_find_a_share_peers(out: dict, args: dict) -> str:
    if "error" in out:
        return f"**错误**: {out['error']}"
    matches = out.get("matches") or []
    if not matches:
        return "无匹配公司"
    sw = "、".join(out.get("sw_industries_used") or [])
    band_note = ""
    if out.get("market_cap_band_applied"):
        band_note = (
            f" · 市值带 {out.get('target_cap_cny_billion')} CNY-Bn × 0.3~3x"
        )
    header = (
        f"**{args.get('us_sector_or_industry', '?')}** → SW行业: {sw}"
        f"{band_note}\n\n"
        "| ts_code | 名称 | SW行业 | 市值(CNY-Bn) | 市值(USD-Bn) | PE_TTM | 股息% | match |\n"
        "|---|---|---|---:|---:|---:|---:|---:|"
    )
    rows = []
    for m in matches:
        rows.append(
            f"| `{m.get('ts_code')}` | {m.get('name')} | "
            f"{m.get('sw_industry')} | "
            f"{m.get('total_mv_cny_billion'):.1f} | "
            f"{m.get('total_mv_usd_billion'):.1f} | "
            f"{(m.get('pe_ttm') if m.get('pe_ttm') is not None else '—')} | "
            f"{(m.get('dv_ratio') if m.get('dv_ratio') is not None else '—')} | "
            f"{m.get('match_score')} |"
        )
    return header + "\n" + "\n".join(rows)


def _fmt_list_sw_industries(out: dict, args: dict) -> str:
    inds = out.get("industries") or []
    n = out.get("total_industries", len(inds))
    head = inds[:30]
    tail_count = len(inds) - len(head)
    lines = [f"共 {n} 个 SW 行业 (前 30 按上市公司数排序):", "",
             "| 行业 | 上市公司数 |", "|---|---:|"]
    for r in head:
        lines.append(f"| {r['name']} | {r['stock_count']} |")
    if tail_count > 0:
        lines.append(f"| _… 还有 {tail_count} 个_ | |")
    return "\n".join(lines)


# ────────────────────────────────────────────────────────────────────────────
# ToolSpec definitions
# ────────────────────────────────────────────────────────────────────────────


_FIND_A_SHARE_PEERS = ToolSpec(
    name="find_a_share_peers",
    description=(
        "Find A-share companies comparable to a US sector / industry, "
        "ranked by market-cap proximity.\n\n"
        "## When to use\n"
        "User asks 'A股里跟 NVDA / AAPL / TSLA 对标的公司是谁', or any "
        "cross-market comparable mapping where the input is a US ticker's "
        "sector / industry label and the output should be Chinese-listed "
        "names. Pass `market_cap_usd_billion` whenever known — the result "
        "set is much sharper when banded (0.3x–3x of the US peer).\n\n"
        "## When NOT to use\n"
        "- For Hong-Kong-listed peers (use a different tool / market).\n"
        "- For company-name → ts_code resolution (use `resolve_ticker`).\n"
        "- For deep fundamental compare (call `get_key_ratios` per peer "
        "  AFTER you have the ts_code list from this tool).\n\n"
        "## Returns\n"
        "`matches[]` with ts_code / name / sw_industry / market caps in CNY "
        "and USD billion / PE_TTM / dividend yield / match_score (1.0 = best). "
        "Plus `sw_industries_used` so you can verify the mapping was sane."
    ),
    compact_description=(
        "美股板块/行业 → A股对标公司列表(按市值就近排序)。"
        "传 market_cap_usd_billion 可加 0.3~3x 市值带。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "us_sector_or_industry": {
                "type": "string",
                "description": (
                    "GICS-ish sector or industry label, e.g. "
                    "'Information Technology', 'Semiconductors', "
                    "'Health Care', 'EV', 'AI'. Case-insensitive."
                ),
            },
            "market_cap_usd_billion": {
                "type": "number",
                "description": (
                    "Optional. Market cap of the US peer in USD billion "
                    "(e.g. 3000 for NVDA). When given, A-share results are "
                    "filtered to 0.3x–3x and ranked by closeness."
                ),
            },
            "max_results": {
                "type": "integer",
                "default": 10,
                "description": "Top-N rows to return (default 10).",
            },
        },
        "required": ["us_sector_or_industry"],
    },
    fn=find_a_share_peers,
    formatter=_fmt_find_a_share_peers,
    cache_ttl_sec=3600,  # daily_basic refreshes EOD; 1h is safe
    timeout_sec=30,      # 20 daily_basic calls — generous
)


_LIST_SW_INDUSTRIES = ToolSpec(
    name="list_sw_industries",
    description=(
        "List all distinct Tushare 'industry' values (old SW1 scheme) and "
        "their A-share listing counts.\n\n"
        "## When to use\n"
        "When `find_a_share_peers` returns 'unknown sector' — call this to "
        "see the raw Chinese vocabulary, then retry with a closer alias.\n"
        "Also useful when the user asks 'A股有哪些行业'.\n\n"
        "## Returns\n"
        "`industries[]` sorted by stock_count desc. ~110 entries."
    ),
    compact_description="A股 SW1 行业全集 + 上市公司数。映射查不到时用来对照。",
    parameters={"type": "object", "properties": {}, "required": []},
    fn=list_sw_industries,
    formatter=_fmt_list_sw_industries,
    cache_ttl_sec=86400,  # listings change rarely
    timeout_sec=10,
)


CROSS_MARKET_TOOLS: list[ToolSpec] = [_FIND_A_SHARE_PEERS, _LIST_SW_INDUSTRIES]


__all__ = [
    "SECTOR_MAPPING",
    "find_a_share_peers",
    "list_sw_industries",
    "CROSS_MARKET_TOOLS",
]
