// Shared fixtures + DOM probes for the Campaign Factory Playwright suite.
// Not a spec (no *.spec.ts), so the runner ignores it as a test file.

import type { Page } from "@playwright/test";
// Pure, dependency-free contract modules — safe to import straight into the
// Node test process (no next/* imports), so the suite stays in lock-step with
// the same limits + roster the app renders from.
import { ALL_AGENT_DEFS } from "../../src/lib/factory/contracts/roster";
import { UI_LIMITS } from "../../src/lib/factory/contracts/limits";

export { UI_LIMITS };

// ---- Parameters (all env-overridable so preview runs reuse this suite) --------

export const PRESENTER_CODE = process.env.PW_PRESENTER_CODE || "factory-rehearsal-2026";

/** How long to wait for every campaign in a batch to reach a terminal state. */
export const TERMINAL_TIMEOUT_MS = Number(process.env.PW_TERMINAL_TIMEOUT_MS) || 5 * 60_000;

/** How long to wait for the first agent cards to appear (mock 60s / live ~120s). */
export const FIRST_CARD_TIMEOUT_MS = Number(process.env.PW_FIRST_CARD_TIMEOUT_MS) || 60_000;

// ---- Roster (the task says "import shortNames from roster.ts") ---------------
// roster.ts exports the agent definitions, not a bare `shortNames` array, so we
// derive the known-name set here. Both shortName and displayName are accepted
// because different card variants surface different forms of the agent's name.
export const ROSTER_SHORT_NAMES: string[] = ALL_AGENT_DEFS.map((d) => d.shortName);
export const ROSTER_NAMES: string[] = Array.from(
  new Set(ALL_AGENT_DEFS.flatMap((d) => [d.shortName, d.displayName])),
);

// Anchor status labels that mean the campaign is finished (honest terminal set).
export const TERMINAL_STATUS_LABELS = new Set(["Complete", "Partial", "Failed", "Cancelled"]);

// ---- The five presenter-batch fixture campaigns (gallery-inspired) -----------

export interface Intake {
  problem: string;
  place: string;
}

export const BATCH_CAMPAIGNS: Intake[] = [
  {
    problem:
      "Traffic outside St John the Baptist CofE Primary School endangers children at drop-off — a promised school street has stalled",
    place: "Leicester",
  },
  {
    problem: "Lime bike docking access to Queen Elizabeth Olympic Park is being removed",
    place: "Stratford, London",
  },
  {
    problem: "Northern line peak service cuts will strand commuters at Tooting",
    place: "Tooting, London",
  },
  {
    problem: "The 419 bus route consultation threatens the only direct link to Kingston Hospital",
    place: "Barnes, London",
  },
  {
    problem: "Thames bathing-water designation at Ham Lands is stalled despite sewage discharges",
    place: "Ham, Richmond",
  },
];

// A single public campaign for the public-intake smoke test.
export const PUBLIC_CAMPAIGN: Intake = {
  problem:
    "Make the school street outside St John the Baptist CofE Primary permanent, with proper enforcement, before the experimental order lapses.",
  place: "Leicester (St John the Baptist CofE Primary School)",
};

// ---- Gallery DOM probe -------------------------------------------------------
// One evaluate call returns a per-campaign snapshot. Selectors are structural /
// inline-style based because the components ship no data-testids and CSS-module
// class names are hashed. The stable hooks used:
//   * CampaignAnchor sets inline color #1b1d1e + borderRadius 12px (unique).
//   * Agent card wrappers carry data-agent-run-id; the expanded AgentWorkCard
//     root is exactly 300px wide (UI_LIMITS.expandedCardSize.w — a frozen
//     contract), which distinguishes it from compact (180px) and pills.
//   * The completion receipt is the global .fa-rcpt / .fa-rcpt__open (plain CSS).

export interface CampaignSnapshot {
  shortName: string;
  statusLabel: string;
  anchorBg: string;
  cardCount: number;
  expanded: number;
  backscrollRows: number;
  cardTexts: string[];
  hasReceipt: boolean;
  receiptTitle: string | null;
  receiptTag: string | null;
}

export async function snapshotGallery(page: Page): Promise<CampaignSnapshot[]> {
  return page.evaluate(() => {
    const isAnchor = (d: HTMLElement) =>
      d.style && d.style.color === "rgb(27, 29, 30)" && d.style.borderRadius === "12px";
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("div")).filter(isAnchor);

    return anchors.map((a) => {
      const spans = Array.from(a.querySelectorAll<HTMLElement>("span"));
      let shortName = "";
      let statusLabel = "";
      for (const s of spans) {
        const fw = s.style.fontWeight;
        const fs = parseFloat(s.style.fontSize || "0");
        if (!shortName && fw === "600" && fs >= 15) shortName = (s.textContent || "").trim();
        if (!statusLabel && s.style.textTransform === "uppercase" && s.style.fontSize === "10px")
          statusLabel = (s.textContent || "").trim();
      }

      const col = a.parentElement as HTMLElement | null;
      const wrappers = col
        ? Array.from(col.querySelectorAll<HTMLElement>("[data-agent-run-id]"))
        : [];
      let expanded = 0;
      const cardTexts: string[] = [];
      for (const w of wrappers) {
        const card = w.firstElementChild as HTMLElement | null;
        if (card && card.style.width === "300px") expanded += 1;
        cardTexts.push((w.textContent || "").trim());
      }

      // Work Backscroll rows use a unique inline padding of "1.5px 0" — count
      // them so the liveness assertion can watch rows accumulate over time.
      const backscrollRows = col
        ? Array.from(col.querySelectorAll<HTMLElement>("[data-agent-run-id] *")).filter(
            (el) => (el.style.padding || "").startsWith("1.5px"),
          ).length
        : 0;

      const receipt = col ? col.querySelector<HTMLElement>(".fa-rcpt") : null;
      const receiptTitle = receipt?.querySelector(".fa-rcpt__title")?.textContent?.trim() ?? null;
      const receiptTag = receipt?.querySelector(".tag")?.textContent?.trim() ?? null;

      return {
        shortName,
        statusLabel,
        anchorBg: getComputedStyle(a).backgroundColor,
        cardCount: wrappers.length,
        expanded,
        backscrollRows,
        cardTexts,
        hasReceipt: !!receipt,
        receiptTitle,
        receiptTag,
      } satisfies CampaignSnapshot;
    });
  });
}

/** Total expanded agent cards across the whole gallery (the ≤10 global cap). */
export function totalExpanded(snap: CampaignSnapshot[]): number {
  return snap.reduce((n, c) => n + c.expanded, 0);
}

/** Total agent-card wrappers across the whole gallery. */
export function totalCards(snap: CampaignSnapshot[]): number {
  return snap.reduce((n, c) => n + c.cardCount, 0);
}

/** Total Work Backscroll rows across the whole gallery. */
export function totalBackscrollRows(snap: CampaignSnapshot[]): number {
  return snap.reduce((n, c) => n + c.backscrollRows, 0);
}

/** A campaign is terminal when it shows a receipt or a terminal anchor status. */
export function isCampaignTerminal(c: CampaignSnapshot): boolean {
  return c.hasReceipt || TERMINAL_STATUS_LABELS.has(c.statusLabel);
}

/** Fabrication-tell scan: no bare undefined / null / NaN in visible text. */
export async function visibleTextHasFabricationTell(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => document.body.innerText || "");
  const m = text.match(/\b(undefined|null|NaN)\b/);
  return m ? m[0] : null;
}
