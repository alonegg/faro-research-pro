/** Vertical timeline of multi-agent collab phases.
 *  Replaces the flat phase-tag row from the v1 design. Headline novel viz. */

import type { LiveTool, PhaseEvent, ReviewVerdict, UITurn } from "../../state/types";
import { I } from "../ui/Icon";

interface StepperProps {
  turn: UITurn;
}

interface Step {
  phase: "researcher" | "reviewer";
  round: number;
  status: "running" | "done";
  durationMs?: number;
  toolNames?: string[];
  review?: ReviewVerdict;
}

/** Build a vertical timeline by walking the live phases + tool calls + reviews. */
function buildTimeline(turn: UITurn): Step[] {
  const steps: Step[] = [];
  for (const p of turn.phases) {
    const review = p.phase === "reviewer"
      ? turn.reviews.find((r) => r.round === p.round)
      : undefined;
    // Estimate tools used during a researcher phase: those completed
    // before the next phase started. For simplicity assume ALL liveTools
    // belong to the current researcher round (we don't have per-phase
    // tool attribution from the SSE protocol).
    const toolNames = p.phase === "researcher"
      ? turn.liveTools.map((t) => t.name)
      : [];
    steps.push({
      phase: p.phase,
      round: p.round,
      status: p.status,
      toolNames,
      review,
    });
  }
  return steps;
}

export function CollabStepper({ turn }: StepperProps) {
  const steps = buildTimeline(turn);
  if (steps.length === 0) return null;
  const running = steps.some((s) => s.status === "running");
  const totalElapsedSec = (turn.elapsedMs || turn.latencyTotalMs || 0) / 1000;
  const researcherCount = steps.filter((s) => s.phase === "researcher").length;
  const reviewerCount = steps.filter((s) => s.phase === "reviewer").length;
  const maxRound = Math.max(1, ...steps.map((s) => s.round));

  return (
    <div className="collab-stepper">
      <div className="stepper-header">
        <I.Layers size={14} style={{ color: "var(--accent)" }} />
        <span className="stepper-title">多 Agent 协作</span>
        <span className="stepper-rounds-pill">
          {maxRound} 轮 · {researcherCount} draft / {reviewerCount} review
        </span>
        <span className="stepper-elapsed">{totalElapsedSec.toFixed(1)}s</span>
      </div>
      <div className="stepper-track" data-progress={running ? "partial" : "full"}>
        {steps.map((step, idx) => (
          <StepRow key={idx} step={step} liveTools={turn.liveTools} />
        ))}
      </div>
    </div>
  );
}

function StepRow({ step, liveTools }: { step: Step; liveTools: LiveTool[] }) {
  const isPending = step.status === "running";
  const cls = `stepper-step ${step.phase} ${isPending ? "pending" : ""}`;
  return (
    <div className={cls}>
      <div className="stepper-step-marker">
        {isPending ? (
          <div className="spinner" style={{ width: 8, height: 8, borderWidth: 1.2 }} />
        ) : step.phase === "researcher" ? (
          <I.Brain size={10} />
        ) : (
          <I.Eye size={10} />
        )}
      </div>
      <div className="stepper-step-head">
        <span className="stepper-step-name">
          {step.phase === "researcher" ? "Researcher" : "Reviewer"}
        </span>
        <span className="stepper-step-round">第 {step.round} 轮</span>
        <span className="stepper-step-status">
          {isPending ? "进行中…" : step.durationMs != null
            ? `${(step.durationMs / 1000).toFixed(1)}s`
            : ""}
        </span>
      </div>
      {/* Researcher: tool pills */}
      {step.phase === "researcher" && step.toolNames && step.toolNames.length > 0 && (
        <div className="stepper-step-tools">
          {step.toolNames.map((name, i) => {
            const lt = liveTools.find((t) => t.name === name);
            const stillRunning = lt?.status === "running";
            return (
              <span key={i} className="tool-pill">
                {stillRunning ? (
                  <span className="tool-spinner" />
                ) : (
                  <span className="tool-tick">✓</span>
                )}
                {name}
              </span>
            );
          })}
        </div>
      )}
      {/* Reviewer: review card with verdict + score + issues */}
      {step.review && <ReviewVerdictCard r={step.review} />}
    </div>
  );
}

function ReviewVerdictCard({ r }: { r: ReviewVerdict }) {
  const approved = r.verdict === "approve";
  return (
    <div className={`review-card ${approved ? "approve" : ""}`}>
      <div className="review-card-head">
        <span className="review-verdict">
          {approved ? "通过" : "建议修改"}
        </span>
        <span className="review-score">score {(r.score / 10).toFixed(2)}</span>
      </div>
      {r.summary && <div className="review-summary">{r.summary}</div>}
      {r.issues && r.issues.length > 0 && (
        <div className="review-issues">
          {r.issues.slice(0, 5).map((iss, k) => (
            <div key={k} className="review-issue">
              <span className="review-issue-cat">{iss.category}</span>
              <span>{iss.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export types for parent components
export type { Step, PhaseEvent };
