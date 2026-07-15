// Deterministic fixture for the W6 documents surface: a partially-complete
// Leicester school-street campaign built directly from W1's section content
// shapes (state/sections.ts). Runtime-neutral, no randomness — the dev preview
// page and the check script both import it. It is NOT a real run.

import type { CampaignState, CampaignSectionState, JudgementRequest } from "../contracts/state";
import type { JourneyStepKey } from "../contracts/journey";
import type { Claim } from "../contracts/evidence";
import type { FactoryEvent } from "../contracts/core";

export const FIXTURE_CAMPAIGN_ID = "fixture-leicester-school-street";
const T0 = Date.parse("2026-07-15T09:00:00.000Z");
const at = (secs: number) => new Date(T0 + secs * 1000).toISOString();

function sec(status: CampaignSectionState["status"], content: unknown, claimIds: string[] = []): CampaignSectionState {
  return { status, content, evidenceClaimIds: claimIds, acceptedAtVersion: status === "accepted" ? 8 : undefined };
}

const sections: Record<JourneyStepKey, CampaignSectionState> = {
  problem: sec("accepted", {
    statement:
      "Traffic outside St John the Baptist CofE Primary School in Leicester makes the school gate dangerous at drop-off and pick-up.",
    interpretation:
      "Reframed from a general 'traffic is bad' complaint to a specific ask for a timed school-street closure, which the council can deliver via an experimental Traffic Regulation Order.",
    context: {
      situation:
        "Narrow residential streets carry heavy peak-time car traffic; parents report near-misses at the gate.",
      currentPolicy: "No existing timed closure; the road is open to through-traffic at all times.",
      howItChanged:
        "Research showed Leicester already runs school-street schemes elsewhere, so the ask became 'join the existing programme' rather than 'invent something new'.",
      keyDates: ["Experimental TRO consultation window (dates to confirm)", "Cabinet transport decisions cycle"],
      institutions: ["Leicester City Council", "Leicester City Council Highways"],
      affected: ["Pupils and parents", "Residents of the surrounding streets"],
    },
  }, ["c4"]),
  evidence: sec("accepted", {
    summary:
      "Leicester City Council operates a school-street programme and has published a school travel plan; local air-quality data shows peak-time exceedances near the school.",
    researchQuestions: [
      "Which body formally makes the TRO decision?",
      "What is the consultation route and timetable?",
    ],
    keyDates: ["School travel plan published 2024"],
    institutions: ["Leicester City Council", "Department for Transport (guidance)"],
    unresolved: ["Exact consultation dates for this street not yet confirmed"],
    // Specialists merge lane findings under lane_<key>; the reducer preserves
    // them and the compiler's extras fallback must render them, never drop them.
    lane_local_government: {
      specialist: "Local Government Records Specialist",
      findings: {
        summary:
          "The school-street programme is administered by the Highways team; experimental TROs are made under delegated powers, with unresolved objections escalating the decision to Cabinet.",
        keyPoints: [
          "Existing school-street sites were approved as experimental TROs.",
          "Objections during the statutory window can push the decision to Cabinet.",
        ],
      },
    },
  }, ["c6"]),
  objective: sec("accepted", {
    dm: "Leicester City Council Cabinet",
    action: "approve an experimental school-street closure for St John the Baptist CofE Primary School",
    by: "the start of the 2027 spring term",
    mvw: "a committed consultation on a timed closure for this street",
    success: "A timed closure operating at drop-off and pick-up, monitored for a year.",
    constraints: ["Limited volunteer time", "Must fit the council's existing TRO process"],
    // A known-but-unrendered schema field: the extras fallback carries it into
    // the compiled Objective and Theory of Change document.
    theoryOfChange:
      "If parents show organised support during the statutory consultation, the lead officer can carry a low-risk recommendation to Cabinet, because the council's own school-street precedent makes approval the path of least resistance.",
    smart: [
      { test: "Specific", assessment: "Names the decision-maker, the street, and the mechanism." },
      { test: "Measurable", assessment: "A closure order either exists or does not." },
      { test: "Time-bound", assessment: "Tied to the spring 2027 term." },
    ],
  }),
  decision_route: sec("under_review", {
    formal: "Leicester City Council Cabinet (or delegated Director of Highways) makes the TRO decision.",
    implementer: "Leicester City Council Highways team",
    practical: "In practice the lead transport officer shapes the recommendation before it reaches Cabinet.",
    processes: ["Experimental Traffic Regulation Order", "Statutory consultation"],
    interventionPoints: ["During the consultation window", "Before the Cabinet report is finalised"],
    unresolved: ["Whether this decision is delegated or taken by full Cabinet"],
  }, ["c1", "c2"]),
  power: sec("accepted", {
    statusQuoCost: "Doing nothing leaves a known danger at the gate and a live parent grievance.",
    stakeholders: [
      {
        name: "Cabinet Lead for Transport",
        role: "Cabinet member",
        tier: "decides",
        power: "High",
        position: "Open but cautious about resident objections",
        positionStatus: "Supported inference",
        ask: "Back the experimental closure in the Cabinet report",
        approach: "Bring parent testimony plus the council's own school-street precedent",
      },
      {
        name: "Lead Transport Officer",
        role: "Highways officer",
        tier: "influences",
        power: "Medium-High",
        positionStatus: "Verification incomplete",
        ask: "Include this street in the next TRO batch",
      },
      {
        name: "Local ward councillor",
        role: "Ward councillor",
        tier: "resists",
        power: "Medium",
        position: "Reported as concerned about displaced parking",
        positionStatus: "Conflicting evidence",
      },
    ],
  }, ["c1", "c3"]),
  pressure: sec("needs_verification", {
    statusQuoCost: "Peak-time congestion and a documented near-miss record.",
    pressures: [
      {
        type: "Reputational",
        on: "Cabinet Lead for Transport",
        why: "Being seen to ignore a child-safety risk near a school is politically costly.",
        whoApplies: "Parents and the school",
        channel: "Local press and the school newsletter",
        action: "Coordinated parent testimony at the consultation",
      },
    ],
  }),
  strategy: sec("accepted", {
    narrative:
      "Win by making it easier for the council to say yes than no: align the ask with the existing school-street programme, gather visible parent support, and give the lead officer a low-risk recommendation to carry to Cabinet.",
    audiences: ["Parents", "Residents of adjoining streets", "The lead transport officer"],
    route: "Work the officer recommendation first, then the Cabinet decision.",
    coalition: "School, parents' association, and supportive residents.",
    phases: [
      { name: "Evidence and support", when: "Weeks 1–4", focus: "Gather testimony and a supporter list" },
      { name: "Consultation", when: "During the TRO window", focus: "Turn out support and rebut objections" },
    ],
    avoid: ["Framing it as anti-car", "Overstating unverified air-quality figures"],
    // The [VERIFY: …] block exercises the clean-prose rule: stripped from the
    // rendered document body, resurfaced under Evidence and Next Checks.
    escalation:
      "If the officer recommendation is negative, request a Cabinet deputation. [VERIFY: deputation request deadline for Cabinet meetings]",
    indicators: ["A supporter list of 100+", "Officer willingness to include the street"],
  }),
  tactics: sec("accepted", {
    tactics: [
      {
        name: "Parent testimony pack",
        phase: 1,
        type: "Evidence",
        target: "Lead Transport Officer",
        owner: "Parents' association",
        purpose: "Give the officer concrete safety evidence",
        success: "Officer acknowledges the safety case in writing",
        approval: "School head reviews before submission",
      },
      {
        name: "Consultation turnout push",
        phase: 2,
        type: "Mobilisation",
        target: "The consultation",
        owner: "Volunteer team",
        purpose: "Ensure supportive responses outweigh objections",
        success: "Majority supportive consultation responses",
      },
    ],
  }),
  organising: sec("empty", null),
  documents: sec("empty", null),
};

