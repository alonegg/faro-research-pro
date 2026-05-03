import { useEffect, useRef, useState } from "react";
import {
  api,
  askStream,
  getApiKey,
  setApiKey,
  type MeResponse,
  type PersistedMessage,
  type ResearchStreamEvent,
  type SessionMeta,
  type ToolCallSummary,
} from "./api";
import { Markdown } from "./markdown";

const SUGGESTIONS = [
  "贵州茅台 PE_TTM 和近 4 季度 ROE",
  "比亚迪 2024 vs 2025 营收对比",
  "给我写一份宁德时代的深度研报",          // skill: research-report
  "茅台 DCF 估值合不合理",                  // skill: dcf-cn
  "记住:我偏好高股息蓝筹, 单股仓位 ≤ 25%",  // memory_update
];

interface LiveTool {
  tool_call_id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done";
  latency_ms?: number;
  error?: string | null;
}

interface PhaseEvent {
  phase: "researcher" | "reviewer";
  round: number;
  status: "running" | "done";
}

interface ReviewVerdict {
  round: number;
  verdict: "approve" | "revise";
  score: number;
  summary: string;
  issues: { category: string; detail: string }[];
}

interface UITurn {
  id: number;            // local id
  query: string;
  status: "pending" | "done" | "error";
  liveTools: LiveTool[];
  finalAnswer?: string;
  finalToolCalls?: ToolCallSummary[];
  latencyTotalMs?: number;
  turns?: number;
  error?: string;
  elapsedMs: number;
  // Pro: collab-mode timeline
  collab?: boolean;
  phases: PhaseEvent[];
  reviews: ReviewVerdict[];
  rounds?: number;
}

interface ServerInfo {
  provider: string;
  version: string;
  auth_required: boolean;
}

