"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// One-way scroll-reveal (the awake-prototype choreography, rebuilt in React).
// A section fades/rises into place the first time it enters the viewport band and
// never re-hides. Children with data-anim get staggered delays via CSS.
export function Reveal({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return;
    // Respect reduced-motion: reveal immediately.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      queueMicrotask(() => {
        if (!cancelled) setOn(true);
      });
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setOn(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: "-10% 0px -20% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as "section";
  return (
    <Comp ref={ref as React.Ref<HTMLElement>} data-on={on ? "1" : "0"} className={`cf-reveal ${className}`}>
      {children}
    </Comp>
  );
}