// Stored document statuses mirror the compiler's authoritative output: in the
// real flow the finalisation node calls compileDocuments and persists the
// compiled status, so stored status == compiled status.
const documents: CampaignState["documents"] = [
  { key: "campaign_brief", status: "needs verification", version: 8 },
  { key: "objective_theory_of_change", status: "ready", version: 3 },
  { key: "power_stakeholder_map", status: "needs verification", version: 4 },
  { key: "campaign_strategy", status: "ready", version: 2 },
  { key: "tactics_timeline", status: "ready", version: 2 },
  { key: "organising_plan", status: "assembling", version: 0 },
  {
    key: "lobbying_pack",
    status: "needs verification",
    version: 2,
    resources: [
      {
        key: "officer_email",
        title: "Email to the lead transport officer",
        body:
          "Dear [OFFICER NAME],\n\nI'm writing on behalf of parents at St John the Baptist CofE Primary School about the road-safety risk at the school gate.\n\nWe understand Leicester already runs school-street closures elsewhere and would like this street considered for the next experimental TRO batch. We can provide parent testimony and a supporter list.\n\nCould we arrange a short meeting?\n\n[SENDER NAME]",
        verificationNotes: ["Confirm the current lead transport officer's name before sending."],
        claimIds: ["c1"],
      },
    ],
  },
  {
    key: "media_pack",
    status: "ready",
    version: 2,
    resources: [
      {
        key: "press_release",
        title: "Local press release",
        body:
          "Parents at a Leicester primary school are calling for a timed school-street closure to end dangerous congestion at the gate.\n\nThe campaign points to the council's existing school-street programme and is asking for this street to join the next round.",
        claimIds: ["c1", "c6"],
      },
    ],
  },
  { key: "digital_pack", status: "assembling", version: 0 },
];

