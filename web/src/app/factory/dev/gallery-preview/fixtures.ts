// Canned 5-campaign event sequence for the gallery preview. These are ordinary
// public FactoryEvents — they go through the SAME W4 fold and W5 adapter the
// live gallery uses, so the preview exercises the real render path (not a mock
// renderer). Timestamps are relative to a supplied `now` so elapsed clocks and
// the completion→pill readable window behave realistically.

import type {
  AgentKey,
  FactoryEvent,
  FactoryEventPayload,
  FactoryEventType,
} from "@/lib/factory/contracts";

const BATCH = "batch-fixture-0001";

interface EmitOpts {
  agentRunId?: string;
  parentAgentRunId?: string;
  journeyStep?: number;
  stateVersion?: number;
  secAgo?: number;
}

class CampaignFixture {
  events: FactoryEvent[] = [];
  private seq = 0;
  constructor(
    readonly campaignId: string,
    private readonly now: number,
  ) {}

  private at(secAgo = 0): string {
    return new Date(this.now - secAgo * 1000).toISOString();
  }

  emit(
    type: FactoryEventType,
    payload: Partial<FactoryEventPayload> & { summary: string },
    opts: EmitOpts = {},
  ): void {
    this.seq += 1;
    this.events.push({
      eventId: `${this.campaignId}-${this.seq}`,
      sequence: this.seq,
      batchId: BATCH,
      campaignId: this.campaignId,
      agentRunId: opts.agentRunId,
      parentAgentRunId: opts.parentAgentRunId,
      journeyStep: opts.journeyStep,
      type,
      at: this.at(opts.secAgo ?? 0),
      stateVersion: opts.stateVersion,
      visibility: "public",
      payload: payload as FactoryEventPayload,
    });
  }
}

interface Row {
  type: FactoryEventType;
  summary: string;
  verb?: string;
  secAgo: number;
  sourceIds?: string[];
}

function agentRun(
  f: CampaignFixture,
  runId: string,
  key: AgentKey,
  o: {
    step?: number;
    parent?: string;
    startSecAgo: number;
    rows?: Row[];
    terminal?: { status: "complete" | "partial" | "failed"; summary: string; secAgo: number };
  },
): void {
  const base: EmitOpts = { agentRunId: runId, parentAgentRunId: o.parent, journeyStep: o.step };
  f.emit("agent.queued", { summary: "Queued", agentKey: key }, { ...base, secAgo: o.startSecAgo + 3 });
  f.emit(
    "agent.started",
    { summary: "Picked up the assignment", agentKey: key, verb: "started" },
    { ...base, secAgo: o.startSecAgo },
  );
  for (const r of o.rows ?? []) {
    f.emit(
      r.type,
      { summary: r.summary, verb: r.verb, agentKey: key, sourceIds: r.sourceIds },
      { ...base, secAgo: r.secAgo },
    );
  }
  if (o.terminal) {
    const type: FactoryEventType =
      o.terminal.status === "complete"
        ? "agent.completed"
        : o.terminal.status === "partial"
          ? "agent.partial"
          : "agent.failed";
    f.emit(type, { summary: o.terminal.summary, agentKey: key }, { ...base, secAgo: o.terminal.secAgo });
  }
}

export interface FixtureCampaign {
  campaignId: string;
  intake: { problem: string; place: string };
  events: FactoryEvent[];
}

