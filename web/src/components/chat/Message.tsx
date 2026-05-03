/** Message primitives + the live-turn view. Composable: any caller can
 *  drop UserMessage / AssistantMessage / TurnView into a Thread.Root. */

import { motion } from "framer-motion";
import type { PersistedMessage, ToolCallSummary } from "../../api";
import { Markdown } from "../../markdown";
import type { UITurn } from "../../state/types";
import { ExportMenu } from "./ExportMenu";
import { PhaseTag } from "./PhaseTag";
import { ReviewCard } from "./ReviewCard";
import { ToolsTrace } from "./ToolsTrace";

export function UserMessage({ children }: { children: React.ReactNode }) {
  return <div className="user-bubble">{children}</div>;
}

export function AssistantMessage({ text }: { text: string }) {
  return (
    <motion.div
      className="assistant-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <Markdown text={text} />
    </motion.div>
  );
}

/** Render a server-persisted message (loaded from history). */
export function PersistedMessageView({
  m,
  sessionId,
}: {
  m: PersistedMessage;
  sessionId: string | null;
}) {
  if (m.role === "user") return <UserMessage>{m.content}</UserMessage>;
  if (m.role === "assistant") {
    const meta = m.meta as {
      turns?: number;
      tool_calls?: ToolCallSummary[];
      latency_total_ms?: number;
    };
    return (
      <>
        {meta.tool_calls && meta.tool_calls.length > 0 && (
          <ToolsTrace
            tools={meta.tool_calls.map((tc, i) => ({
              tool_call_id: String(i),
              name: tc.name,
              args: tc.args,
              status: "done" as const,
              latency_ms: tc.latency_ms,
              error: tc.error,
            }))}
            expanded={false}
          />
        )}
        <AssistantMessage text={m.content} />
        {meta.turns !== undefined && (
          <div className="run-meta">
            <span>{meta.turns} turns</span>
            <span>{meta.tool_calls?.length ?? 0} tool calls</span>
            <span>{((meta.latency_total_ms ?? 0) / 1000).toFixed(1)} s</span>
          </div>
        )}
        <ExportMenu sessionId={sessionId} />
      </>
    );
  }
  return null;
}

/** Render a live (in-flight) turn — query, phases, tools, final answer. */
export function TurnView({
  turn,
  sessionId,
}: {
  turn: UITurn;
  sessionId: string | null;
}) {
  const isPending = turn.status === "pending";
  return (
    <>
      <UserMessage>{turn.query}</UserMessage>

      {turn.collab && (
        <>
          {turn.phases.map((p, i) => {
            const reviewForRound =
              p.phase === "reviewer"
                ? turn.reviews.find((r) => r.round === p.round)
                : null;
            return (
              <div key={i}>
                <PhaseTag {...p} />
                {reviewForRound && <ReviewCard review={reviewForRound} />}
              </div>
            );
          })}
        </>
      )}

      {turn.liveTools.length > 0 && (
        <ToolsTrace tools={turn.liveTools} expanded={isPending} />
      )}

      {isPending && (
        <span className="pending">
          <span className="dot" /> 思考中… {(turn.elapsedMs / 1000).toFixed(1)} s
        </span>
      )}

      {turn.status === "error" && (
        <div className="error-card">⚠ {turn.error}</div>
      )}

      {turn.status === "done" && turn.finalAnswer && (
        <>
          <AssistantMessage text={turn.finalAnswer} />
          <div className="run-meta">
            {turn.collab && turn.rounds && <span>{turn.rounds} 轮协作</span>}
            <span>{turn.finalToolCalls?.length ?? 0} tool calls</span>
            <span>{((turn.latencyTotalMs ?? 0) / 1000).toFixed(1)} s</span>
          </div>
          <ExportMenu sessionId={sessionId} />
        </>
      )}
    </>
  );
}
