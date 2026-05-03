import type { LiveTool } from "../../state/types";

export function ToolsTrace({
  tools,
  expanded,
}: {
  tools: LiveTool[];
  expanded: boolean;
}) {
  const running = tools.some((t) => t.status === "running");
  return (
    <details className="tools-trace" open={expanded}>
      <summary>
        工具调用 ({tools.length}
        {running && <span style={{ color: "var(--accent)" }}> · 进行中</span>})
      </summary>
      {tools.map((t) => {
        const argStr = Object.entries(t.args)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        const pillKind = t.error
          ? "neg"
          : t.status === "running"
          ? "warn"
          : "info";
        return (
          <div key={t.tool_call_id} className="tool-line">
            <span className={`tool-pill tool-pill--${pillKind}`}>{t.name}</span>{" "}
            <span>({argStr})</span>{" "}
            <span>
              {t.status === "running"
                ? "— 运行中…"
                : `— ${(t.latency_ms ?? 0).toFixed(0)} ms${
                    t.error ? `, 错误: ${t.error}` : ""
                  }`}
            </span>
          </div>
        );
      })}
    </details>
  );
}