export function buildFixtureCampaigns(now: number): FixtureCampaign[] {
  // ---- C1 · Leicester school street (RD handed off, specialists working) ----
  const c1 = new CampaignFixture("cmp-leicester", now);
  c1.emit("run.started", { summary: "Run started" }, { secAgo: 210 });
  agentRun(c1, "c1-rd", "research_director", {
    step: 1,
    startSecAgo: 205,
    rows: [
      { type: "source.search.started", summary: "Searching leicester.gov.uk", verb: "searching", secAgo: 200 },
      { type: "source.fetch.completed", summary: "Fetched cabinet decision page", verb: "fetched", secAgo: 190, sourceIds: ["s1"] },
      { type: "artefact.handoff", summary: "Handed scope to Council Records specialist", verb: "handoff", secAgo: 150 },
    ],
    terminal: { status: "complete", summary: "Scope brief accepted; two specialists selected", secAgo: 120 },
  });
  agentRun(c1, "c1-lg", "local_government", {
    step: 2,
    parent: "c1-rd",
    startSecAgo: 145,
    rows: [
      { type: "source.search.started", summary: "Searching Leicester committee minutes", verb: "searching", secAgo: 130 },
      { type: "source.fetch.completed", summary: "Fetched Highways cabinet report (PDF)", verb: "fetched", secAgo: 90, sourceIds: ["s2"] },
      { type: "source.fetch.completed", summary: "Fetched delegated decision notice", verb: "fetched", secAgo: 55, sourceIds: ["s3"] },
      { type: "evidence.found", summary: "Confirmed decision sits with the City Mayor, not full council", verb: "found", secAgo: 40 },
    ],
  });
  agentRun(c1, "c1-adj", "evidence_adjudicator", {
    step: 2,
    startSecAgo: 50,
    rows: [{ type: "work.update", summary: "Reviewing claims against fetched sources", verb: "working", secAgo: 48 }],
  });
  agentRun(c1, "c1-obj", "objective_strategist", { step: 3, startSecAgo: 8 });
  agentRun(c1, "c1-pow", "power_stakeholder", { step: 5, startSecAgo: 5 });
  c1.emit(
    "judgement.requested",
    {
      summary: "Which school street counts as the anchor site?",
      judgementId: "c1-j1",
      detail: {
        question: "Two nearby schools could anchor the campaign — which is primary?",
        options: ["St John the Baptist CofE", "Both, jointly"],
        provisionalDefault: "St John the Baptist CofE",
        kind: "scope_ambiguity",
        affectedOutputs: ["problem", "objective"],
      },
    },
    { agentRunId: "c1-rd", journeyStep: 1, secAgo: 100 },
  );

  // ---- C2 · Stratford shared bike (a proposal awaiting review, a handoff) ----
  const c2 = new CampaignFixture("cmp-stratford", now);
  c2.emit("run.started", { summary: "Run started" }, { secAgo: 200 });
  agentRun(c2, "c2-rd", "research_director", {
    step: 1,
    startSecAgo: 195,
    rows: [{ type: "artefact.handoff", summary: "Handed scope to Public Body specialist", verb: "handoff", secAgo: 160 }],
    terminal: { status: "complete", summary: "Scope brief accepted", secAgo: 150 },
  });
  agentRun(c2, "c2-pb", "public_body", {
    step: 2,
    parent: "c2-rd",
    startSecAgo: 148,
    rows: [
      { type: "source.fetch.completed", summary: "Fetched LLDC access policy", verb: "fetched", secAgo: 100, sourceIds: ["s4"] },
      { type: "proposal.submitted", summary: "Proposed decision route for QEOP cycle access", verb: "proposing", secAgo: 30 },
    ],
  });
  agentRun(c2, "c2-route", "decision_route", {
    step: 4,
    startSecAgo: 70,
    rows: [{ type: "artefact.handoff", summary: "Passing route map to Strategy Architect", verb: "handoff", secAgo: 12 }],
  });
  agentRun(c2, "c2-strat", "strategy_architect", { step: 7, startSecAgo: 20 });

  // ---- C3 · Brighton cabinet decision (6 agents → per-campaign cap of 3) ----
  const c3 = new CampaignFixture("cmp-brighton", now);
  c3.emit("run.started", { summary: "Run started" }, { secAgo: 180 });
  agentRun(c3, "c3-rd", "research_director", {
    step: 1,
    startSecAgo: 175,
    rows: [{ type: "artefact.handoff", summary: "Handed scope to Council Records specialist", verb: "handoff", secAgo: 60 }],
  });
  agentRun(c3, "c3-lg", "local_government", {
    step: 2,
    parent: "c3-rd",
    startSecAgo: 58,
    rows: [{ type: "source.fetch.completed", summary: "Fetched cabinet forward plan", verb: "fetched", secAgo: 30, sourceIds: ["s5"] }],
  });
  agentRun(c3, "c3-pow", "power_stakeholder", { step: 5, startSecAgo: 40 });
  agentRun(c3, "c3-pre", "pressure_analysis", { step: 6, startSecAgo: 25 });
  agentRun(c3, "c3-tac", "tactics_planner", { step: 8, startSecAgo: 15 });
  agentRun(c3, "c3-med", "media_producer", { step: 10, startSecAgo: 4 });

  // ---- C4 · Ham/Kingston bathing water (a fresh failure + a conflict) ----
  const c4 = new CampaignFixture("cmp-ham", now);
  c4.emit("run.started", { summary: "Run started" }, { secAgo: 170 });
  agentRun(c4, "c4-rd", "research_director", {
    step: 1,
    startSecAgo: 165,
    terminal: { status: "complete", summary: "Scope brief accepted", secAgo: 140 },
  });
  agentRun(c4, "c4-pb", "public_body", {
    step: 2,
    parent: "c4-rd",
    startSecAgo: 138,
    rows: [
      { type: "source.fetch.failed", summary: "Environment Agency page returned 503", verb: "fetch failed", secAgo: 20 },
      { type: "agent.retry", summary: "Retrying the Environment Agency fetch", verb: "retrying", secAgo: 10 },
    ],
    // completes (fails) 0.3s ago → inside the readable window, so it shows
    // expanded (failure priority) and then collapses to a pill.
    terminal: { status: "failed", summary: "Could not reach the bathing-water designation record", secAgo: 0.3 },
  });
  agentRun(c4, "c4-adj", "evidence_adjudicator", {
    step: 2,
    startSecAgo: 45,
    rows: [{ type: "evidence.conflicted", summary: "Two sources disagree on current designation status", verb: "conflict", secAgo: 15 }],
  });
  agentRun(c4, "c4-obj", "objective_strategist", { step: 3, startSecAgo: 6 });

  // ---- C5 · Barnes bus consultation (COMPLETED → Completion Receipt) ----
  const c5 = new CampaignFixture("cmp-barnes", now);
  c5.emit("run.started", { summary: "Run started" }, { secAgo: 400 });
  agentRun(c5, "c5-rd", "research_director", {
    step: 1,
    startSecAgo: 395,
    terminal: { status: "complete", summary: "Scope brief accepted", secAgo: 360 },
  });
  agentRun(c5, "c5-lm", "local_media", {
    step: 2,
    parent: "c5-rd",
    startSecAgo: 355,
    rows: [{ type: "source.fetch.completed", summary: "Fetched TfL consultation page", verb: "fetched", secAgo: 300, sourceIds: ["s6"] }],
    terminal: { status: "complete", summary: "Local context gathered", secAgo: 280 },
  });
  agentRun(c5, "c5-strat", "strategy_architect", {
    step: 7,
    startSecAgo: 250,
    terminal: { status: "complete", summary: "Strategy accepted after one revision", secAgo: 120 },
  });
  agentRun(c5, "c5-org", "organising_designer", {
    step: 9,
    startSecAgo: 110,
    terminal: { status: "complete", summary: "Organising plan accepted", secAgo: 60 },
  });
  // accepted sections + ready documents so the receipt shows real counts
  for (const [step, key] of [
    [1, "problem"],
    [2, "evidence"],
    [3, "objective"],
    [4, "decision_route"],
    [7, "strategy"],
    [9, "organising"],
  ] as const) {
    c5.emit(
      "section.status",
      { summary: `Accepted: ${key}`, sectionStep: step, sectionStatus: "accepted" },
      { journeyStep: step, stateVersion: step, secAgo: 90 },
    );
  }
  for (const doc of ["campaign_brief", "campaign_strategy", "organising_plan"]) {
    c5.emit("document.status", { summary: `${doc} ready`, documentKey: doc, documentStatus: "ready" }, { secAgo: 40 });
  }
  c5.emit("run.completed", { summary: "Campaign substantially complete" }, { secAgo: 30 });
  c5.emit("receipt.campaign", { summary: "Campaign completion receipt produced" }, { secAgo: 25 });

  return [
    {
      campaignId: c1.campaignId,
      intake: { problem: "The council plans to remove the school street outside the primary", place: "Leicester" },
      events: c1.events,
    },
    {
      campaignId: c2.campaignId,
      intake: { problem: "Shared bikes are locked out of the Olympic Park", place: "Stratford, London" },
      events: c2.events,
    },
    {
      campaignId: c3.campaignId,
      intake: { problem: "A cabinet decision threatens a valued public service", place: "Brighton & Hove" },
      events: c3.events,
    },
    {
      campaignId: c4.campaignId,
      intake: { problem: "The river needs bathing-water designation", place: "Ham & Kingston" },
      events: c4.events,
    },
    {
      campaignId: c5.campaignId,
      intake: { problem: "A local bus route is under consultation for cuts", place: "Barnes" },
      events: c5.events,
    },
  ];
}
