// Steps 3–6: the analysis backbone. Each writes exactly one brief section from
// accepted evidence + state (no web tools). Parameters §2 fixed-backbone table.

import { VERIFICATION_LABELS } from "../../pipeline/labels";
import { A, enumStr, S, str, strA } from "./schema";
import { EVIDENCE_RULES, NO_SYNTHETIC_DATA, PLACE_DISCIPLINE } from "./shared";
import { makeSectionContract } from "./builders";

const ANALYSIS_TAIL = [NO_SYNTHETIC_DATA, EVIDENCE_RULES, PLACE_DISCIPLINE];

// ---- Step 3: Objective & Theory-of-Change Strategist ----------------------
// Field names mirror the PLAN_SCHEMA objective (dm, mvw, smart) so W4 and the
// document compiler render it unchanged; theoryOfChange is an extra field that
// w1's reducer preserves.
const objectiveContent = S(
  {
    dm: str,
    action: str,
    by: str,
    mvw: str,
    success: str,
    constraints: strA,
    theoryOfChange: str,
    smart: A(S({ test: str, assessment: str })),
  },
  ["dm", "action"],
);

export const objectiveStrategist = makeSectionContract({
  key: "objective_strategist",
  step: 3,
  contentField: "objective",
  contentSchema: objectiveContent,
  summary: "Objective, theory of change, and interim win",
  tail: ANALYSIS_TAIL,
  role: `You are the Objective & Theory-of-Change Strategist for Campaign Factory (UK local/public-policy campaigns). From the accepted problem, evidence, and decision route, set ONE specific objective using the formula: "We want [named decision-maker or role] to [specific action] by [time], even if the immediate outcome is only [minimum viable win]." Then give the theory of change (why that action follows from this pressure), the success conditions, real constraints, and a MEANINGFUL interim win.
- Reject Token Wins: a "win" that does not move formal authority, build durable capacity, or materially raise the cost of the status quo is not acceptable — say so and propose a real one instead.
- The decision-maker must be a named role or office (use the role, not an invented name) drawn from the accepted decision route; the action must be concrete; the timeframe must be a real date/window from the evidence or an explicit "no date is set — this is a gap".
- Each SMART test states how the objective is measured and your honest assessment of whether it currently meets that test.`,
});

// ---- Step 4: Decision Route Agent -----------------------------------------
// Field names mirror ResearchResult.decisionMaker (formal, practical,
// processes, deadlines); `stages` is an extra field w1's reducer preserves.
const decisionRouteContent = S(
  {
    formal: str,
    implementer: str,
    practical: str,
    processes: strA,
    stages: A(S({ name: str, what: str, dateStatus: str })),
    interventionPoints: strA,
    deadlines: strA,
    unresolved: strA,
  },
  ["formal"],
);

export const decisionRoute = makeSectionContract({
  key: "decision_route",
  step: 4,
  contentField: "route",
  contentSchema: decisionRouteContent,
  summary: "Formal authority, stages, dates, and intervention points",
  tail: ANALYSIS_TAIL,
  role: `You are the Decision Route Agent for Campaign Factory. Map the FORMAL route by which this decision is actually made and implemented, using accepted evidence (and, if your tool policy authorises it, one official-record fetch plus one targeted search — never guess a route).
- Identify: who holds formal authority, who implements, who has practical influence, the ordered stages, the intervention points where a campaign can act, and the key dates.
- For every date, state its status honestly: confirmed from an official source, indicative, or "no date set / not found". Never invent a committee date or deadline.
- List unresolved route questions rather than papering over them. If the correct institution differs from the user's assumption, say so.`,
});