export const FIXTURE_STATE: CampaignState = {
  campaignId: FIXTURE_CAMPAIGN_ID,
  version: 8,
  problem:
    "Traffic outside St John the Baptist CofE Primary School in Leicester makes the school gate dangerous at drop-off and pick-up.",
  place: "Leicester",
  sections,
  documents,
  nextChecks: [
    {
      id: "nc1",
      description: "Confirm the experimental TRO consultation dates for this street",
      reason: "The timetable determines when to mobilise supporters",
      affectedSections: ["decision_route", "strategy"],
      claimIds: ["c2"],
    },
    {
      id: "nc2",
      description: "Verify the ward councillor's public position",
      reason: "Sources conflict on whether they support or oppose",
      affectedSections: ["power"],
      claimIds: ["c3"],
    },
  ],
  terminalGaps: [
    {
      id: "gap1",
      description: "Organising plan could not be completed — the Organising Designer agent failed after its retry.",
      agentRunId: "ar6",
      step: 9,
      at: at(300),
    },
  ],
};

export const FIXTURE_CLAIMS: Claim[] = [
  {
    id: "c1",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "Leicester City Council decides experimental Traffic Regulation Orders for school streets.",
    type: "authority",
    status: "Verified public information",
    loadBearing: true,
    confidence: "high",
    sourceIds: ["s1"],
    excerpt: "The council's traffic team administers experimental TROs under delegated powers.",
    authorAgentRunId: "ar2",
    stateVersion: 4,
    affectedOutputs: ["decision_route", "power", "power_stakeholder_map", "campaign_brief"],
  },
  {
    id: "c2",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "The experimental TRO consultation for this street closes on a date still to be confirmed.",
    type: "deadline",
    status: "Verification incomplete",
    loadBearing: true,
    confidence: "low",
    sourceIds: [],
    authorAgentRunId: "ar2",
    stateVersion: 4,
    affectedOutputs: ["decision_route"],
  },
  {
    id: "c3",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "The local ward councillor's position on the closure is disputed between sources.",
    type: "stakeholder_position",
    status: "Conflicting evidence",
    loadBearing: true,
    confidence: "medium",
    sourceIds: ["s2", "s3"],
    authorAgentRunId: "ar3",
    stateVersion: 5,
    affectedOutputs: ["power"],
    contradictsClaimIds: ["c3b"],
  },
  {
    id: "c4",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "Peak-time air quality near the school exceeds recommended limits.",
    type: "number",
    status: "Supported inference",
    loadBearing: false,
    confidence: "medium",
    sourceIds: ["s4"],
    authorAgentRunId: "ar3",
    stateVersion: 3,
    // Free-text variants observed in the recorded live batch — the compiler's
    // normalization layer must still match these to "problem" / "evidence".
    affectedOutputs: ["problem statement", "evidence base"],
  },
  {
    id: "c5",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "The residents' association is assumed to back the closure.",
    type: "context",
    status: "Campaign assumption",
    loadBearing: false,
    confidence: "low",
    sourceIds: [],
    authorAgentRunId: "ar5",
    stateVersion: 6,
    affectedOutputs: ["organising"],
  },
  {
    id: "c6",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "The school published a school travel plan in 2024.",
    type: "policy",
    status: "Verified public information",
    loadBearing: true,
    confidence: "high",
    sourceIds: ["s5"],
    excerpt: "School Travel Plan, 2024.",
    authorAgentRunId: "ar2",
    stateVersion: 3,
    affectedOutputs: ["evidence"],
  },
  {
    id: "c7",
    campaignId: FIXTURE_CAMPAIGN_ID,
    text: "The council requires a named school contact for a school-street application.",
    type: "process",
    status: "Verification incomplete",
    loadBearing: true,
    confidence: "low",
    sourceIds: [],
    authorAgentRunId: "ar2",
    stateVersion: 6,
    // Deliberately a free-text variant ("organising plan" → organising): the
    // Organising Plan document has NO accepted content yet, so despite this
    // unresolved load-bearing claim it must stay "assembling", never
    // "needs verification" (a contentless doc is not exportable).
    affectedOutputs: ["organising plan"],
  },
];

