// Pure Factory Event fold (W4). Events → RunViewModel, decoupled from any
// transport: the live SSE hook, the polling fallback, and W7's stored-event
// replay all feed the SAME function so live and replay render identically.
//
// Design rules:
//  - PURE: no Date.now(), no randomness, no EventSource. Same input → same output.
//    (Elapsed timers live in the components, which tick the clock themselves.)
//  - Tolerates out-of-order arrival: events are sorted by `sequence` and
//    de-duplicated before folding.
//  - Reads only the neutral FactoryEvent contract. Section content and judgement
//    detail arrive inside `payload.detail` (the events-only read model carries no
//    separate state), so the fold reads them defensively from there.
//
// Two entry points share one event-application core:
//  - foldEvents(): the pure one-shot fold (normalise → apply all → RunVM).
//  - createFold()/foldInto(): an incremental accumulator for high-rate consumers
//    (replay, verbose live streams). It folds ONLY the new events on each call
//    (O(new) per batch instead of O(all)) and falls back to a full deterministic
//    refold whenever a batch arrives out of order or resends a sequence — so the
//    result is always identical to foldEvents() over the union.

import {
  ALL_AGENT_DEFS,
  CANONICAL_DOCUMENTS,
  JOURNEY_STEPS,
  UI_LIMITS,
  type AgentDef,
  type AgentKey,
  type AgentRunStatus,
  type CanonicalDocumentKey,
  type DocumentStatus,
  type FactoryEvent,
  type FactoryEventType,
  type JourneyStepKey,
  type JudgementKind,
  type JudgementStatus,
  type NextCheck,
  type RunStatus,
  type SectionStatus,
  type TerminalGap,
} from "@/lib/factory/contracts";

// ---- View-model types (what the UI renders) ----

export interface BackscrollRow {
  key: string; // eventId (stable react key)
  sequence: number;
  at: string; // ISO
  type: FactoryEventType;
  verb: string; // short present-tense verb for dense monospace column
  summary: string; // human-readable sans prose, rendered verbatim
  sourceCount: number; // sources referenced by this event (for the count column)
}

export interface AgentCardVM {
  agentRunId: string;
  agentKey?: AgentKey;
  displayName: string;
  shortName: string;
  responsibility?: string;
  kind?: "fixed" | "specialist";
  parentAgentRunId?: string;
  journeyStep?: number;
  status: AgentRunStatus; // queued | running | complete | partial | failed
  currentVerb?: string;
  /** Real bounded assignment from agent.started detail.task (≤200 chars).
   *  Absent on old recordings — consumers fall back to responsibility. */
  task?: string;
  lastEvent?: BackscrollRow; // last meaningful event (card header line)
  lastFinding?: BackscrollRow; // latest useful finding / uncertainty
  backscroll: BackscrollRow[]; // ring buffer, oldest → newest
  startedAt?: string;
  completedAt?: string;
  lastEventAt?: string;
  sourceCount: number;
  handoffCount: number;
  order: number; // stable spawn order for layout
}

export interface StepReceiptVM {
  at: string;
  agentCount: number;
  sourceCount: number;
}

export interface SectionVM {
  step: number;
  key: JourneyStepKey;
  title: string;
  status: SectionStatus; // empty | assembling | under_review | accepted | needs_verification
  content?: unknown; // accepted section content (shape per W1 sections.ts)
  stepReport?: string; // reviewer's Step Report, shown on the collapsed receipt toggle
  acceptedAtVersion?: number;
  lastActivityAt?: string;
  receipt?: StepReceiptVM; // Step Build Receipt (populated once accepted/verified)
}

/** A published piece of the campaign brief: created when a section's content is
 *  accepted/applied (proposal.applied / section.status accepted). Persistent —
 *  these accumulate down the campaign column so the brief visibly assembles. */
export interface PublishedCardVM {
  key: string; // stable per section (the journey step key)
  step: number;
  sectionKey: JourneyStepKey;
  title: string; // detail.sectionTitle, falling back to the canonical step title
  excerpt?: string; // detail.excerpt (≤280 chars) → content string → event summary
  at: string; // ISO of the latest publish event for this section
  sequence: number;
}

