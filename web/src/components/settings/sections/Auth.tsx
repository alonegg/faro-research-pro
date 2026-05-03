import { toast } from "sonner";
import type { SettingsStatus } from "../../../api";
import { setApiKey } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section } from "../Field";

export function AuthSection({ status }: { status: SettingsStatus }) {
  const u = status.auth.current_user;
  return (
    <>
      <Section title="鉴权状态">
        <Field label="服务端要求 token">
          <ReadOnly value={status.auth.required ? "✓ 是 (FARO_AUTH_REQUIRED=1)" : "✗ 否 (单用户模式)"} />
        </Field>
        <Field label="当前用户 ID"><ReadOnly value={u.id} mono /></Field>
        <Field label="邮箱"><ReadOnly value={u.email} /></Field>
        <Field label="角色"><ReadOnly value={u.role} /></Field>
      </Section>

      {status.auth.required && (
        <Section title="API Key" hint="API key 仅存在你浏览器的 localStorage; 不会上传到第三方。">
          <Field label="退出登录">
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                toast("退出当前 API key?", {
                  action: {
                    label: "退出",
                    onClick: () => { setApiKey(""); location.reload(); },
                  },
                  duration: 6000,
                })
              }
            >
              清除 key 并退出
            </Button>
          </Field>
        </Section>
      )}

      <Section title="版本">
        <Field label="Pro"><ReadOnly value={`v${status.version.pro}`} mono /></Field>
        <Field label="OSS"><ReadOnly value={`v${status.version.oss}`} mono /></Field>
      </Section>
    </>
  );
}
