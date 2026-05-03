import { Section } from "../Field";

const SHORTCUTS = [
  { keys: ["⌘", "Enter"], desc: "发送消息" },
  { keys: ["⌘", "K"], desc: "聚焦搜索框 (会自动展开侧栏)" },
  { keys: ["⌘", "\\"], desc: "折叠 / 展开侧栏" },
  { keys: ["⌘", "N"], desc: "新建会话" },
  { keys: ["双击会话名"], desc: "重命名会话 (Esc 取消)" },
  { keys: ["Esc"], desc: "关闭设置 / 取消编辑" },
];

export function ShortcutsSection() {
  return (
    <Section title="键盘快捷键" hint="Mac 用 ⌘, Windows / Linux 用 Ctrl。">
      <table className="shortcuts-table">
        <tbody>
          {SHORTCUTS.map((s, i) => (
            <tr key={i}>
              <td>
                {s.keys.map((k, j) => (
                  <span key={j}>
                    <kbd className="kbd">{k}</kbd>
                    {j < s.keys.length - 1 && <span style={{ margin: "0 4px", color: "var(--ink-3)" }}>+</span>}
                  </span>
                ))}
              </td>
              <td style={{ color: "var(--ink-2)" }}>{s.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
