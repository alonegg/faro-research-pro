import { useEffect, useState } from "react";
import type { SettingsStatus } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section } from "../Field";

export function MemorySection({
  status, onUpdateMemory,
}: {
  status: SettingsStatus;
  onUpdateMemory: (soul: string, rules: string) => void;
}) {
  const [soul, setSoul] = useState(status.memory.soul);
  const [rules, setRules] = useState(status.memory.rules);
  const dirty = soul !== status.memory.soul || rules !== status.memory.rules;

  useEffect(() => {
    setSoul(status.memory.soul);
    setRules(status.memory.rules);
  }, [status.memory.soul, status.memory.rules]);

  return (
    <>
      <Section title="偏好 (Soul)" hint="你是谁、你的研究风格、你最在意什么。Agent 每次提问都会读取。">
        <Field label="">
          <textarea
            className="settings-input settings-input--textarea"
            placeholder="例如: 我是个人投资者,偏好高股息蓝筹,追求 5-10 年长持有。回答时多给安全边际分析,少给短线推荐。"
            rows={5}
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
          />
        </Field>
      </Section>

      <Section title="规则 (Rules)" hint="硬性约束。Agent 不会违反。">
        <Field label="">
          <textarea
            className="settings-input settings-input--textarea"
            placeholder="例如: 1) 单股仓位 ≤ 25% 2) 不碰未盈利的小盘股 3) 任何 PE > 60 的标的需明确写出风险"
            rows={5}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
        </Field>
      </Section>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={() => onUpdateMemory(soul, rules)}
        >
          {dirty ? "保存 Memory" : "已保存"}
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => { setSoul(status.memory.soul); setRules(status.memory.rules); }}
        >
          撤销
        </Button>
      </div>

      <Section title="已记录条数" hint="Agent 调用 memory_save 主动记下的事实/结论 (人物 / 标的 / 决策)。">
        <Field label="数量"><ReadOnly value={status.memory.count} /></Field>
      </Section>

      <Section title="已加载 Skills" hint="可在提问中触发的高阶能力 (research-report / dcf-cn 等)。">
        {status.skills.length === 0 && <ReadOnly value="（无）" />}
        {status.skills.map((s) => (
          <Field key={s.name} label={s.name}>
            <ReadOnly value={s.description} />
          </Field>
        ))}
      </Section>
    </>
  );
}
