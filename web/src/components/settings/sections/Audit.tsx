import { toast } from "sonner";
import { api, type SettingsStatus } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section, Switch } from "../Field";

export function AuditSection({
  status, settings, onUpdate,
}: {
  status: SettingsStatus;
  settings: Record<string, any>;
  onUpdate: (k: string, v: any) => void;
}) {
  return (
    <>
      <Section title="审计日志">
        <Field label="记录提问内容到 audit log" hint="关掉只记 metadata (谁、什么时候、什么工具),不记问题文本。">
          <Switch
            checked={settings["audit.record_query_text"] !== false}
            onChange={(v) => onUpdate("audit.record_query_text", v)}
          />
        </Field>
        <Field label="数据库路径"><ReadOnly value={status.audit.db_path} mono /></Field>
      </Section>

      <Section title="数据导出">
        <Field label="导出全部会话为 .zip" hint="包含 SQLite + memory 文件夹">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.message("尚未实现 — 后续版本")}
          >
            开始导出
          </Button>
        </Field>
      </Section>

      <Section title="危险操作" hint="不可恢复。三思而行。">
        <Field label="清空所有会话">
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              toast("永久删除你的所有会话?", {
                description: "包括回收站里的。无法恢复。",
                action: {
                  label: "我确认删除",
                  onClick: () =>
                    toast("再次确认: 真的全删?", {
                      description: "这是最后一次确认。",
                      action: {
                        label: "确认",
                        onClick: async () => {
                          try {
                            const r = await api.purgeAllSessions();
                            toast.success(`已删除 ${r.purged} 个会话`);
                            setTimeout(() => location.reload(), 1500);
                          } catch (e) {
                            toast.error(`删除失败: ${e}`);
                          }
                        },
                      },
                      duration: 10000,
                    }),
                },
                duration: 8000,
              })
            }
          >
            清空全部会话
          </Button>
        </Field>
      </Section>
    </>
  );
}
