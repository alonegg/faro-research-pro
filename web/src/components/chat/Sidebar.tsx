/** Left rail — brand + new-session + session list with hover actions
 *  + double-click rename. Pure UI, all data + handlers from props. */

import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

interface SidebarProps {
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function Sidebar(p: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__brand-mark">F</span>
        <span className="sidebar__brand">
          Faro Research
          <span className="sidebar__brand-pro">PRO</span>
        </span>
      </div>
      <div className="sidebar__new">
        <Button
          variant="primary"
          style={{ width: "100%" }}
          onClick={p.onNew}
        >
          + 新会话
        </Button>
      </div>
      <div className="session-list">
        {p.sessions.length === 0 && (
          <div className="session-list__empty">
            还没有会话<br />点上面新建
          </div>
        )}
        {p.sessions.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            active={p.activeId === s.id}
            onSelect={() => p.onSelect(s.id)}
            onDelete={() => p.onDelete(s.id)}
            onRename={(title) => p.onRename(s.id, title)}
          />
        ))}
      </div>
    </aside>
  );
}

interface ItemProps {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

function SessionItem({ session, active, onSelect, onDelete, onRename }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.title) {
      onRename(draft.trim());
    } else {
      setDraft(session.title);
    }
  };

  return (
    <div
      className={cn("session-item", active && "active")}
      onClick={() => !editing && onSelect()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(session.title);
        setEditing(true);
      }}
      title="双击重命名"
    >
      {editing ? (
        <input
          ref={inputRef}
          className="session-item__title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setDraft(session.title); setEditing(false); }
          }}
        />
      ) : (
        <span className="session-item__title">{session.title}</span>
      )}
      <span className="session-item__date">
        {new Date(session.updated_at).toLocaleDateString("zh-CN", {
          month: "numeric", day: "numeric",
        })}
      </span>
      <button
        className="session-item__action"
        title="删除"
        aria-label="删除"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        ×
      </button>
    </div>
  );
}
