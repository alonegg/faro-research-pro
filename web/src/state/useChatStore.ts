/** Single source of truth for chat state — sessions, turns, history, auth.
 *
 *  Critical invariants (don't break these):
 *
 *    A. Wipe-race fix — when submit() lazily creates a session, setActiveId
 *       fires the load-history effect; that effect must NOT clear `turns` or
 *       the freshly-inserted pending turn vanishes (commit a7ad6ad).
 *
 *    B. Session-tagged turns — every UITurn carries `sessionId`. Late stream
 *       events after the user switches away are ignored (so a slow Researcher
 *       can't paint into the wrong thread).
 *
 *    C. AbortController on switch — switching sessions mid-stream cancels
 *       the in-flight fetch.
 *
 *    D. Auto-title trigger — fires once per session, only when the FIRST
 *       turn in that session finishes successfully and title is still default.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const COLLAPSED_KEY = "faro_pro_sidebar_collapsed";
const COLLAB_KEY = "faro_pro_collab";

export function useChatStore() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [deletedSessions, setDeletedSessions] = useState<SessionMeta[]>([]);
  const [activeId, _setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<PersistedMessage[]>([]);
  const [turns, setTurns] = useState<UITurn[]>([]);
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [collabMode, setCollabModeState] = useState<boolean>(
    () => localStorage.getItem(COLLAB_KEY) === "1",
  );
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Evidence rail (right slide-in panel for tool-call sources)
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceHighlight, setEvidenceHighlight] = useState<number | null>(null);

  const nextTurnId = useRef(1);
  const tickRef = useRef<number | null>(null);
  const lastLoadedSession = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Sessions where the next done-turn should trigger auto-title.
  // (Set when ensureSession lazily creates a new session in submit.)
  // (pendingAutoTitle ref removed — backend now decides via auto_titled flag)

  // ── persisted toggles ───────────────────────────────────────────────
  const setCollabMode = useCallback((on: boolean) => {
    setCollabModeState(on);
    localStorage.setItem(COLLAB_KEY, on ? "1" : "0");
  }, []);
  const setSidebarCollapsed = useCallback((on: boolean) => {
    setSidebarCollapsedState(on);
    localStorage.setItem(COLLAPSED_KEY, on ? "1" : "0");
  }, []);
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  // ── boot ────────────────────────────────────────────────────────────
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

  // ── elapsed-time tick ───────────────────────────────────────────────
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

  const refreshSessions = useCallback(async () => {
    try {
      const ss = await api.listSessions();
      setSessions(ss);
    } catch {/* ignore */}
  }, []);

  const refreshDeleted = useCallback(async () => {
    try {
      const ds = await api.listDeletedSessions();
      setDeletedSessions(ds);
    } catch {/* ignore */}
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

  const ensureSession = useCallback(async (): Promise<{ sid: string; isNew: boolean }> => {
    if (activeId) return { sid: activeId, isNew: false };
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    lastLoadedSession.current = s.id;
    _setActiveId(s.id);
    return { sid: s.id, isNew: true };
  }, [activeId]);

  // ── delete / rename / restore / purge ────────────────────────────────
  const deleteSession = useCallback((id: string) => {
    toast(`删除这个会话?`, {
      action: {
        label: "删除",
        onClick: async () => {
          try {
            await api.deleteSession(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));
            if (activeId === id) setActiveId(null);
            toast.success("已移到回收站", {
              action: {
                label: "撤销",
                onClick: async () => {
                  try {
                    const restored = await api.restoreSession(id);
                    setSessions((prev) => [restored, ...prev]);
                    toast.success("已还原");
                  } catch (e) {
                    toast.error(`还原失败: ${e}`);
                  }
                },
              },
              duration: 8000,
            });
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
      setSessions((prev) => prev.map((s) =>
        s.id === id ? { ...s, ...updated } : s,
      ));
    } catch (e) {
      toast.error(`重命名失败: ${e}`);
    }
  }, []);

  const restoreSession = useCallback(async (id: string) => {
    try {
      const restored = await api.restoreSession(id);
      setDeletedSessions((prev) => prev.filter((s) => s.id !== id));
      setSessions((prev) => [restored, ...prev]);
      toast.success("已还原");
    } catch (e) {
      toast.error(`还原失败: ${e}`);
    }
  }, []);

  const purgeSession = useCallback((id: string) => {
    toast("永久删除? 不可恢复", {
      action: {
        label: "永久删除",
        onClick: async () => {
          try {
            await api.purgeSession(id);
            setDeletedSessions((prev) => prev.filter((s) => s.id !== id));
            toast.success("已永久删除");
          } catch (e) {
            toast.error(`删除失败: ${e}`);
          }
        },
      },
      duration: 6000,
    });
  }, []);

  // ── pin / tags ──────────────────────────────────────────────────────
  const setPinned = useCallback(async (id: string, pinned: boolean) => {
    // Optimistic update.
    setSessions((prev) => prev.map((s) =>
      s.id === id ? { ...s, pinned, pinned_at: pinned ? new Date().toISOString() : null } : s,
    ));
    try {
      await api.setPinned(id, pinned);
    } catch (e) {
      toast.error(`${pinned ? "置顶" : "取消置顶"}失败: ${e}`);
      refreshSessions();
    }
  }, [refreshSessions]);

  const setTags = useCallback(async (id: string, tags: string[]) => {
    setSessions((prev) => prev.map((s) =>
      s.id === id ? { ...s, tags } : s,
    ));
    try {
      await api.setTags(id, tags);
    } catch (e) {
      toast.error(`修改标签失败: ${e}`);
      refreshSessions();
    }
  }, [refreshSessions]);

  // ── auto-title trigger ──────────────────────────────────────────────
  // Called after every successful turn. The backend has an idempotent
  // guard (skips if already auto_titled), so re-fires on the 2nd/3rd
  // turn cost a single ~10ms round trip and immediately return
  // `{skipped: "already-titled"}`. We previously gated on a
  // pendingAutoTitle ref + ensureSession's isNew flag, but that broke
  // when the user clicked "+ 新会话" before submitting — activeId was
  // already set, ensureSession returned isNew=false, and auto-title
  // never fired. Letting the backend decide is simpler and bulletproof.
  const tryAutoTitle = useCallback(async (sessionId: string) => {
    try {
      const updated = await api.autoTitle(sessionId);
      // Skipped responses don't include the full session shape; ignore.
      if ((updated as { skipped?: string }).skipped) return;
      setSessions((prev) => prev.map((s) =>
        s.id === sessionId ? { ...s, ...updated, auto_titled: true } : s,
      ));
    } catch {/* silent; not critical */}
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
        if (ev.type === "phase_start") {
          return { ...t, phases: [...t.phases, { phase: ev.phase, round: ev.round, status: "running" }] };
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
  }, []);

  // ── submit ──────────────────────────────────────────────────────────
  const submit = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (!query || running) return;
    setRunning(true);

    let sid: string;
    try {
      const r = await ensureSession();
      sid = r.sid;
    } catch (e) {
      setRunning(false);
      toast.error(`新建会话失败: ${e}`);
      return;
    }

    const id = nextTurnId.current++;
    setTurns((prev) => [...prev, {
      id, query, status: "pending", liveTools: [], elapsedMs: 0,
      collab: collabMode, phases: [], reviews: [], sessionId: sid,
    }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let succeeded = false;
    try {
      await askStream(
        sid, query, (ev) => onEvent(id, ev),
        controller.signal, collabMode ? "collab" : "single",
      );
      succeeded = true;
    } catch (e) {
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
      // Refresh list (bumps updated_at) then attempt auto-title.
      // Only fire on successful turns — aborted streams shouldn't
      // trigger a title for a session the user is leaving.
      await refreshSessions();
      if (succeeded) tryAutoTitle(sid);
    }
  }, [running, collabMode, ensureSession, onEvent, refreshSessions, tryAutoTitle]);

  // ── derived: visible session list (search + tag filter) ─────────────
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const sess of sessions) {
      for (const t of sess.tags || []) s.add(t);
    }
    return Array.from(s).sort();
  }, [sessions]);

  const visibleSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (q && !s.title.toLowerCase().includes(q)) return false;
      if (tagFilter && !(s.tags || []).includes(tagFilter)) return false;
      return true;
    });
  }, [sessions, searchQuery, tagFilter]);

  // Evidence rail: open + highlight a citation marker
  const showEvidence = useCallback((cite?: number | null) => {
    setEvidenceOpen(true);
    if (cite != null) {
      setEvidenceHighlight(cite);
      window.setTimeout(() => setEvidenceHighlight(null), 2000);
    }
  }, []);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);
  const toggleEvidence = useCallback(() => setEvidenceOpen((o) => !o), []);

  return {
    // state
    sessions, visibleSessions, deletedSessions, allTags,
    activeId, history, turns, running,
    info, me, authError,
    collabMode, sidebarCollapsed,
    searchQuery, tagFilter,
    evidenceOpen, evidenceHighlight,
    // actions
    setActiveId, setCollabMode,
    setSidebarCollapsed, toggleSidebarCollapsed,
    setSearchQuery, setTagFilter,
    newSession, deleteSession, renameSession,
    restoreSession, purgeSession, refreshDeleted,
    setPinned, setTags,
    submit,
    showEvidence, closeEvidence, toggleEvidence,
  };
}

export type ChatStore = ReturnType<typeof useChatStore>;
