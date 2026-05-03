"""Risk Reviewer agent — reads the Researcher's draft, returns structured
verdict (approve / revise / reject) + specific issues.

Why a separate role rather than just "ask the LLM to critique its own work":
  - Different system prompt → different attention focus
  - Forces structured JSON output → orchestrator can act on it programmatically
  - Each review is one cheap LLM call (no tools, no chain-of-thought hacks)
"""

from __future__ import annotations

import json
import re
import textwrap
from dataclasses import dataclass

from faro_research.providers.base import Message, Provider

REVIEWER_SYSTEM = textwrap.dedent("""\
    你是 Faro Research 的 **风险审查员**。一位 Researcher 同事刚交了一份
    A 股研究草稿。**你的任务不是重写,而是审查**。

    # 审查清单

    遍历草稿,依次检查:

    1. **数据归因**: 每个具体数字是否有日期 + 数据源标注?
       - "PE_TTM 20.97×" → 是否说明了 (Tushare 2026-04-30)?
       - 季度财务指标 → 是否有 25Q4 / 26Q1 这样的清楚口径?
    2. **未披露字段**: 是否如实写"未披露"而不是用"约""大概"硬填?
    3. **估值/反求假设**: 如果给了估值结论或反求权重,核心假设是否明确暴露?
       - DCF: WACC / 永续增长率 / β
       - 反求: x_max / target_overrides 归一化 / 基金池
    4. **关键风险**: 是否有提到至少一个非显然的风险点?
       - 行情未复权(若有长跨度比较)
       - 一致预期数据缺失(若涉及预测)
       - 数据滞后(财报 vs 实时)
       - 基金池天花板 / 行业周期 / 单事件依赖
    5. **过度自信语**: 是否有未充分论证的"显著低估""极具吸引力""强烈推荐"等?
    6. **空话**: 是否有"综上所述""总而言之"这种无信息密度的总结段?

    # 输出 (严格 JSON, 不带任何 markdown 围栏)

    ```
    {
      "verdict": "approve" | "revise",
      "score": 1-10,
      "issues": [
        {"category": "归因|假设|风险|过度自信|空话|未披露", "detail": "<具体引用 + 修改建议>"},
        ...
      ],
      "must_fix": ["最关键 1-3 条 issue 的索引"],
      "summary": "<一句话总评, ≤ 40 字>"
    }
    ```

    评分参考:
    - 9-10: approve, 几乎不用改
    - 7-8: approve, 留意 issues 但不阻塞
    - 5-6: revise, must_fix 必须解决
    - <5: revise, 草稿有重大缺陷

    **不要重写草稿。不要给"完整修订版"。只给 JSON。**
""")


@dataclass
class ReviewIssue:
    category: str
    detail: str


@dataclass
class Review:
    verdict: str         # "approve" | "revise"
    score: int           # 1..10
    summary: str
    issues: list[ReviewIssue]
    must_fix_indices: list[int]
    raw_text: str        # for debugging / display

    @property
    def is_approved(self) -> bool:
        return self.verdict == "approve"

    @property
    def must_fix_issues(self) -> list[ReviewIssue]:
        return [self.issues[i] for i in self.must_fix_indices
                if 0 <= i < len(self.issues)]


def _parse_review(text: str) -> Review:
    """Robust JSON extraction. Reviewer LLMs sometimes wrap output in fences."""
    raw = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    m = re.search(r"\{[\s\S]*\}", cleaned)
    payload: dict = {}
    if m:
        try:
            payload = json.loads(m.group(0))
        except json.JSONDecodeError:
            payload = {}
    issues_raw = payload.get("issues") or []
    issues: list[ReviewIssue] = []
    for it in issues_raw:
        if isinstance(it, dict):
            issues.append(ReviewIssue(
                category=str(it.get("category") or "?"),
                detail=str(it.get("detail") or ""),
            ))
    return Review(
        verdict=("approve" if payload.get("verdict") == "approve" else "revise"),
        score=int(payload.get("score") or 0),
        summary=str(payload.get("summary") or "(reviewer 未给摘要)"),
        issues=issues,
        must_fix_indices=[int(i) for i in (payload.get("must_fix") or [])
                          if isinstance(i, (int, str)) and str(i).isdigit()],
        raw_text=raw,
    )


def review_draft(provider: Provider, *, query: str, draft: str) -> Review:
    """Single LLM call → structured Review. Provider-agnostic."""
    user = (
        f"# 用户原问题\n\n{query.strip()}\n\n"
        f"# Researcher 草稿\n\n{draft.strip()}"
    )
    resp = provider.chat(
        [
            Message(role="system", content=REVIEWER_SYSTEM),
            Message(role="user", content=user),
        ],
        tools=None,
        temperature=0.0,
        max_tokens=2048,
    )
    return _parse_review(resp.content or resp.extra.get("reasoning_content", ""))


def revision_prompt_for_researcher(review: Review) -> str:
    """Compose a follow-up user message telling the researcher what to fix."""
    if not review.must_fix_issues:
        # Only nice-to-haves. Polite revision.
        bullets = "\n".join(f"- [{it.category}] {it.detail}" for it in review.issues[:5])
        return (
            f"风险审查反馈 (评分 {review.score}/10): {review.summary}\n\n"
            f"以下问题不阻塞通过, 但请在重写时尽量解决:\n\n{bullets}\n\n"
            "请改完后,把改动加粗或用 → 标注。**不要从头重写**。"
        )
    bullets = "\n".join(f"- [{it.category}] {it.detail}" for it in review.must_fix_issues)
    return (
        f"风险审查 **未通过** (评分 {review.score}/10): {review.summary}\n\n"
        f"必须修正:\n\n{bullets}\n\n"
        "请只针对上述问题修改原稿, 保留其他部分。改动用 → 或加粗显示。"
    )
