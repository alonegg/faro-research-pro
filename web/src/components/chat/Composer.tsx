/** Editorial composer — auto-grow textarea + send circle + footer
 *  with collab/Tushare/Memory pill toggles + ⌘+Enter hint. */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { I } from "../ui/Icon";

interface ComposerProps {
  running: boolean;
  collabMode: boolean;
  onToggleCollab: () => void;
  onSubmit: (q: string) => void;
}

export function Composer({ running, collabMode, onToggleCollab, onSubmit }: ComposerProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(192, Math.max(22, ta.scrollHeight)) + "px";
  }, [value]);

  const send = () => {
    if (running || !value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-textarea-wrap">
          <textarea
            ref={taRef}
            value={value}
            placeholder={collabMode
              ? "用协作模式提问 — 多 Agent 会复核答案…"
              : "提问以开始 — ⌘+Enter 发送"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button
            className="send-btn"
            disabled={!value.trim() || running}
            onClick={send}
            title="发送 (⌘+Enter)"
            aria-label="发送"
          >
            {running ? (
              <div
                className="spinner"
                style={{
                  width: 12, height: 12,
                  borderColor: "white", borderTopColor: "transparent",
                }}
              />
            ) : (
              <I.Send size={14} />
            )}
          </button>
        </div>
        <div className="composer-footer">
          <button
            className={`composer-tool-btn ${collabMode ? "active" : ""}`}
            onClick={onToggleCollab}
            title="多 Agent 协作 (Researcher + Risk Reviewer)"
          >
            <I.Layers size={11} />
            {collabMode ? "协作 · 双 Agent" : "单 Agent"}
          </button>
          <button className="composer-tool-btn" title="数据源: Tushare A 股 / 港股">
            <I.Database size={11} />
            Tushare
          </button>
          <button className="composer-tool-btn" title="个人偏好与规则">
            <I.Brain size={11} />
            Memory
          </button>
          <div className="composer-hint">
            <span className="kbd">⌘</span>
            <span className="kbd">Enter</span>
            <span>发送</span>
          </div>
        </div>
      </div>
    </div>
  );
}
