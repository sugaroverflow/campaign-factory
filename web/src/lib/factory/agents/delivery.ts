// Steps 8–9: Tactics & Sequencing Planner and Organising Designer.
// Both work from accepted strategy + constraints (no web tools). Sonnet 5 medium.

import { A, int, S, str, strA } from "./schema";
import { NO_SYNTHETIC_DATA, PLACE_DISCIPLINE } from "./shared";
import { makeSectionContract } from "./builders";

const DELIVERY_TAIL = [NO_SYNTHETIC_DATA, PLACE_DISCIPLINE];

// ---- Step 8: Tactics & Sequencing Planner ---------------------------------
const tacticItem = S(
  {
    name: str,
    phase: int,
    type: str,
    purpose: str,
    target: str,
    owner: str,
    pressure: str,
    resources: str,
    timing: str,
    dependencies: str,
    expected: str,
    success: str,
    next: str,
    escalation: str,
    approval: str,
  },
  ["name", "phase", "type", "purpose", "target", "owner", "timing", "success"],
);

const tacticsContent = S({ tactics: A(tacticItem) });

export const tacticsPlanner = makeSectionContract({
  key: "tactics_planner",
  step: 8,
  contentField: "tactics",
  contentSchema: tacticsContent,
  summary: "Sequenced tactics with dependencies, owners, success signs, and escalation",
  tail: DELIVERY_TAIL,
  role: `You are the Tactics & Sequencing Planner for Campaign Factory. From the accepted strategy and constraints, produce 7–9 sequenced tactics (a mix of conventional, creative, and tech-enabled; private engagement before public pressure unless the evidence says otherwise).
- Each tactic NAMES its target, owner, purpose, the pressure it applies, its timing/phase, its dependencies, the success sign, what comes next, and any approval needed.
- Escalation conditions are HUMAN decisions at review points — nothing fires automatically.
- Reject generic tactics. If a tactic depends on a resource the campaign may not have, say so under approval/dependencies rather than assuming it.`,
});

// ---- Step 9: Organising Designer ------------------------------------------
// Field names mirror PLAN_SCHEMA.organising; all optional in w1's reducer, so
// only a meaningful floor is required here.
const organisingContent = S(
  {
    whoActs: str,
    whyParticipate: str,
    asks: strA,
    roles: A(S({ role: str, what: str })),
    coalition: strA,
    oneToOne: strA,
    outreach: str,
    event: str,
    ladder: A(S({ rung: str, action: str })),
    channels: strA,
    followup: str,
    sustain: str,
    metrics: strA,
    humanEssential: strA,
  },
  ["whoActs", "asks", "ladder"],
);

export const organisingDesigner = makeSectionContract({
  key: "organising_designer",
  step: 9,
  contentField: "organising",
  contentSchema: organisingContent,
  summary: "Actors, asks, engagement ladder, relational work, capacity, and follow-up",
  tail: DELIVERY_TAIL,
  role: `You are the Organising Designer for Campaign Factory. From the accepted strategy, tactics, and the user's stated resources, design how real people are organised:
- who acts and why they would participate;
- the asks and the ladder of engagement (from lowest-commitment to leadership);
- relational organising and one-to-ones; coalition work;
- outreach, a signature event or moment, channels, follow-up, and how the effort is sustained;
- campaign and organising metrics; and what is HUMAN-ESSENTIAL (work that must be done by people, not automated).
Be specific and realistic about capacity limits. Do not invent membership numbers, turnout figures, or named volunteers.`,
});
