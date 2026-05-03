import { motion } from "framer-motion";
import type { PhaseEvent } from "../../state/types";

export function PhaseTag({ phase, round, status }: PhaseEvent) {
  const label = phase === "researcher" ? "Researcher" : "Risk Reviewer";
  return (
    <motion.div
      className={`phase-tag phase-tag--${phase}`}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <span className="dot" />
      {label} · 第 {round} 轮{status === "running" ? "（运行中）" : ""}
    </motion.div>
  );
}
