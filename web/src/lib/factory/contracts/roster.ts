// Runtime Agent roster (parameters §2, ADR 0004): 13 fixed responsibilities,
// 6 registered specialists, hard caps. One Runtime Agent = one independently
// invoked model process with a named contract and its own agentRunId.
// Deterministic validators/reducers/schedulers/compilers are never agents.

export const SOFT_TARGET_AGENTS = 15;
export const HARD_CAP_AGENTS = 20;
export const DEFAULT_SPECIALISTS = 2;
export const MAX_SPECIALISTS = 4;

export type AgentModel = "claude-sonnet-5" | "claude-opus-4-8" | "claude-haiku-4-5";
export type AgentEffort = "high" | "medium" | "low";

export type ToolPolicy =
  | "none" // accepted state only
  | "geo_lookup" // postcode/geography (deterministic, keyless)
  | "search_discovery" // ≤2 discovery searches (Research Director)
  | "search_specialist" // ≤4 searches (selected specialists)
  | "adjudication" // ≤2 targeted searches + re-fetches (Evidence Adjudicator)
  | "official_record"; // official-record fetch + 1 targeted search if authorised

export interface AgentDef {
  key: AgentKey;
  displayName: string;
  shortName: string; // fits a compact card
  kind: "fixed" | "specialist";
  responsibility: string; // one line, shown on the card
  model: AgentModel;
  effort: AgentEffort;
  maxOutputTokens: number;
  inputTokenBudget: number;
  timeoutMs: number;
  toolPolicy: ToolPolicy;
  searchBudget: number; // Anthropic web searches this agent may spend
  journeySteps: number[]; // steps this agent primarily serves
}

export type FixedAgentKey =
  | "research_director"
  | "evidence_adjudicator"
  | "objective_strategist"
  | "decision_route"
  | "power_stakeholder"
  | "pressure_analysis"
  | "strategy_architect"
  | "tactics_planner"
  | "organising_designer"
  | "lobbying_producer"
  | "media_producer"
  | "digital_producer"
  | "synthesis_reviewer";

export type SpecialistKey =
  | "local_government"
  | "parliamentary"
  | "public_body"
  | "planning"
  | "local_media"
  | "precedent_opposition";

export type AgentKey = FixedAgentKey | SpecialistKey;