// ---- Step 5: Power & Stakeholder Agent ------------------------------------
const stakeholderSchema = S(
  {
    name: str,
    org: str,
    role: str,
    tier: enumStr(["decides", "influences", "mobilises", "resists", "neutral"]),
    power: enumStr(["High", "Medium-High", "Medium", "Low-Medium", "Low"]),
    position: str,
    positionStatus: enumStr(VERIFICATION_LABELS),
    relationship: str,
    cares: str,
    ask: str,
    approach: str,
    evidence: str,
    confidence: enumStr(["High", "Medium", "Low"]),
  },
  // `name` is required by w1's reducer schema — role title, never an invented
  // person (see the power agent's prompt + normalizeContent backstop).
  ["name", "org", "role", "tier", "power", "position", "positionStatus", "ask"],
);

const powerContent = S(
  {
    stakeholders: A(stakeholderSchema),
    statusQuoCost: str,
    localKnowledgeGaps: strA,
  },
  ["stakeholders"],
);

export const powerStakeholder = makeSectionContract({
  key: "power_stakeholder",
  step: 5,
  contentField: "power",
  contentSchema: powerContent,
  summary: "Role-based power map with positions, relationships, and asks",
  tail: ANALYSIS_TAIL,
  role: `You are the Power & Stakeholder Agent for Campaign Factory. Build a role-based power map (8–12 stakeholders) from accepted evidence and attributed local context.
- Each stakeholder MUST have a name: use the ROLE TITLE as the name (e.g. "Cabinet Lead for Transport", "Headteacher"). Use a person's actual name ONLY if it was verified during research and is in the accepted evidence — NEVER invent a personal name. Also give the ORG and ROLE category, their power level, their tier (decides / influences / mobilises / resists / neutral), their position, the ASK you would make of them, and how you would approach them.
- positionStatus MUST carry an honest verification label. An inferred position is "Supported inference", never "Verified public information". Never present a guessed stance as confirmed.
- Record local-knowledge gaps: what a person on the ground would know that the evidence does not tell you.`,
  // w1's reducer requires every stakeholder to carry a `name` string. The prompt
  // asks for a role-title name, but if the model omits it we fall back to the
  // role, then org — never fabricating a personal name — so the section is never
  // rejected for a missing name.
  normalizeContent: (c) => {
    const list = Array.isArray(c.stakeholders) ? c.stakeholders : [];
    const pick = (o: Record<string, unknown>, k: string) =>
      typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string) : "";
    return {
      ...c,
      stakeholders: list.map((s) => {
        const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
        const name = pick(o, "name") || pick(o, "role") || pick(o, "org") || "Stakeholder";
        return { ...o, name };
      }),
    };
  },
});

// ---- Step 6: Pressure Analysis Agent --------------------------------------
const pressureItem = S(
  {
    type: enumStr(["electoral", "reputational", "institutional", "legal", "operational", "relational"]),
    on: str,
    why: str,
    whoApplies: str,
    channel: str,
    boundary: enumStr(["evidence", "inference"]),
    evidence: str,
    action: str,
  },
  ["type", "on", "why", "whoApplies", "channel", "boundary"],
);

const pressureContent = S({ pressures: A(pressureItem), statusQuoCost: str }, ["pressures"]);

export const pressureAnalysis = makeSectionContract({
  key: "pressure_analysis",
  step: 6,
  contentField: "pressure",
  contentSchema: pressureContent,
  summary: "Electoral, reputational, institutional, legal, operational pressures",
  tail: ANALYSIS_TAIL,
  role: `You are the Pressure Analysis Agent for Campaign Factory. Working from accepted state ONLY, map what makes the status quo costlier than change FOR THIS SPECIFIC decision-maker: electoral, reputational, institutional, legal, operational, and relational pressures.
- For each pressure: who it bears on, why it bites for this decision-maker, who can apply it, and through which channel.
- Mark the evidence/inference boundary explicitly: "evidence" when it rests on an accepted verified claim, "inference" when it is your reasoning. Never blur the two.
- Summarise the overall cost of the status quo. Do not invent polling, margins, or figures — if a pressure depends on a number you do not have, say so and mark it a gap.`,
});
