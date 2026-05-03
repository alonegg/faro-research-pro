/** Faro Research Pro — chat shell.
 *
 *  Pure wiring: pulls state from useChatStore, lays out the shell, hands
 *  each piece to a primitive (Sidebar / TopBar / Thread / Composer).
 *  Global keyboard shortcuts (⌘K / ⌘\ / ⌘N) are wired here. */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Composer } from "./components/chat/Composer";
import { EmptyState } from "./components/chat/EmptyState";
import { PersistedMessageView, TurnView } from "./components/chat/Message";
import { Sidebar } from "./components/chat/Sidebar";
import { Thread } from "./components/chat/Thread";
import { TopBar } from "./components/chat/TopBar";
import { AuthGate } from "./components/ui/AuthGate";
import { cn } from "./lib/cn";
import { useChatStore } from "./state/useChatStore";

const SUGGESTIONS = [
  "贵州茅台 PE_TTM 和近 4 季度 ROE",
  "比亚迪 2024 vs 2025 营收对比",
  "给我写一份宁德时代的深度研报",
  "茅台 DCF 估值合不合理",
  "记住:我偏好高股息蓝筹, 单股仓位 ≤ 25%",
];

export function App() {
  const s = useChatStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global shortcuts: ⌘K (search), ⌘\ (collapse), ⌘N (new session)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (s.sidebarCollapsed) s.setSidebarCollapsed(false);
        // wait for sidebar to mount, then focus
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === "\\") {
        e.preventDefault();
        s.toggleSidebarCollapsed();
      } else if ((e.key === "n" || e.key === "N") && !e.shiftKey) {
        // Don't fight ⌘+Shift+N (new private window). Plain ⌘+N for new session.
        e.preventDefault();
        s.newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.sidebarCollapsed, s.setSidebarCollapsed, s.toggleSidebarCollapsed, s.newSession]);

  // Auth gate
  const showAuthModal =
    s.info?.auth_required && (!s.me || !!s.authError) && !!s.info;
  if (showAuthModal) {
    return <AuthGate onSuccess={() => location.reload()} />;
  }

  const showEmpty = !s.activeId && s.turns.length === 0;

  return (
    <div className={cn("app", s.sidebarCollapsed && "app--collapsed")}>
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
        onSearchQuery={s.setSearchQuery}
        onTagFilter={s.setTagFilter}
        searchInputRef={searchInputRef}
      />

      <div className="main">
        <TopBar
          info={s.info}
          me={s.me}
          collabMode={s.collabMode}
          onToggleCollab={s.setCollabMode}
        />

        <Thread scrollKey={[s.history.length, s.turns]}>
          {showEmpty && (
            <EmptyState suggestions={SUGGESTIONS} onPick={s.submit} />
          )}
          {s.history.map((m) => (
            <PersistedMessageView key={m.seq} m={m} sessionId={s.activeId} />
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
                <TurnView turn={t} sessionId={s.activeId} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Thread>

        <Composer running={s.running} onSubmit={s.submit} />
      </div>
    </div>
  );
}
