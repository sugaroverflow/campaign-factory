// Per-rung aside anatomy for the Campaign Brief (original-brief redesign,
// 15 Jul 2026). Each of the twelve rungs — the ten journey steps plus the
// Sources register and the closing Next steps — gets the legacy Journey aside:
// a serif-italic title, a one-paragraph plain-English explainer of what the
// step IS, and a small bordered principle note where apt. Per user decision
// there is NO agent chip and no agent caption here — agent attribution lives
// in the Agent Build Bar during live runs.

import type { ReactNode } from "react";
import type { JourneyStepKey } from "@/lib/factory/contracts";

export interface RungCopy {
  /** Serif-italic display title (the canonical step title stays on the data). */
  title: ReactNode;
  /** Plain-English rail tooltip / mobile label. */
  short: string;
  /** One paragraph: what this step is, for a campaigner. */
  sub: string;
  /** Small bordered principle note (the legacy .limit), where one earns its place. */
  limit?: string;
}

export const STEP_COPY: Record<JourneyStepKey, RungCopy> = {
  problem: {
    title: (
      <>
        The original <span className="serif">problem</span>
      </>
    ),
    short: "Problem",
    sub: "The starting statement is treated as a hypothesis, not a brief — research tests it.",
    limit: "Research is not a campaign — everything here serves a decision, not a report.",
  },
  evidence: {
    title: (
      <>
        Researched <span className="serif">context</span>
      </>
    ),
    short: "Research",
    sub: "Live web research against authoritative UK sources. Every claim is labelled and linked in Sources.",
    limit:
      "Only what could be verified is labelled 'verified'; unverified facts are flagged, never invented.",
  },
  objective: {
    title: (
      <>
        Objective &amp; minimum viable <span className="serif">win</span>
      </>
    ),
    short: "Objective",
    sub: "The formula keeps it honest: a decision-maker, a specific action, a time, and a minimum viable win.",
    limit: "Every stage below builds on this objective — change it and the plan changes with it.",
  },
  decision_route: {
    title: (
      <>
        The decision-making <span className="serif">route</span>
      </>
    ),
    short: "Decision",
    sub: "Formal authority and practical influence are different maps. This is both.",
    limit: "Formal authority ≠ practical influence. Inferred links need confirming.",
  },
  power: {
    title: (
      <>
        Power &amp; <span className="serif">stakeholders</span>
      </>
    ),
    short: "Power",
    sub: "Who decides, who influences, who mobilises, who resists — click any stakeholder for the full profile.",
    limit: "Inferred positions are starting points for human judgement, never confirmed facts.",
  },
  pressure: {
    title: (
      <>
        Pressure <span className="serif">analysis</span>
      </>
    ),
    short: "Pressure",
    sub: "The levers that make the status quo costlier than the change the campaign asks for.",
    limit: "Pressure = making the status quo costlier than change, for THIS decision-maker.",
  },
  strategy: {
    title: (
      <>
        Campaign <span className="serif">strategy</span>
      </>
    ),
    short: "Strategy",
    sub: "Why this approach could produce the decision — not a list of outputs.",
    limit: "Constrained by real resources — no tactic assumes capacity that doesn't exist.",
  },
  tactics: {
    title: (
      <>
        Tactics &amp; <span className="serif">sequencing</span>
      </>
    ),
    short: "Tactics",
    sub: "Each tactic has a target, an owner, a success sign, and a human approval point.",
    limit: "Nothing here is sent or staged without a person approving it first.",
  },
  organising: {
    title: (
      <>
        Organising <span className="serif">people</span>
      </>
    ),
    short: "Organising",
    sub: "Who acts, why they'll take part, and the ladder that turns sympathy into work.",
    limit: "Supporters are owners, not recipients. Relationships stay human.",
  },
  documents: {
    title: (
      <>
        Campaign <span className="serif">materials</span>
      </>
    ),
    short: "Materials",
    sub: "Nine documents compiled from the accepted brief — copy or download each one when it's ready.",
    limit: "Every document reads from one shared campaign brief; regenerate any one alone.",
  },
};

/** Rung 11 — the full source register, legacy Sources-step pattern. */
export const SOURCES_COPY: RungCopy = {
  title: (
    <>
      Every <span className="serif">source</span> used
    </>
  ),
  short: "Sources",
  sub: "The full register of what the research read — organisation, link and dates for every source, grouped by how much weight it can carry.",
  limit: "Nothing invented is presented as verified — every claim links back to here.",
};

/** Rung 12 (final) — what to check before relying on the campaign. */
export const NEXT_STEPS_COPY: RungCopy = {
  title: (
    <>
      Next <span className="serif">steps</span>
    </>
  ),
  short: "Next steps",
  sub: "What the research could not settle, and the specific checks to make before you rely on the campaign materials.",
  limit: "Anything unresolved is listed here — shown, never quietly filled in.",
};