export function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<PersistedMessage[]>([]);
  const [turns, setTurns] = useState<UITurn[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  // Pro: collab-mode toggle (persists to localStorage)
  const [collabMode, setCollabMode] = useState<boolean>(
    () => localStorage.getItem("faro_pro_collab") === "1",
  );
  useEffect(() => {
    localStorage.setItem("faro_pro_collab", collabMode ? "1" : "0");
  }, [collabMode]);
  const nextTurnId = useRef(1);
  const tickRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // ── boot ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setInfo({ provider: h.provider, version: h.version, auth_required: h.auth_required });
      } catch {
        return;
      }
      try {
        const m = await api.me();
        if (cancelled) return;
        setMe(m);
        setAuthError(null);
        const ss = await api.listSessions();
        if (!cancelled) setSessions(ss);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setAuthError(msg);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── load active session messages ──────────────────────────────────
  useEffect(() => {
    if (!activeId) {
      setHistory([]);
      setTurns([]);
      return;
    }
    api.getSession(activeId).then((d) => {
      setHistory(d.messages);
      setTurns([]);  // live turns stay empty for a freshly opened session
    }).catch(() => {});
  }, [activeId]);

  // ── elapsed tick ──────────────────────────────────────────────────
  useEffect(() => {
    const pending = turns.find((t) => t.status === "pending");
    if (!pending) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (tickRef.current) return;
    const start = Date.now() - pending.elapsedMs;
    tickRef.current = window.setInterval(() => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pending.id && t.status === "pending"
            ? { ...t, elapsedMs: Date.now() - start } : t,
        ),
      );
    }, 500);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [turns]);

  // ── auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, history]);

  // ── actions ───────────────────────────────────────────────────────
  const newSession = async () => {
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const ensureSession = async (): Promise<string> => {
    if (activeId) return activeId;
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    return s.id;
  };

  const onEvent = (turnId: number, ev: ResearchStreamEvent) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        if (ev.type === "tool_call") {
          return {
            ...t,
            liveTools: [
              ...t.liveTools,
              { tool_call_id: ev.tool_call_id, name: ev.name, args: ev.args, status: "running" },
            ],
          };
        }
        if (ev.type === "tool_result") {
          return {
            ...t,
            liveTools: t.liveTools.map((lt) =>
              lt.tool_call_id === ev.tool_call_id
                ? { ...lt, latency_ms: ev.latency_ms, error: ev.error, status: "done" } : lt,
            ),
          };
        }
        // ── Pro: collab phase events ─────────────────────────────────
        if (ev.type === "phase_start") {
          return {
            ...t,
            phases: [...t.phases, { phase: ev.phase, round: ev.round, status: "running" }],
          };
        }
        if (ev.type === "phase_done") {
          return {
            ...t,
            phases: t.phases.map((p) =>
              p.phase === ev.phase && p.round === ev.round
                ? { ...p, status: "done" } : p,
            ),
          };
        }
        if (ev.type === "review_verdict") {
          return {
            ...t,
            reviews: [...t.reviews, {
              round: ev.round, verdict: ev.verdict, score: ev.score,
              summary: ev.summary, issues: ev.issues,
            }],
          };
        }
        if (ev.type === "final") {
          return {
            ...t,
            status: "done",
            finalAnswer: ev.answer,
            finalToolCalls: ev.tool_calls,
            latencyTotalMs: ev.latency_total_ms,
            turns: ev.turns,
            rounds: ev.rounds,
            elapsedMs: ev.latency_total_ms,
          };
        }
        if (ev.type === "error") {
          return { ...t, status: "error", error: ev.message };
        }
        return t;
      }),
    );
  };

  const submit = async (raw: string) => {
    const query = raw.trim();
    if (!query || running) return;
    setRunning(true);
    setInput("");
    const sid = await ensureSession();
    const id = nextTurnId.current++;
    setTurns((prev) => [...prev, {
      id, query, status: "pending", liveTools: [], elapsedMs: 0,
      collab: collabMode, phases: [], reviews: [],
    }]);
    try {
      await askStream(
        sid, query, (ev) => onEvent(id, ev),
        undefined, collabMode ? "collab" : "single",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTurns((prev) => prev.map((t) =>
        t.id === id && t.status === "pending" ? { ...t, status: "error", error: msg } : t,
      ));
    } finally {
      setRunning(false);
      // refresh session list to bump updated_at order
      api.listSessions().then(setSessions).catch(() => {});
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(input);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm("删除这个会话?")) return;
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  // ── render ────────────────────────────────────────────────────────

  // Auth gate — only blocks when server requires auth AND we don't have a
  // valid key (or the saved one was rejected with 401).
  const showAuthModal = info?.auth_required && (!me || !!authError) && !!info;
  if (showAuthModal) {
    return <AuthModal onSubmit={(key) => { setApiKey(key); location.reload(); }} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__head">
          <span className="sidebar__brand-mark">F</span>
          <span className="sidebar__brand">
            Faro Research <span style={{
              fontSize: 10, color: "var(--accent)", fontWeight: 700,
              padding: "2px 6px", border: "1px solid var(--accent)",
              borderRadius: 4, marginLeft: 4,
            }}>PRO</span>
          </span>
        </div>
        <div className="sidebar__new">
          <button className="btn btn--primary" style={{ width: "100%" }} onClick={newSession}>
            + 新会话
          </button>
        </div>
        <div className="session-list">
          {sessions.length === 0 && (
            <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 12, textAlign: "center" }}>
              还没有会话<br />点上面新建
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={"session-item " + (activeId === s.id ? "active" : "")}
              onClick={() => setActiveId(s.id)}
              style={{ cursor: "pointer" }}
            >
              <span className="session-item__title">{s.title}</span>
              <span className="session-item__date">
                {new Date(s.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
              </span>
              <button
                title="删除"
                style={{ color: "var(--ink-3)", fontSize: 14, padding: "0 4px" }}
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">A 股研究助手 PRO</span>
          <span className="topbar__sub">多 agent 协作 + 品牌研报 · AGPL</span>
          {/* Collab toggle */}
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              cursor: "pointer", padding: "4px 10px", borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              background: collabMode ? "var(--accent-soft)" : "var(--surface-2)",
              color: collabMode ? "var(--accent)" : "var(--ink-2)",
              border: collabMode ? "1px solid var(--accent)" : "1px solid var(--border)",
              marginLeft: 12,
            }}
            title={collabMode
              ? "开: Researcher 出稿后 Risk Reviewer 审查, 必要时退回让 Researcher 改"
              : "开 = 多 agent 协作模式; 关 = 单 agent (更快)"
            }
          >
            <input
              type="checkbox"
              checked={collabMode}
              onChange={(e) => setCollabMode(e.target.checked)}
              style={{ margin: 0 }}
            />
            🤝 多 agent 协作
          </label>
          {info && (
            <span className="topbar__pill">
              <span className="dot" />
              {info.provider} · v{info.version}
              {info.auth_required ? ` · ${me?.email ?? "?"}` : ""}
            </span>
          )}
          {info?.auth_required && me && (
            <button
              className="btn btn--ghost"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => {
                if (!confirm("退出当前 API key?")) return;
                setApiKey("");
                location.reload();
              }}
            >退出</button>
          )}
        </header>

        <div className="thread" ref={threadRef}>
          {!activeId && turns.length === 0 && (
            <div className="thread__empty">
              <h2>问个 A 股研究问题</h2>
              <div>例如:</div>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn btn--ghost" style={{ maxWidth: 520 }}
                          onClick={() => submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Persisted history (loaded from server) */}
          {history.map((m) => (
            <PersistedMessageView key={m.seq} m={m} sessionId={activeId} />
          ))}

          {/* Live turns */}
          {turns.map((t) => <TurnView key={t.id} turn={t} sessionId={activeId} />)}
        </div>

        <div className="composer">
          <div className="composer__row">
            <textarea
              placeholder={running ? "等待中..." : "问个 A 股研究问题... (⌘/Ctrl + Enter 发送)"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              disabled={running}
            />
            <button
              className="btn btn--primary"
              onClick={() => submit(input)}
              disabled={running || !input.trim()}
            >
              {running ? "⋯" : "提问"}
            </button>
          </div>
          <div className="composer__hint">
            数据：本地 SQLite 多会话历史 + Tushare（行情 / 三表 / 估值 / 高管交易）·
            自动写审计日志
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Render helpers
// ──────────────────────────────────────────────────────────────────────────

function ExportButtons({ sessionId }: { sessionId: string | null }) {
  if (!sessionId) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <button
        className="btn btn--ghost"
        style={{ fontSize: 11, padding: "3px 8px" }}
        onClick={() => api.download(sessionId, "md").catch((e) => alert(`导出失败: ${e}`))}
      >下载 Markdown</button>
      <button
        className="btn btn--ghost"
        style={{ fontSize: 11, padding: "3px 8px" }}
        onClick={() => api.download(sessionId, "pdf").catch((e) => alert(`导出失败: ${e}`))}
      >下载 PDF</button>
    </div>
  );
}

function PersistedMessageView({ m, sessionId }: { m: PersistedMessage; sessionId: string | null }) {
  if (m.role === "user") {
    return <div className="user-bubble">{m.content}</div>;
  }
  if (m.role === "assistant") {
    const meta = m.meta as { turns?: number; tool_calls?: ToolCallSummary[]; latency_total_ms?: number };
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
        <div className="assistant-card"><Markdown text={m.content} /></div>
        {meta.turns !== undefined && (
          <div className="run-meta">
            <span>{meta.turns} turns</span>
            <span>{(meta.tool_calls?.length ?? 0)} tool calls</span>
            <span>{((meta.latency_total_ms ?? 0) / 1000).toFixed(1)} s</span>
          </div>
        )}
        <ExportButtons sessionId={sessionId} />
      </>
    );
  }
  return null;  // skip system / tool rows
}

function PhaseTag({ phase, round, status }: PhaseEvent) {
  const label = phase === "researcher" ? "Researcher" : "Risk Reviewer";
  return (
    <div className={`phase-tag phase-tag--${phase}`}>
      <span className="dot" />
      {label} · 第 {round} 轮{status === "running" ? "（运行中）" : ""}
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewVerdict }) {
  return (
    <div className={`review-card review-card--${review.verdict}`}>
      <div className="verdict">
        {review.verdict === "approve" ? "✓ 通过" : "↺ 退回修改"}
        <span style={{ marginLeft: 8, color: "var(--ink-3)", fontWeight: 500 }}>
          (评分 {review.score}/10 · 第 {review.round} 轮)
        </span>
      </div>
      <div className="summary">{review.summary}</div>
      {review.issues.length > 0 && (
        <ul>
          {review.issues.slice(0, 5).map((it, i) => (
            <li key={i}><span className="cat">[{it.category}]</span> {it.detail}</li>
          ))}
          {review.issues.length > 5 && (
            <li style={{ color: "var(--ink-3)" }}>...另 {review.issues.length - 5} 条</li>
          )}
        </ul>
      )}
    </div>
  );
}

function TurnView({ turn, sessionId }: { turn: UITurn; sessionId: string | null }) {
  const isPending = turn.status === "pending";
  return (
    <>
      <div className="user-bubble">{turn.query}</div>

      {/* Pro: collab timeline (interleaves phases + tool calls + reviews) */}
      {turn.collab && (
        <>
          {turn.phases.map((p, i) => {
            const reviewForRound = p.phase === "reviewer"
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
        <div className="pending">
          <span className="dot" /> 思考中… {(turn.elapsedMs / 1000).toFixed(1)} s
        </div>
      )}
      {turn.status === "error" && (
        <div className="error-card">⚠ {turn.error}</div>
      )}
      {turn.status === "done" && turn.finalAnswer && (
        <>
          <div className="assistant-card"><Markdown text={turn.finalAnswer} /></div>
          <div className="run-meta">
            {turn.collab && turn.rounds && <span>{turn.rounds} 轮协作</span>}
            <span>{turn.finalToolCalls?.length ?? 0} tool calls</span>
            <span>{((turn.latencyTotalMs ?? 0) / 1000).toFixed(1)} s</span>
          </div>
          <ExportButtons sessionId={sessionId} />
        </>
      )}
    </>
  );
}

function ToolsTrace({ tools, expanded }: { tools: LiveTool[]; expanded: boolean }) {
  return (
    <details className="tools-trace" open={expanded}>
      <summary>
        工具调用 ({tools.length}
        {tools.some((t) => t.status === "running") && (
          <span style={{ color: "var(--accent)" }}> · 进行中</span>
        )}
        )
      </summary>
      {tools.map((t) => {
        const argStr = Object.entries(t.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
        const pillKind = t.error ? "neg" : t.status === "running" ? "warn" : "info";
        return (
          <div key={t.tool_call_id} className="tool-line">
            <span className={`tool-pill tool-pill--${pillKind}`}>{t.name}</span>{" "}
            <span>({argStr})</span>{" "}
            <span>
              {t.status === "running"
                ? "— 运行中…"
                : `— ${(t.latency_ms ?? 0).toFixed(0)} ms${t.error ? `, 错误: ${t.error}` : ""}`}
            </span>
          </div>
        );
      })}
    </details>
  );
}

function AuthModal({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [key, setKey] = useState(getApiKey());
  const [submitting, setSubmitting] = useState(false);
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          setSubmitting(true);
          onSubmit(key.trim());
        }}
        style={{
          background: "var(--surface)", padding: 28, borderRadius: 12,
          maxWidth: 460, width: "90%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="sidebar__brand-mark">F</span>
          <h2 style={{ margin: 0, fontSize: 18 }}>Faro Research 登录</h2>
        </div>
        <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 13 }}>
          服务端启用了 <code>FARO_AUTH_REQUIRED</code>。粘贴你的 API key
          (从管理员处获得; 形如 <code>fr-xxx...</code>)。
        </p>
        <input
          type="password"
          autoFocus
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="fr-..."
          style={{
            padding: "10px 12px", border: "1px solid var(--border)",
            borderRadius: 8, fontSize: 13, fontFamily: "ui-monospace, monospace",
          }}
        />
        <button type="submit" className="btn btn--primary" disabled={!key.trim() || submitting}>
          {submitting ? "验证中..." : "登录"}
        </button>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 11 }}>
          API key 仅存在你浏览器的 localStorage; 不会上传到第三方。
        </p>
      </form>
    </div>
  );
}
