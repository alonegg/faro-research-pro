/** Top bar — title block (with sub: relative time · tags · mode) +
 *  evidence btn + collab pill switch + provider pulse pill + settings. */

import { toast } from "sonner";
import { setApiKey, type MeResponse, type SessionMeta } from "../../api";
import { cn } from "../../lib/cn";
import type { ServerInfo } from "../../state/types";
import { I } from "../ui/Icon";

interface TopBarProps {
  info: ServerInfo | null;
  me: MeResponse | null;
  collabMode: boolean;
  activeSession: SessionMeta | null;
  evidenceCount: number;
  onToggleCollab: (on: boolean) => void;
  onShowEvidence: () => void;
  onOpenSettings: () => void;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return `${Math.floor(d / 7)} 周前`;
}

export function TopBar({
  info, me, collabMode, activeSession, evidenceCount,
  onToggleCollab, onShowEvidence, onOpenSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title-block">
        <div className="topbar-title">
          {activeSession?.title || "新会话"}
        </div>
        <div className="topbar-sub">
          {activeSession ? (
            <>
              <span>{relTime(activeSession.updated_at)}</span>
              <span className="dot-sep" />
              <span>{(activeSession.tags || []).join(" · ") || "无标签"}</span>
              <span className="dot-sep" />
              <span>{collabMode ? "协作模式" : "单 Agent"}</span>
            </>
          ) : (
            <span>等待提问 — 多 Agent A 股研究</span>
          )}
        </div>
      </div>
      <div className="topbar-actions">
        {evidenceCount > 0 && (
          <button
            className="icon-btn"
            onClick={onShowEvidence}
            title="证据面板"
            aria-label="证据面板"
          ><I.Compass size={16} /></button>
        )}
        <button
          type="button"
          className={cn("collab-switch", collabMode && "on")}
          onClick={() => onToggleCollab(!collabMode)}
          title={collabMode
            ? "开: Researcher 出稿后 Risk Reviewer 审查"
            : "关: 单 Agent 模式 (更快)"}
          role="switch"
          aria-checked={collabMode}
        >
          <span className="collab-switch-label">
            <I.Layers size={12} />
            协作
          </span>
          <span className="collab-switch-track" />
        </button>
        {info && (
          <div className="provider-pill">
            <span className="pulse-dot" />
            {info.provider}
          </div>
        )}
        {info?.auth_required && me && (
          <button
            className="icon-btn"
            title={`${me.email} · 退出`}
            aria-label="退出登录"
            onClick={() =>
              toast("退出当前 API key?", {
                action: {
                  label: "退出",
                  onClick: () => { setApiKey(""); location.reload(); },
                },
                duration: 6000,
              })
            }
          >
            <I.Close size={14} />
          </button>
        )}
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          title="设置 (⌘,)"
          aria-label="打开设置"
        ><I.Settings size={16} /></button>
      </div>
    </header>
  );
}