export const FIXED_AGENTS: readonly AgentDef[] = [
  {
    key: "research_director",
    displayName: "Campaign Interpreter & Research Director",
    shortName: "Research Director",
    kind: "fixed",
    responsibility: "Scopes the problem and place, sets research questions, selects specialists",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 16000,
    inputTokenBudget: 20000,
    timeoutMs: 420000,
    toolPolicy: "search_discovery",
    searchBudget: 1,
    journeySteps: [1, 2],
  },
  {
    key: "evidence_adjudicator",
    displayName: "Evidence Adjudicator",
    shortName: "Evidence Adjudicator",
    kind: "fixed",
    responsibility: "Decides claim status: confirmed, qualified, conflicted, not found, or stale",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 16000,
    inputTokenBudget: 50000,
    timeoutMs: 420000,
    toolPolicy: "adjudication",
    searchBudget: 1,
    journeySteps: [2],
  },
  {
    key: "objective_strategist",
    displayName: "Objective & Theory-of-Change Strategist",
    shortName: "Objective Strategist",
    kind: "fixed",
    responsibility: "Sets the specific objective, theory of change, and a meaningful interim win",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [3],
  },
  {
    key: "decision_route",
    displayName: "Decision Route Agent",
    shortName: "Decision Route",
    kind: "fixed",
    responsibility: "Maps formal authority, stages, implementer, dates, and intervention points",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 360000,
    toolPolicy: "official_record",
    searchBudget: 1,
    journeySteps: [4],
  },
  {
    key: "power_stakeholder",
    displayName: "Power & Stakeholder Agent",
    shortName: "Power Map",
    kind: "fixed",
    responsibility: "Builds the role-based power map with positions, relationships, and asks",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [5],
  },
  {
    key: "pressure_analysis",
    displayName: "Pressure Analysis Agent",
    shortName: "Pressure Analysis",
    kind: "fixed",
    responsibility: "Maps electoral, reputational, institutional, legal, and operational pressures",
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [6],
  },
  {
    key: "strategy_architect",
    displayName: "Campaign Strategy Architect",
    shortName: "Strategy Architect",
    kind: "fixed",
    responsibility: "Designs narrative, audiences, coalition, phases, escalation, and trade-offs",
    model: "claude-opus-4-8",
    effort: "high",
    maxOutputTokens: 16000,
    inputTokenBudget: 60000,
    timeoutMs: 360000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [7],
  },
  {
    key: "tactics_planner",
    displayName: "Tactics & Sequencing Planner",
    shortName: "Tactics Planner",
    kind: "fixed",
    responsibility: "Sequences tactics with dependencies, owners, success signs, and escalation",
    model: "claude-sonnet-5",
    effort: "medium",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [8],
  },
  {
    key: "organising_designer",
    displayName: "Organising Designer",
    shortName: "Organising Designer",
    kind: "fixed",
    responsibility: "Designs actors, asks, ladder, relational work, capacity, and follow-up",
    model: "claude-sonnet-5",
    effort: "medium",
    maxOutputTokens: 12000,
    inputTokenBudget: 35000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [9],
  },
  {
    key: "lobbying_producer",
    displayName: "Lobbying Producer",
    shortName: "Lobbying Producer",
    kind: "fixed",
    responsibility: "Produces the Lobbying Pack with evidence references and verification placeholders",
    model: "claude-sonnet-5",
    effort: "medium",
    maxOutputTokens: 16000,
    inputTokenBudget: 40000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [10],
  },
  {
    key: "media_producer",
    displayName: "Media Producer",
    shortName: "Media Producer",
    kind: "fixed",
    responsibility: "Produces the Media Pack; role-attributed draft quotes only; flags reputational risk",
    model: "claude-sonnet-5",
    effort: "medium",
    maxOutputTokens: 16000,
    inputTokenBudget: 40000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [10],
  },
  {
    key: "digital_producer",
    displayName: "Digital Producer",
    shortName: "Digital Producer",
    kind: "fixed",
    responsibility: "Produces the Digital Campaign Pack; coarse public audiences, no personal targeting",
    model: "claude-sonnet-5",
    effort: "medium",
    maxOutputTokens: 16000,
    inputTokenBudget: 40000,
    timeoutMs: 240000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [10],
  },
  {
    key: "synthesis_reviewer",
    displayName: "Campaign Synthesis Reviewer",
    shortName: "Synthesis Reviewer",
    kind: "fixed",
    responsibility: "Accepts, returns once, or rejects proposals; writes Step Reports; preserves dissent",
    // One recurring campaign-scoped identity (ADR 0003). Sonnet 5 for ordinary
    // step closure; the runtime upgrades to Opus 4.8 for the strategy review
    // and the final whole-campaign review.
    model: "claude-sonnet-5",
    effort: "high",
    maxOutputTokens: 12000,
    inputTokenBudget: 80000,
    timeoutMs: 360000,
    toolPolicy: "none",
    searchBudget: 0,
    journeySteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
] as const;

export const REVIEWER_OPUS_MODEL: AgentModel = "claude-opus-4-8";
export const REVIEWER_OPUS_STEPS = [7, 10]; // strategy review + final review

export interface SpecialistDef extends AgentDef {
  key: SpecialistKey;
  kind: "specialist";
  useWhen: string; // selection criterion shown in ScopeBrief reasoning
}

const specialistBase = {
  kind: "specialist" as const,
  model: "claude-sonnet-5" as const,
  effort: "high" as const,
  maxOutputTokens: 16000,
  inputTokenBudget: 20000,
  timeoutMs: 420000,
  toolPolicy: "search_specialist" as const,
  searchBudget: 2,
  journeySteps: [2],
};

export const SPECIALIST_CATALOGUE: readonly SpecialistDef[] = [
  {
    ...specialistBase,
    key: "local_government",
    displayName: "Local Government & Council Records Specialist",
    shortName: "Council Records",
    responsibility: "Finds authority, committee, delegation, minutes, papers, and dates",
    useWhen: "council, combined authority, mayoral, or local service decision",
  },
  {
    ...specialistBase,
    key: "parliamentary",
    displayName: "Parliamentary & Constituency Specialist",
    shortName: "Parliamentary",
    responsibility: "Maps the parliamentary route, office roles, proceedings, constituency relevance",
    useWhen: "MP, minister, department, bill, committee, or parliamentary process",
  },
  {
    ...specialistBase,
    key: "public_body",
    displayName: "Public Body, Policy & Regulation Specialist",
    shortName: "Public Body",
    responsibility: "Finds statutory remit, policy, regulation, accountable office, formal routes",
    useWhen: "regulator, NHS body, transport body, agency, or quango",
  },
  {
    ...specialistBase,
    key: "planning",
    displayName: "Planning, Development & Consultation Specialist",
    shortName: "Planning",
    responsibility: "Tracks application/consultation status, decision route, dates, representations",
    useWhen: "application, local plan, development, or statutory consultation",
  },
  {
    ...specialistBase,
    key: "local_media",
    displayName: "Local Media & Community Context Specialist",
    shortName: "Local Context",
    responsibility: "Gathers attributed context, candidate organisations, local media, disputed claims",
    useWhen: "local narrative, affected organisations, or public controversy",
  },
  {
    ...specialistBase,
    key: "precedent_opposition",
    displayName: "Precedent & Opposition Specialist",
    shortName: "Precedent",
    responsibility: "Finds comparable precedents, transfer limits, counterarguments, evidence quality",
    useWhen: "comparable campaign, prior decision, or likely institutional objection",
  },
] as const;

export const ALL_AGENT_DEFS: readonly AgentDef[] = [...FIXED_AGENTS, ...SPECIALIST_CATALOGUE];

export function agentDef(key: AgentKey): AgentDef {
  const def = ALL_AGENT_DEFS.find((a) => a.key === key);
  if (!def) throw new Error(`Unknown agent key: ${key}`);
  return def;
}

// ---- Express profile (derived view, NOT a duplicate roster) -----------------
// Same 13 responsibilities, same contracts; lighter execution for the audience
// path (typical ≤12 min, hard 15 min): Sonnet strategy instead of Opus, medium
// effort for the analysis wave, decision_route loses its search, and output
// budgets are capped at ~8k. Selection of ONE specialist (vs two) and the
// no-revision rule live in the graph, not here.

const EXPRESS_MAX_OUTPUT_TOKENS = 8000;

const EXPRESS_OVERRIDES: Partial<Record<AgentKey, Partial<Omit<AgentDef, "key" | "kind">>>> = {
  // Director/adjudicator carry the two largest output contracts: at high
  // effort inside the 8k cap, thinking starved the JSON and both truncated to
  // effectively-empty in every live express run (15 Jul). Medium effort +
  // 12k gives the object room; search depth is unchanged.
  research_director: { searchBudget: 1, effort: "medium", maxOutputTokens: 12000 },
  evidence_adjudicator: { searchBudget: 1, effort: "medium", maxOutputTokens: 12000 },
  // Largest structured output in the graph (nine fully-specified tactics):
  // truncated at 8k in live batch 8 (Barnet) even with the doubled retry, and
  // the reviewer rightly rejected the cut-off plan. Same cure as above.
  tactics_planner: { maxOutputTokens: 12000 },
  // The four sequential review passes measured ~8 of the 20-minute budget at
  // high effort (batch 5, 15 Jul). Medium + 6k reclaims ~4 min of slack.
  synthesis_reviewer: { effort: "medium", maxOutputTokens: 6000 },
  objective_strategist: { effort: "medium" },
  decision_route: { effort: "medium", searchBudget: 0, timeoutMs: 240000 },
  power_stakeholder: { effort: "medium" },
  pressure_analysis: { effort: "medium" },
  strategy_architect: { model: "claude-sonnet-5" },
};

/** Profile-aware agent definition: "full" returns the roster def unchanged;
 *  "express" layers the derived overrides + the ~8k output cap on top. */
export function agentDefFor(key: AgentKey, profile: "full" | "express"): AgentDef {
  const base = agentDef(key);
  if (profile !== "express") return base;
  return {
    ...base,
    maxOutputTokens: Math.min(base.maxOutputTokens, EXPRESS_MAX_OUTPUT_TOKENS),
    ...EXPRESS_OVERRIDES[key],
  };
}

// Execution limits per agent turn (parameters §2).
export const AGENT_LIMITS = {
  correctionRetries: 1, // invalid structured output
  operationalRetries: 1, // timeout / provider / tool failure (visible)
  reviewerRevisionLoops: 1, // per proposal cluster
  specialistEscalationsPerTurn: 1,
} as const;
