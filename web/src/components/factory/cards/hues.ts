// The five campaign hues. These are the existing Awake pastel/brand accents
// (globals.css): brand purple-blue, pastel blue, pastel green, pastel purple,
// pale yellow. Each campaign owns exactly one; its agents, pills, and connector
// lines inherit it. No new colours are introduced (parameters §6).

import type { CampaignHueIndex } from "./types";

export interface CampaignHue {
  index: CampaignHueIndex;
  name: string; // debug/aria only
  accent: string; // strong hue — identity edge, connector stroke, pill text on dark
  softBg: string; // low-alpha hue for a pill background on a dark card
  edgeGlowless: string; // slightly translucent accent for the card's identity edge
  anchorTint: string; // light tint for the OPAQUE campaign anchor background
  anchorBorder: string; // anchor border in the hue
}

// Awake accents (verified in web/src/app/globals.css):
//   brand #4928fd · pastel-blue #70b5ff · pastel-green #79d45e ·
//   pastel-purple #ba81ee · pale-yellow #f6e683
export const CAMPAIGN_HUES: readonly CampaignHue[] = [
  {
    index: 0,
    name: "brand",
    accent: "#6f57ff", // brand #4928fd lifted for legibility on dark ink
    softBg: "rgba(111, 87, 255, 0.18)",
    edgeGlowless: "rgba(111, 87, 255, 0.85)",
    anchorTint: "#eeeafe",
    anchorBorder: "rgba(73, 40, 253, 0.35)",
  },
  {
    index: 1,
    name: "blue",
    accent: "#70b5ff",
    softBg: "rgba(112, 181, 255, 0.20)",
    edgeGlowless: "rgba(112, 181, 255, 0.9)",
    anchorTint: "#d9f3fc",
    anchorBorder: "rgba(56, 132, 214, 0.35)",
  },
  {
    index: 2,
    name: "green",
    accent: "#79d45e",
    softBg: "rgba(121, 212, 94, 0.20)",
    edgeGlowless: "rgba(121, 212, 94, 0.9)",
    anchorTint: "#e6f7de",
    anchorBorder: "rgba(60, 150, 40, 0.35)",
  },
  {
    index: 3,
    name: "purple",
    accent: "#ba81ee",
    softBg: "rgba(186, 129, 238, 0.20)",
    edgeGlowless: "rgba(186, 129, 238, 0.9)",
    anchorTint: "#f2e9fb",
    anchorBorder: "rgba(140, 70, 200, 0.35)",
  },
  {
    index: 4,
    name: "yellow",
    accent: "#f6e683",
    softBg: "rgba(246, 230, 131, 0.22)",
    edgeGlowless: "rgba(246, 230, 131, 0.95)",
    anchorTint: "#fdf1d3",
    anchorBorder: "rgba(168, 106, 0, 0.35)",
  },
] as const;

export function hueByIndex(i: CampaignHueIndex): CampaignHue {
  return CAMPAIGN_HUES[i] ?? CAMPAIGN_HUES[0];
}

// Assign a hue index by campaign order (intake order 0..4). A sixth campaign is
// never enterable, so the modulo is defensive only.
export function hueIndexForPosition(position: number): CampaignHueIndex {
  return (((position % CAMPAIGN_HUES.length) + CAMPAIGN_HUES.length) %
    CAMPAIGN_HUES.length) as CampaignHueIndex;
}
