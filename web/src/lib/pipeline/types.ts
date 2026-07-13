import { type VerificationLabel } from "./labels";

/* ------------------------------------------------------------------ input --- */

// The full structured form (ported from the prototype). Only `problem` is
// required; research fills the gaps and reports what it could not establish.
export interface RunInput {
  problem: string;
  org?: string;
  location?: string;
  outcome?: string;
  dm?: string; // known decision-maker
  timeframe?: string;
  affected?: string;
  evidence?: string;
  resources?: string;
  // Per-run API key. Server default is process.env.ANTHROPIC_API_KEY; the BYOK
  // seam (post-launch) will pass a user key here. Never persisted.
  apiKey?: string;
}

/* -------------------------------------------------------------- research --- */

export interface SourceClaim {
  claim: string;
  status: VerificationLabel;
  sourceTitle: string;
  sourceOrg: string;
  url: string;
  date: string;
  accessDate: string;
  evidence: string;
  confidence: "High" | "Medium" | "Low";
  usedFor: string;
}

export interface ResearchResult {
  refinedProblem: string;
  campaignName: string;
  location: { area: string; authority: string; geography: string };
  interpretation: string;
  missingInfo: string[];
  researchQuestions: string[];
  context: {
    situation: string;
    currentPolicy: string;
    affected: string[];
    keyDates: string[];
    institutions: string[];
    howItChanged: string;
  };
  decisionMaker: {
    formal: string;
    implementer: string;
    practical: string;
    processes: string[];
    interventionPoints: string[];
    deadlines: string[];
    unresolved: string[];
  };
  claims: SourceClaim[];
  possibleAllies: string[];
  possibleOpponents: string[];
  localMedia: string[];
  searched: string[];
  unresolvedQuestions: string[];
}

/* ------------------------------------------------------------------ plan --- */

export interface PlanObjective {
  dm: string;
  action: string;
  by: string;
  mvw: string;
  success: string;
  constraints: string[];
  smart: { test: string; assessment: string }[];
}

export interface PlanStakeholder {
  name: string;
  org: string;
  role: string;
  tier: "decides" | "influences" | "mobilises" | "resists" | "neutral";
  power: "High" | "Medium-High" | "Medium" | "Low-Medium" | "Low";
  position: string;
  positionStatus: VerificationLabel;
  relationship: string;
  cares: string;
  ask: string;
  approach: string;
  evidence: string;
  confidence: "High" | "Medium" | "Low";
}

export interface PlanPressure {
  type: string;
  on: string;
  why: string;
  whoApplies: string;
  channel: string;
  evidence: string;
  action: string;
}

export interface PlanTactic {
  name: string;
  phase: number;
  type: string;
  purpose: string;
  target: string;
  owner: string;
  pressure: string;
  resources: string;
  timing: string;
  dependencies: string;
  expected: string;
  success: string;
  next: string;
  escalation: string;
  approval: string;
}

export interface Plan {
  objective: PlanObjective;
  stakeholders: PlanStakeholder[];
  pressures: PlanPressure[];
  statusQuoCost: string;
  strategy: {
    narrative: string;
    audiences: string[];
    route: string;
    coalition: string;
    phases: { name: string; when: string; focus: string }[];
    resources: string[];
    constraints: string[];
    risks: string[];
    tradeoffs: string[];
    escalation: string;
    avoid: string[];
    indicators: string[];
  };
  tactics: PlanTactic[];
  organising: {
    whoActs: string;
    whyParticipate: string;
    asks: string[];
    roles: { role: string; what: string }[];
    coalition: string[];
    oneToOne: string[];
    outreach: string;
    event: string;
    ladder: { rung: string; action: string }[];
    channels: string[];
    followup: string;
    sustain: string;
    metrics: string[];
    humanEssential: string[];
  };
  risks: string[];
  assumptions: string[];
  metrics: { campaign: string[]; organising: string[] };
  qualityFlags: string[];
}

/* ---------------------------------------------------------------- drafts --- */

export interface QA {
  q: string;
  a: string;
}

// Stage C is three parallel calls, one per group. These three sub-objects map
// onto the nine rendered documents (decision-maker pack / press pack / supporter
// pack).
export interface DraftsLobbying {
  briefing: string;
  meetingEmail: string;
  agenda: string;
  keyArguments: string[];
  talkingPoints: string[];
  questionsToAsk: string[];
  objections: { objection: string; response: string }[];
  contactScript: string;
  doorknockScript: string;
  followupEmail: string;
  escalationOptions: string[];
}

export interface DraftsMedia {
  pressRelease: string;
  pitchEmail: string;
  headline: string;
  altAngles: string[];
  spokespeople: string;
  quotes: { voice: string; quote: string; note: string }[];
  qa: QA[];
  hostileQA: QA[];
  timing: string;
  visual: string;
}

export interface DraftsDigital {
  landingCopy: string;
  actionPageCopy: string;
  supporterEmail: string;
  volunteerMessage: string;
  socialPosts: { platform: string; text: string }[];
  audienceVariants: { audience: string; text: string }[];
  faq: QA[];
  ctas: string[];
  contentSequence: string;
  sharingMessage: string;
  graphicConcepts: string[];
}

export interface Drafts {
  lobbying?: DraftsLobbying;
  media?: DraftsMedia;
  digital?: DraftsDigital;
}

/* ------------------------------------------------------ lint / campaign --- */

export interface LintFlag {
  document: string; // which draft field / doc
  issue: string; // what's wrong (missing label, invented name, missing [VERIFY:])
  severity: "block" | "warn";
}

export interface LintResult {
  ok: boolean;
  flags: LintFlag[];
}

// The merged campaign object the journey UI reads from. Assembled from the three
// live stages; there is no synthetic baseline.
export interface Campaign {
  id: string;
  name: string;
  refinedProblem?: string;
  interpretation?: string;
  input: RunInput;
  research?: ResearchResult;
  plan?: Plan;
  drafts?: Drafts;
  sources: SourceClaim[];
  lint?: LintResult;
  // completeness flags — which stages actually produced output
  completed: { research: boolean; plan: boolean; drafts: boolean; lint: boolean };
  createdAt: string;
}

/* ------------------------------------------------------------ run state --- */

export type StageId = "research" | "plan" | "drafts" | "lint";
export type StageStatus = "pending" | "running" | "done" | "failed";
export type RunStatus =
  | "queued"
  | "running"
  | "partial" // finished but one or more stages failed
  | "complete"
  | "failed"; // nothing usable produced

export interface RunState {
  id: string;
  status: RunStatus;
  stages: Record<StageId, { status: StageStatus; error?: string }>;
  notes: string[]; // human-readable progress notes (feeds the ticker/feed)
  campaign: Campaign;
  costUSD: number; // accumulated spend for this run (kill-switch accounting)
  startedAt: string;
  updatedAt: string;
}

export type RunMutator = (patch: (s: RunState) => void) => void;
