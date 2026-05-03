"""Researcher agent — same loop as OSS Faro, but with a tighter system prompt
that pre-warns about the upcoming risk review.

Telling the researcher "your output will be reviewed by a risk-focused
colleague" measurably improves first-draft quality: more caveats, more
explicit data dates, fewer hand-wavy projections.
"""

from __future__ import annotations

import textwrap

from faro_research.agent.core import DEFAULT_SYSTEM_PROMPT

RESEARCHER_ADDENDUM = textwrap.dedent("""\

    # 协作模式注意 (Researcher)

    你的初稿会传给一位 **风险审查同事** 审阅。他特别关注:
    - 数据来源与日期是否每个数字都有 attribution
    - 是否对未披露字段如实说"未披露", 而不是用"约""大概"硬填
    - 反求 / 估值结论的核心假设是否暴露
    - 是否提示了关键风险点(数据滞后 / 复权 / 行业周期 / 单事件依赖)

    所以这一轮你要:
    - 关键数字都加上 (Tushare YYYY-MM-DD) 或 (FOF YYYY-MM-DD as_of) 标注
    - 估值/反求结论必须明确写出"假设: ..."
    - 对薄弱的数据明确写"该字段未披露"或"基金池天花板限制"等限制
    - 不写"综合判断"这种无信息量的总结句
""")


def researcher_system_prompt(base: str = DEFAULT_SYSTEM_PROMPT) -> str:
    """OSS base prompt + collab addendum."""
    return base + RESEARCHER_ADDENDUM
