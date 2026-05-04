/** Full-screen Settings overlay. Left tab nav, right content panel.
 *  Auto-saves on each change (no save button). */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "../../state/useSettings";
import { cn } from "../../lib/cn";
import { LLMSection } from "./sections/LLM";
import { DataSourcesSection } from "./sections/DataSources";
import { AgentSection } from "./sections/Agent";
import { SessionsSection } from "./sections/Sessions";
import { BrandSection } from "./sections/Brand";
import { MemorySection } from "./sections/Memory";
import { AuthSection } from "./sections/Auth";
import { AuditSection } from "./sections/Audit";
import { ShortcutsSection } from "./sections/Shortcuts";
import { AppearanceSection } from "./sections/Appearance";
import { UsersSection } from "./sections/Users";

const ALL_TABS = [
  { id: "llm", label: "LLM 模型", icon: "🧠", adminOnly: false },
  { id: "data", label: "数据源", icon: "📊", adminOnly: false },
  { id: "agent", label: "Agent 行为", icon: "🤖", adminOnly: false },
  { id: "sessions", label: "会话默认", icon: "💬", adminOnly: false },
  { id: "brand", label: "品牌 / PDF", icon: "🎨", adminOnly: false },
  { id: "memory", label: "Memory & Skills", icon: "🧬", adminOnly: false },
  { id: "users", label: "用户管理", icon: "👥", adminOnly: true },
  { id: "auth", label: "认证", icon: "🔐", adminOnly: false },
  { id: "audit", label: "审计 / 隐私", icon: "🛡️", adminOnly: false },
  { id: "shortcuts", label: "快捷键", icon: "⌨️", adminOnly: false },
  { id: "appearance", label: "外观", icon: "✨", adminOnly: false },
] as const;

type TabId = typeof ALL_TABS[number]["id"];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("llm");
  const s = useSettings(open);
  const isAdmin = s.status?.auth.current_user.role === "admin";
  const TABS = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="settings-modal"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-modal__head">
              <span className="settings-modal__title">⚙ 设置</span>
              <span className="settings-modal__hint">改完即生效 · Esc 关闭</span>
              <button
                className="settings-modal__close"
                onClick={onClose}
                title="关闭 (Esc)"
              >×</button>
            </header>

            <div className="settings-modal__body">
              <nav className="settings-nav">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={cn("settings-nav__item", tab === t.id && "active")}
                    onClick={() => setTab(t.id)}
                  >
                    <span className="settings-nav__icon">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </nav>

              <main className="settings-content">
                {s.loading && <div className="settings-loading">加载中…</div>}
                {!s.loading && s.settings && s.status && (
                  <>
                    {tab === "llm" && <LLMSection status={s.status} onTest={s.test} />}
                    {tab === "data" && <DataSourcesSection status={s.status} onTest={s.test} />}
                    {tab === "agent" && <AgentSection settings={s.settings} status={s.status} onUpdate={s.update} />}
                    {tab === "sessions" && <SessionsSection settings={s.settings} onUpdate={s.update} />}
                    {tab === "brand" && <BrandSection settings={s.settings} onUpdate={s.update} />}
                    {tab === "memory" && (
                      <MemorySection
                        status={s.status}
                        onUpdateMemory={s.updateMemory}
                      />
                    )}
                    {tab === "users" && isAdmin && <UsersSection />}
                    {tab === "auth" && <AuthSection status={s.status} />}
                    {tab === "audit" && <AuditSection status={s.status} settings={s.settings} onUpdate={s.update} />}
                    {tab === "shortcuts" && <ShortcutsSection />}
                    {tab === "appearance" && <AppearanceSection settings={s.settings} onUpdate={s.update} />}
                  </>
                )}
              </main>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