// Judgement requests for the UI preview: one open, one defaulted, one resolved.
export const FIXTURE_JUDGEMENTS: JudgementRequest[] = [
  {
    id: "j-open",
    campaignId: FIXTURE_CAMPAIGN_ID,
    agentRunId: "ar5",
    kind: "strategy_choice",
    question: "Lead with the officer recommendation, or go straight to a Cabinet deputation?",
    options: ["Work the officer recommendation first", "Request a Cabinet deputation now"],
    provisionalDefault: "Work the officer recommendation first",
    rationale:
      "Officer-first is lower risk and matches how the council's existing school-street schemes were approved, but a deputation is faster if the officer is unlikely to recommend.",
    affectedOutputs: ["strategy", "tactics"],
    status: "open",
  },
  {
    id: "j-defaulted",
    campaignId: FIXTURE_CAMPAIGN_ID,
    agentRunId: "ar1",
    kind: "scope_ambiguity",
    question: "Should the campaign also cover the neighbouring street, or just this one?",
    options: ["This street only", "Include the neighbouring street"],
    provisionalDefault: "This street only",
    rationale: "Keeping scope tight makes the ask easier for the council to grant.",
    affectedOutputs: ["problem"],
    status: "defaulted",
    answer: "This street only",
    answeredAt: at(120),
  },
  {
    id: "j-resolved",
    campaignId: FIXTURE_CAMPAIGN_ID,
    agentRunId: "ar4",
    kind: "local_knowledge",
    question: "Is the parents' association willing to be the named campaign owner?",
    options: ["Yes, name them", "Keep the owner anonymous for now"],
    provisionalDefault: "Keep the owner anonymous for now",
    rationale: "Only the campaigner knows whether the association has agreed to be named.",
    affectedOutputs: ["organising"],
    status: "resolved",
    answer: "Yes, name them",
    answeredAt: at(150),
  },
];

// Factory Events sufficient to derive an honest Campaign Completion Receipt.
const ev = (
  sequence: number,
  type: FactoryEvent["type"],
  extra: Partial<FactoryEvent> & { payload?: Partial<FactoryEvent["payload"]> } = {},
): FactoryEvent => ({
  eventId: `e${sequence}`,
  sequence,
  campaignId: FIXTURE_CAMPAIGN_ID,
  batchId: "fixture-batch",
  type,
  at: at(sequence),
  visibility: "public",
  ...extra,
  payload: { summary: extra.payload?.summary ?? type, ...(extra.payload ?? {}) },
});

