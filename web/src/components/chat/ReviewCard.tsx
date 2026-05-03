import { motion } from "framer-motion";
import type { ReviewVerdict } from "../../state/types";

export function ReviewCard({ review }: { review: ReviewVerdict }) {
  return (
    <motion.div
      className={`review-card review-card--${review.verdict}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="verdict">
        {review.verdict === "approve" ? "✓ 通过" : "↺ 退回修改"}
        <span style={{ marginLeft: 8, color: "var(--ink-3)", fontWeight: 500 }}>
          (评分 {review.score}/10 · 第 {review.round} 轮)
        </span>
      </div>
      <div className="summary">{review.summary}</div>
      {review.issues.length > 0 && (
        <ul>
          {review.issues.slice(0, 5).map((it, i) => (
            <li key={i}><span className="cat">[{it.category}]</span> {it.detail}</li>
          ))}
          {review.issues.length > 5 && (
            <li style={{ color: "var(--ink-3)" }}>...另 {review.issues.length - 5} 条</li>
          )}
        </ul>
      )}
    </motion.div>
  );
}
