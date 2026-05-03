/** Scroll container with auto-scroll-to-bottom on new messages.
 *
 *  Children compose freely — Thread doesn't know about messages; the parent
 *  decides what to render inside. */

import { useEffect, useRef, type ReactNode } from "react";

interface ThreadProps {
  scrollKey: unknown; // bump this to trigger auto-scroll (turns or history)
  children: ReactNode;
}

export function Thread({ scrollKey, children }: ThreadProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollKey]);

  return (
    <div className="thread-wrap" ref={wrapRef}>
      <div className="thread">{children}</div>
    </div>
  );
}
