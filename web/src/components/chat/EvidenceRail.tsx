/** Right-side floating panel listing tool-call sources behind the
 *  current answer. Inline [N] citation markers in the answer body
 *  link here via the highlight prop. */

import type { ToolCallSummary } from "../../api";
import { I } from "../ui/Icon";

export interface EvidenceItem {
  tool: string;
  title: string;
  detail: string;
}

interface RailProps {
  visible: boolean;
  items: EvidenceItem[];
  highlight: number | null;  // 1-based citation index to highlight
  onClose: () => void;
}

/** Convert raw tool_calls into compact evidence items.
 *  The frontend doesn't have rich citation data, so this is best-effort
 *  derived from tool name + first arg. */
export function deriveEvidence(toolCalls: ToolCallSummary[] | undefined): EvidenceItem[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls
    .filter((c) => !c.error)
    .map((c) => {
      const args = Object.entries(c.args || {})
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      const sizeKb = (c.result_chars / 1024).toFixed(1);
      return {
        tool: c.name,
        title: args || c.name,
        detail: `${c.latency_ms.toFixed(0)} ms · ${sizeKb} KB`,
      };
    });
}

export function EvidenceRail({ visible, items, highlight, onClose }: RailProps) {
  return (
    <div className={`evidence-rail ${visible ? "visible" : ""}`}>
      <div className="evidence-rail-head">
        <I.Compass size={14} style={{ color: "var(--accent)" }} />
        <span className="evidence-rail-title">证据</span>
        <span className="evidence-rail-count">{items.length}</span>
        <button
          className="icon-btn"
          style={{ width: 24, height: 24, marginLeft: "auto" }}
          onClick={onClose}
          title="关闭"
          aria-label="关闭证据面板"
        >
          <I.Close size={12} />
        </button>
      </div>
      <div className="evidence-rail-list">
        {items.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: 11.5, color: "var(--ink-3)", textAlign: "center" }}>
            该回答没有外部证据
          </div>
        )}
        {items.map((it, i) => (
          <div
            key={i}
            id={`evidence-${i + 1}`}
            className="evidence-item"
            style={highlight === i + 1 ? {
              background: "var(--accent-softer)",
              outline: "1px solid var(--accent)",
            } : undefined}
          >
            <div className="evidence-item-head">
              <span className="evidence-item-num">[{i + 1}]</span>
              <span className="evidence-item-tool">{it.tool}</span>
            </div>
            <div className="evidence-item-title">{it.title}</div>
            <div className="evidence-item-detail">{it.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