export interface JudgementVM {
  id: string;
  kind?: JudgementKind;
  question: string;
  options: string[];
  provisionalDefault?: string;
  rationale?: string;
  affectedOutputs: string[];
  status: JudgementStatus; // open | defaulted | resolved
  answer?: string;
  at: string;
  step?: number;
}

export interface DocumentVM {
  key: CanonicalDocumentKey;
  name: string;
  num: number;
  status?: DocumentStatus;
  at?: string;
}

export interface EvidenceTally {
  found: number;
  conflicted: number;
  gaps: number;
}

export interface RunVM {
  campaignId: string;
  batchId?: string;
  status: RunStatus; // queued | running | completed | partial | failed | cancelled
  stateVersion: number;
  lastSequence: number;
  problem?: string;
  place?: string;
  startedAt?: string;
  agents: AgentCardVM[]; // spawn order
  sections: Record<JourneyStepKey, SectionVM>;
  /** Accepted/applied brief pieces in publish order (oldest → newest). */
  publishedCards: PublishedCardVM[];
  judgements: JudgementVM[];
  documents: DocumentVM[];
  terminalGaps: TerminalGap[];
  nextChecks: NextCheck[];
  evidence: EvidenceTally;
  receiptAt?: string; // campaign completion receipt timestamp
}

// ---- helpers ----

const AGENT_BY_KEY = new Map<string, AgentDef>(ALL_AGENT_DEFS.map((a) => [a.key, a]));
const STEP_BY_NUM = new Map<number, (typeof JOURNEY_STEPS)[number]>(
  JOURNEY_STEPS.map((s) => [s.step, s]),
);
const BACKSCROLL_CAP = Math.max(200, UI_LIMITS.backscrollVirtualiseAfterRows * 2);
const EXCERPT_CAP = 280;

// Default present-tense verb when payload.verb is absent. Kept terse for the
// compact monospace verb column; never invents intermediate model "thoughts".
const DEFAULT_VERB: Partial<Record<FactoryEventType, string>> = {
  "agent.queued": "queued",
  "agent.started": "started",
  "agent.completed": "completed",
  "agent.partial": "partial",
  "agent.failed": "failed",
  "agent.retry": "retrying",
  "agent.replaced": "replaced",
  "specialist.requested": "requesting",
  "specialist.approved": "approved",
  "specialist.rejected": "declined",
  "specialist.spawned": "spawned",
  "source.search.started": "searching",
  "source.search.completed": "searched",
  "source.search.failed": "search failed",
  "source.fetch.started": "fetching",
  "source.fetch.completed": "fetched",
  "source.fetch.failed": "fetch failed",
  "evidence.found": "found",
  "evidence.conflicted": "conflict",
  "evidence.gap": "gap",
  "artefact.handoff": "handoff",
  "proposal.submitted": "proposing",
  "proposal.accepted": "accepted",
  "proposal.returned": "returned",
  "proposal.rejected": "rejected",
  "proposal.applied": "applied",
  "judgement.requested": "asking",
  "judgement.defaulted": "defaulted",
  "judgement.resolved": "resolved",
  "work.update": "working",
  "section.status": "section",
  "document.status": "document",
  "gap.terminal": "gap",
  "receipt.campaign": "receipt",
  "receipt.batch": "receipt",
  "cost.update": "cost",
};

const FINDING_TYPES = new Set<FactoryEventType>([
  "evidence.found",
  "evidence.conflicted",
  "evidence.gap",
  "source.fetch.completed",
  "proposal.submitted",
  "proposal.accepted",
  "work.update",
]);

