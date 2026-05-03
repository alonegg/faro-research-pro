"""Multi-agent orchestrator — Researcher → Reviewer loop.

Flow per user query:

    1. Researcher draft   (full agent loop with tools)
    2. Reviewer reads draft, returns structured Review
    3. If approved (or final round): emit final
       Else: send revision prompt back to Researcher → goto 1 (capped)

Streaming protocol — yields the OSS event types verbatim PLUS a few new ones:

    {"type": "phase_start",  "phase": "researcher"|"reviewer", "round": N}
    {"type": "phase_done",   "phase": "researcher"|"reviewer", "round": N,
                              "draft": str?, "review": dict?}
    {"type": "review_verdict", "round": N, "verdict": "approve"|"revise",
                                "score": int, "summary": str, "issues": [...]}
    {"type": "final", ...}                ← OSS shape
    {"type": "error", "message": str}

The frontend can render phases as separate visual blocks. Reviewer phases
are cheap (one LLM call, no tools).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass, field

from faro_research.agent.core import Agent, build_system_prompt
from faro_research.providers.base import Message, Provider

from faro_research_pro.agents.researcher import researcher_system_prompt
from faro_research_pro.agents.reviewer import (
    Review,
    review_draft,
    revision_prompt_for_researcher,
)

log = logging.getLogger(__name__)

DEFAULT_MAX_REVIEW_ROUNDS = 2


@dataclass
class CollabTrace:
    """End-of-run summary for persistence / display."""

    final_answer: str
    rounds: int
    researcher_drafts: list[str] = field(default_factory=list)
    reviews: list[Review] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    latency_total_ms: float = 0.0
    error: str | None = None


def stream_collab(
    *,
    researcher: Agent,
    reviewer_provider: Provider,
    history: list[Message],
    max_rounds: int = DEFAULT_MAX_REVIEW_ROUNDS,
    soul: str | None = None,
    rules: str | None = None,
) -> Iterator[dict]:
    """Run the Researcher ↔ Reviewer loop and stream events.

    `researcher`: a fully-configured OSS Agent (with its tools + memory).
                  We rebuild its system prompt with the collab addendum.
    `reviewer_provider`: same Provider type as researcher (OK to reuse).
    `history`: same convention as Agent.stream — full multi-turn context.
    """
    # Splice the researcher's system prompt with the collab addendum.
    # We respect any user SOUL/RULES that were already in the agent's prompt.
    base = researcher.system_prompt
    researcher.system_prompt = build_system_prompt(
        base=researcher_system_prompt(base=base),
        soul=soul, rules=rules,
    )
    user_query = next(
        (m.content or "" for m in reversed(history) if m.role == "user"),
        "(no user query)",
    )

    drafts: list[str] = []
    reviews: list[Review] = []
    tool_calls: list[dict] = []
    t_start = time.perf_counter()
    final_text = ""
    last_error: str | None = None

    try:
        current_history = list(history)
        for round_idx in range(1, max_rounds + 1):
            # ── Researcher phase ─────────────────────────────────────
            yield {"type": "phase_start", "phase": "researcher", "round": round_idx}
            draft = ""
            for ev in researcher.stream(current_history):
                if ev["type"] == "final":
                    draft = ev["answer"]
                    tool_calls.extend(ev.get("tool_calls") or [])
                elif ev["type"] == "error":
                    last_error = ev["message"]
                yield ev
                if ev["type"] in ("final", "error"):
                    break
            if last_error:
                break
            drafts.append(draft)
            yield {
                "type": "phase_done", "phase": "researcher",
                "round": round_idx, "draft": draft,
            }

            # ── Reviewer phase ───────────────────────────────────────
            yield {"type": "phase_start", "phase": "reviewer", "round": round_idx}
            try:
                review = review_draft(
                    reviewer_provider, query=user_query, draft=draft,
                )
            except Exception as e:
                last_error = f"reviewer failed: {type(e).__name__}: {e}"
                yield {"type": "error", "message": last_error}
                break
            reviews.append(review)
            yield {
                "type": "review_verdict",
                "round": round_idx,
                "verdict": review.verdict,
                "score": review.score,
                "summary": review.summary,
                "issues": [
                    {"category": it.category, "detail": it.detail}
                    for it in review.issues
                ],
            }
            yield {"type": "phase_done", "phase": "reviewer", "round": round_idx}

            # ── Decide ───────────────────────────────────────────────
            if review.is_approved or round_idx >= max_rounds:
                final_text = draft
                break
            # Append reviewer's revision request as a new user turn
            current_history = current_history + [
                Message(role="assistant", content=draft),
                Message(role="user",
                        content=revision_prompt_for_researcher(review)),
            ]

        # ── Done ─────────────────────────────────────────────────────
        if not final_text and drafts:
            final_text = drafts[-1]

        yield {
            "type": "final",
            "answer": final_text,
            "turns": len(drafts),
            "tool_calls": tool_calls,
            "latency_total_ms": (time.perf_counter() - t_start) * 1000,
            "rounds": len(drafts),
            "reviews": [
                {"verdict": r.verdict, "score": r.score, "summary": r.summary}
                for r in reviews
            ],
        }
    except Exception as e:
        last_error = f"{type(e).__name__}: {e}"
        yield {"type": "error", "message": last_error}


def run_collab(
    *,
    researcher: Agent,
    reviewer_provider: Provider,
    history: list[Message],
    max_rounds: int = DEFAULT_MAX_REVIEW_ROUNDS,
) -> CollabTrace:
    """Blocking wrapper around stream_collab — drains events."""
    drafts: list[str] = []
    reviews_dicts: list[dict] = []
    tool_calls: list[dict] = []
    final_answer = ""
    rounds = 0
    latency = 0.0
    error: str | None = None
    for ev in stream_collab(
        researcher=researcher, reviewer_provider=reviewer_provider,
        history=history, max_rounds=max_rounds,
    ):
        et = ev["type"]
        if et == "phase_done" and ev.get("phase") == "researcher":
            drafts.append(ev.get("draft") or "")
        elif et == "review_verdict":
            reviews_dicts.append(ev)
        elif et == "final":
            final_answer = ev["answer"]
            rounds = ev.get("rounds", len(drafts))
            tool_calls = ev.get("tool_calls") or []
            latency = ev.get("latency_total_ms", 0)
        elif et == "error":
            error = ev["message"]

    # Reconstruct Review objects (lightweight, since stream emits flat dicts)
    from faro_research_pro.agents.reviewer import Review as RR
    from faro_research_pro.agents.reviewer import ReviewIssue
    reviews_objs = [
        RR(
            verdict=r["verdict"], score=r["score"], summary=r["summary"],
            issues=[ReviewIssue(category=it["category"], detail=it["detail"])
                    for it in (r.get("issues") or [])],
            must_fix_indices=[],
            raw_text="",
        )
        for r in reviews_dicts
    ]
    return CollabTrace(
        final_answer=final_answer or (f"agent failed: {error}" if error else ""),
        rounds=rounds,
        researcher_drafts=drafts,
        reviews=reviews_objs,
        tool_calls=tool_calls,
        latency_total_ms=latency,
        error=error,
    )
