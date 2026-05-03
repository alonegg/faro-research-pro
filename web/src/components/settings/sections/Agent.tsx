import type { SettingsStatus } from "../../../api";
import { Field, ReadOnly, Section, Switch } from "../Field";

export function AgentSection({
  settings, status, onUpdate,
}: {
  settings: Record<string, any>;
  status: SettingsStatus;
  onUpdate: (k: string, v: any) => void;
}) {
  return (
    <>
      <Section title="协作模式" hint="多 agent (Researcher + Risk Reviewer) 默认行为。">
        <Field label="新会话默认开启协作">
          <Switch
            checked={!!settings["agent.default_collab"]}
            onChange={(v) => onUpdate("agent.default_collab", v)}
          />
        </Field>
        <Field label="协作最多轮数" hint="Researcher → Reviewer 反复几次">
          <input
            type="number" min={1} max={5}
            className="settings-input settings-input--num"
            value={settings["agent.collab_max_rounds"] ?? 2}
            onChange={(e) => onUpdate("agent.collab_max_rounds", parseInt(e.target.value) || 2)}
          />
        </Field>
      </Section>

      <Section title="工具循环" hint="单次提问内 agent 最多调几次工具。修改需改 .env 重启。">
        <Field label="max_tool_turns"><ReadOnly value={status.agent.max_tool_turns} /></Field>
        <Field label="tool_result_max_chars" hint="单条 tool 结果送回 LLM 前截断到多少字符">
          <ReadOnly value={status.agent.tool_result_max_chars} />
        </Field>
      </Section>

      <Section title="扩展能力">
        <Field label="启用 skills 插件" hint="research-report / dcf-cn 等">
          <Switch
            checked={settings["agent.skills_enabled"] !== false}
            onChange={(v) => onUpdate("agent.skills_enabled", v)}
          />
        </Field>
        <Field label="启用 memory 工具" hint="记住偏好 / 持仓 / 关注的标的">
          <Switch
            checked={settings["agent.memory_enabled"] !== false}
            onChange={(v) => onUpdate("agent.memory_enabled", v)}
          />
        </Field>
      </Section>
    </>
  );
}
