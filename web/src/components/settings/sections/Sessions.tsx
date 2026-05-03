import { Field, Section, Switch } from "../Field";

export function SessionsSection({
  settings, onUpdate,
}: {
  settings: Record<string, any>;
  onUpdate: (k: string, v: any) => void;
}) {
  return (
    <>
      <Section title="自动标题" hint="第一条提问发完后,LLM 自动给会话生成 6-12 字标题。">
        <Field label="启用自动标题">
          <Switch
            checked={settings["session.auto_title_enabled"] !== false}
            onChange={(v) => onUpdate("session.auto_title_enabled", v)}
          />
        </Field>
        <Field label="用小模型" hint="关掉的话用主模型 (耗时 + 成本)">
          <Switch
            checked={settings["session.auto_title_use_small_model"] !== false}
            onChange={(v) => onUpdate("session.auto_title_use_small_model", v)}
          />
        </Field>
      </Section>

      <Section title="回收站" hint="软删除的会话保留多少天后自动清理。0 = 永久保留。">
        <Field label="保留天数">
          <input
            type="number" min={0} max={365}
            className="settings-input settings-input--num"
            value={settings["session.trash_retention_days"] ?? 30}
            onChange={(e) => onUpdate("session.trash_retention_days", parseInt(e.target.value) || 0)}
          />
        </Field>
      </Section>
    </>
  );
}
