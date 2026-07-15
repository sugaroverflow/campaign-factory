// Mock mode (FACTORY_MODEL_MODE=mock): deterministic, Leicester-school-street-
// flavoured AgentResults with realistic pacing and zero model calls, so the full
// graph, events, UI, recovery, and replay are exercisable without an API key.
// Every mock claim is labelled "Generated campaign recommendation" or "Campaign
// assumption" — NEVER "Verified public information" — because none of it is
// sourced. Fixtures are fed through each agent's real contract.toResult, so mock
// output is byte-for-byte the same shape as live output.
//
// Set FACTORY_MOCK_FAST=1 to collapse the 2–8s pacing to ~0 (used by checks).

import { getAgentContract, type AgentResultBody } from "@web/lib/factory/agents/index.js";
import type { AgentDef, AgentKey, AgentResult, AgentTaskEnvelope } from "@web/lib/factory/contracts/index.js";
import type { ExecutorDeps } from "./deps.js";
import type { ReviewInput, ReviewOutcome } from "./reviewer.js";
import type { WorkEmitter } from "./work.js";

const REC = "Generated campaign recommendation";
const ASSUME = "Campaign assumption";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    (t as { unref?: () => void }).unref?.();
  });
}

const fast = () => process.env.FACTORY_MOCK_FAST === "1" || process.env.FACTORY_MOCK_FAST === "true";

async function pace(work: WorkEmitter, deps: ExecutorDeps, notes: string[]): Promise<void> {
  const total = fast() ? 0 : 2000 + Math.floor(Math.random() * 6000); // 2–8s
  const chunk = notes.length ? Math.floor(total / notes.length) : 0;
  for (const note of notes) {
    if (deps.signal.aborted) return;
    work.work(note, "working");
    await sleep(chunk, deps.signal);
  }
}

const claim = (ref: string, text: string, label: string, loadBearing = false, type = "context") => ({
  ref,
  text,
  status: label,
  loadBearing,
  confidence: "medium",
  sourceIds: [] as string[],
  type,
});

