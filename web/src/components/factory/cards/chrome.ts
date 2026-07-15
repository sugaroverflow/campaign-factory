// Shared visual constants for the dark-ink translucent overlay. Cards sit over
// the light Awake page, so they are dark and translucent to layer spatially —
// not a second dark app. Monospace uses the app's Geist Mono (--font-mono).

import type { CSSProperties } from "react";
import { UI_LIMITS } from "@/lib/factory/contracts";

export const INK = {
  surface: "rgba(22, 24, 27, 0.9)",
  surfaceCompact: "rgba(22, 24, 27, 0.86)",
  border: "rgba(255, 255, 255, 0.09)",
  text: "#f2f3f5",
  textMuted: "rgba(242, 243, 245, 0.62)",
  textFaint: "rgba(242, 243, 245, 0.42)",
  rowBorder: "rgba(255, 255, 255, 0.06)",
} as const;

export const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

export const EXPANDED = UI_LIMITS.expandedCardSize; // { w: 300, h: 190 }
export const COMPACT = UI_LIMITS.compactCardSize; // { w: 180, h: 96 }

// Status → a small legible dot colour on the dark surface.
export function statusDot(status: string): string {
  switch (status) {
    case "running":
      return "#8ad0ff";
    case "complete":
      return "#8fe08a";
    case "partial":
      return "#f6d873";
    case "failed":
      return "#ff8a8a";
    case "queued":
    default:
      return "rgba(242,243,245,0.4)";
  }
}
