/** Message primitives. Composable: parent renders any combination of
 *  UserMessage / AssistantMessage / PersistedMessageView / TurnView. */

import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, type PersistedMessage, type ToolCallSummary } from "../../api";
import { Markdown } from "../../markdown";
import type { UITurn } from "../../state/types";
import { CollabStepper } from "./CollabStepper";
import { deriveEvidence } from "./EvidenceRail";
import { ToolsTrace } from "./ToolsTrace";
import { I } from "../ui/Icon";

interface AssistantContentProps {
  text: string;
  onCite?: (n: number) => void;
  isStreaming?: boolean;
}

export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="msg-user">
      <div className="msg-user-bubble">{children}</div>
    </div>
  );
}

function AssistantBody({ text, onCite, isStreaming }: AssistantContentProps) {
  return (
    <div className="msg-assistant-body">
      <Markdown text={text} onCite={onCite} />
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  );
}

interface MetaBarProps {
  latencyMs: number;
  toolCount: number;
  evidenceCount: number;
  sessionId: string | null;
  onShowEvidence: () => void;
  onCopy: () => void;
}

function MetaBar({ latencyMs, toolCount, evidenceCount, sessionId, onShowEvidence, onCopy }: MetaBarProps) {
  return (
    <div className="msg-meta-bar">
      <span className="meta-stat">
        <I.Bolt size={11} />
        {(latencyMs / 1000).toFixed(1)}s
      </span>
      <span className="meta-stat">
        <I.Tools size={11} />
        {toolCount} 调用
      </span>
      {evidenceCount > 0 && (
        <span className="meta-stat">
          <I.Quote size={11} />
          {evidenceCount} 引用
        </span>
      )}
      <span className="meta-spacer" />
      {evidenceCount > 0 && (
        <button className="msg-action-btn" onClick={onShowEvidence}>
          <I.Compass size={12} />
          证据
        </button>
      )}
      <button className="msg-action-btn" onClick={onCopy}>
        <I.Copy size={12} />
        复制
      </button>
      {sessionId && (
        <>
          <button
            className="msg-action-btn"
            onClick={() =>
              toast.promise(api.download(sessionId, "md"), {
                loading: "正在导出 Markdown…",
                success: "已下载 Markdown",
                error: (e) => `导出失败: ${e}`,
              })
            }
          >
            <I.Download size={12} />
            Markdown
          </button>
          <button
            className="msg-action-btn"
            onClick={() =>
              toast.promise(api.download(sessionId, "pdf"), {
                loading: "正在生成品牌 PDF…",
                success: "已下载 PDF",
                error: (e) => `导出失败: ${e}`,
              })
            }
          >
            <I.Download size={12} />
            PDF
          </button>
        </>
      )}
    </div>
  );
}

/** Render a server-persisted assistant message (loaded from history). */
export function PersistedMessageView({
  m,
  sessionId,
  onShowEvidence,
  onCite,
}: {
  m: PersistedMessage;
  sessionId: string | null;
  onShowEvidence: (items: ReturnType<typeof deriveEvidence>) => void;
  onCite: (n: number, items: ReturnType<typeof deriveEvidence>) => void;
}) {
  if (m.role === "user") return <UserMessage>{m.content}</UserMessage>;
  if (m.role !== "assistant") return null;
  const meta = m.meta as {
    turns?: number;
    tool_calls?: ToolCallSummary[];
    latency_total_ms?: number;
  };
  const evidence = deriveEvidence(meta.tool_calls);
  const copy = () => {
    navigator.clipboard.writeText(m.content).then(() => toast.success("已复制"));
  };
  return (
    <div className="msg-assistant">
      <div className="msg-assistant-card">
        <AssistantBody
          text={m.content}
          onCite={(n) => onCite(n, evidence)}
        />
        <MetaBar
          latencyMs={meta.latency_total_ms ?? 0}
          toolCount={meta.tool_calls?.length ?? 0}
          evidenceCount={evidence.length}
          sessionId={sessionId}
          onShowEvidence={() => onShowEvidence(evidence)}
          onCopy={copy}
        />
      </div>
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
    </div>
  );
}

/** Render a live (in-flight) turn — query, optional collab stepper, body, meta. */
export function TurnView({
  turn,
  sessionId,
  onShowEvidence,
  onCite,
}: {
  turn: UITurn;
  sessionId: string | null;
  onShowEvidence: (items: ReturnType<typeof deriveEvidence>) => void;
  onCite: (n: number, items: ReturnType<typeof deriveEvidence>) => void;
}) {
  const isPending = turn.status === "pending";
  const isError = turn.status === "error";
  const showStepper = !!turn.collab && turn.phases.length > 0;
  const evidence = deriveEvidence(turn.finalToolCalls);

  return (
    <>
      <UserMessage>{turn.query}</UserMessage>

      {showStepper && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <CollabStepper turn={turn} />
        </motion.div>
      )}

      {turn.finalAnswer && (
        <motion.div
          className="msg-assistant"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="msg-assistant-card">
            <AssistantBody
              text={turn.finalAnswer}
              isStreaming={isPending}
              onCite={(n) => onCite(n, evidence)}
            />
            {turn.status === "done" && (
              <MetaBar
                latencyMs={turn.latencyTotalMs ?? 0}
                toolCount={turn.finalToolCalls?.length ?? 0}
                evidenceCount={evidence.length}
                sessionId={sessionId}
                onShowEvidence={() => onShowEvidence(evidence)}
                onCopy={() => {
                  navigator.clipboard.writeText(turn.finalAnswer || "")
                    .then(() => toast.success("已复制"));
                }}
              />
            )}
          </div>
        </motion.div>
      )}

      {!showStepper && turn.liveTools.length > 0 && (
        <ToolsTrace tools={turn.liveTools} expanded={isPending} />
      )}

      {isPending && !showStepper && !turn.finalAnswer && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink-3)", padding: "8px 4px" }}>
          <span className="pending-dot" />
          正在思考… {(turn.elapsedMs / 1000).toFixed(1)} s
        </div>
      )}

      {isError && (
        <div style={{
          padding: "12px 14px",
          background: "var(--neg-soft)",
          color: "var(--neg)",
          borderRadius: "var(--radius-md)",
          fontSize: 12.5,
          border: "1px solid color-mix(in srgb, var(--neg) 25%, transparent)",
        }}>
          ⚠ {turn.error}
        </div>
      )}
    </>
  );
}
