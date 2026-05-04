/** Faro Research Pro — chat shell.
 *
 *  Editorial-research aesthetic per claude.ai/design handoff:
 *  warm cream + refined purple, mixed serif/sans, vertical collab
 *  stepper, right-side evidence rail with [N] citation linking. */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Composer } from "./components/chat/Composer";
import { EmptyState } from "./components/chat/EmptyState";
import { EvidenceRail, deriveEvidence, type EvidenceItem } from "./components/chat/EvidenceRail";
import { PersistedMessageView, TurnView } from "./components/chat/Message";
import { Sidebar } from "./components/chat/Sidebar";
import { TopBar } from "./components/chat/TopBar";
import { SettingsModal } from "./components/settings/SettingsModal";
import { AuthGate } from "./components/ui/AuthGate";
import { useChatStore } from "./state/useChatStore";

const SUGGESTIONS = [
  { label: "财报解读", text: "贵州茅台 PE_TTM 和近 4 季度 ROE" },
  { label: "个股对比", text: "比亚迪 2024 vs 2025 营收对比" },
  { label: "深度研报", text: "给我写一份宁德时代的深度研报" },
  { label: "估值追踪", text: "茅台 DCF 估值合不合理" },
  { label: "Memory", text: "记住:我偏好高股息蓝筹, 单股仓位 ≤ 25%" },
];

export function App() {
  const s = useChatStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Active evidence (the items shown in the rail when user clicks [N] / 证据)
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);

  // Auto-derive evidence from the latest turn or last persisted assistant msg
  // — used to power the topbar evidence button + auto-update on new turn.
  const autoEvidence = useMemo<EvidenceItem[]>(() => {
    const latestTurn = [...s.turns].reverse().find((t) => t.status === "done");
    if (latestTurn) return deriveEvidence(latestTurn.finalToolCalls);
    const lastAssistant = [...s.history].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      const meta = lastAssistant.meta as { tool_calls?: any[] };
      return deriveEvidence(meta?.tool_calls);
    }
    return [];
  }, [s.turns, s.history]);

  // Open the rail when user clicks 证据 / [N]
  const openEvidence = (items: EvidenceItem[]) => {
    setEvidenceItems(items);
    s.showEvidence();
  };
  const handleCite = (n: number, items: EvidenceItem[]) => {
    setEvidenceItems(items);
    s.showEvidence(n);
  };

  // Global shortcuts: ⌘K (search) / ⌘\ (collapse) / ⌘N (new) / ⌘, (settings)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (s.sidebarCollapsed) s.setSidebarCollapsed(false);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === "\\") {
        e.preventDefault();
        s.toggleSidebarCollapsed();
      } else if ((e.key === "n" || e.key === "N") && !e.shiftKey) {
        e.preventDefault();
        s.newSession();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.sidebarCollapsed, s.setSidebarCollapsed, s.toggleSidebarCollapsed, s.newSession]);

  // Auth gate
  const showAuthModal = s.info?.auth_required && (!s.me || !!s.authError) && !!s.info;
  if (showAuthModal) {
    return <AuthGate onSuccess={() => location.reload()} />;
  }

  const activeSession = s.sessions.find((sess) => sess.id === s.activeId) || null;
  const showEmpty = !s.activeId && s.turns.length === 0;

  return (
    <div id="app" data-collapsed={s.sidebarCollapsed ? "true" : "false"}>
      <Sidebar
        sessions={s.visibleSessions}
        deletedSessions={s.deletedSessions}
        allTags={s.allTags}
        activeId={s.activeId}
        collapsed={s.sidebarCollapsed}
        searchQuery={s.searchQuery}
        tagFilter={s.tagFilter}
        onSelect={s.setActiveId}
        onNew={s.newSession}
        onDelete={s.deleteSession}
        onRename={s.renameSession}
        onTogglePin={s.setPinned}
        onSetTags={s.setTags}
        onRestore={s.restoreSession}
        onPurge={s.purgeSession}
        onRefreshDeleted={s.refreshDeleted}
        onToggleCollapsed={s.toggleSidebarCollapsed}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearchQuery={s.setSearchQuery}
        onTagFilter={s.setTagFilter}
        searchInputRef={searchInputRef}
      />

      <main className="main">
        <TopBar
          info={s.info}
          me={s.me}
          collabMode={s.collabMode}
          activeSession={activeSession}
          evidenceCount={autoEvidence.length}
          onToggleCollab={s.setCollabMode}
          onShowEvidence={() => openEvidence(autoEvidence)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="thread">
          {showEmpty ? (
            <EmptyState suggestions={SUGGESTIONS} onPick={s.submit} />
          ) : (
            <div className="thread-inner">
              {s.history.map((m) => (
                <PersistedMessageView
                  key={m.seq}
                  m={m}
                  sessionId={s.activeId}
                  onShowEvidence={openEvidence}
                  onCite={handleCite}
                />
              ))}
              <AnimatePresence initial={false}>
                {s.turns.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <TurnView
                      turn={t}
                      sessionId={s.activeId}
                      onShowEvidence={openEvidence}
                      onCite={handleCite}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <Composer
          running={s.running}
          collabMode={s.collabMode}
          onToggleCollab={() => s.setCollabMode(!s.collabMode)}
          onSubmit={s.submit}
        />

        <EvidenceRail
          visible={s.evidenceOpen}
          items={evidenceItems.length > 0 ? evidenceItems : autoEvidence}
          highlight={s.evidenceHighlight}
          onClose={s.closeEvidence}
        />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
