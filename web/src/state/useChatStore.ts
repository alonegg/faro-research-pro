/** Single source of truth for chat state — sessions, turns, history, auth.
 *
 *  Why one big hook instead of context+reducer/zustand: the surface is small
 *  enough (one screen) that an extra abstraction layer hurts more than helps,
 *  and React Strict Mode's double-invocation lays nicely on plain useState.
 *
 *  Critical invariants (don't break these):
 *
 *    A. Wipe-race fix — when submit() lazily creates a session, setActiveId
 *       fires the load-history effect; that effect must NOT clear `turns` or
 *       the freshly-inserted pending turn vanishes (commit a7ad6ad). We track
 *       `lastLoadedSession` in a ref so only real switches clear turns.
 *
 *    B. Session-tagged turns — every UITurn carries `sessionId`. Late stream
 *       events after the user switches away are ignored (so a slow Researcher
 *       can't paint into the wrong thread).
 *
 *    C. AbortController on switch — switching sessions mid-stream cancels
 *       the in-flight fetch so the new session's input doesn't stay disabled
 *       and the wrong session doesn't keep mutating.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  api,
  askStream,
  type MeResponse,
  type PersistedMessage,
  type ResearchStreamEvent,
  type SessionMeta,
} from "../api";
import type { ServerInfo, UITurn } from "./types";

export function useChatStore() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, _setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<PersistedMessage[]>([]);
  const [turns, setTurns] = useState<UITurn[]>([]);
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [collabMode, setCollabModeState] = useState<boolean>(
    () => localStorage.getItem("faro_pro_collab") === "1",
  );

  const nextTurnId = useRef(1);
  const tickRef = useRef<number | null>(null);
  const lastLoadedSession = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── persist collab toggle ───────────────────────────────────────────
  const setCollabMode = useCallback((on: boolean) => {
    setCollabModeState(on);
    localStorage.setItem("faro_pro_collab", on ? "1" : "0");
  }, []);

  // ── boot: health → auth → list sessions ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setInfo({
          provider: h.provider,
          version: h.version,
          auth_required: h.auth_required,
        });
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

  // ── load active session messages ─────────────────────────────────────
  // Invariant A: only wipe `turns` when the user is *switching* sessions,
  // never when activeId first becomes set inside the same submit() call.
  useEffect(() => {
    if (!activeId) {
      setHistory([]);
      if (lastLoadedSession.current) setTurns([]);
      lastLoadedSession.current = null;
      return;
    }
    const switched =
      lastLoadedSession.current !== null &&
      lastLoadedSession.current !== activeId;
    lastLoadedSession.current = activeId;
    api.getSession(activeId).then((d) => {
      setHistory(d.messages);
      if (switched) setTurns([]);
    }).catch(() => {});
  }, [activeId]);

  // ── elapsed-time tick on the pending turn ───────────────────────────
  useEffect(() => {
    const pending = turns.find((t) => t.status === "pending");
    if (!pending) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
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
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [turns]);

  // ── setActiveId wrapper: aborts in-flight stream on real switch ─────
  const setActiveId = useCallback((id: string | null) => {
    _setActiveId((prev) => {
      if (prev !== id && abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        setRunning(false);
      }
      return id;
    });
  }, []);

  // ── new session ─────────────────────────────────────────────────────
  const newSession = useCallback(async () => {
    try {
      const s = await api.createSession();
      setSessions((prev) => [s, ...prev]);
      setActiveId(s.id);
    } catch (e) {
      toast.error(`新建会话失败: ${e}`);
    }
  }, [setActiveId]);

  // submit may be called from the empty state (activeId === null), in
  // which case we lazily create a session and immediately use its id —
  // do NOT wait for setActiveId's render cycle.
  const ensureSession = useCallback(async (): Promise<string> => {
    if (activeId) return activeId;
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    // Bump the ref BEFORE setActiveId so the load-history effect's
    // `switched` check sees no real switch.
    lastLoadedSession.current = s.id;
    _setActiveId(s.id);
    return s.id;
  }, [activeId]);

  // ── delete / rename ─────────────────────────────────────────────────
  const deleteSession = useCallback((id: string) => {
    toast(`删除这个会话?`, {
      action: {
        label: "删除",
        onClick: async () => {
          try {
            await api.deleteSession(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));
            if (activeId === id) setActiveId(null);
            toast.success("已删除");
          } catch (e) {
            toast.error(`删除失败: ${e}`);
          }
        },
      },
      duration: 6000,
    });
  }, [activeId, setActiveId]);

  const renameSession = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const updated = await api.rename(id, trimmed);
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (e) {
      toast.error(`重命名失败: ${e}`);
    }
  }, []);

  // ── stream event reducer ────────────────────────────────────────────
  const onEvent = useCallback((turnId: number, ev: ResearchStreamEvent) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        if (ev.type === "tool_call") {
          return {
            ...t,
            liveTools: [
              ...t.liveTools,
              {
                tool_call_id: ev.tool_call_id,
                name: ev.name,
                args: ev.args,
                status: "running",
              },
            ],
          };
        }
        if (ev.type === "tool_result") {
          return {
            ...t,
            liveTools: t.liveTools.map((lt) =>
              lt.tool_call_id === ev.tool_call_id
                ? {
                  ...lt,
                  latency_ms: ev.latency_ms,
                  error: ev.error,
                  status: "done",
                } : lt,
            ),
          };
        }
        if (ev.type === "phase_start") {
          return {
            ...t,
            phases: [
              ...t.phases,
              { phase: ev.phase, round: ev.round, status: "running" },
            ],
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
              round: ev.round,
              verdict: ev.verdict,
              score: ev.score,
              summary: ev.summary,
              issues: ev.issues,
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
  }, []);

  // ── submit ──────────────────────────────────────────────────────────
  const submit = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (!query || running) return;
    setRunning(true);

    let sid: string;
    try {
      sid = await ensureSession();
    } catch (e) {
      setRunning(false);
      toast.error(`新建会话失败: ${e}`);
      return;
    }

    const id = nextTurnId.current++;
    setTurns((prev) => [...prev, {
      id,
      query,
      status: "pending",
      liveTools: [],
      elapsedMs: 0,
      collab: collabMode,
      phases: [],
      reviews: [],
      sessionId: sid,
    }]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await askStream(
        sid,
        query,
        (ev) => onEvent(id, ev),
        controller.signal,
        collabMode ? "collab" : "single",
      );
    } catch (e) {
      // AbortError is expected when user switches sessions mid-stream
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      if (!isAbort) {
        const msg = e instanceof Error ? e.message : String(e);
        setTurns((prev) => prev.map((t) =>
          t.id === id && t.status === "pending"
            ? { ...t, status: "error", error: msg } : t,
        ));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      api.listSessions().then(setSessions).catch(() => {});
    }
  }, [running, collabMode, ensureSession, onEvent]);

  return {
    // state
    sessions, activeId, history, turns, running, info, me, authError,
    collabMode,
    // actions
    setActiveId, setCollabMode,
    newSession, deleteSession, renameSession, submit,
  };
}

export type ChatStore = ReturnType<typeof useChatStore>;
