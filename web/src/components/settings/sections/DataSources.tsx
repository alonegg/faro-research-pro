import type { SettingsStatus } from "../../../api";
import { Button } from "../../ui/Button";
import { Field, ReadOnly, Section } from "../Field";

export function DataSourcesSection({
  status, onTest,
}: {
  status: SettingsStatus;
  onTest: (kind: "tushare" | "fd_ai") => void;
}) {
  const ds = status.data_sources;
  return (
    <>
      <Section title="Tushare (A 股 / 港股)" hint="行情 / 三大表 / 估值 / 高管交易。修改需改 .env 后重启。">
        <Field label="Token"><ReadOnly value={ds.tushare.token_masked} mono /></Field>
        <Field label="已加载工具数"><ReadOnly value={ds.tushare.tools_loaded} /></Field>
        <Field label="连接测试">
          <Button variant="ghost" size="sm" onClick={() => onTest("tushare")}>
            拉一次 stock_basic
          </Button>
        </Field>
      </Section>

      <Section title="Financial Datasets AI (美股)" hint="美股行情 / 财报 / 内部交易等。问 NVDA 这种问题用这个。">
        <Field label="API Key"><ReadOnly value={ds.fd_ai.key_masked || "—"} mono /></Field>
        <Field label="状态"><ReadOnly value={ds.fd_ai.configured ? "已配置" : "未配置"} /></Field>
        <Field label="连接测试">
          <Button variant="ghost" size="sm" onClick={() => onTest("fd_ai")} disabled={!ds.fd_ai.configured}>
            查 AAPL 报价
          </Button>
        </Field>
      </Section>

      <Section title="AKShare (兜底)" hint="Tushare 没的字段或限流时的兜底数据源。Python 包,装了就用。">
        <Field label="是否可用"><ReadOnly value={ds.akshare.available} /></Field>
      </Section>
    </>
  );
}
