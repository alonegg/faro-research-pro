"""CLI: `faro-pro` — multi-agent collaborative research from terminal.

Modes:
  faro-pro "<query>"            single-shot multi-agent (Researcher + Reviewer)
  faro-pro --plain "<query>"    fallback to plain OSS Faro agent
  faro-pro --rounds 3 "<query>" cap collab review rounds (default 2)
  faro-pro --pdf out.pdf "..."  also write a branded PDF report
"""

from __future__ import annotations

import argparse
import sys

from faro_research.agent import Agent, Message, build_system_prompt
from faro_research.memory import MemoryStore, make_memory_tools
from faro_research.providers import make_provider
from faro_research.skills import make_skill_tool
from faro_research.tools import ToolRegistry, discover_external_tools
from faro_research.tools.builtin.tushare import tushare_default_tools

from faro_research_pro import __version__
from faro_research_pro.agents import run_collab
from faro_research_pro.exports import BrandConfig, branded_markdown_to_pdf


def _build_agent() -> Agent:
    provider = make_provider()
    memory = MemoryStore()
    reg = ToolRegistry()
    reg.register_many(tushare_default_tools(provider))
    skill = make_skill_tool()
    if skill is not None:
        reg.register(skill)
    reg.register_many(make_memory_tools(memory))
    for spec in discover_external_tools():
        if spec.name in reg:
            continue
        reg.register(spec)
    sys_prompt = build_system_prompt(soul=memory.soul(), rules=memory.rules())
    return Agent(provider=provider, tools=reg, system_prompt=sys_prompt)


def main() -> int:
    p = argparse.ArgumentParser(
        prog="faro-pro",
        description=f"Faro Research Pro v{__version__} — multi-agent A-share research.",
    )
    p.add_argument("query", nargs="+", help="Natural-language question")
    p.add_argument("--plain", action="store_true",
                   help="Skip the reviewer; behave like plain OSS Faro.")
    p.add_argument("--rounds", type=int, default=2,
                   help="Max collaborative review rounds (default 2)")
    p.add_argument("--pdf", metavar="PATH",
                   help="Also write a branded PDF report to PATH")
    p.add_argument("--md", metavar="PATH",
                   help="Also write a markdown report to PATH")
    p.add_argument("--quiet", "-q", action="store_true",
                   help="Hide intermediate phase output")
    args = p.parse_args()
    query = " ".join(args.query)

    try:
        researcher = _build_agent()
    except Exception as e:
        print(f"setup failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 2

    history = [Message(role="user", content=query)]

    if args.plain:
        trace = researcher.run(history)
        print(trace.final_answer)
        if not args.quiet:
            print(f"\n---\n[plain mode · {trace.turns} turns · "
                  f"{len(trace.tool_calls)} tool calls]", file=sys.stderr)
        final_md = trace.final_answer
    else:
        try:
            ct = run_collab(
                researcher=researcher,
                reviewer_provider=researcher.provider,
                history=history,
                max_rounds=max(1, args.rounds),
            )
        except Exception as e:
            print(f"collab failed: {type(e).__name__}: {e}", file=sys.stderr)
            return 1
        if not args.quiet:
            for i, draft in enumerate(ct.researcher_drafts[:-1] or [], 1):
                print(f"\n=== Round {i} draft (revised) ===\n", file=sys.stderr)
                print(draft, file=sys.stderr)
            for i, r in enumerate(ct.reviews, 1):
                print(f"\n=== Reviewer round {i}: {r.verdict} (score={r.score}) ===",
                      file=sys.stderr)
                print(f"  {r.summary}", file=sys.stderr)
                for it in r.issues:
                    print(f"  - [{it.category}] {it.detail}", file=sys.stderr)
        print(ct.final_answer)
        if not args.quiet:
            print(f"\n---\n[collab · {ct.rounds} round(s) · "
                  f"{len(ct.tool_calls)} tool calls · "
                  f"{ct.latency_total_ms:.0f}ms]", file=sys.stderr)
        final_md = ct.final_answer

    if args.md:
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(f"# {query}\n\n{final_md}\n")
        print(f"wrote {args.md}", file=sys.stderr)

    if args.pdf:
        pdf = branded_markdown_to_pdf(
            f"# {query}\n\n{final_md}",
            title=query[:60],
            brand=BrandConfig(),
        )
        with open(args.pdf, "wb") as f:
            f.write(pdf)
        print(f"wrote {args.pdf} ({len(pdf)} bytes)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
