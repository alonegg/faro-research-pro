import type { SessionMeta } from "../api";

export type SessionGroup = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

export const GROUP_LABELS: Record<SessionGroup, string> = {
  today: "今天",
  yesterday: "昨天",
  thisWeek: "本周",
  thisMonth: "本月",
  older: "更早",
};

const DAY_MS = 86400000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function classify(date: Date, now = new Date()): SessionGroup {
  const today = startOfDay(now).getTime();
  const ts = startOfDay(date).getTime();
  if (ts === today) return "today";
  if (ts === today - DAY_MS) return "yesterday";
  if (ts >= today - 6 * DAY_MS) return "thisWeek";
  // "this month" = within current calendar month
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth())
    return "thisMonth";
  return "older";
}

export interface GroupedSessions {
  pinned: SessionMeta[];
  byGroup: Record<SessionGroup, SessionMeta[]>;
  order: SessionGroup[];
}

export function groupSessions(sessions: SessionMeta[]): GroupedSessions {
  const pinned: SessionMeta[] = [];
  const buckets: Record<SessionGroup, SessionMeta[]> = {
    today: [], yesterday: [], thisWeek: [], thisMonth: [], older: [],
  };
  const now = new Date();
  for (const s of sessions) {
    if (s.pinned) {
      pinned.push(s);
      continue;
    }
    const g = classify(new Date(s.updated_at), now);
    buckets[g].push(s);
  }
  // Pinned: most recently pinned first.
  pinned.sort((a, b) => {
    const ta = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
    const tb = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
    return tb - ta;
  });
  // Each bucket: most recent first.
  const byUpdatedDesc = (a: SessionMeta, b: SessionMeta) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  for (const k of Object.keys(buckets) as SessionGroup[]) {
    buckets[k].sort(byUpdatedDesc);
  }
  const order: SessionGroup[] = ["today", "yesterday", "thisWeek", "thisMonth", "older"];
  return { pinned, byGroup: buckets, order: order.filter((g) => buckets[g].length > 0) };
}
