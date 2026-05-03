import type { SettingsStatus } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section } from "../Field";

export function LLMSection({
  status, onTest,
}: {
  status: SettingsStatus;
  onTest: (kind: "llm_main" | "llm_small") => void;
}) {
  const m = status.llm_main;
  const s = status.llm_small;
  return (
    <>
      <Section title="主模型" hint="跑 Researcher 的 LLM。修改需改 .env 后重启容器。">
        <Field label="Provider"><ReadOnly value={m.provider} /></Field>
        <Field label="Base URL"><ReadOnly value={m.base_url} mono /></Field>
        <Field label="Model"><ReadOnly value={m.model} mono /></Field>
        <Field label="API Key"><ReadOnly value={m.api_key_masked} mono /></Field>
        <Field label="超时 (秒)"><ReadOnly value={m.timeout_sec} /></Field>
        <Field label="连接测试">
          <Button variant="ghost" size="sm" onClick={() => onTest("llm_main")}>
            发个 ping
          </Button>
        </Field>
      </Section>

      <Section title="小模型 (auto-title / summary)" hint="跑标题/总结这种轻量任务的小模型。配置 FARO_PRO_SMALL_LLM_* env。">
        <Field label="状态"><ReadOnly value={s.configured ? "已配置" : "未配置 (会回退到主模型)"} /></Field>
        <Field label="Base URL"><ReadOnly value={s.base_url || "—"} mono /></Field>
        <Field label="Model"><ReadOnly value={s.model || "—"} mono /></Field>
        <Field label="API Key"><ReadOnly value={s.api_key_masked || "—"} mono /></Field>
        <Field label="连接测试">
          <Button variant="ghost" size="sm" onClick={() => onTest("llm_small")} disabled={!s.configured}>
            发个 ping
          </Button>
        </Field>
      </Section>
    </>
  );
}
