/** Welcome state — italic serif title + 4-grid suggestions with icon + label. */

import { I } from "../ui/Icon";

interface EmptyStateProps {
  suggestions: { label: string; text: string }[];
  onPick: (s: string) => void;
}

const ICONS = [I.Activity, I.Layers, I.Sparkle, I.Compass];

export function EmptyState({ suggestions, onPick }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-mark">F</div>
      <h1 className="empty-title">
        想研究点 <em>什么</em> ?
      </h1>
      <p className="empty-sub">
        Faro 是一个为 A 股研究而生的多 Agent 工作台。问财报、问行业、问估值,
        我会拆解、调数据、复核、再回答。
      </p>
      <div className="empty-suggestions">
        {suggestions.slice(0, 4).map((s, i) => {
          const IconCmp = ICONS[i] || I.Compass;
          return (
            <button
              key={s.text}
              className="suggestion-chip"
              onClick={() => onPick(s.text)}
            >
              <div className="suggestion-chip-icon">
                <IconCmp size={12} />
              </div>
              <div className="suggestion-chip-text">
                <div className="suggestion-chip-label">{s.label}</div>
                <div>{s.text}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