function detailStr(detail: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = detail?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}
function detailArr(detail: Record<string, unknown> | undefined, key: string): string[] {
  const v = detail?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function detailNum(detail: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = detail?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function truncateExcerpt(s: string, cap: number = EXCERPT_CAP): string {
  const t = s.trim();
  return t.length <= cap ? t : `${t.slice(0, cap - 1).trimEnd()}…`;
}

function emptySections(): Record<JourneyStepKey, SectionVM> {
  const out = {} as Record<JourneyStepKey, SectionVM>;
  for (const s of JOURNEY_STEPS) {
    out[s.key] = { step: s.step, key: s.key, title: s.title, status: "empty" };
  }
  return out;
}

/** Sort + de-dupe by sequence. Later events with the same sequence win (a resend
 *  carries the freshest payload); ties without sequence keep arrival order. */
export function normaliseEvents<P>(events: FactoryEvent<P>[]): FactoryEvent<P>[] {
  const bySeq = new Map<number, FactoryEvent<P>>();
  const noSeq: FactoryEvent<P>[] = [];
  for (const e of events) {
    if (typeof e.sequence === "number") bySeq.set(e.sequence, e);
    else noSeq.push(e);
  }
  const sorted = [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
  return [...sorted, ...noSeq];
}

export interface FoldSeed {
  problem?: string;
  place?: string;
}

// ---- the fold core (shared by the pure fold and the incremental accumulator) ----

interface FoldCtx {
  run: RunVM;
  agentMap: Map<string, AgentCardVM>;
  judgementMap: Map<string, JudgementVM>;
  docMap: Map<CanonicalDocumentKey, DocumentVM>;
  gapSeen: Set<string>;
  publishedBySection: Map<JourneyStepKey, PublishedCardVM>;
  spawnCounter: number;
}

function createCtx(campaignId: string, seed?: FoldSeed): FoldCtx {
  const run: RunVM = {
    campaignId,
    status: "queued",
    stateVersion: 0,
    lastSequence: 0,
    problem: seed?.problem,
    place: seed?.place,
    agents: [],
    sections: emptySections(),
    publishedCards: [],
    judgements: [],
    documents: CANONICAL_DOCUMENTS.map((d) => ({ key: d.key, name: d.name, num: d.num })),
    terminalGaps: [],
    nextChecks: [],
    evidence: { found: 0, conflicted: 0, gaps: 0 },
  };
  return {
    run,
    agentMap: new Map(),
    judgementMap: new Map(),
    docMap: new Map(run.documents.map((d) => [d.key, d])),
    gapSeen: new Set(),
    publishedBySection: new Map(),
    spawnCounter: 0,
  };
}

/** Apply ONE event to the fold context. Deterministic given event order. */
function applyEvent(ctx: FoldCtx, e: FactoryEvent): void {
  const { run } = ctx;
  if (e.visibility && e.visibility === "internal") return; // never render internal events
  if (typeof e.sequence === "number" && e.sequence > run.lastSequence) run.lastSequence = e.sequence;
  if (typeof e.stateVersion === "number" && e.stateVersion > run.stateVersion) {
    run.stateVersion = e.stateVersion;
  }
  const p = e.payload || ({ summary: "" } as FactoryEvent["payload"]);
  const detail = p.detail;

  // ---- run lifecycle ----
  switch (e.type) {
    case "run.queued":
      run.status = "queued";
      break;
    case "run.started":
      run.status = "running";
      run.startedAt = run.startedAt || e.at;
      run.problem = detailStr(detail, "problem") || run.problem;
      run.place = detailStr(detail, "place") || run.place;
      break;
    case "run.completed":
      run.status = "completed";
      break;
    case "run.partial":
      run.status = "partial";
      break;
    case "run.failed":
      run.status = "failed";
      break;
    case "run.cancelled":
      run.status = "cancelled";
      break;
    case "receipt.campaign":
      run.receiptAt = e.at;
      break;
    default:
      break;
  }
  if (e.batchId && !run.batchId) run.batchId = e.batchId;

  // ---- evidence tally ----
  if (e.type === "evidence.found") run.evidence.found += 1;
  else if (e.type === "evidence.conflicted") run.evidence.conflicted += 1;
  else if (e.type === "evidence.gap") run.evidence.gaps += 1;

  // ---- next checks (defensive: only if the worker attaches them) ----
  const nc = detail?.["nextChecks"];
  if (Array.isArray(nc)) {
    for (const raw of nc) {
      if (raw && typeof raw === "object" && typeof (raw as NextCheck).description === "string") {
        const check = raw as NextCheck;
        if (!run.nextChecks.some((x) => x.id === check.id || x.description === check.description)) {
          run.nextChecks.push(check);
        }
      }
    }
  }

  // ---- terminal gaps ----
  if (e.type === "gap.terminal") {
    const id = e.eventId || `${e.sequence}`;
    if (!ctx.gapSeen.has(id)) {
      ctx.gapSeen.add(id);
      run.terminalGaps.push({
        id,
        description: detailStr(detail, "description") || p.summary || "Unfinished work",
        agentRunId: e.agentRunId,
        step: p.sectionStep ?? e.journeyStep,
        at: e.at,
      });
    }
  }

  // ---- sections ----
  if (e.type === "section.status" || (e.type === "proposal.applied" && (p.sectionStatus || p.sectionStep))) {
    const stepNum = p.sectionStep ?? e.journeyStep;
    const def = stepNum ? STEP_BY_NUM.get(stepNum) : undefined;
    if (def) {
      const sec = run.sections[def.key];
      const status = (p.sectionStatus as SectionStatus) || sec.status;
      sec.status = status;
      sec.lastActivityAt = e.at;
      const content = detail?.["content"];
      if (content !== undefined) sec.content = content;
      const report = detailStr(detail, "stepReport");
      if (report) sec.stepReport = report;
      if (status === "accepted" || status === "needs_verification") {
        if (typeof e.stateVersion === "number") sec.acceptedAtVersion = e.stateVersion;
        sec.receipt = {
          at: e.at,
          agentCount: detailNum(detail, "agentCount") ?? 0,
          sourceCount: detailNum(detail, "sourceCount") ?? 0,
        };
      }

      // ---- published brief cards ----
      // A section's content is "published" when a proposal is applied to it or
      // its status lands on accepted / needs_verification. One persistent card
      // per section; a re-publish refreshes the excerpt/title/time in place.
      const published =
        e.type === "proposal.applied" || status === "accepted" || status === "needs_verification";
      if (published) {
        const title = detailStr(detail, "sectionTitle") || def.title;
        const excerpt =
          detailStr(detail, "excerpt") ??
          (typeof sec.content === "string" && sec.content.trim()
            ? truncateExcerpt(sec.content)
            : undefined) ??
          (p.summary ? truncateExcerpt(p.summary) : undefined);
        const existing = ctx.publishedBySection.get(def.key);
        if (existing) {
          existing.title = title;
          if (excerpt) existing.excerpt = excerpt;
          existing.at = e.at;
          if (typeof e.sequence === "number") existing.sequence = e.sequence;
        } else {
          const card: PublishedCardVM = {
            key: def.key,
            step: def.step,
            sectionKey: def.key,
            title,
            excerpt,
            at: e.at,
            sequence: typeof e.sequence === "number" ? e.sequence : 0,
          };
          ctx.publishedBySection.set(def.key, card);
          run.publishedCards.push(card);
        }
      }
    }
  }

  // ---- documents ----
  if (e.type === "document.status" && p.documentKey) {
    const doc = ctx.docMap.get(p.documentKey as CanonicalDocumentKey);
    if (doc) {
      doc.status = (p.documentStatus as DocumentStatus) || doc.status;
      doc.at = e.at;
    }
  }

  // ---- judgements ----
  if (p.judgementId && (e.type === "judgement.requested" || e.type === "judgement.defaulted" || e.type === "judgement.resolved")) {
    let j = ctx.judgementMap.get(p.judgementId);
    if (!j) {
      j = {
        id: p.judgementId,
        question: detailStr(detail, "question") || p.summary || "A judgement is requested",
        options: detailArr(detail, "options"),
        provisionalDefault: detailStr(detail, "provisionalDefault"),
        rationale: detailStr(detail, "rationale"),
        affectedOutputs: detailArr(detail, "affectedOutputs"),
        kind: (detailStr(detail, "kind") as JudgementKind) || undefined,
        status: "open",
        at: e.at,
        step: e.journeyStep,
      };
      ctx.judgementMap.set(p.judgementId, j);
      run.judgements.push(j);
    }
    if (e.type === "judgement.defaulted") {
      j.status = "defaulted";
      j.answer = detailStr(detail, "answer") || j.provisionalDefault;
    } else if (e.type === "judgement.resolved") {
      j.status = "resolved";
      j.answer = detailStr(detail, "answer") || j.answer;
    }
  }

  // ---- agents + backscroll ----
  if (e.agentRunId) {
    let a = ctx.agentMap.get(e.agentRunId);
    if (!a) {
      const def = lookupAgent(p.agentKey);
      a = {
        agentRunId: e.agentRunId,
        agentKey: (p.agentKey as AgentKey) || def?.key,
        displayName: p.agentDisplayName || def?.displayName || "Agent",
        shortName: def?.shortName || p.agentDisplayName || "Agent",
        responsibility: def?.responsibility,
        kind: def?.kind,
        parentAgentRunId: e.parentAgentRunId,
        journeyStep: e.journeyStep,
        status: "queued",
        backscroll: [],
        sourceCount: 0,
        handoffCount: 0,
        order: ctx.spawnCounter++,
      };
      ctx.agentMap.set(e.agentRunId, a);
      run.agents.push(a);
    }
    if (p.agentDisplayName && a.displayName === "Agent") a.displayName = p.agentDisplayName;
    if (e.parentAgentRunId) a.parentAgentRunId = e.parentAgentRunId;
    if (typeof e.journeyStep === "number") a.journeyStep = e.journeyStep;

    // real bounded assignment (agent.started detail.task; absent on old recordings)
    if (e.type === "agent.started" || e.type === "agent.queued") {
      const task = detailStr(detail, "task");
      if (task) a.task = task;
    }

    // status transitions
    if (e.type === "agent.queued") a.status = "queued";
    else if (e.type === "agent.started" || e.type === "agent.retry" || e.type === "agent.replaced") {
      a.status = "running";
      a.startedAt = a.startedAt || e.at;
    } else if (e.type === "agent.completed") {
      a.status = "complete";
      a.completedAt = e.at;
    } else if (e.type === "agent.partial") {
      a.status = "partial";
      a.completedAt = e.at;
    } else if (e.type === "agent.failed") {
      a.status = "failed";
      a.completedAt = e.at;
    }

    const srcCount = (p.sourceIds?.length ?? 0) || (detailNum(detail, "sourceCount") ?? 0);
    if (e.type === "source.fetch.completed") a.sourceCount += 1;
    if (e.type === "artefact.handoff") a.handoffCount += 1;

    const row: BackscrollRow = {
      key: e.eventId || `${e.agentRunId}:${e.sequence}`,
      sequence: e.sequence,
      at: e.at,
      type: e.type,
      verb: p.verb || DEFAULT_VERB[e.type] || e.type,
      summary: p.summary || "",
      sourceCount: srcCount,
    };
    if (row.summary) {
      a.backscroll.push(row);
      if (a.backscroll.length > BACKSCROLL_CAP) a.backscroll.splice(0, a.backscroll.length - BACKSCROLL_CAP);
      a.lastEvent = row;
      a.currentVerb = row.verb;
      a.lastEventAt = e.at;
      if (FINDING_TYPES.has(e.type)) a.lastFinding = row;
    }
  }
}

/** The fold. Deterministic: events (any order) → RunVM. */
export function foldEvents(
  campaignId: string,
  events: FactoryEvent[],
  seed?: FoldSeed,
): RunVM {
  const ctx = createCtx(campaignId, seed);
  for (const e of normaliseEvents(events)) applyEvent(ctx, e);
  // stable spawn order (defensive; push order already matches)
  ctx.run.agents.sort((x, y) => x.order - y.order);
  return ctx.run;
}

// ---- incremental fold accumulator ----

/** Fresh shallow snapshot so React state consumers get a new identity per fold
 *  step while the accumulator keeps mutating its internal view model. */
function snapshotRun(run: RunVM): RunVM {
  return {
    ...run,
    agents: [...run.agents],
    sections: { ...run.sections },
    publishedCards: [...run.publishedCards],
    judgements: [...run.judgements],
    documents: [...run.documents],
    terminalGaps: [...run.terminalGaps],
    nextChecks: [...run.nextChecks],
    evidence: { ...run.evidence },
  };
}

export interface FoldAccumulator {
  campaignId: string;
  seed?: FoldSeed;
  /** Latest immutable-ish snapshot (fresh identity after every foldInto). */
  snapshot: RunVM;
  /** @internal */ ctx: FoldCtx;
  /** @internal */ bySeq: Map<number, FactoryEvent>;
  /** @internal */ noSeq: FactoryEvent[];
  /** @internal */ maxSeq: number;
}

export function createFold(campaignId: string, seed?: FoldSeed): FoldAccumulator {
  const ctx = createCtx(campaignId, seed);
  return {
    campaignId,
    seed,
    snapshot: snapshotRun(ctx.run),
    ctx,
    bySeq: new Map(),
    noSeq: [],
    maxSeq: -1,
  };
}

/** Fold a batch of newly arrived events into the accumulator and return a fresh
 *  RunVM snapshot. In-order batches cost O(batch); an out-of-order or resent
 *  sequence triggers a full deterministic refold of everything retained (same
 *  result as foldEvents over the union — resends win, per normaliseEvents). */
export function foldInto(acc: FoldAccumulator, incoming: FactoryEvent[]): RunVM {
  if (incoming.length === 0) return acc.snapshot;

  let refold = false;
  const fresh: FactoryEvent[] = [];
  for (const e of incoming) {
    if (typeof e.sequence === "number") {
      if (e.sequence <= acc.maxSeq || acc.bySeq.has(e.sequence)) refold = true;
      acc.bySeq.set(e.sequence, e);
      if (e.sequence > acc.maxSeq) acc.maxSeq = e.sequence;
    } else {
      acc.noSeq.push(e);
    }
    fresh.push(e);
  }

  if (refold) {
    const ctx = createCtx(acc.campaignId, acc.seed);
    const ordered = [...acc.bySeq.values()].sort((a, b) => a.sequence - b.sequence);
    for (const e of ordered) applyEvent(ctx, e);
    for (const e of acc.noSeq) applyEvent(ctx, e);
    ctx.run.agents.sort((x, y) => x.order - y.order);
    acc.ctx = ctx;
  } else {
    fresh.sort(
      (a, b) =>
        (typeof a.sequence === "number" ? a.sequence : Number.MAX_SAFE_INTEGER) -
        (typeof b.sequence === "number" ? b.sequence : Number.MAX_SAFE_INTEGER),
    );
    for (const e of fresh) applyEvent(acc.ctx, e);
  }

  acc.snapshot = snapshotRun(acc.ctx.run);
  return acc.snapshot;
}

function lookupAgent(key?: string): AgentDef | undefined {
  return key ? AGENT_BY_KEY.get(key) : undefined;
}

// ---- derived selectors (used by the layout, kept out of the reducer) ----

const ACTIVE_STATUSES = new Set<AgentRunStatus>(["queued", "running"]);

/** Agents currently working a given journey step, priority-ordered so the layout
 *  can expand the most demanding one. Priority: failed/partial → running →
 *  queued, then most recent activity first. Completed agents are not "active". */
export function activeAgentsForStep(run: RunVM, step: number): AgentCardVM[] {
  return run.agents
    .filter((a) => ACTIVE_STATUSES.has(a.status) && a.journeyStep === step)
    .sort((x, y) => statusPriority(y) - statusPriority(x) || tMs(y.lastEventAt) - tMs(x.lastEventAt));
}

/** Agents active but not yet mapped to a concrete step (e.g. queued before their
 *  first step event). Rendered in a small holding workspace at the top. */
export function unassignedActiveAgents(run: RunVM): AgentCardVM[] {
  return run.agents
    .filter((a) => ACTIVE_STATUSES.has(a.status) && a.journeyStep == null)
    .sort((x, y) => tMs(y.lastEventAt) - tMs(x.lastEventAt));
}

export function activeAgentCount(run: RunVM): number {
  return run.agents.filter((a) => ACTIVE_STATUSES.has(a.status)).length;
}

export function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "partial" || status === "failed" || status === "cancelled";
}

function statusPriority(a: AgentCardVM): number {
  switch (a.status) {
    case "failed":
      return 4;
    case "partial":
      return 3;
    case "running":
      return 2;
    case "queued":
      return 1;
    default:
      return 0;
  }
}
function tMs(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
