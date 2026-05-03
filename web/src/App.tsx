/** Faro Research Pro — chat shell.
 *
 *  This file does only wiring: pull state from useChatStore, lay out the
 *  shell, hand each piece to a primitive (Sidebar / TopBar / Thread /
 *  Composer). All chat behavior lives in state/useChatStore.ts and the
 *  individual components/. */

import { AnimatePresence, motion } from "framer-motion";
import { Composer } from "./components/chat/Composer";
import { EmptyState } from "./components/chat/EmptyState";
import { PersistedMessageView, TurnView } from "./components/chat/Message";
import { Sidebar } from "./components/chat/Sidebar";
import { Thread } from "./components/chat/Thread";
import { TopBar } from "./components/chat/TopBar";
import { AuthGate } from "./components/ui/AuthGate";
import { useChatStore } from "./state/useChatStore";

const SUGGESTIONS = [
  "贵州茅台 PE_TTM 和近 4 季度 ROE",
  "比亚迪 2024 vs 2025 营收对比",
  "给我写一份宁德时代的深度研报",          // skill: research-report
  "茅台 DCF 估值合不合理",                  // skill: dcf-cn
  "记住:我偏好高股息蓝筹, 单股仓位 ≤ 25%",  // memory_update
];

export function App() {
  const s = useChatStore();

  // Auth gate — only blocks when server requires auth AND no valid session
  const showAuthModal =
    s.info?.auth_required && (!s.me || !!s.authError) && !!s.info;
  if (showAuthModal) {
    return <AuthGate onSuccess={() => location.reload()} />;
  }

  // Empty state shows ONLY when there's no session AND no live turn
  // (otherwise the just-submitted preset would briefly hide its own turn).
  const showEmpty = !s.activeId && s.turns.length === 0;

  return (
    <div className="app">
      <Sidebar
        sessions={s.sessions}
        activeId={s.activeId}
        onSelect={s.setActiveId}
        onNew={s.newSession}
        onDelete={s.deleteSession}
        onRename={s.renameSession}
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
