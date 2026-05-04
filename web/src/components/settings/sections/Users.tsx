/** Multi-user admin: only admins see this tab. List users, create new
 *  ones (returns plain key once), regenerate key, delete. */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type UserSummary } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section } from "../Field";

export function UsersSection() {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ email: string; key: string } | null>(null);

  const refresh = () =>
    api.listUsersAdmin()
      .then(setUsers)
      .catch((e) => toast.error(`加载用户失败: ${e}`));

  useEffect(() => { refresh(); }, []);

  const onCreate = async (email: string, role: "user" | "admin") => {
    try {
      const u = await api.createUserAdmin(email, role);
      setRevealedKey({ email: u.email, key: u.plain_key });
      setShowCreate(false);
      refresh();
    } catch (e) {
      toast.error(`创建失败: ${e}`);
    }
  };

  const onRegenerate = (u: UserSummary) => {
    toast(`重新生成 ${u.email} 的 API key?`, {
      description: "旧 key 会立即失效。新 key 只会显示一次。",
      action: {
        label: "重新生成",
        onClick: async () => {
          try {
            const r = await api.regenerateUserKey(u.id);
            setRevealedKey({ email: u.email, key: r.plain_key });
            refresh();
          } catch (e) {
            toast.error(`生成失败: ${e}`);
          }
        },
      },
      duration: 8000,
    });
  };

  const onDelete = (u: UserSummary) => {
    toast(`删除用户 ${u.email}?`, {
      description: "连同 ta 的所有会话和 memory 一起删除。不可恢复。",
      action: {
        label: "删除",
        onClick: async () => {
          try {
            await api.deleteUserAdmin(u.id);
            toast.success(`已删除 ${u.email}`);
            refresh();
          } catch (e) {
            toast.error(`删除失败: ${e}`);
          }
        },
      },
      duration: 8000,
    });
  };

  return (
    <>
      <Section
        title="用户列表"
        hint="每个用户独立的会话历史 + memory + audit log。完全隔离,看不到彼此。"
      >
        {users === null && <ReadOnly value="加载中…" />}
        {users && (
          <table className="users-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>会话数</th>
                <th>最后活跃</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="users-table__email">{u.email}</span>
                    <div className="users-table__id">{u.id}</div>
                  </td>
                  <td>
                    <span className={`role-pill role-pill--${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.sessions_count}</td>
                  <td className="users-table__time">
                    {u.last_seen_at
                      ? new Date(u.last_seen_at).toLocaleString("zh-CN")
                      : "—"}
                  </td>
                  <td className="users-table__actions">
                    {u.id !== "default" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRegenerate(u)}
                          title="生成新 API key (旧 key 失效)"
                        >
                          重置 key
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onDelete(u)}
                        >
                          删除
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 12 }}>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + 创建新用户
          </Button>
        </div>
      </Section>

      <Section title="使用流程" hint="给朋友开账号的标准动作">
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.8 }}>
          <li>点 "创建新用户"，填邮箱（仅作识别用，不发邮件），选 user 角色</li>
          <li>系统返回一次性 API key（形如 <code>fr-xxx...</code>），立刻复制发给朋友</li>
          <li>朋友打开你的部署地址，弹出登录框，粘贴 key</li>
          <li>朋友会看到自己的空白会话列表，开始用</li>
          <li>需要时来这里 重置 key（朋友需要重新登录）或 删除用户（连同会话）</li>
        </ol>
      </Section>

      {showCreate && (
        <CreateUserModal onCreate={onCreate} onCancel={() => setShowCreate(false)} />
      )}
      {revealedKey && (
        <RevealedKeyModal
          email={revealedKey.email}
          plainKey={revealedKey.key}
          onClose={() => setRevealedKey(null)}
        />
      )}
    </>
  );
}

function CreateUserModal({
  onCreate, onCancel,
}: {
  onCreate: (email: string, role: "user" | "admin") => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  return (
    <div className="user-modal-overlay" onClick={onCancel}>
      <form
        className="user-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (email.trim()) onCreate(email.trim(), role); }}
      >
        <h3>创建新用户</h3>
        <Field label="邮箱 / 用户名">
          <input
            type="text"
            autoFocus
            placeholder="alice@example.com"
            className="settings-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="角色">
          <div className="settings-radios">
            <button
              type="button"
              className={`settings-radio ${role === "user" ? "active" : ""}`}
              onClick={() => setRole("user")}
            >普通用户</button>
            <button
              type="button"
              className={`settings-radio ${role === "admin" ? "active" : ""}`}
              onClick={() => setRole("admin")}
            >管理员</button>
          </div>
        </Field>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button type="submit" variant="primary" disabled={!email.trim()}>
            创建并生成 API key
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
        </div>
      </form>
    </div>
  );
}

function RevealedKeyModal({
  email, plainKey, onClose,
}: {
  email: string;
  plainKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败,请手动选中复制");
    }
  };
  return (
    <div className="user-modal-overlay" onClick={onClose}>
      <div className="user-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{email} 的 API key</h3>
        <p style={{ fontSize: 12.5, color: "var(--neg)", margin: "0 0 8px" }}>
          ⚠ 这个 key 只会显示一次。复制并发给用户后再关闭。
        </p>
        <div className="key-display">
          <code>{plainKey}</code>
          <Button variant={copied ? "primary" : "ghost"} size="sm" onClick={copy}>
            {copied ? "已复制 ✓" : "复制"}
          </Button>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 12 }}>
          用户登录步骤: 打开你的部署 URL → 弹出 "Faro Research 登录" → 粘贴这个 key → 登录
        </p>
        <Button variant="ghost" onClick={onClose} style={{ marginTop: 8 }}>
          我已复制,关闭
        </Button>
      </div>
    </div>
  );
}
