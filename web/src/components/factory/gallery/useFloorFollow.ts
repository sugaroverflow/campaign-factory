"use client";

// Downward floor-follow autoscroll for the factory floor (live + replay).
//
// As the overall build grows taller the page drifts DOWN so the newest region
// stays in view. Strictly one direction: it never scrolls up and never jumps
// across columns. It starts engaged (same contract as the card backscroll
// pinning), disengages the moment the user scrolls manually (wheel / touch /
// scroll keys / an upward scrollbar drag), and re-engages when the user
// returns to the bottom of the floor.
//
// Compositor-friendly by construction:
//  - growth is detected with a ResizeObserver on the floor root (no polling);
//  - the target is measured ONCE per resize (getBoundingClientRect in the RO
//    callback, post-layout) — the rAF drift loop never reads scrollHeight;
//  - each frame does a single window.scrollTo toward the cached target.

import { useEffect, type RefObject } from "react";

const REENGAGE_PX = 64; // within this distance of the floor bottom = "returned"
const MIN_STEP_PX = 2; // slowest drift per frame (guarantees forward progress)
const DRIFT_FRACTION = 0.12; // ease toward the target: 12% of the remainder/frame

const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

/** Attach the floor-follow behaviour to the element `rootRef` points at. */
export function useFloorFollow(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let engaged = true; // starts pinned, like the backscroll
    let target = 0; // scrollY that puts the floor's bottom edge at the viewport bottom
    let raf = 0;
    let pendingProgrammatic = 0; // scroll events we caused ourselves
    let lastY = window.scrollY;

    const measureTarget = () => {
      // Post-layout in the RO callback, so this read is not a forced reflow.
      const rect = root.getBoundingClientRect();
      target = Math.max(0, Math.ceil(window.scrollY + rect.bottom - window.innerHeight));
    };

    const stopDrift = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const step = () => {
      raf = 0;
      if (!engaged) return;
      const cur = window.scrollY;
      if (cur >= target - 0.5) return; // arrived — or already past (never scroll up)
      const next = reduceMotion.matches
        ? target
        : Math.min(target, Math.ceil(cur + Math.max(MIN_STEP_PX, (target - cur) * DRIFT_FRACTION)));
      pendingProgrammatic += 1;
      window.scrollTo(0, next);
      if (next < target - 0.5) raf = requestAnimationFrame(step);
    };

    const follow = () => {
      if (engaged && !raf) raf = requestAnimationFrame(step);
    };

    const disengage = () => {
      engaged = false;
      stopDrift();
    };

    const ro = new ResizeObserver(() => {
      measureTarget();
      follow();
    });
    ro.observe(root);

    const onScroll = () => {
      const y = window.scrollY;
      const programmatic = pendingProgrammatic > 0;
      if (programmatic) pendingProgrammatic -= 1;
      if (!programmatic) {
        if (engaged && y < lastY - 1 && y < target) {
          // Manual upward movement (e.g. scrollbar drag) above the floor
          // bottom — not a document-shrink clamp. Hand control back.
          disengage();
        } else if (!engaged && target - y <= REENGAGE_PX) {
          // The user came back to the bottom: re-engage, like the backscroll.
          engaged = true;
          follow();
        }
      }
      lastY = y;
    };

    const onWheel = () => disengage();
    const onTouchMove = () => disengage();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return; // typing / activating a control, not scrolling
      }
      disengage();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      stopDrift();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef]);
}
