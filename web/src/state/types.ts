import type { ToolCallSummary } from "../api";

export interface LiveTool {
  tool_call_id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done";
  latency_ms?: number;
  error?: string | null;
}

export interface PhaseEvent {
  phase: "researcher" | "reviewer";
  round: number;
  status: "running" | "done";
}

export interface ReviewVerdict {
  round: number;
  verdict: "approve" | "revise";
  score: number;
  summary: string;
  issues: { category: string; detail: string }[];
}

export interface UITurn {
  id: number;
  query: string;
  status: "pending" | "done" | "error";
  liveTools: LiveTool[];
  finalAnswer?: string;
  finalToolCalls?: ToolCallSummary[];
  latencyTotalMs?: number;
  turns?: number;
  error?: string;
  elapsedMs: number;
  collab?: boolean;
  phases: PhaseEvent[];
  reviews: ReviewVerdict[];
  rounds?: number;
  // Which session this turn belongs to. Used to ignore late stream
  // events after the user has switched sessions.
  sessionId: string;
}

export interface ServerInfo {
  provider: string;
  version: string;
  auth_required: boolean;
}
