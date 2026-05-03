/** Left rail — brand + collapse toggle + search + tag filter +
 *  pinned section + time-grouped sessions + trash drawer.
 *
 *  All data + handlers come from useChatStore via props. */

import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../api";
import { cn } from "../../lib/cn";
import { GROUP_LABELS, groupSessions } from "../../lib/groupSessions";
import { Button } from "../ui/Button";

interface SidebarProps {
  sessions: SessionMeta[];
  deletedSessions: SessionMeta[];
  allTags: string[];
  activeId: string | null;
  collapsed: boolean;
  searchQuery: string;
  tagFilter: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onSetTags: (id: string, tags: string[]) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onRefreshDeleted: () => void;
  onToggleCollapsed: () => void;
  onSearchQuery: (q: string) => void;
  onTagFilter: (t: string | null) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

export function Sidebar(p: SidebarProps) {
  const grouped = groupSessions(p.sessions);
  const [showTrash, setShowTrash] = useState(false);

  if (p.collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <button
          className="sidebar__brand-mark sidebar__brand-mark--clickable"
          onClick={p.onToggleCollapsed}
          title="展开侧栏 (⌘\\)"
        >F</button>
        <Button
          variant="ghost"
          size="icon"
          onClick={p.onNew}
          title="新会话"
          style={{ marginTop: 8 }}
        >
          +
        </Button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__brand-mark">F</span>
        <span className="sidebar__brand">
          Faro Research
          <span className="sidebar__brand-pro">PRO</span>
        </span>
        <button
          className="sidebar__collapse-btn"
          onClick={p.onToggleCollapsed}
          title="折叠侧栏 (⌘\\)"
          aria-label="折叠侧栏"
        >
          ‹
        </button>
      </div>

      <div className="sidebar__new">
        <Button variant="primary" style={{ width: "100%" }} onClick={p.onNew}>
          + 新会话
        </Button>
      </div>

      <div className="sidebar__search">
        <input
          ref={p.searchInputRef}
          type="search"
          placeholder="搜索会话..."
          value={p.searchQuery}
          onChange={(e) => p.onSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") p.onSearchQuery(""); }}
        />
        <span className="sidebar__search-kbd">⌘K</span>
      </div>

      {p.allTags.length > 0 && (
        <div className="tag-row">
          <button
            className={cn("tag-chip", !p.tagFilter && "tag-chip--active")}
            onClick={() => p.onTagFilter(null)}
          >
            全部
          </button>
          {p.allTags.map((t) => (
            <button
              key={t}
              className={cn("tag-chip", p.tagFilter === t && "tag-chip--active")}
              onClick={() => p.onTagFilter(p.tagFilter === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="session-list">
        {p.sessions.length === 0 && (
          <div className="session-list__empty">
            还没有会话<br />点上面新建
          </div>
        )}

        {grouped.pinned.length > 0 && (
          <SessionGroup label="📌 置顶">
            {grouped.pinned.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={p.activeId === s.id}
                {...rowHandlers(p, s)}
              />
            ))}
          </SessionGroup>
        )}

        {grouped.order.map((g) => (
          <SessionGroup key={g} label={GROUP_LABELS[g]}>
            {grouped.byGroup[g].map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={p.activeId === s.id}
                {...rowHandlers(p, s)}
              />
            ))}
          </SessionGroup>
        ))}
      </div>

      <button
        className="sidebar__trash-btn"
        onClick={() => {
          if (!showTrash) p.onRefreshDeleted();
          setShowTrash(!showTrash);
        }}
      >
        🗑 回收站
        {p.deletedSessions.length > 0 && (
          <span className="sidebar__trash-count">{p.deletedSessions.length}</span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--ink-3)" }}>
          {showTrash ? "▾" : "▸"}
        </span>
      </button>

      {showTrash && (
        <div className="trash-drawer">
          {p.deletedSessions.length === 0 && (
            <div className="trash-drawer__empty">回收站是空的</div>
          )}
          {p.deletedSessions.map((s) => (
            <div key={s.id} className="trash-item">
              <span className="trash-item__title">{s.title}</span>
              <span className="trash-item__date">
                {s.deleted_at && new Date(s.deleted_at).toLocaleDateString("zh-CN", {
                  month: "numeric", day: "numeric",
                })}
              </span>
              <button
                className="trash-item__action"
                onClick={() => p.onRestore(s.id)}
                title="还原"
              >↺</button>
              <button
                className="trash-item__action trash-item__action--purge"
                onClick={() => p.onPurge(s.id)}
                title="永久删除"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function rowHandlers(p: SidebarProps, s: SessionMeta) {
  return {
    onSelect: () => p.onSelect(s.id),
    onDelete: () => p.onDelete(s.id),
    onRename: (title: string) => p.onRename(s.id, title),
    onTogglePin: () => p.onTogglePin(s.id, !s.pinned),
    onSetTags: (tags: string[]) => p.onSetTags(s.id, tags),
  };
}

// ─── Group section ────────────────────────────────────────────────────
function SessionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="session-group">
      <div className="session-group__label">{label}</div>
      {children}
    </div>
  );
}

// ─── Session row ─────────────────────────────────────────────────────
interface ItemProps {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onSetTags: (tags: string[]) => void;
}

function SessionItem({
  session, active, onSelect, onDelete, onRename, onTogglePin, onSetTags,
}: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [editingTags, setEditingTags] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.title) onRename(draft.trim());
    else setDraft(session.title);
  };

  const tags = session.tags || [];

  return (
    <div
      className={cn("session-item", active && "active", session.pinned && "pinned")}
      onClick={() => !editing && !editingTags && onSelect()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(session.title);
        setEditing(true);
      }}
      title={editing ? undefined : "双击重命名"}
    >
      <div className="session-item__row">
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
          {new Date(session.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
        </span>
        <button
          className={cn("session-item__action", session.pinned && "session-item__action--active")}
          title={session.pinned ? "取消置顶" : "置顶"}
          aria-label={session.pinned ? "取消置顶" : "置顶"}
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
        >
          📌
        </button>
        <button
          className="session-item__action session-item__action--tag"
          title="编辑标签"
          aria-label="编辑标签"
          onClick={(e) => { e.stopPropagation(); setEditingTags(!editingTags); }}
        >
          #
        </button>
        <button
          className="session-item__action session-item__action--delete"
          title="删除"
          aria-label="删除"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          ×
        </button>
      </div>

      {(tags.length > 0 || editingTags) && (
        <div className="session-item__tags" onClick={(e) => e.stopPropagation()}>
          {editingTags ? (
            <TagEditor
              tags={tags}
              onCommit={(newTags) => { onSetTags(newTags); setEditingTags(false); }}
              onCancel={() => setEditingTags(false)}
            />
          ) : (
            tags.slice(0, 3).map((t) => <span key={t} className="tag-pill">{t}</span>)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tag editor (inline) ──────────────────────────────────────────────
function TagEditor({
  tags, onCommit, onCancel,
}: {
  tags: string[];
  onCommit: (tags: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(tags.join(", "));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="session-item__tag-input"
      placeholder="逗号分隔, 如: 茅台, 白酒"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.split(/[,，、]/).map((t) => t.trim()).filter(Boolean))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft.split(/[,，、]/).map((t) => t.trim()).filter(Boolean));
        }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
    />
  );
}