export const FIXTURE_EVENTS: FactoryEvent[] = [
  ev(1, "run.queued"),
  ev(2, "run.started", { payload: { summary: "Run started", detail: { problem: FIXTURE_STATE.problem, place: "Leicester" } } }),
  ev(3, "agent.queued", { agentRunId: "ar1", payload: { summary: "Research Director queued", agentKey: "research_director" } }),
  ev(4, "agent.started", { agentRunId: "ar1", payload: { summary: "Scoping the problem", agentKey: "research_director" } }),
  ev(5, "agent.started", { agentRunId: "ar2", payload: { summary: "Council records specialist searching", agentKey: "local_government" } }),
  ev(6, "source.fetch.completed", { agentRunId: "ar2", payload: { summary: "Fetched council TRO page", sourceIds: ["s1"] } }),
  ev(7, "source.fetch.completed", { agentRunId: "ar2", payload: { summary: "Fetched school travel plan", sourceIds: ["s5"] } }),
  ev(8, "source.fetch.completed", { agentRunId: "ar2", payload: { summary: "Fetched local news report", sourceIds: ["s2"] } }),
  ev(9, "agent.started", { agentRunId: "ar3", payload: { summary: "Adjudicating claims", agentKey: "evidence_adjudicator" } }),
  ev(10, "evidence.found", { agentRunId: "ar3", payload: { summary: "Confirmed the council decides TROs", claimIds: ["c1"], detail: { label: "Verified public information" } } }),
  ev(11, "evidence.found", { agentRunId: "ar3", payload: { summary: "Confirmed the 2024 school travel plan", claimIds: ["c6"], detail: { label: "Verified public information" } } }),
  ev(12, "evidence.conflicted", { agentRunId: "ar3", payload: { summary: "Sources conflict on the ward councillor", claimIds: ["c3"], detail: { label: "Conflicting evidence" } } }),
  ev(13, "agent.completed", { agentRunId: "ar1", payload: { summary: "Scope complete", agentKey: "research_director" } }),
  ev(14, "agent.completed", { agentRunId: "ar2", payload: { summary: "Records gathered", agentKey: "local_government" } }),
  ev(15, "agent.completed", { agentRunId: "ar3", payload: { summary: "Claims adjudicated", agentKey: "evidence_adjudicator" } }),
  ev(16, "section.status", { journeyStep: 1, payload: { summary: "Problem accepted", sectionStep: 1, sectionStatus: "accepted" } }),
  ev(17, "agent.completed", { agentRunId: "ar4", payload: { summary: "Objective set", agentKey: "objective_strategist" } }),
  ev(18, "section.status", { journeyStep: 3, payload: { summary: "Objective accepted", sectionStep: 3, sectionStatus: "accepted" } }),
  ev(19, "judgement.requested", { agentRunId: "ar4", payload: { summary: "Name the campaign owner?", judgementId: "j-resolved" } }),
  ev(20, "judgement.resolved", { payload: { summary: "Owner named", judgementId: "j-resolved", detail: { answer: "Yes, name them" } } }),
  ev(21, "document.status", { payload: { summary: "Objective & Theory of Change ready", documentKey: "objective_theory_of_change", documentStatus: "ready" } }),
  ev(22, "agent.completed", { agentRunId: "ar5", payload: { summary: "Strategy designed", agentKey: "strategy_architect" } }),
  ev(23, "section.status", { journeyStep: 7, payload: { summary: "Strategy accepted", sectionStep: 7, sectionStatus: "accepted" } }),
  ev(24, "document.status", { payload: { summary: "Campaign Strategy ready", documentKey: "campaign_strategy", documentStatus: "ready" } }),
  ev(25, "agent.failed", { agentRunId: "ar6", payload: { summary: "Organising Designer failed after retry", agentKey: "organising_designer" } }),
  ev(26, "gap.terminal", { journeyStep: 9, payload: { summary: "Organising plan not completed", sectionStep: 9, detail: { description: "Organising plan could not be completed." } } }),
  ev(27, "agent.completed", { agentRunId: "ar7", payload: { summary: "Final review complete", agentKey: "synthesis_reviewer" } }),
  ev(28, "run.partial", { payload: { summary: "Run finished partially" } }),
];
