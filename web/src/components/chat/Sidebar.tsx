/** Left rail — editorial-research sidebar:
 *    brand pill + new-session btn + integrated search + tag chips
 *    + time-grouped sessions (📌置顶 · 今天 · 昨天 · 本周 · 本月 · 更早)
 *    + bottom trash drawer
 *  Collapsed state: 56px rail with brand mini + 3 icon shortcuts. */

import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../api";
import { cn } from "../../lib/cn";
import { GROUP_LABELS, groupSessions } from "../../lib/groupSessions";
import { I } from "../ui/Icon";

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
  onOpenSettings: () => void;
  onSearchQuery: (q: string) => void;
  onTagFilter: (t: string | null) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

export function Sidebar(p: SidebarProps) {
  const grouped = groupSessions(p.sessions);
  const [showTrash, setShowTrash] = useState(false);

  if (p.collapsed) {
    return (
      <aside className="sidebar">
        <div className="sidebar-collapsed-rail">
          <button
            className="collapsed-icon-btn brand-mini"
            onClick={p.onToggleCollapsed}
            title="展开侧栏"
          >F</button>
          <button
            className="collapsed-icon-btn"
            onClick={p.onNew}
            title="新会话 (⌘N)"
          ><I.Plus size={17} /></button>
          <button
            className="collapsed-icon-btn"
            onClick={() => {
              p.onToggleCollapsed();
              setTimeout(() => p.searchInputRef?.current?.focus(), 250);
            }}
            title="搜索 (⌘K)"
          ><I.Search size={17} /></button>
          <button
            className="collapsed-icon-btn"
            onClick={p.onOpenSettings}
            title="设置 (⌘,)"
            style={{ marginTop: "auto" }}
          ><I.Settings size={17} /></button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-content-full" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Brand */}
        <div className="brand">
          <div className="brand-mark">F</div>
          <div className="brand-text">
            <div className="brand-name-row">
              <span className="brand-name">Faro</span>
              <span className="brand-pro">Pro</span>
            </div>
            <div className="brand-version">A 股研究</div>
          </div>
          <button
            className="collapse-btn"
            onClick={p.onToggleCollapsed}
            title="折叠侧栏 (⌘\\)"
            aria-label="折叠侧栏"
          ><I.Sidebar size={14} /></button>
        </div>

        {/* New session + search */}
        <div className="sidebar-section">
          <button className="new-session-btn" onClick={p.onNew}>
            <I.Plus size={14} />
            <span>新会话</span>
            <span className="kbd-mini">⌘N</span>
          </button>
          <div className="search-wrap">
            <span className="search-icon"><I.Search size={13} /></span>
            <input
              ref={p.searchInputRef}
              type="text"
              placeholder="搜索会话…"
              value={p.searchQuery}
              onChange={(e) => p.onSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") p.onSearchQuery(""); }}
            />
            {!p.searchQuery && <span className="search-kbd">⌘K</span>}
          </div>
        </div>

        {/* Tags */}
        {p.allTags.length > 0 && (
          <div className="tag-chips">
            <button
              className={cn("tag-chip all", !p.tagFilter && "active")}
              onClick={() => p.onTagFilter(null)}
            >全部</button>
            {p.allTags.slice(0, 8).map((t) => (
              <button
                key={t}
                className={cn("tag-chip", p.tagFilter === t && "active")}
                onClick={() => p.onTagFilter(p.tagFilter === t ? null : t)}
              >{t}</button>
            ))}
          </div>
        )}

        {/* Sessions list */}
        <div className="session-list">
          {p.sessions.length === 0 && (
            <div style={{ padding: "24px 16px", color: "var(--ink-3)", fontSize: 12.5, textAlign: "center" }}>
              {p.searchQuery ? "无匹配会话" : "暂无会话"}
            </div>
          )}

          {grouped.pinned.length > 0 && (
            <>
              <div className="session-group-label">
                <span className="pin-glyph">📌</span>
                置顶
              </div>
              {grouped.pinned.map((s) => (
                <SessionItem
                  key={s.id}
                  s={s}
                  active={p.activeId === s.id}
                  {...rowHandlers(p, s)}
                />
              ))}
            </>
          )}

          {grouped.order.map((g) => (
            <div key={g}>
              <div className="session-group-label">{GROUP_LABELS[g]}</div>
              {grouped.byGroup[g].map((s) => (
                <SessionItem
                  key={s.id}
                  s={s}
                  active={p.activeId === s.id}
                  {...rowHandlers(p, s)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Trash drawer */}
        <div className="trash-drawer">
          <button
            className="trash-toggle"
            onClick={() => {
              if (!showTrash) p.onRefreshDeleted();
              setShowTrash(!showTrash);
            }}
          >
            <I.Trash size={13} />
            <span>回收站</span>
            <span className="trash-count">{p.deletedSessions.length}</span>
            <span style={{
              transform: showTrash ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
              display: "inline-flex",
            }}>
              <I.ChevDown size={12} />
            </span>
          </button>
          {showTrash && (
            <div className="trash-list">
              {p.deletedSessions.length === 0 && (
                <div style={{ padding: "8px 12px", fontSize: 11.5, color: "var(--ink-4)" }}>
                  回收站为空
                </div>
              )}
              {p.deletedSessions.map((s) => (
                <div key={s.id} className="trash-item">
                  <span className="trash-title" title={s.title}>{s.title}</span>
                  <button
                    className="trash-item-action restore"
                    onClick={() => p.onRestore(s.id)}
                  >还原</button>
                  <button
                    className="trash-item-action purge"
                    onClick={() => p.onPurge(s.id)}
                  >永删</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function rowHandlers(p: SidebarProps, s: SessionMeta) {
  return {
    onActivate: () => p.onSelect(s.id),
    onDelete: () => p.onDelete(s.id),
    onRename: (title: string) => p.onRename(s.id, title),
    onTogglePin: () => p.onTogglePin(s.id, !s.pinned),
    onSetTags: (tags: string[]) => p.onSetTags(s.id, tags),
  };
}

interface ItemProps {
  s: SessionMeta;
  active: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onSetTags: (tags: string[]) => void;
}

function SessionItem({ s, active, onActivate, onDelete, onRename, onTogglePin, onSetTags }: ItemProps) {
  const [editing, setEditing] = useState<null | "title" | "tags">(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select?.(); }
  }, [editing]);

  const beginRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(s.title);
    setEditing("title");
  };
  const beginTags = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft((s.tags || []).join(", "));
    setEditing("tags");
  };
  const commit = () => {
    if (editing === "title" && draft.trim()) onRename(draft.trim());
    if (editing === "tags") {
      const parts = draft.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
      onSetTags(parts);
    }
    setEditing(null);
  };

  return (
    <div
      className={cn("session-item", active && "active", s.pinned && "pinned")}
      onClick={() => !editing && onActivate()}
    >
      <svg className="session-pin" width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 4l6 6-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4 1-3z" />
      </svg>
      {editing === "title" ? (
        <input
          ref={inputRef}
          className="session-rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : editing === "tags" ? (
        <input
          ref={inputRef}
          className="session-tags-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="用逗号分隔"
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <div className="session-title" onDoubleClick={beginRename}>{s.title}</div>
      )}
      {!editing && s.tags && s.tags.length > 0 && (
        <div className="session-tag-dot" title={s.tags.join(", ")} />
      )}
      {!editing && (
        <div className="session-actions">
          <button
            className="session-action-btn"
            title="标签"
            onClick={beginTags}
          ><I.Hash size={12} /></button>
          <button
            className="session-action-btn"
            title={s.pinned ? "取消置顶" : "置顶"}
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          ><I.Pin size={12} /></button>
          <button
            className="session-action-btn danger"
            title="删除"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          ><I.Trash size={12} /></button>
        </div>
      )}
    </div>
  );
}
