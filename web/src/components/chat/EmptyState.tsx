interface EmptyStateProps {
  suggestions: string[];
  onPick: (s: string) => void;
}

export function EmptyState({ suggestions, onPick }: EmptyStateProps) {
  return (
    <div className="thread__empty">
      <h2>问个 A 股研究问题</h2>
      <p>试试下面这些示例,或直接在底部输入你的问题</p>
      <div className="suggestions">
        {suggestions.map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
