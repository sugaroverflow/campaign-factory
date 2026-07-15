// Canned FactoryEvent sequence for the dev preview harness (W4). This is a
// FIXTURE, not a run: it exercises the fold + Assembly View without the worker
// or any model calls. It is clearly labelled in the UI and must never be
// presented as a real run. Modelled on the Leicester school-street evaluation
// fixture (parameters §8) so the shapes are realistic.
//
// Section content objects follow W1's per-section schemas
// (web/src/lib/factory/state/sections.ts). A few deliberately carry EXTRA
// fields beyond the schema (e.g. problem.whyNow, evidence.keyClaims) because
// the reducer preserves the agent's original object — the preview proves the
// UI renders that preserved richness instead of dropping it.

import type { FactoryEvent } from "@/lib/factory/contracts";

const T0 = Date.parse("2026-07-15T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let seq = 0;
const next = () => ++seq;

// helper to keep the fixture terse
function ev(
  partial: Omit<FactoryEvent, "eventId" | "sequence" | "visibility"> & {
    visibility?: FactoryEvent["visibility"];
  },
): FactoryEvent {
  const s = next();
  return {
    eventId: `fx-${s}`,
    sequence: s,
    visibility: partial.visibility ?? "public",
    ...partial,
  };
}

const CID = "fixture-leicester";
const RD = "ar-research-director";
const CR = "ar-council-records";
const EA = "ar-evidence-adjudicator";
const OB = "ar-objective";
const DR = "ar-decision-route";
const PW = "ar-power";
const PR = "ar-pressure";
const SA = "ar-strategy-architect";
const TP = "ar-tactics";
const OD = "ar-organising";
const LP = "ar-lobbying";
const SR = "ar-synthesis-reviewer";

/** The full fixture log. The preview reveals these over time to animate the UI,
 *  but the fold produces the same RunVM whether fed all at once or incrementally. */
export const FIXTURE_EVENTS: FactoryEvent[] = [
  ev({ campaignId: CID, type: "run.queued", at: at(0), payload: { summary: "Run queued" } }),
  ev({
    campaignId: CID,
    type: "run.started",
    at: at(1),
    stateVersion: 1,
    payload: {
      summary: "Campaign run started",
      detail: {
        problem:
          "Make the school street outside St John the Baptist CofE Primary permanent, with proper enforcement.",
        place: "Leicester (St John the Baptist CofE Primary School)",
      },
    },
  }),

  // ---- scoping + research (steps 1–2) ----
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 1,
    type: "agent.started",
    at: at(2),
    payload: { summary: "Interpreting the problem and scoping research", verb: "scoping", agentKey: "research_director" },
  }),
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 1,
    type: "work.update",
    at: at(4),
    payload: {
      summary: "Identified Leicester City Council as the responsible highways authority",
      verb: "reading",
      agentKey: "research_director",
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 2,
    type: "source.search.started",
    at: at(6),
    payload: { summary: "Searching official sources for the school-street order", verb: "searching", agentKey: "research_director" },
  }),
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 2,
    type: "specialist.spawned",
    at: at(8),
    payload: {
      summary: "Selected the Local Government & Council Records specialist",
      verb: "spawned",
      agentKey: "research_director",
      detail: { specialist: "local_government" },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: CR,
    parentAgentRunId: RD,
    journeyStep: 2,
    type: "agent.started",
    at: at(9),
    payload: { summary: "Locating the traffic regulation order and cabinet papers", verb: "starting", agentKey: "local_government" },
  }),
  ev({
    campaignId: CID,
    agentRunId: CR,
    journeyStep: 2,
    type: "source.fetch.started",
    at: at(11),
    payload: { summary: "Fetching Leicester City Council cabinet minutes (Mar 2026)", verb: "fetching", agentKey: "local_government" },
  }),
  ev({
    campaignId: CID,
    agentRunId: CR,
    journeyStep: 2,
    type: "source.fetch.completed",
    at: at(14),
    payload: {
      summary: "Retrieved cabinet minutes confirming the experimental order",
      verb: "fetched",
      agentKey: "local_government",
      sourceIds: ["src-cabinet-minutes"],
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: CR,
    journeyStep: 2,
    type: "evidence.found",
    at: at(16),
    payload: {
      summary: "Experimental Traffic Regulation Order runs 18 months; decision on permanence due Sept 2026",
      verb: "found",
      agentKey: "local_government",
      sourceIds: ["src-cabinet-minutes"],
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 1,
    type: "proposal.submitted",
    at: at(17),
    payload: { summary: "Proposed the refined problem statement", verb: "proposing", agentKey: "research_director", proposalId: "p-problem" },
  }),
  ev({
    campaignId: CID,
    agentRunId: SR,
    journeyStep: 1,
    type: "proposal.accepted",
    at: at(19),
    stateVersion: 2,
    payload: { summary: "Accepted the refined problem", verb: "accepted", agentKey: "synthesis_reviewer", proposalId: "p-problem" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 1,
    type: "section.status",
    at: at(19),
    stateVersion: 2,
    payload: {
      summary: "Problem section accepted",
      sectionStep: 1,
      sectionStatus: "accepted",
      detail: {
        stepReport:
          "Refined the starting statement into a decision-focused problem tied to the Sept 2026 permanence decision.",
        content: {
          statement:
            "Secure a permanent, enforced school street outside St John the Baptist CofE Primary before the experimental order lapses.",
          campaignName: "Safe Street for St John's",
          interpretation:
            "Read as a highways decision owned by Leicester City Council: make an experimental traffic order permanent, with enforcement attached.",
          context: {
            situation:
              "An 18-month experimental school-street order restricts motor traffic outside the school at drop-off and pick-up times.",
            keyDates: ["Experimental order lapses September 2026", "Cabinet permanence decision due September 2026"],
            institutions: ["Leicester City Council (highways authority)", "St John the Baptist CofE Primary School"],
            affected: ["pupils and families at the school", "residents on the affected streets", "local through-traffic"],
          },
          // extra field beyond the schema — preserved by the reducer, rendered via Extras
          whyNow: "The 18-month experimental Traffic Regulation Order lapses in September 2026 unless made permanent.",
        },
        agentCount: 2,
        sourceCount: 1,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: EA,
    journeyStep: 2,
    type: "agent.started",
    at: at(21),
    payload: { summary: "Adjudicating the collected claims", verb: "adjudicating", agentKey: "evidence_adjudicator" },
  }),
  ev({
    campaignId: CID,
    agentRunId: EA,
    journeyStep: 2,
    type: "evidence.conflicted",
    at: at(24),
    payload: {
      summary: "Two sources disagree on the exact decision date — flagged for verification",
      verb: "conflict",
      agentKey: "evidence_adjudicator",
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: EA,
    journeyStep: 2,
    type: "judgement.requested",
    at: at(26),
    payload: {
      summary: "Which decision date should the campaign plan around?",
      verb: "asking",
      agentKey: "evidence_adjudicator",
      judgementId: "j-date",
      detail: {
        kind: "evidence_conflict",
        question: "Sources give two different dates for the permanence decision. Which should the plan target?",
        options: ["September 2026 cabinet (cabinet minutes)", "July 2026 scrutiny (council news post)"],
        provisionalDefault: "September 2026 cabinet (cabinet minutes)",
        rationale: "The cabinet minutes are a Tier A primary source; the news post is Tier C.",
        affectedOutputs: ["objective", "decision_route", "tactics"],
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: CR,
    journeyStep: 2,
    type: "agent.completed",
    at: at(27),
    payload: { summary: "Council records complete: order, papers, dates captured", verb: "completed", agentKey: "local_government" },
  }),
  ev({
    campaignId: CID,
    agentRunId: EA,
    journeyStep: 2,
    type: "agent.completed",
    at: at(28),
    payload: { summary: "Claim decisions issued; one conflict left visible", verb: "completed", agentKey: "evidence_adjudicator" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 2,
    type: "section.status",
    at: at(29),
    stateVersion: 3,
    payload: {
      summary: "Research and evidence accepted",
      sectionStep: 2,
      sectionStatus: "accepted",
      detail: {
        stepReport:
          "Confirmed the responsible authority and the experimental order; one date conflict left open as a judgement.",
        content: {
          summary:
            "Leicester City Council introduced an 18-month experimental school-street order; a permanence decision is due at cabinet in September 2026.",
          keyDates: ["Experimental order lapses September 2026", "Cabinet decision due September 2026"],
          institutions: ["Leicester City Council", "Highways & Transport division"],
          unresolved: ["Exact scrutiny committee date (two sources disagree)"],
          // extra field beyond the schema — preserved and rendered as labelled lines
          keyClaims: [
            { text: "Leicester City Council is the highways authority", label: "Verified public information" },
            { text: "Experimental order lapses September 2026", label: "Verified public information" },
            { text: "Exact scrutiny date", label: "Conflicting evidence" },
          ],
        },
        agentCount: 3,
        sourceCount: 4,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: RD,
    journeyStep: 1,
    type: "agent.completed",
    at: at(30),
    payload: { summary: "Scope brief complete; research questions handed on", verb: "completed", agentKey: "research_director" },
  }),

  // ---- objective (step 3) — includes a silent model turn for the demo ----
  ev({
    campaignId: CID,
    agentRunId: OB,
    journeyStep: 3,
    type: "agent.started",
    at: at(31),
    payload: { summary: "Setting the objective and theory of change", verb: "drafting", agentKey: "objective_strategist" },
  }),
  ev({
    campaignId: CID,
    agentRunId: OB,
    journeyStep: 3,
    type: "work.update",
    at: at(34),
    payload: { summary: "Framing a meaningful interim win if permanence slips", verb: "framing", agentKey: "objective_strategist" },
  }),
  // (long silent turn here: the card shows "Analysis in progress · MM:SS")
  ev({
    campaignId: CID,
    agentRunId: OB,
    journeyStep: 3,
    type: "proposal.submitted",
    at: at(44),
    payload: { summary: "Proposed the campaign objective", verb: "proposing", agentKey: "objective_strategist", proposalId: "p-objective" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 3,
    type: "section.status",
    at: at(44),
    stateVersion: 3,
    payload: { summary: "Objective under review", sectionStep: 3, sectionStatus: "under_review" },
  }),
  ev({
    campaignId: CID,
    agentRunId: SR,
    journeyStep: 3,
    type: "proposal.accepted",
    at: at(46),
    stateVersion: 4,
    payload: { summary: "Accepted the objective; rejects a token win", verb: "accepted", agentKey: "synthesis_reviewer", proposalId: "p-objective" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 3,
    type: "section.status",
    at: at(46),
    stateVersion: 4,
    payload: {
      summary: "Objective accepted",
      sectionStep: 3,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Objective names the decision-maker, the action, the date, and a meaningful interim win.",
        content: {
          dm: "Leicester City Council cabinet",
          action: "make the school-street order permanent with camera enforcement",
          by: "the September 2026 cabinet meeting",
          mvw: "a cabinet commitment to extend the experimental order while enforcement is procured",
          success: "A permanent Traffic Regulation Order with enforcement funded in the 2026/27 highways budget.",
          constraints: ["No new statutory consultation can start after July 2026", "Enforcement cameras need procurement lead time"],
          smart: [
            { test: "Specific", assessment: "One named order outside one named school" },
            { test: "Measurable", assessment: "Order made permanent; enforcement live" },
            { test: "Time-bound", assessment: "September 2026 cabinet" },
          ],
        },
        agentCount: 2,
        sourceCount: 2,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: OB,
    journeyStep: 3,
    type: "agent.completed",
    at: at(47),
    payload: { summary: "Objective and theory of change complete", verb: "completed", agentKey: "objective_strategist" },
  }),

  // ---- decision route (step 4) ----
  ev({
    campaignId: CID,
    agentRunId: DR,
    journeyStep: 4,
    type: "agent.started",
    at: at(48),
    payload: { summary: "Mapping the formal decision route", verb: "mapping", agentKey: "decision_route" },
  }),
  ev({
    campaignId: CID,
    agentRunId: DR,
    journeyStep: 4,
    type: "source.fetch.completed",
    at: at(51),
    payload: {
      summary: "Fetched the council's constitution: TRO decisions sit with cabinet",
      verb: "fetched",
      agentKey: "decision_route",
      sourceIds: ["src-constitution"],
    },
  }),
  ev({
    campaignId: CID,
    journeyStep: 4,
    type: "section.status",
    at: at(56),
    stateVersion: 5,
    payload: {
      summary: "Decision route accepted",
      sectionStep: 4,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Formal authority, implementer, and the two realistic intervention points are mapped.",
        content: {
          formal: "Leicester City Council cabinet",
          implementer: "Highways & Transport division",
          practical:
            "Officers draft the permanence report; the lead member for transport effectively decides whether it reaches the September agenda.",
          processes: ["Objection review on the experimental order", "Scrutiny commission pre-decision review", "Cabinet decision"],
          interventionPoints: ["Formal support submissions before the objection deadline", "Scrutiny commission public questions"],
          deadlines: ["Objection window closes July 2026", "Cabinet papers published 10 days before the meeting"],
          unresolved: ["Exact scrutiny committee date (subject of the open judgement)"],
        },
        agentCount: 1,
        sourceCount: 2,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: DR,
    journeyStep: 4,
    type: "agent.completed",
    at: at(57),
    payload: { summary: "Decision route mapped end to end", verb: "completed", agentKey: "decision_route" },
  }),

  // ---- power (step 5) ----
  ev({
    campaignId: CID,
    agentRunId: PW,
    journeyStep: 5,
    type: "agent.started",
    at: at(58),
    payload: { summary: "Building the role-based power map", verb: "mapping", agentKey: "power_stakeholder" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 5,
    type: "section.status",
    at: at(64),
    stateVersion: 6,
    payload: {
      summary: "Power map accepted",
      sectionStep: 5,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Five roles mapped; two positions are inferred and flagged for human confirmation.",
        content: {
          statusQuoCost:
            "Doing nothing lets the order lapse by default — the cheapest outcome for officers, the worst for the school.",
          stakeholders: [
            {
              name: "Cabinet lead for transport",
              role: "Decision-maker",
              tier: "decides",
              power: "High",
              position: "Publicly supportive of school streets programme",
              positionStatus: "Verified public information",
              ask: "Put the permanence report on the September agenda",
              approach: "Formal letter plus a school-gate visit invitation",
            },
            {
              name: "Highways officers",
              role: "Report authors",
              tier: "influences",
              power: "Medium-High",
              position: "Neutral; will follow the objection-count evidence",
              positionStatus: "Supported inference",
              ask: "Include the school's monitoring data in the report",
            },
            {
              name: "School head & governors",
              tier: "mobilises",
              power: "Medium",
              position: "Strongly in favour",
              positionStatus: "Verified public information",
              ask: "Coordinate parent submissions before the objection deadline",
            },
            {
              name: "Parents & residents' group",
              tier: "mobilises",
              power: "Medium",
              position: "Mostly in favour; some residents want parking exemptions",
              positionStatus: "Campaign assumption",
              ask: "Collect signed support statements",
            },
            {
              name: "Through-traffic drivers' lobby",
              tier: "resists",
              power: "Low-Medium",
              position: "Objected to the experimental order",
              positionStatus: "Verified public information",
            },
          ],
        },
        agentCount: 1,
        sourceCount: 3,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: PW,
    journeyStep: 5,
    type: "agent.completed",
    at: at(65),
    payload: { summary: "Power map complete; two positions need confirming", verb: "completed", agentKey: "power_stakeholder" },
  }),

  // ---- pressure (step 6) ----
  ev({
    campaignId: CID,
    agentRunId: PR,
    journeyStep: 6,
    type: "agent.started",
    at: at(66),
    payload: { summary: "Analysing pressures on the decision-maker", verb: "analysing", agentKey: "pressure_analysis" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 6,
    type: "section.status",
    at: at(72),
    stateVersion: 7,
    payload: {
      summary: "Pressure analysis accepted",
      sectionStep: 6,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Two pressures with clear activation actions; evidence/inference boundaries marked.",
        content: {
          pressures: [
            {
              type: "Electoral",
              on: "the cabinet lead",
              why: "School streets poll strongly with families in the ward and the administration's active-travel pledge is public",
              whoApplies: "Parents and residents",
              channel: "signed support submissions and ward councillor contact",
              action: "Deliver 200+ support statements before the objection deadline",
            },
            {
              type: "Reputational",
              on: "the council",
              why: "Letting a monitored, successful trial lapse contradicts the council's published transport strategy",
              whoApplies: "School, local media",
              channel: "monitoring-data story offered to local press",
              evidence: "Council's own interim monitoring showed compliance and reduced peak traffic",
              action: "Publish the school's before/after data alongside the council's targets",
            },
          ],
        },
        agentCount: 1,
        sourceCount: 2,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: PR,
    journeyStep: 6,
    type: "agent.completed",
    at: at(73),
    payload: { summary: "Pressure analysis complete", verb: "completed", agentKey: "pressure_analysis" },
  }),

  // ---- strategy (step 7) ----
  ev({
    campaignId: CID,
    agentRunId: SA,
    journeyStep: 7,
    type: "agent.started",
    at: at(74),
    payload: { summary: "Designing the campaign strategy", verb: "designing", agentKey: "strategy_architect" },
  }),
  ev({
    campaignId: CID,
    agentRunId: SA,
    journeyStep: 7,
    type: "work.update",
    at: at(78),
    payload: { summary: "Weighing a confrontational route against an inside-track route", verb: "weighing", agentKey: "strategy_architect" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 7,
    type: "section.status",
    at: at(84),
    stateVersion: 8,
    payload: {
      summary: "Strategy accepted after one revision",
      sectionStep: 7,
      sectionStatus: "accepted",
      detail: {
        stepReport:
          "Inside-track strategy with public-evidence backing; the confrontational alternative was explicitly rejected as riskier for a supportive decision-maker.",
        content: {
          narrative:
            "The council already believes in school streets — the campaign's job is to make permanence the easy, evidenced, publicly-backed choice before the order lapses.",
          route: "Support the sympathetic decision-maker with overwhelming local evidence rather than opposing the council.",
          audiences: ["Cabinet lead for transport", "Highways officers", "Ward councillors", "Parents at the school gate"],
          coalition: "School, governors, parents' group, and the walking & cycling forum.",
          phases: [
            { name: "Evidence", when: "Now – July", focus: "Support statements + monitoring data" },
            { name: "Formal window", when: "July", focus: "Objection-window submissions" },
            { name: "Decision", when: "Aug – Sept", focus: "Scrutiny questions and cabinet attendance" },
          ],
          tradeoffs: ["Inside-track goodwill traded against slower public visibility"],
          risks: ["A leadership reshuffle before September", "Objection count dominated by through-traffic drivers"],
          escalation: "If the report slips off the September agenda, move to public petition and press.",
          avoid: ["Framing the council as the enemy", "Any tactic that assumes volunteer capacity beyond ~15 parents"],
          indicators: ["Officer report recommends permanence", "200+ support submissions logged"],
        },
        agentCount: 2,
        sourceCount: 3,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: SA,
    journeyStep: 7,
    type: "agent.completed",
    at: at(85),
    payload: { summary: "Strategy complete; alternative recorded as rejected", verb: "completed", agentKey: "strategy_architect" },
  }),

  // judgement defaults after the human doesn't answer (non-blocking, honest)
  ev({
    campaignId: CID,
    agentRunId: EA,
    journeyStep: 2,
    type: "judgement.defaulted",
    at: at(86),
    payload: {
      summary: "Judgement defaulted to the Tier A cabinet date",
      verb: "defaulted",
      agentKey: "evidence_adjudicator",
      judgementId: "j-date",
      detail: { answer: "September 2026 cabinet (cabinet minutes)" },
    },
  }),

  // ---- tactics (step 8) ----
  ev({
    campaignId: CID,
    agentRunId: TP,
    journeyStep: 8,
    type: "agent.started",
    at: at(87),
    payload: { summary: "Sequencing tactics against the decision timeline", verb: "sequencing", agentKey: "tactics_planner" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 8,
    type: "section.status",
    at: at(93),
    stateVersion: 9,
    payload: {
      summary: "Tactics accepted",
      sectionStep: 8,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Three tactics, each with an owner, success sign, and human approval point.",
        content: {
          tactics: [
            {
              name: "Support-statement drive",
              phase: 1,
              type: "Organising",
              target: "Objection-window record",
              owner: "Parents' group",
              timing: "Before the July objection deadline",
              success: "200+ signed statements submitted",
              approval: "School approves the template letter",
            },
            {
              name: "Monitoring-data briefing",
              phase: 2,
              type: "Lobbying",
              target: "Highways officers",
              owner: "Governors",
              dependencies: "Council releases interim monitoring data",
              success: "Data cited in the officer report",
              approval: "Head signs off the briefing",
            },
            {
              name: "Scrutiny public question",
              phase: 3,
              type: "Institutional",
              target: "Scrutiny commission",
              owner: "Named parent volunteer",
              timing: "Committee meeting before cabinet",
              success: "Permanence recommendation minuted",
              escalation: "If refused, move to petition + press",
              approval: "Question text agreed with the coalition",
            },
          ],
        },
        agentCount: 1,
        sourceCount: 1,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: TP,
    journeyStep: 8,
    type: "agent.completed",
    at: at(94),
    payload: { summary: "Tactics sequenced with approvals", verb: "completed", agentKey: "tactics_planner" },
  }),

  // ---- organising (step 9) ----
  ev({
    campaignId: CID,
    agentRunId: OD,
    journeyStep: 9,
    type: "agent.started",
    at: at(95),
    payload: { summary: "Designing the organising plan", verb: "designing", agentKey: "organising_designer" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 9,
    type: "section.status",
    at: at(101),
    stateVersion: 10,
    payload: {
      summary: "Organising plan accepted",
      sectionStep: 9,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Ladder, roles, and capacity limits designed around ~15 active parents.",
        content: {
          whoActs: "Parents and carers at the school gate, coordinated by the existing parents' group.",
          whyParticipate: "Their children's daily safety, and a visible, winnable ask with a hard deadline.",
          asks: ["Sign a support statement", "Bring one other parent", "Attend the cabinet meeting in September"],
          roles: [
            { role: "Gate coordinator", what: "Runs the morning sign-up table" },
            { role: "Data steward", what: "Logs submissions before the deadline" },
          ],
          ladder: [
            { rung: "Sign", action: "Support statement in the objection window" },
            { rung: "Bring one", action: "Recruit one more parent" },
            { rung: "Show up", action: "Attend scrutiny or cabinet" },
          ],
          channels: ["School newsletter", "Gate conversations", "Class WhatsApp groups"],
          humanEssential: ["Conversations with hesitant residents", "Any contact with objectors"],
        },
        agentCount: 1,
        sourceCount: 0,
      },
    },
  }),
  ev({
    campaignId: CID,
    agentRunId: OD,
    journeyStep: 9,
    type: "agent.completed",
    at: at(102),
    payload: { summary: "Organising plan complete", verb: "completed", agentKey: "organising_designer" },
  }),

  // ---- documents (step 10) ----
  ev({
    campaignId: CID,
    agentRunId: LP,
    journeyStep: 10,
    type: "agent.started",
    at: at(103),
    payload: { summary: "Producing the Lobbying Pack", verb: "drafting", agentKey: "lobbying_producer" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 10,
    type: "document.status",
    at: at(104),
    payload: { summary: "Campaign Brief compiling", documentKey: "campaign_brief", documentStatus: "assembling" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 10,
    type: "document.status",
    at: at(107),
    payload: { summary: "Campaign Brief ready", documentKey: "campaign_brief", documentStatus: "ready" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 10,
    type: "document.status",
    at: at(108),
    payload: { summary: "Objective & Theory of Change ready", documentKey: "objective_theory_of_change", documentStatus: "ready" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 10,
    type: "document.status",
    at: at(110),
    payload: { summary: "Lobbying Pack needs verification", documentKey: "lobbying_pack", documentStatus: "needs verification" },
  }),
  ev({
    campaignId: CID,
    agentRunId: LP,
    journeyStep: 10,
    type: "agent.completed",
    at: at(111),
    payload: { summary: "Lobbying Pack drafted; two facts flagged for verification", verb: "completed", agentKey: "lobbying_producer" },
  }),
  ev({
    campaignId: CID,
    journeyStep: 10,
    type: "section.status",
    at: at(112),
    stateVersion: 11,
    payload: {
      summary: "Documents overview accepted",
      sectionStep: 10,
      sectionStatus: "accepted",
      detail: {
        stepReport: "Docs 1–2 compiled; the Lobbying Pack carries explicit verification placeholders.",
        content: {
          summary:
            "Core documents compiled from the accepted brief; pack facts that couldn't be verified are marked, not invented.",
          notes: ["Lobbying Pack: two [VERIFY] placeholders on officer names", "Media and Digital packs queued next"],
        },
        agentCount: 1,
        sourceCount: 0,
      },
    },
  }),

  // ---- wrap up ----
  ev({
    campaignId: CID,
    agentRunId: SR,
    journeyStep: 10,
    type: "agent.completed",
    at: at(113),
    payload: { summary: "Final whole-campaign review: consistent, one open verification", verb: "completed", agentKey: "synthesis_reviewer" },
  }),
  ev({
    campaignId: CID,
    type: "receipt.campaign",
    at: at(114),
    payload: { summary: "Campaign Completion Receipt produced" },
  }),
  ev({
    campaignId: CID,
    type: "run.completed",
    at: at(115),
    stateVersion: 11,
    payload: { summary: "Run completed" },
  }),
];

export const FIXTURE_SEED = {
  problem:
    "Make the school street outside St John the Baptist CofE Primary permanent, with proper enforcement.",
  place: "Leicester (St John the Baptist CofE Primary School)",
};

export const FIXTURE_CAMPAIGN_ID = CID;
