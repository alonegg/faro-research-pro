import { toast } from "sonner";
import { setApiKey, type MeResponse } from "../../api";
import { cn } from "../../lib/cn";
import type { ServerInfo } from "../../state/types";
import { Button } from "../ui/Button";

interface TopBarProps {
  info: ServerInfo | null;
  me: MeResponse | null;
  collabMode: boolean;
  onToggleCollab: (on: boolean) => void;
}

export function TopBar({ info, me, collabMode, onToggleCollab }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="topbar__title">A 股研究助手 PRO</span>
      <span className="topbar__sub">多 agent 协作 + 品牌研报 · AGPL</span>

      <CollabSwitch on={collabMode} onChange={onToggleCollab} />

      {info && (
        <span className="topbar__pill" style={{ marginLeft: "auto" }}>
          <span className="dot" />
          {info.provider} · v{info.version}
          {info.auth_required ? ` · ${me?.email ?? "?"}` : ""}
        </span>
      )}
      {info?.auth_required && me && (
        <Button
          variant="ghost"
          size="sm"
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
          退出
        </Button>
      )}
    </header>
  );
}

function CollabSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={cn("switch", on && "switch--on")}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      title={on
        ? "开: Researcher 出稿后 Risk Reviewer 审查, 必要时退回让 Researcher 改"
        : "开 = 多 agent 协作模式; 关 = 单 agent (更快)"}
    >
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      🤝 多 agent 协作
    </button>
  );
}