// One raw fixture per agent key, shaped to that agent's schema.
const MOCK_RAW: Record<AgentKey, () => Record<string, unknown>> = {
  research_director: () => ({
    workSummary:
      "Scoped the campaign to a proposed school street outside St John the Baptist CofE Primary School in Leicester, set the research agenda, and selected two research lanes.",
    confidence: "medium",
    unknowns: ["Whether an Experimental Traffic Regulation Order has been formally proposed yet"],
    claims: [
      claim("c1", "The relevant authority is Leicester City Council as local highway authority.", ASSUME, true, "authority"),
      claim("c2", "School streets are typically delivered via a Traffic Regulation Order with statutory consultation.", ASSUME, false, "process"),
    ],
    evidenceClaimRefs: ["c1", "c2"],
    handoffs: [],
    scopeBrief: {
      refinedProblem:
        "Residents want a timed school street (motor-traffic restriction at drop-off and pick-up) on the road outside St John the Baptist CofE Primary School to improve child safety and air quality.",
      campaignName: "Safe Streets for St John the Baptist",
      requiredPlace: { area: "Leicester", authority: "Leicester City Council", geography: "Streets around St John the Baptist CofE Primary School" },
      interpretation:
        "The ask is a council-delivered timed motor-traffic restriction, not a national policy change; the decision sits with Leicester City Council's highways/transport function.",
      researchQuestions: [
        "Who formally decides a school street TRO in Leicester and by what process?",
        "Is there a current or planned consultation for this location?",
        "What is the council's existing school street or active-travel policy?",
        "What precedent school streets exist in Leicester and how were objections handled?",
      ],
      specialistSelection: [
        { specialist: "local_government", reason: "The decision is a council highways decision — need the committee/delegation route and dates." },
        { specialist: "planning", reason: "A school street runs via a Traffic Regulation Order with statutory consultation — a distinct evidence system from the committee route." },
      ],
      context: {
        situation: "A primary school on a residential street with heavy drop-off congestion.",
        currentPolicy: "Leicester has an active-travel and school street programme (assumption pending verification).",
        affected: ["Pupils and parents", "Local residents", "Nearby businesses"],
        keyDates: [],
        institutions: ["Leicester City Council", "The school and its governing body"],
        howItChanged: "Reframed from 'ban cars' to a timed, consulted TRO with a named decision route.",
      },
      decisionRouteSketch: {
        formal: "Leicester City Council (highway authority)",
        implementer: "Council highways/transport team",
        practical: "Ward councillors and the relevant cabinet lead",
        processes: ["Traffic Regulation Order", "Statutory consultation"],
        interventionPoints: ["During consultation", "At committee/delegated decision"],
        deadlines: [],
        unresolved: ["Exact decision-maker (cabinet vs delegated officer) not yet confirmed"],
      },
      possibleAllies: ["Parent-teacher association", "Local active-travel groups"],
      possibleOpponents: ["Some residents concerned about displaced parking"],
      localMedia: ["Leicester Mercury (local reporting)"],
    },
  }),

  evidence_adjudicator: () => ({
    workSummary: "Reviewed the scoping claims; in mock mode none can be independently verified, so they remain assumptions with gaps recorded.",
    confidence: "medium",
    unknowns: ["No live sources are fetched in mock mode"],
    claims: [],
    evidenceClaimRefs: [],
    handoffs: [],
    claimDecisions: [
      { claimId: "c1", decision: "not_found", rationale: "Mock mode — no source retrieved to confirm the authority.", resultingLabel: "Verification incomplete" },
      { claimId: "c2", decision: "qualified", rationale: "Generally true of school streets but unconfirmed for this location.", resultingLabel: "Supported inference" },
    ],
    gaps: ["Confirm the formal decision-maker and any live consultation"],
    reSearchRequests: ["Leicester City Council school street TRO decision route"],
  }),

  objective_strategist: () => ({
    workSummary: "Set a specific, consulted objective with a meaningful interim win.",
    confidence: "medium",
    unknowns: ["No committee date confirmed yet"],
    claims: [claim("c1", "A timed school street is a proportionate, deliverable ask for a single primary school.", REC, false)],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    objective: {
      dm: "Leicester City Council (highways decision-maker)",
      action: "approve and implement a timed school street (Experimental TRO) outside St John the Baptist CofE Primary School",
      by: "the start of the next school year [VERIFY: exact date once the decision route is confirmed]",
      mvw: "a formal commitment to consult on a school street at this location",
      success: "Motor traffic restricted at drop-off/pick-up on school days with monitoring in place.",
      constraints: ["Limited council budget", "Possible parking displacement concerns"],
      theoryOfChange: "A consulted, monitored trial lowers the political risk of objection and creates evidence for a permanent order.",
      smart: [{ test: "Specific", assessment: "Names the school, the mechanism, and the decision-maker." }],
    },
  }),

  decision_route: () => ({
    workSummary: "Mapped the formal decision route and intervention points.",
    confidence: "medium",
    unknowns: ["Whether the decision is delegated to officers or taken at committee"],
    claims: [claim("c1", "School street TROs are commonly decided under officer delegation with ward-member sign-off.", ASSUME, true, "process")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    route: {
      formal: "Leicester City Council as local highway authority",
      implementer: "Council highways/transport team",
      practical: "Ward councillors and the cabinet lead for transport",
      processes: ["Experimental Traffic Regulation Order", "Statutory consultation", "Decision (delegated or committee)"],
      interventionPoints: ["Before consultation opens", "During the consultation window", "At the decision point"],
      deadlines: [],
      unresolved: ["Confirm delegated vs committee decision", "Confirm any published timetable"],
    },
  }),

  power_stakeholder: () => ({
    workSummary: "Built a role-based power map for the school street decision.",
    confidence: "medium",
    unknowns: ["Named officeholders not confirmed in mock mode"],
    claims: [claim("c1", "The cabinet transport lead is the key persuadable decision influencer.", ASSUME, false, "stakeholder_position")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    power: {
      stakeholders: [
        {
          name: "Cabinet lead for transport",
          org: "Leicester City Council",
          role: "Cabinet member",
          tier: "decides",
          power: "High",
          position: "Unknown — likely supportive of active travel [Supported inference]",
          positionStatus: "Supported inference",
          relationship: "None yet",
          cares: "Deliverability, resident support, air quality outcomes",
          ask: "Commit to consult on a school street at this location",
          approach: "Private briefing with parent and safety evidence",
          evidence: "Council active-travel programme (assumption)",
          confidence: "Medium",
        },
        {
          name: "Headteacher",
          org: "St John the Baptist CofE Primary School",
          role: "Headteacher / governing body",
          tier: "influences",
          power: "Medium",
          position: "Likely supportive",
          positionStatus: "Campaign assumption",
          relationship: "Direct",
          cares: "Pupil safety",
          ask: "Public endorsement and help engaging parents",
          approach: "Meet the head; align on safety framing",
          evidence: "",
          confidence: "Medium",
        },
      ],
      statusQuoCost: "Continued congestion and safety risk at the school gate on school days.",
      localKnowledgeGaps: ["Which residents object and why"],
    },
  }),

  pressure_analysis: () => ({
    workSummary: "Mapped the pressures that make the status quo costlier than a consulted trial.",
    confidence: "medium",
    unknowns: [],
    claims: [claim("c1", "Child-safety framing raises the reputational cost of inaction for the council.", REC, false)],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    pressure: {
      pressures: [
        { type: "reputational", on: "Cabinet lead for transport", why: "A visible child-safety ask is hard to refuse publicly", whoApplies: "Parents and the school", channel: "Local media and public deputation", boundary: "inference", evidence: "", action: "Coordinated parent voice at consultation" },
        { type: "electoral", on: "Ward councillors", why: "Parents and residents are constituents", whoApplies: "Local residents", channel: "Ward surgeries and correspondence", boundary: "inference", evidence: "", action: "Ward-member briefings" },
      ],
      statusQuoCost: "Reputational exposure on child safety and air quality with no offsetting saving.",
    },
  }),

  strategy_architect: () => ({
    workSummary: "Designed a consulted, evidence-led strategy with an explicit rejected alternative.",
    confidence: "medium",
    unknowns: [],
    claims: [claim("c1", "Private engagement before public escalation lowers the risk of entrenched objection.", REC, false)],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    strategy: {
      narrative: "Parents and the school working with the council for safer streets at the school gate.",
      audiences: ["Parents", "Residents", "Ward councillors", "Cabinet lead"],
      route: "Private briefings first, then a strong, evidenced consultation response, then measured public pressure only if needed.",
      coalition: "School, PTA, local active-travel group, supportive residents.",
      phases: [
        { name: "Groundwork", when: "Weeks 1–3", focus: "Evidence, allies, and private briefings" },
        { name: "Consultation", when: "During the window", focus: "Maximise supportive, specific responses" },
        { name: "Decision", when: "At the decision point", focus: "Deputation and ward-member support" },
      ],
      escalation: "Escalate to public campaigning only if private engagement stalls — a human decision at a review point.",
      tradeoffs: ["Slower but lower-risk than immediate public confrontation"],
      risks: ["Parking-displacement backlash"],
      resources: ["Volunteer parent organisers"],
      constraints: ["Council budget and timetable"],
      avoid: ["Framing the ask as anti-car"],
      indicators: ["Number of supportive consultation responses"],
      rejectedAlternative: { approach: "Immediate petition and press campaign", whyRejected: "Risks hardening resident objection before the council has committed to consult." },
    },
  }),

  tactics_planner: () => ({
    workSummary: "Sequenced tactics with owners, dependencies, and human escalation points.",
    confidence: "medium",
    unknowns: [],
    claims: [claim("c1", "A parent survey provides evidence and builds the supporter list at once.", REC, false)],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    tactics: {
      tactics: [
        { name: "Parent safety survey", phase: 1, type: "organising", purpose: "Evidence + list-building", target: "Parents", owner: "PTA volunteers", pressure: "reputational", resources: "Online form", timing: "Weeks 1–2", dependencies: "School endorsement", expected: "80+ responses", success: "Majority support recorded", next: "Share with ward members", escalation: "None", approval: "Head to endorse" },
        { name: "Private ward-member briefings", phase: 1, type: "lobbying", purpose: "Secure early support", target: "Ward councillors", owner: "Campaign lead", pressure: "electoral", resources: "Briefing note", timing: "Week 3", dependencies: "Survey results", expected: "At least one supportive councillor", success: "Councillor agrees to advocate", next: "Cabinet-lead meeting", escalation: "Public ask only if refused — human decision", approval: "N/A" },
      ],
    },
  }),

  organising_designer: () => ({
    workSummary: "Designed how parents and residents are organised, with a ladder of engagement.",
    confidence: "medium",
    unknowns: [],
    claims: [claim("c1", "A named parent organiser per class year sustains turnout.", REC, false)],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    organising: {
      whoActs: "Parents, the PTA, and supportive residents.",
      whyParticipate: "Their children's safety at the school gate.",
      asks: ["Sign the survey", "Respond to the consultation", "Attend the decision meeting"],
      roles: [{ role: "Class rep", what: "Relay updates and collect responses" }],
      coalition: ["PTA", "Local active-travel group"],
      oneToOne: ["Coffee-morning conversations with hesitant parents"],
      outreach: "School newsletter and gate conversations.",
      event: "A visible 'safe gate' morning to demonstrate support.",
      ladder: [
        { rung: "Aware", action: "Read the newsletter item" },
        { rung: "Active", action: "Respond to the consultation" },
        { rung: "Leader", action: "Become a class rep" },
      ],
      channels: ["School newsletter", "Class messaging groups"],
      followup: "Thank responders and report numbers back.",
      sustain: "Keep parents updated through the decision.",
      metrics: ["Consultation responses", "Volunteers recruited"],
      humanEssential: ["Gate conversations and one-to-ones"],
    },
  }),

  lobbying_producer: () => ({
    workSummary: "Drafted the lobbying pack with role-attributed content and verification placeholders.",
    confidence: "medium",
    unknowns: [],
    claims: [],
    evidenceClaimRefs: [],
    handoffs: [],
    resources: [
      {
        key: "meeting_request_email",
        title: "Meeting request to the cabinet lead",
        body: "Dear [INSERT: cabinet lead name once confirmed],\n\nWe are parents at St John the Baptist CofE Primary School writing to request a short meeting about a timed school street outside the school.\n\nWe have [VERIFY: number] survey responses showing strong support for safer streets at drop-off and pick-up.\n\nYours sincerely,\nSafe Streets for St John the Baptist",
        verificationNotes: ["Cabinet lead name to confirm", "Survey response count to confirm"],
      },
    ],
  }),

  media_producer: () => ({
    workSummary: "Drafted the media pack with role-attributed quotes and a reputational-risk note.",
    confidence: "medium",
    unknowns: [],
    claims: [],
    evidenceClaimRefs: [],
    handoffs: [],
    resources: [
      {
        key: "press_release",
        title: "Press release: parents call for a safer school gate",
        body: "Parents at St John the Baptist CofE Primary School in Leicester are calling on the city council to trial a timed school street to protect children at drop-off and pick-up.\n\n\"We just want our children to be safe at the gate,\" said a local parent.\n\n[VERIFY: any figures before issuing.]",
        verificationNotes: ["All figures require verification before issue"],
      },
      {
        key: "reputational_risk_flags",
        title: "Reputational risk flags",
        body: "Risk: being framed as anti-car. Mitigation: emphasise it is timed, consulted, and about child safety.",
        verificationNotes: [],
      },
    ],
  }),

  digital_producer: () => ({
    workSummary: "Drafted the digital pack with coarse public audiences and no personal targeting.",
    confidence: "medium",
    unknowns: [],
    claims: [],
    evidenceClaimRefs: [],
    handoffs: [],
    resources: [
      {
        key: "action_page_copy",
        title: "Consultation action page",
        body: "Support a safer school gate at St John the Baptist. Respond to the council consultation in two minutes.\n\n[INSERT: consultation link once open.]",
        verificationNotes: ["Consultation link to add when the window opens"],
      },
    ],
  }),

  synthesis_reviewer: () => ({
    workSummary: "Reviewed the submitted proposals.",
    confidence: "medium",
    reviews: [],
    stepReports: [],
    consistencyFlags: [],
  }),

  // ---- specialists ----
  local_government: () => ({
    workSummary: "Researched the council committee/delegation route for a school street (mock).",
    confidence: "medium",
    unknowns: ["Named officers not confirmed in mock mode"],
    claims: [claim("c1", "Leicester City Council operates a school street / active-travel programme.", ASSUME, true, "policy")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: {
      summary: "The council is the highway authority; a school street runs via a TRO with a delegated or committee decision.",
      keyPoints: ["Highway authority: Leicester City Council", "Mechanism: Traffic Regulation Order"],
      candidateOrganisations: ["Leicester City Council transport team"],
      disputedClaims: [],
    },
  }),
  parliamentary: () => ({
    workSummary: "Checked for any parliamentary/constituency angle (mock).",
    confidence: "low",
    unknowns: ["Limited parliamentary relevance for a local TRO"],
    claims: [claim("c1", "This is a local-authority decision with little direct parliamentary route.", ASSUME, false, "process")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: { summary: "Primarily a local decision; MP support could add pressure but is not on the formal route.", keyPoints: ["Local decision"], candidateOrganisations: [], disputedClaims: [] },
  }),
  public_body: () => ({
    workSummary: "Checked relevant public bodies (mock).",
    confidence: "low",
    unknowns: [],
    claims: [claim("c1", "No separate regulator decides a local school street beyond the highway authority.", ASSUME, false, "authority")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: { summary: "The highway authority is the accountable body; no additional regulator required.", keyPoints: ["Highway authority accountable"], candidateOrganisations: [], disputedClaims: [] },
  }),
  planning: () => ({
    workSummary: "Researched the TRO / statutory consultation route (mock).",
    confidence: "medium",
    unknowns: ["No live consultation confirmed in mock mode"],
    claims: [claim("c1", "A school street requires a Traffic Regulation Order with statutory consultation.", ASSUME, true, "process")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: {
      summary: "Delivery is via a (often experimental) TRO with a statutory consultation window and formal representations.",
      keyPoints: ["Experimental TRO route", "Statutory consultation window", "Formal objection/representation process"],
      candidateOrganisations: ["Council traffic-management team"],
      disputedClaims: [],
    },
  }),
  local_media: () => ({
    workSummary: "Gathered local media and community context (mock).",
    confidence: "low",
    unknowns: ["Specific coverage not fetched in mock mode"],
    claims: [claim("c1", "Local reporting on school streets tends to feature parent-safety voices.", ASSUME, false, "context")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: { summary: "The Leicester Mercury is the main local outlet; framing around child safety travels well.", keyPoints: ["Leicester Mercury"], candidateOrganisations: ["Leicester Mercury"], disputedClaims: ["Parking displacement is contested locally"] },
  }),
  precedent_opposition: () => ({
    workSummary: "Found precedent school streets and likely objections (mock).",
    confidence: "medium",
    unknowns: [],
    claims: [claim("c1", "Comparable UK school streets show parking displacement is the main objection.", ASSUME, false, "context")],
    evidenceClaimRefs: ["c1"],
    handoffs: [],
    findings: { summary: "Many UK councils run school streets; the recurring objection is displaced parking, usually addressed by monitoring.", keyPoints: ["Widespread precedent", "Parking displacement is the key objection"], candidateOrganisations: [], disputedClaims: [] },
  }),
};

/** Mock agent turn: paced work updates + a schema-correct fixture, zero model calls. */
export async function mockAgentTurn(
  envelope: AgentTaskEnvelope,
  deps: ExecutorDeps,
  work: WorkEmitter,
): Promise<AgentResult> {
  const def: AgentDef = deps.agentDef;
  const key = def.key as AgentKey;
  const journeyStep = envelope.journeySteps[0];

  const researchy = def.toolPolicy !== "none";
  const notes = researchy
    ? [`Reviewing the ${def.shortName} brief`, "Searching public sources", "Drafting findings", "Writing proposals"]
    : [`Reviewing the ${def.shortName} brief`, "Working through the analysis", "Writing proposals"];

  if (researchy) {
    void deps.emit({ type: "source.search.started", journeyStep, payload: { summary: "Searching public sources", verb: "searching", agentKey: key } });
  }
  await pace(work, deps, notes);
  if (researchy) {
    void deps.emit({ type: "source.search.completed", journeyStep, payload: { summary: "Reviewed public sources", verb: "read", agentKey: key } });
  }

  const contract = getAgentContract(key);
  const raw = (MOCK_RAW[key] ?? MOCK_RAW.objective_strategist)();
  const body: AgentResultBody = contract.toResult(raw, { envelope, def });

  if (body.claims.length) {
    void deps.emit({
      type: "evidence.found",
      journeyStep,
      payload: { summary: `Recorded ${body.claims.length} mock claim${body.claims.length === 1 ? "" : "s"}`, verb: "recorded", agentKey: key },
    });
  }
  work.flush();
  return { agentRunId: envelope.agentRunId, status: "complete", ...body };
}

/** Mock reviewer: accepts every proposal with a canned rationale + Step Report. */
export async function mockReview(input: ReviewInput, deps: ExecutorDeps, work: WorkEmitter): Promise<ReviewOutcome> {
  await pace(work, deps, ["Reading the accepted state", `Reviewing ${input.proposals.length} proposal(s)`, "Writing the step report"]);
  const reviews = input.proposals.map((p) => ({
    proposalId: p.id,
    decision: "accept" as const,
    rationale: "Mock review: accepted. Content is campaign-specific and carries honest mock labels.",
    stepReport: `Mock step report for the ${input.pass} pass: ${p.summary}.`,
  }));
  const stepReports = input.journeySteps.map((step) => ({ step, report: `Mock step ${step} closed in the ${input.pass} pass.` }));
  work.flush();
  return {
    reviewerAgentRunId: input.reviewerAgentRunId,
    status: "complete",
    workSummary: `Mock-reviewed ${input.proposals.length} proposal(s) on the ${input.pass} pass.`,
    confidence: "medium",
    reviews,
    stepReports,
    consistencyFlags: [],
  };
}
