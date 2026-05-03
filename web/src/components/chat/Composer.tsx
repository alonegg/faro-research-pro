/** ChatGPT-style composer: auto-resizing textarea (up to 8 lines), send
 *  button on the right, ⌘/Ctrl+Enter hint underneath. */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";

interface ComposerProps {
  running: boolean;
  onSubmit: (q: string) => void;
}

export function Composer({ running, onSubmit }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: shrink to content height, capped by max-height in CSS
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  const submit = () => {
    if (running || !value.trim()) return;
    onSubmit(value);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer__field">
          <textarea
            ref={textareaRef}
            placeholder={running ? "等待中..." : "问个 A 股研究问题..."}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={running}
            rows={1}
          />
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={running || !value.trim()}
            title="发送 (⌘/Ctrl + Enter)"
          >
            {running ? "⋯" : "发送"}
          </Button>
        </div>
        <div className="composer__hint">
          <span>
            数据：本地 SQLite 多会话历史 + Tushare（行情 / 三表 / 估值 / 高管交易）
          </span>
          <span>
            <Kbd>⌘</Kbd>+<Kbd>Enter</Kbd> 发送
          </span>
        </div>
      </div>
    </div>
  );
}
