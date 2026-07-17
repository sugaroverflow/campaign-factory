"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { foldEvents } from "@/lib/factory/client/fold";
import type { RunReadModel } from "@/lib/factory/contracts/api";
import type { CompiledDocument, EvidenceAndNextChecks } from "@/lib/factory/documents";
import {
  OPERATIONS_PUBLIC_CAMPAIGNS,
  hasConsistentOperationsDocumentEvidence,
  hasSyntheticUnavailableOperationsRunHeader,
  isOperationsCompiledDocumentList,
  isOperationsEvidenceAndNextChecks,
  isOperationsRunReadModel,
  normaliseOperationsSourceOrigin,
  type OperationsSourcePayload,
} from "@/lib/operations/source";

const STORAGE_KEY = "cf_operations_demo_v3";
const LEGACY_STORAGE_KEYS = ["cf_operations_demo_v2", "cf_operations_demo_v1"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PORTFOLIO_CAMPAIGNS: PortfolioCampaign[] = [...OPERATIONS_PUBLIC_CAMPAIGNS];
const SOURCE_CLIENT_TIMEOUT_MS = 15_000;
const SOURCE_CLIENT_FETCH_HEADERS = {
  accept: "application/json",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

function hasJsonResponseContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function sanitizeSourceRetryAfter(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d{1,5}$/.test(trimmed) ? trimmed : undefined;
}

function retryAfterMessage(retryAfter?: string) {
  return retryAfter ? `Source retry guidance: try again after ${retryAfter} second${retryAfter === "1" ? "" : "s"}.` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type SegmentId = "school_gates" | "ward_parents" | "local_allies";
type DraftId = "supporter_email" | "decision_maker_letter" | "press_pitch";
type DraftStatus = "draft" | "review" | "approved" | "queued";
type Mode = "compose" | "preview";
type StageStatus = "complete" | "current" | "blocked" | "soon";
type ViewId =
  | "overview"
  | "actions"
  | "brief"
  | "objectives"
  | "power"
  | "strategy"
  | "evidence"
  | "audiences"
  | "contacts"
  | "drafts"
  | "reviews"
  | "outbox"
  | "responses";

type Activity = {
  id: string;
  label: string;
};

type LocalActionStatus = "next" | "in_progress" | "blocked" | "done";

type LocalAction = {
  id: string;
  title: string;
  source: string;
  owner: string;
  timing: string;
  priority: "High" | "Medium" | "Low";
  status: LocalActionStatus;
  provenance: string;
};

type SourceWorkingCopy = {
  id: string;
  campaignId: string;
  title: string;
  channel: string;
  sourceDocument: string;
  sourceDocumentKey: string;
  createdAt: string;
  warnings: string[];
  provenance: string;
};

type WorkingDraft = {
  id: string;
  title: string;
  channel: string;
  subject: string;
  body: string;
  reviewerNote: string;
  status: DraftStatus;
  queuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceWorkingCopy: SourceWorkingCopy;
};

type DemoState = {
  workspaceKey: string;
  sourceStateVersion: number | null;
  sourceLastSequence: number | null;
  sourceDocumentSignature: string | null;
  selectedSegment: SegmentId;
  subject: string;
  body: string;
  reviewerNote: string;
  status: DraftStatus;
  mode: Mode;
  activeDraft: DraftId;
  activeView: ViewId;
  contactFilter: SegmentId | "all";
  contactReadinessFilter: "all" | "ready" | "review" | "blocked";
  scheduleIntent: "after_approval" | "tomorrow_morning" | "school_run";
  queuedAt: string | null;
  localActions: LocalAction[];
  workingDrafts: WorkingDraft[];
  activeWorkingDraftId: string | null;
  sourceWorkingCopy: SourceWorkingCopy | null;
  activity: Activity[];
};

type Segment = {
  id: SegmentId;
  name: string;
  role: string;
  contacts: number;
  ready: number;
  readiness: string;
  ask: string;
  caveat: string;
};

type NavItem = { id: ViewId; label: string; badge?: string; note: string };
type CampaignContextRow = { label: string; detail: string; use: string; owner: string };
type RunwayStage = { label: string; view: ViewId; status: StageStatus; statusLabel: string; detail: string };
type SourceStakeholder = { group: string; name: string; power: string; position: string };
type DraftLibraryItem = {
  id: DraftId;
  title: string;
  channel: string;
  state: string;
  detail: string;
  audience: string;
  requires: string;
  outline: string[];
};

type SourceResource = {
  id: string;
  title: string;
  channel: string;
  sourceDocument: string;
  sourceDocumentKey: string;
  subject: string;
  body: string;
  warnings: string[];
  preview: string;
};

type SourceTactic = {
  id: string;
  title: string;
  type: string;
  target: string;
  owner: string;
  timing: string;
  detail: string;
  priority: LocalAction["priority"];
};

type SourceAudienceSignal = {
  label: string;
  detail: string;
  status: string;
};

type RecommendedLocalAction = {
  id: string;
  title: string;
  detail: string;
  priority: LocalAction["priority"];
  disabled: boolean;
  create: () => void;
};

type CampaignSource = {
  campaignId: string;
  title: string;
  problem?: string;
  place?: string;
  runStatus: RunReadModel["status"];
  stateVersion: number;
  lastSequence: number;
  loadedAt: string;
  documents: CompiledDocument[];
  evidence: EvidenceAndNextChecks;
  readyCount: number;
  incompleteDocuments: CompiledDocument[];
  nextGate?: string;
  sourceHref: string;
  sourceOrigin: string;
};

type SourceState =
  | { status: "fixture" }
  | { status: "invalid"; campaignId: string }
  | { status: "loading"; campaignId: string }
  | { status: "error"; campaignId: string; title: string; message: string; sourceOrigin?: string; retryAfter?: string }
  | { status: "unavailable"; campaignId: string; title: string; message: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; retryAfter?: string }
  | { status: "ready"; source: CampaignSource };

type PortfolioCampaign = {
  id: string;
  sourceHref: string;
  conferenceHero?: boolean;
};

type PortfolioLocalCounts = {
  actions: number;
  drafts: number;
  reviews: number;
  queued: number;
};

type PortfolioItem =
  | { campaign: PortfolioCampaign; status: "loading"; local: PortfolioLocalCounts }
  | { campaign: PortfolioCampaign; status: "ready"; source: CampaignSource; local: PortfolioLocalCounts }
  | { campaign: PortfolioCampaign; status: "error"; title: string; message: string; sourceOrigin?: string; retryAfter?: string; local: PortfolioLocalCounts };

type CampaignSwitcherItem =
  | { campaign: PortfolioCampaign; status: "loading" }
  | { campaign: PortfolioCampaign; status: "ready"; source: CampaignSource }
  | { campaign: PortfolioCampaign; status: "error"; message: string };

type ContactFixture = {
  id: string;
  name: string;
  segmentId: SegmentId;
  segment: string;
  role: string;
  readiness: "Ready fixture" | "Review first" | "Blocked";
  consent: string;
  check: string;
  nextAction: string;
  owner: string;
};

const segments: Segment[] = [
  {
    id: "school_gates",
    name: "School-gate families",
    role: "Primary audience",
    contacts: 48,
    ready: 31,
    readiness: "31 fixture contacts have enough detail for a reviewed local email.",
    ask: "Ask families to back a permanent, enforced school street before the experimental order lapses.",
    caveat: "Contact details are demo fixtures; real import and consent checks are coming soon.",
  },
  {
    id: "ward_parents",
    name: "Nearby ward parents",
    role: "Pressure-building audience",
    contacts: 73,
    ready: 44,
    readiness: "44 fixture contacts include postcode-level relevance and school-run concern tags.",
    ask: "Invite parents nearby to show this is a neighbourhood safety issue, not only a school request.",
    caveat: "The workspace can draft for this segment, but live segmentation is not connected.",
  },
  {
    id: "local_allies",
    name: "Local allies and councillor watchers",
    role: "Review and escalation audience",
    contacts: 16,
    ready: 9,
    readiness: "9 fixture contacts are marked ready for careful, human-reviewed outreach.",
    ask: "Share the campaign ask with allies who can spot council process risks and amplify the decision route.",
    caveat: "No external contacts are messaged from this demo workspace.",
  },
];

const contacts: ContactFixture[] = [
  {
    id: "patel",
    name: "A. Patel",
    segmentId: "school_gates",
    segment: "School-gate families",
    role: "Parent supporter",
    readiness: "Ready fixture",
    consent: "Fixture opt-in noted; real consent record not imported",
    check: "Confirm current school-street timing before real use",
    nextAction: "Good for reviewed supporter email in this local demo",
    owner: "Campaigner",
  },
  {
    id: "johnson",
    name: "R. Johnson",
    segmentId: "school_gates",
    segment: "School-gate families",
    role: "Crossing volunteer",
    readiness: "Review first",
    consent: "Fixture relationship only",
    check: "Ask whether they want a public quote before escalation",
    nextAction: "Keep in review set; do not use for press outline yet",
    owner: "Local organiser",
  },
  {
    id: "davies",
    name: "M. Davies",
    segmentId: "ward_parents",
    segment: "Nearby ward parents",
    role: "Neighbourhood parent",
    readiness: "Ready fixture",
    consent: "Fixture postcode-level relevance; live import missing",
    check: "Verify ward relevance before a real provider list exists",
    nextAction: "Useful for broader supporter framing after review",
    owner: "Campaigner",
  },
  {
    id: "hussain",
    name: "S. Hussain",
    segmentId: "ward_parents",
    segment: "Nearby ward parents",
    role: "Resident supporter",
    readiness: "Blocked",
    consent: "No live consent source in this demo",
    check: "Needs real import and deduplication before use",
    nextAction: "Exclude from any provider list until import exists",
    owner: "Campaigner",
  },
  {
    id: "clean-air",
    name: "Clean Air Leicester",
    segmentId: "local_allies",
    segment: "Local allies and councillor watchers",
    role: "Ally organisation",
    readiness: "Review first",
    consent: "Organisation relationship is fixture-only",
    check: "Confirm named contact and escalation appetite before real use",
    nextAction: "Ask to review process risks before public escalation",
    owner: "Local organiser",
  },
  {
    id: "casework",
    name: "Ward casework watcher",
    segmentId: "local_allies",
    segment: "Local allies and councillor watchers",
    role: "Council-process watcher",
    readiness: "Blocked",
    consent: "Import and permission path coming soon",
    check: "Find a named, permissioned contact before outreach",
    nextAction: "Use as a reminder, not as a contact record",
    owner: "Campaigner",
  },
];

const draftLibrary: DraftLibraryItem[] = [
  {
    id: "supporter_email",
    title: "Supporter email",
    channel: "Email",
    state: "Editable",
    detail: "Working local draft for the selected audience, with compose and preview saved in this browser.",
    audience: "Selected audience segment",
    requires: "Human message review, evidence warnings understood, and explicit approval before local queueing.",
    outline: ["Invite local supporters to back the permanent school street.", "Ask for one local reason families support the change.", "Keep council timing and consent checks visible before real use."],
  },
  {
    id: "decision_maker_letter",
    title: "Decision-maker letter",
    channel: "Letter",
    state: "Staged fixture",
    detail: "Structured outline for the council route; not editable until the formal decision path is checked.",
    audience: "Council decision route, exact recipient not verified",
    requires: "Confirm order status, committee or officer ownership, legal wording, and sign-off route.",
    outline: ["Name the narrow ask: permanent, enforceable school-street decision.", "Show parent support only after consent-safe evidence is ready.", "Request the documented next step without overstating authority."],
  },
  {
    id: "press_pitch",
    title: "Press pitch",
    channel: "Media",
    state: "Staged fixture",
    detail: "Media prompt for later escalation; no newsroom contact list or provider is connected.",
    audience: "Local media and community reporters, not imported",
    requires: "Verify public claims, decide whether escalation helps the strategy, and confirm media contacts.",
    outline: ["Lead with safer school-run streets and the pending decision moment.", "Offer a campaigner voice only after human consent.", "Avoid implying council failure until evidence is checked."],
  },
];

const campaignContext = {
  brief: {
    title: "Campaign brief",
    intro:
      "Seeded school-street campaign brief, shown as fixture context rather than verified current research. Each section points to the operational work it should influence.",
    rows: [
      {
        label: "Outcome",
        detail: "Make the school street outside St John the Baptist CofE Primary permanent and enforced.",
        use: "Keep the ask narrow in supporter copy and the later decision-maker letter.",
        owner: "Campaigner",
      },
      {
        label: "Place",
        detail: "Leicester; school-run streets around St John the Baptist CofE Primary.",
        use: "Anchor audience selection to families and nearby ward parents before broader ally outreach.",
        owner: "Local organiser",
      },
      {
        label: "Narrative",
        detail: "Safer routes, cleaner air, and a council decision route parents can understand before the order lapses.",
        use: "Use this language in the editable supporter email, with the timing claim checked first.",
        owner: "Reviewer",
      },
      {
        label: "Provenance",
        detail: "Local fixture state for the OpenClaw Build Reveal; campaigners must verify current council process before real use.",
        use: "Keep demo/local truth labels visible across review and queue steps.",
        owner: "Workbench",
      },
    ],
  },
  objectives: {
    title: "Objective & targets",
    intro: "The target map keeps political decisions human-readable before drafting or approval.",
    rows: [
      {
        label: "Primary objective",
        detail: "Secure a permanent, enforced school-street decision before the experimental order lapses.",
        use: "Use as the subject-line spine and as the first review check.",
        owner: "Campaigner",
      },
      {
        label: "Decision-maker",
        detail: "Leicester City Council transport decision route; exact committee/officer path needs verification.",
        use: "Blocks the staged decision-maker letter until the formal route is checked.",
        owner: "Reviewer",
      },
      {
        label: "Influence targets",
        detail: "School leadership, ward councillors, nearby parents, clean-air allies, and local media only after review.",
        use: "Shapes the audience sequence and explains why supporter email comes before press work.",
        owner: "Local organiser",
      },
    ],
  },
  power: {
    title: "Power map",
    intro: "A plain map of who can help, block, or be persuaded without pretending fixture contacts are live campaign intelligence.",
    rows: [
      {
        label: "Allies",
        detail: "School-gate families, clean-air supporters, and councillor watchers who can validate local concerns.",
        use: "Start with the selected audience, then ask allies to check process risks before escalation.",
        owner: "Campaigner",
      },
      {
        label: "Persuadables",
        detail: "Nearby parents and ward residents affected by traffic but not yet involved.",
        use: "Use the ward-parents segment when copy needs broader neighbourhood framing.",
        owner: "Local organiser",
      },
      {
        label: "Potential blockers",
        detail: "Implementation cost concerns, enforcement doubts, and objections from through-traffic users.",
        use: "Keep the review gate focused on claims that could be challenged publicly.",
        owner: "Reviewer",
      },
    ],
  },
  strategy: {
    title: "Strategy & tactics",
    intro: "The campaign sequence connects the brief to reviewable communications work and keeps owners visible.",
    rows: [
      {
        label: "1. Verify route",
        detail: "Confirm order status, lapse timing, and who can make the permanent decision.",
        use: "Must happen before approving decision-maker or press materials.",
        owner: "Reviewer",
      },
      {
        label: "2. Build support",
        detail: "Invite school-gate families and nearby parents to record support and local reasons.",
        use: "This is the working supporter-email flow in Drafts and Reviews.",
        owner: "Campaigner",
      },
      {
        label: "3. Escalate carefully",
        detail: "Brief allies and prepare decision-maker contact only after evidence and consent checks are clear.",
        use: "Keeps staged draft types honest until they can be reviewed.",
        owner: "Local organiser",
      },
    ],
  },
  evidence: {
    title: "Evidence & checks",
    intro: "Claims stay visible until a person is comfortable with them; approval is blocked by judgement, not automation.",
    rows: [
      {
        label: "Council timing",
        detail: "Verify current order status and the deadline before using the draft externally.",
        use: "Mentioned in the review warning and should be checked before provider setup.",
        owner: "Reviewer",
      },
      {
        label: "Legal wording",
        detail: "Confirm the exact school-street order language and enforcement route.",
        use: "Prevents overclaiming in the supporter email and later formal letter.",
        owner: "Reviewer",
      },
      {
        label: "Contact consent",
        detail: "Fixture contacts are not a live consent record; import and reconciliation are Coming soon.",
        use: "Explains why outbox remains local and provider connection stays disabled.",
        owner: "Local organiser",
      },
    ],
  },
} satisfies Record<"brief" | "objectives" | "power" | "strategy" | "evidence", { title: string; intro: string; rows: CampaignContextRow[] }>;

const viewIds: ViewId[] = [
  "overview",
  "actions",
  "brief",
  "objectives",
  "power",
  "strategy",
  "evidence",
  "audiences",
  "contacts",
  "drafts",
  "reviews",
  "outbox",
  "responses",
];

const initialState: DemoState = {
  workspaceKey: "fixture",
  sourceStateVersion: null,
  sourceLastSequence: null,
  sourceDocumentSignature: null,
  selectedSegment: "school_gates",
  subject: "Make the St John the Baptist school street permanent",
  body:
    "Hello,\n\nWe are asking Leicester City Council to make the school street outside St John the Baptist CofE Primary permanent, with clear enforcement before the experimental order lapses.\n\nThe campaign is focused on safer school-run streets, cleaner air at the gates, and a decision route parents can follow. If you support the permanent order, please add your name to the campaign update and share one local reason this matters to your family.\n\nBefore any provider connection is used, a campaigner should check the council timing, the wording of the order, and whether this message fits your contact consent records.\n\nThank you,\nCampaign Factory demo workspace",
  reviewerNote: "",
  status: "draft",
  mode: "compose",
  activeDraft: "supporter_email",
  activeView: "overview",
  contactFilter: "all",
  contactReadinessFilter: "all",
  scheduleIntent: "after_approval",
  queuedAt: null,
  localActions: [],
  workingDrafts: [],
  activeWorkingDraftId: null,
  sourceWorkingCopy: null,
  activity: [{ id: "seed", label: "Demo workspace loaded with seeded campaign brief and local fixture contacts." }],
};

const statusCopy: Record<DraftStatus, { label: string; text: string }> = {
  draft: {
    label: "Draft",
    text: "Editable local draft. It has not been reviewed or queued.",
  },
  review: {
    label: "Needs human review",
    text: "A campaigner has marked this draft ready for checking. External action is still blocked.",
  },
  approved: {
    label: "Approved by human",
    text: "Approved for the demo queue only. Provider connection is not active.",
  },
  queued: {
    label: "Queued for demo",
    text: "Stored in this browser as a local demo queue item. Provider connection is off.",
  },
};

const stageStatusCopy: Record<StageStatus, string> = {
  complete: "Complete",
  current: "Current",
  blocked: "Blocked",
  soon: "Coming soon boundary",
};

const stageClass: Record<StageStatus, string> = {
  complete: "ops-stage-complete",
  current: "ops-stage-current",
  blocked: "ops-stage-blocked",
  soon: "ops-stage-soon",
};

const localActionStatusCopy: Record<LocalActionStatus, string> = {
  next: "Next",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

function exportFileName(label: string, extension: "json" | "md") {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "campaign-operations";
  const date = new Date().toISOString().slice(0, 10);
  return `${safeLabel}-operations-pack-${date}.${extension}`;
}

function downloadClientFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function normaliseLocalActions(actions: unknown): LocalAction[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action): action is Partial<LocalAction> => Boolean(action) && typeof action === "object")
    .map((action, index) => ({
      id: typeof action.id === "string" && action.id ? action.id : `local-action-${index + 1}`,
      title: typeof action.title === "string" && action.title ? action.title : "Untitled local action",
      source: typeof action.source === "string" && action.source ? action.source : "Local workspace",
      owner: typeof action.owner === "string" && action.owner ? action.owner : "Campaigner",
      timing: typeof action.timing === "string" && action.timing ? action.timing : "Next",
      priority: action.priority === "High" || action.priority === "Medium" || action.priority === "Low" ? action.priority : "Medium",
      status: action.status === "next" || action.status === "in_progress" || action.status === "blocked" || action.status === "done" ? action.status : "next",
      provenance: typeof action.provenance === "string" && action.provenance ? action.provenance : "Created in this browser-local operations workspace.",
    }));
}

function normaliseSourceWorkingCopy(value: unknown): SourceWorkingCopy | null {
  if (!value || typeof value !== "object") return null;
  const copy = value as Partial<SourceWorkingCopy>;
  if (!copy.id || !copy.title || !copy.sourceDocument || !copy.campaignId) return null;
  return {
    id: copy.id,
    campaignId: copy.campaignId,
    title: copy.title,
    channel: copy.channel || "Source draft",
    sourceDocument: copy.sourceDocument,
    sourceDocumentKey: copy.sourceDocumentKey || "source_document",
    createdAt: copy.createdAt || new Date().toISOString(),
    warnings: Array.isArray(copy.warnings) ? copy.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    provenance: copy.provenance || "Copied from a read-only Campaign Factory source document into this browser-local workspace.",
  };
}

function localActionMatchesWorkspace(action: LocalAction, expectedWorkspaceKey: string) {
  const idCampaignId = action.id.match(/^source:([0-9a-f-]{36})(?::|$)/i)?.[1];
  if (idCampaignId && idCampaignId !== expectedWorkspaceKey) return false;
  const provenanceCampaignId = action.provenance.match(/Source campaign\s+([0-9a-f-]{36})/i)?.[1];
  if (provenanceCampaignId && provenanceCampaignId !== expectedWorkspaceKey) return false;
  return true;
}

function normaliseWorkingDrafts(value: unknown, legacyState: Partial<DemoState>): WorkingDraft[] {
  const drafts = Array.isArray(value) ? value : [];
  const normalised = drafts
    .filter((draft): draft is Partial<WorkingDraft> => Boolean(draft) && typeof draft === "object")
    .map((draft) => {
      const sourceWorkingCopy = normaliseSourceWorkingCopy(draft.sourceWorkingCopy);
      if (!sourceWorkingCopy || !draft.id || !draft.title) return null;
      const createdAt = typeof draft.createdAt === "string" && draft.createdAt ? draft.createdAt : sourceWorkingCopy.createdAt;
      return {
        id: draft.id,
        title: draft.title,
        channel: draft.channel || sourceWorkingCopy.channel || "Source draft",
        subject: typeof draft.subject === "string" && draft.subject ? draft.subject : draft.title,
        body: typeof draft.body === "string" && draft.body ? draft.body : "",
        reviewerNote: typeof draft.reviewerNote === "string" ? draft.reviewerNote : "",
        status: draft.status === "draft" || draft.status === "review" || draft.status === "approved" || draft.status === "queued" ? draft.status : "draft",
        queuedAt: typeof draft.queuedAt === "string" ? draft.queuedAt : null,
        createdAt,
        updatedAt: typeof draft.updatedAt === "string" && draft.updatedAt ? draft.updatedAt : createdAt,
        sourceWorkingCopy,
      } satisfies WorkingDraft;
    })
    .filter((draft): draft is WorkingDraft => Boolean(draft));

  const legacyCopy = normaliseSourceWorkingCopy(legacyState.sourceWorkingCopy);
  if (legacyCopy && !normalised.some((draft) => draft.id === legacyCopy.id)) {
    normalised.unshift({
      id: legacyCopy.id,
      title: legacyCopy.title,
      channel: legacyCopy.channel,
      subject: typeof legacyState.subject === "string" && legacyState.subject ? legacyState.subject : legacyCopy.title,
      body: typeof legacyState.body === "string" && legacyState.body ? legacyState.body : "",
      reviewerNote: typeof legacyState.reviewerNote === "string" ? legacyState.reviewerNote : "",
      status: legacyState.status === "review" || legacyState.status === "approved" || legacyState.status === "queued" ? legacyState.status : "draft",
      queuedAt: typeof legacyState.queuedAt === "string" ? legacyState.queuedAt : null,
      createdAt: legacyCopy.createdAt,
      updatedAt: legacyCopy.createdAt,
      sourceWorkingCopy: legacyCopy,
    });
  }

  return normalised;
}

function normaliseState(parsed: Partial<DemoState>): DemoState {
  const workingDrafts = normaliseWorkingDrafts(parsed.workingDrafts, parsed);
  const activeWorkingDraftId = workingDrafts.some((draft) => draft.id === parsed.activeWorkingDraftId)
    ? parsed.activeWorkingDraftId ?? null
    : parsed.sourceWorkingCopy && workingDrafts[0]
      ? workingDrafts[0].id
      : null;
  return {
    ...initialState,
    ...parsed,
    selectedSegment: segments.some((segment) => segment.id === parsed.selectedSegment)
      ? (parsed.selectedSegment as SegmentId)
      : initialState.selectedSegment,
    status: ["draft", "review", "approved", "queued"].includes(parsed.status || "")
      ? (parsed.status as DraftStatus)
      : initialState.status,
    activeDraft: draftLibrary.some((draft) => draft.id === parsed.activeDraft)
      ? (parsed.activeDraft as DraftId)
      : initialState.activeDraft,
    workspaceKey: typeof parsed.workspaceKey === "string" ? parsed.workspaceKey : initialState.workspaceKey,
    sourceStateVersion: typeof parsed.sourceStateVersion === "number" ? parsed.sourceStateVersion : null,
    sourceLastSequence: typeof parsed.sourceLastSequence === "number" ? parsed.sourceLastSequence : null,
    sourceDocumentSignature: typeof parsed.sourceDocumentSignature === "string" ? parsed.sourceDocumentSignature : null,
    reviewerNote: typeof parsed.reviewerNote === "string" ? parsed.reviewerNote : "",
    activeView: viewIds.includes(parsed.activeView as ViewId) ? (parsed.activeView as ViewId) : "overview",
    contactFilter:
      parsed.contactFilter === "all" || segments.some((segment) => segment.id === parsed.contactFilter)
        ? (parsed.contactFilter as SegmentId | "all")
        : initialState.contactFilter,
    contactReadinessFilter: ["all", "ready", "review", "blocked"].includes(parsed.contactReadinessFilter || "")
      ? (parsed.contactReadinessFilter as DemoState["contactReadinessFilter"])
      : initialState.contactReadinessFilter,
    scheduleIntent: ["after_approval", "tomorrow_morning", "school_run"].includes(parsed.scheduleIntent || "")
      ? (parsed.scheduleIntent as DemoState["scheduleIntent"])
      : initialState.scheduleIntent,
    localActions: normaliseLocalActions(parsed.localActions),
    workingDrafts,
    activeWorkingDraftId,
    sourceWorkingCopy: normaliseSourceWorkingCopy(parsed.sourceWorkingCopy),
    activity: parsed.activity?.length ? parsed.activity : initialState.activity,
    mode: parsed.mode === "preview" ? "preview" : "compose",
  };
}

function sanitizeStateForWorkspace(state: DemoState, expectedWorkspaceKey: string): DemoState {
  if (!UUID_RE.test(expectedWorkspaceKey)) return state;
  const localActions = state.localActions.filter((action) => localActionMatchesWorkspace(action, expectedWorkspaceKey));
  const workingDrafts = state.workingDrafts.filter((draft) => draft.sourceWorkingCopy.campaignId === expectedWorkspaceKey);
  const activeWorkingDraftId = workingDrafts.some((draft) => draft.id === state.activeWorkingDraftId)
    ? state.activeWorkingDraftId
    : workingDrafts[0]?.id ?? null;
  const sourceWorkingCopy = state.sourceWorkingCopy?.campaignId === expectedWorkspaceKey ? state.sourceWorkingCopy : null;
  const removedMismatchedLocalWork = localActions.length !== state.localActions.length || workingDrafts.length !== state.workingDrafts.length;
  const removedMismatchedTopLevelSourceCopy = Boolean(state.sourceWorkingCopy && !sourceWorkingCopy);

  if (
    localActions.length === state.localActions.length &&
    workingDrafts.length === state.workingDrafts.length &&
    activeWorkingDraftId === state.activeWorkingDraftId &&
    sourceWorkingCopy === state.sourceWorkingCopy
  ) {
    return state;
  }

  return {
    ...state,
    subject: removedMismatchedTopLevelSourceCopy ? "Local source draft reset" : state.subject,
    body: removedMismatchedTopLevelSourceCopy
      ? "This browser-local draft was reset because its stored source provenance belonged to another campaign. Use a source resource from this campaign before review or local queueing."
      : state.body,
    reviewerNote: removedMismatchedTopLevelSourceCopy ? "" : state.reviewerNote,
    status: removedMismatchedTopLevelSourceCopy ? "draft" : state.status,
    queuedAt: removedMismatchedTopLevelSourceCopy ? null : state.queuedAt,
    localActions,
    workingDrafts,
    activeWorkingDraftId,
    sourceWorkingCopy,
    activity: removedMismatchedLocalWork || removedMismatchedTopLevelSourceCopy ? initialState.activity : state.activity,
  };
}

function loadState(storageKey = STORAGE_KEY): DemoState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = localStorage.getItem(storageKey) || (storageKey === STORAGE_KEY ? LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) : null);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed.subject || !parsed.body || !parsed.selectedSegment) return initialState;
    return normaliseState(parsed);
  } catch {
    return initialState;
  }
}

function hasStoredState(storageKey = STORAGE_KEY) {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(storageKey) || (storageKey === STORAGE_KEY ? LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) : null));
}

function portfolioLocalCounts(campaignId: string): PortfolioLocalCounts {
  if (typeof window === "undefined") return { actions: 0, drafts: 0, reviews: 0, queued: 0 };
  const loaded = loadState(localStorageKeyFor(campaignId));
  if (loaded.workspaceKey !== campaignId) return { actions: 0, drafts: 0, reviews: 0, queued: 0 };
  const state = sanitizeStateForWorkspace(loaded, campaignId);
  return {
    actions: state.localActions.length,
    drafts: state.workingDrafts.length,
    reviews: (state.status === "review" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "review").length,
    queued: (state.status === "queued" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "queued").length,
  };
}

function initialCampaignSwitcherItems(): CampaignSwitcherItem[] {
  return PORTFOLIO_CAMPAIGNS.map((campaign) => ({ campaign, status: "loading" }));
}

function localStorageKeyFor(campaignId?: string) {
  return campaignId ? `${STORAGE_KEY}:${campaignId}` : STORAGE_KEY;
}

function firstNonEmptyLine(value?: string) {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function extractPlaceFromBrief(value?: string) {
  return value?.match(/^Place:\s*(.+)$/im)?.[1]?.trim();
}

function documentExcerpt(doc: CompiledDocument | undefined, max = 260) {
  const text = doc?.plainText
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .join(" ");
  if (!text) return "This source document is present, but no readable excerpt was exposed by the typed document route.";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const SOURCE_SECTION_LABELS = [
  "Decision-maker",
  "Specific action",
  "By",
  "Minimum viable win",
  "Success looks like",
  "Route to influence",
  "Coalition strategy",
  "Priority audiences",
  "Resources assumed",
  "Constraints",
  "Type",
  "Target",
  "Owner",
  "Purpose",
  "Timing",
  "Dependencies",
  "Resources",
  "Expected effect",
  "Success sign",
  "What follows",
  "Escalation",
  "Human approval",
  "Power",
  "Position",
  "Cares about",
  "What we ask of them",
  "Recommended approach",
  "Evidence",
  "Confidence",
] as const;

const SOURCE_SECTION_BOUNDARY = new RegExp(`^(${SOURCE_SECTION_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\s*`, "i");

function sourceSectionValue(doc: CompiledDocument | undefined, label: string, max = 300) {
  const lines = doc?.plainText?.split(/\r?\n/) ?? [];
  const start = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`));
  if (start < 0) return null;
  const first = lines[start].trim().replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "");
  const continuation: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (continuation.length) break;
      continue;
    }
    if (SOURCE_SECTION_BOUNDARY.test(trimmed) || /^[A-Z][A-Za-z0-9 ()/&,-]{2,80}$/.test(trimmed)) break;
    continuation.push(trimmed);
  }
  const value = [first, ...continuation].map((line) => line.trim()).filter(Boolean).join(" ");
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function sourceLinesAfterHeading(doc: CompiledDocument | undefined, heading: string, maxItems = 4) {
  const lines = doc?.plainText?.split(/\r?\n/).map((line) => line.trim()) ?? [];
  const start = lines.findIndex((line) => line.replace(/:$/, "").toLowerCase() === heading.toLowerCase());
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) continue;
    if (items.length && /^[A-Z][A-Za-z /&-]{2,60}:?$/.test(line) && !/^\d+\./.test(line) && !/^(P\d+|Phase\s+\d+)/i.test(line)) break;
    if (/^[-•]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^(P\d+|Phase\s+\d+)/i.test(line)) {
      items.push(line.replace(/^[-•]\s+/, ""));
      if (items.length >= maxItems) break;
    }
  }
  return items;
}

function sourceFirstParagraph(doc: CompiledDocument | undefined, max = 220) {
  const lines = doc?.plainText?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  const paragraph = lines.find((line, index) => index > 0 && !/^[A-Z][A-Z /&-]{3,}:?$/.test(line) && !SOURCE_SECTION_BOUNDARY.test(line));
  return paragraph ? shortText(paragraph, max) : null;
}

function cleanAudienceLabel(value: string, max = 64) {
  return shortText(
    value
      .replace(/^\d+\.\s*/, "")
      .replace(/^[-•]\s*/, "")
      .replace(/\s+\([^)]*\)$/g, "")
      .replace(/\s+—\s+.*$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  );
}

function audiencePhrasesFromBase(value: string | null, maxItems = 3) {
  if (!value) return [];
  const firstSentence = value.split(/\.\s+/)[0] ?? value;
  return firstSentence
    .replace(/^A small(?:,|\s+core)?\s+(?:resident-led\s+)?(?:group|core group|base)\s+(?:anchored|centred|centered)?\s*(?:in|on)?\s*/i, "")
    .split(/,\s+|;\s+|\s+plus\s+|\s+supported by\s+|\s+and\s+(?=(?:the\s+)?(?:pre-existing|followers|parents|trade|local|ward|planning|residents|tenants|opposition|cross-party|MPs?|councillors))/i)
    .map((item) => cleanAudienceLabel(item))
    .filter((item) => item.length > 8 && !/^connected to\b/i.test(item))
    .slice(0, maxItems);
}

function buildSourceAudienceSignals(source: CampaignSource): SourceAudienceSignal[] {
  const byKey = new Map(source.documents.map((doc) => [doc.key, doc]));
  const strategy = byKey.get("campaign_strategy");
  const organising = byKey.get("organising_plan");
  const digital = byKey.get("digital_pack");
  const priorityAudiences = sourceLinesAfterHeading(strategy, "Priority audiences", 4);
  const organisingBase = sourceFirstParagraph(organising, 260);
  const organisingAsks = sourceLinesAfterHeading(organising, "The asks", 3);
  const digitalActions = sourceLinesAfterHeading(digital, "WHAT YOU CAN DO", 3);
  const signals: SourceAudienceSignal[] = [];

  if (priorityAudiences.length) {
    signals.push({
      label: "Priority audience sequence",
      detail: priorityAudiences.map((item) => cleanAudienceLabel(item, 90)).join(" · "),
      status: strategy?.status === "ready" ? "Ready source" : `${strategy?.status ?? "Missing"} source`,
    });
  }
  if (organisingBase) {
    signals.push({
      label: "Organising base",
      detail: organisingBase,
      status: organising?.status === "ready" ? "Ready source" : `${organising?.status ?? "Missing"} source`,
    });
  }
  const asks = organisingAsks.length ? organisingAsks : digitalActions;
  if (asks.length) {
    signals.push({
      label: organisingAsks.length ? "Campaign asks" : "Digital action asks",
      detail: asks.map((item) => cleanAudienceLabel(item, 96)).join(" · "),
      status: (organisingAsks.length ? organising : digital)?.status === "ready" ? "Ready source" : "Source note",
    });
  }

  return signals.slice(0, 4);
}

function extractSourceStakeholders(doc: CompiledDocument | undefined, maxItems = 5): SourceStakeholder[] {
  const lines = doc?.plainText?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  const stakeholders: SourceStakeholder[] = [];
  let group = "Stakeholder";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(Decides|Influences|Blocks|Potential blockers|Allies|Persuadables)$/i.test(line)) {
      group = line;
      continue;
    }
    if (!line.includes(" — ") || SOURCE_SECTION_BOUNDARY.test(line)) continue;
    const [name] = line.split(" — ");
    const window = lines.slice(index + 1, index + 10);
    const power = window.find((candidate) => /^Power:/i.test(candidate))?.replace(/^Power:\s*/i, "") || "Power not labelled";
    const position = window.find((candidate) => /^Position:/i.test(candidate))?.replace(/^Position:\s*/i, "") || "Position not labelled in source excerpt";
    stakeholders.push({ group, name: name.trim(), power, position: shortText(position, 150) });
    if (stakeholders.length >= maxItems) break;
  }
  return stakeholders;
}

function compactCampaignLabel(value: string) {
  return value
    .replace(/^Keep\s+/i, "")
    .replace(/^Build\s+/i, "Build ")
    .replace(/^Stop\s+/i, "Stop ")
    .replace(/\s+in\s+the\s+next\s+3\s+years/i, "")
    .trim();
}

const SOURCE_RESOURCE_DOC_KEYS = new Set(["lobbying_pack", "digital_pack", "media_pack"]);

const SOURCE_RESOURCE_PATTERNS = [
  { pattern: /supporter email/i, channel: "Supporter email", priority: 1 },
  { pattern: /meeting request email/i, channel: "Council email", priority: 2 },
  { pattern: /pitch email/i, channel: "Media pitch", priority: 3 },
  { pattern: /volunteer (recruitment|call-out|message)/i, channel: "Volunteer email", priority: 4 },
  { pattern: /press release/i, channel: "Press release", priority: 5 },
  { pattern: /decision-maker briefing/i, channel: "Briefing note", priority: 6 },
  { pattern: /(landing page|campaign landing page)/i, channel: "Landing page", priority: 7 },
  { pattern: /(action page|take action page)/i, channel: "Action page", priority: 8 },
  { pattern: /social media (post set|posts)/i, channel: "Social posts", priority: 9 },
  { pattern: /follow[- ]?up email/i, channel: "Follow-up email", priority: 10 },
  { pattern: /phone script/i, channel: "Phone script", priority: 11 },
  { pattern: /doorknock script/i, channel: "Doorstep script", priority: 12 },
  { pattern: /questions to ask/i, channel: "Question bank", priority: 13 },
  { pattern: /(confirmation message|sharing message|simple share message|short shareable message)/i, channel: "Share copy", priority: 14 },
  { pattern: /graphic concept briefs/i, channel: "Creative brief", priority: 15 },
] as const;

function matchSourceResourceHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120 || /[.!?]$/.test(trimmed)) return null;
  return SOURCE_RESOURCE_PATTERNS.find((candidate) => candidate.pattern.test(trimmed)) ?? null;
}

function extractSourceResources(source: CampaignSource): SourceResource[] {
  const resources = source.documents.flatMap((doc) => {
    if (!SOURCE_RESOURCE_DOC_KEYS.has(doc.key) || doc.status !== "ready" || !doc.plainText) return [];
    const lines = doc.plainText.split(/\r?\n/);
    const starts = lines
      .map((line, index) => ({ index, line: line.trim(), match: matchSourceResourceHeading(line) }))
      .filter((item): item is { index: number; line: string; match: NonNullable<ReturnType<typeof matchSourceResourceHeading>> } => Boolean(item.match));
    return starts.flatMap((start, startIndex) => {
      const end = starts[startIndex + 1]?.index;
      const block = lines.slice(start.index + 1, end);
      const checkIndex = block.findIndex((line) => /^Before you send this, check$/i.test(line.trim()));
      const bodyLines = (checkIndex >= 0 ? block.slice(0, checkIndex) : block).map((line) => line.trimEnd());
      const warningLines = (checkIndex >= 0 ? block.slice(checkIndex + 1) : [])
        .map((line) => line.trim().replace(/^-\s*/, ""))
        .filter(Boolean);
      const subjectLine = bodyLines.find((line) => /^Subject:/i.test(line.trim()));
      const subject = subjectLine?.replace(/^Subject:\s*/i, "").trim() || start.line;
      const body = bodyLines
        .filter((line) => line.trim() && line !== subjectLine)
        .join("\n\n")
        .trim();
      if (!body) return [];
      return [
        {
          id: `${source.campaignId}:${doc.key}:${start.line}`,
          title: start.line,
          channel: start.match.channel,
          sourceDocument: doc.name,
          sourceDocumentKey: doc.key,
          subject,
          body,
          warnings: warningLines,
          preview: body.length > 220 ? `${body.slice(0, 219).trimEnd()}…` : body,
          priority: start.match.priority,
        },
      ];
    });
  });
  return resources
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.title.localeCompare(b.title))
    .map((resource) => ({
      id: resource.id,
      title: resource.title,
      channel: resource.channel,
      sourceDocument: resource.sourceDocument,
      sourceDocumentKey: resource.sourceDocumentKey,
      subject: resource.subject,
      body: resource.body,
      warnings: resource.warnings,
      preview: resource.preview,
    }));
}

function sourceTacticField(lines: string[], label: string) {
  return lines.find((line) => line.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`))?.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "").trim();
}

function extractSourceTactics(source: CampaignSource): SourceTactic[] {
  const doc = source.documents.find((item) => item.key === "tactics_timeline");
  if (!doc?.plainText || doc.status !== "ready") return [];
  const lines = doc.plainText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter((item) => /^(P\d+|Phase\s+\d+)\b/i.test(item.line));

  return starts.slice(0, 6).map((start, tacticIndex) => {
    const end = starts[tacticIndex + 1]?.index ?? lines.length;
    const block = lines.slice(start.index + 1, end);
    const type = sourceTacticField(block, "Type") || "Campaign tactic";
    const target = sourceTacticField(block, "Target") || source.title;
    const owner = sourceTacticField(block, "Owner") || (/media|press/i.test(type) ? "Local organiser" : "Reviewer");
    const timing = sourceTacticField(block, "Timing") || sourceTacticField(block, "Dependencies") || "After source checks are understood";
    const purpose = sourceTacticField(block, "Purpose") || sourceTacticField(block, "Expected effect") || block.find((line) => !SOURCE_SECTION_BOUNDARY.test(line));
    const priority: LocalAction["priority"] = /^(P0|Phase\s+0)|urgent|before|immediate/i.test(`${start.line} ${timing}`) ? "High" : tacticIndex < 3 ? "Medium" : "Low";
    return {
      id: `source:${source.campaignId}:tactic:${tacticIndex + 1}-${start.line.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`,
      title: start.line,
      type,
      target,
      owner,
      timing,
      detail: shortText(purpose || `${type} aimed at ${target}`, 170),
      priority,
    };
  });
}

function statusPhrase(status: RunReadModel["status"]) {
  if (status === "partial") return "Partial but usable";
  if (status === "completed") return "Complete";
  if (status === "running") return "Still running";
  if (status === "queued") return "Queued";
  if (status === "failed") return "Failed";
  return "Cancelled";
}

function sourceStatusPhrase(source: CampaignSource) {
  return statusPhrase(source.runStatus);
}

function sourceStatusDetail(source: CampaignSource) {
  const documentSummary = `${source.readyCount}/${source.documents.length} documents ready`;
  const incompleteSummary = source.incompleteDocuments.map((doc) => `${doc.name} ${doc.status}`).join(", ") || "no incomplete documents";
  return `${statusPhrase(source.runStatus)} · ${documentSummary}; ${incompleteSummary}.`;
}

function shortText(value: string, max = 88) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function sourcePrimaryCheckTitle(source: CampaignSource) {
  const gate = source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "";
  if (/appeal|planning inspectorate/i.test(gate)) return "Confirm Planning Inspectorate appeal status";
  if (/housing|affordable/i.test(`${source.title} ${gate}`)) return "Verify housing delivery evidence";
  if (/gla|s106|section 106|committee|minutes|planning/i.test(gate)) return "Verify planning decision record";
  return "Confirm next source check";
}

function sourcePrimaryCheckButton(source: CampaignSource) {
  return /appeal|planning inspectorate/i.test(source.nextGate ?? "") ? "Create appeal-status action" : "Create source-check action";
}

function sourceCheckActionId(source: CampaignSource, check: EvidenceAndNextChecks["nextChecks"][number], index: number) {
  if (index === 0) return `source:${source.campaignId}:primary-source-check`;
  return `source:${source.campaignId}:next-check:${check.id || index}`;
}

function sourceCheckActionTitle(source: CampaignSource, check: EvidenceAndNextChecks["nextChecks"][number], index: number) {
  if (index === 0) return sourcePrimaryCheckTitle(source);
  return `Check: ${shortText(check.description, 82)}`;
}

function incompleteDocumentActionId(source: CampaignSource, doc: CompiledDocument) {
  return `source:${source.campaignId}:incomplete:${doc.key}`;
}

function buildSourceAudienceSegments(source: CampaignSource): Segment[] {
  const byKey = new Map(source.documents.map((doc) => [doc.key, doc]));
  const strategy = byKey.get("campaign_strategy");
  const organising = byKey.get("organising_plan");
  const priorityAudiences = sourceLinesAfterHeading(strategy, "Priority audiences", 4).map((item) => cleanAudienceLabel(item));
  const baseAudiences = audiencePhrasesFromBase(sourceFirstParagraph(organising, 260));
  const audienceNames = [...priorityAudiences, ...baseAudiences].filter(Boolean);
  const asks = sourceLinesAfterHeading(organising, "The asks", 3);
  const place = source.place || "this place";
  return [
    {
      id: "school_gates",
      name: audienceNames[0] ?? "Core campaign supporters",
      role: "Source audience · browser-local intent",
      contacts: 0,
      ready: 0,
      readiness: `No imported contacts are counted for ${source.title}; this is only a planning label from the public source.`,
      ask: asks[0] ? cleanAudienceLabel(asks[0], 180) : `Prepare a careful update for people already close to ${source.title}, with unresolved checks still visible.`,
      caveat: "No live consent source, CRM import, or provider list is connected for this real campaign.",
    },
    {
      id: "ward_parents",
      name: audienceNames[1] ?? "Decision-route watchers",
      role: "Source audience · evidence/process reviewers",
      contacts: 0,
      ready: 0,
      readiness: `Use source documents to plan who should check the route in ${place}; do not infer reachable contacts.`,
      ask: asks[1] ? cleanAudienceLabel(asks[1], 180) : source.nextGate ?? "Ask a campaigner to verify the next public decision-route check before stronger copy is used.",
      caveat: "This local audience intent does not create, import, or message a real person.",
    },
    {
      id: "local_allies",
      name: audienceNames[2] ?? "Allies and validators",
      role: "Source audience · later escalation planning",
      contacts: 0,
      ready: 0,
      readiness: "Source stakeholder clues can shape planning, but Operations has no permissioned ally list yet.",
      ask: asks[2] ? cleanAudienceLabel(asks[2], 180) : "Hold ally, media, or decision-maker escalation until source warnings and human approval are understood.",
      caveat: "External action remains blocked; provider setup and contact consent are coming soon.",
    },
  ];
}

function buildSourceDraftLibrary(source: CampaignSource): DraftLibraryItem[] {
  const check = source.nextGate ?? "the next source evidence check";
  return [
    {
      id: "supporter_email",
      title: "Source supporter update",
      channel: "Email",
      state: "Editable local draft",
      detail: "Browser-local working copy seeded from the real campaign source, with review and queueing still disabled until approval.",
      audience: "Selected local audience intent",
      requires: "Human message review, source warnings understood, contact consent confirmed, and explicit approval before local queueing.",
      outline: [`Name the campaign as ${source.title}.`, `Keep the next check visible: ${shortText(check)}.`, "Do not claim a contact list, provider, or delivery has been connected."],
    },
    {
      id: "decision_maker_letter",
      title: "Decision-maker request",
      channel: "Letter",
      state: "Staged source outline",
      detail: "Structured prompt for a later formal route; not editable until the decision-maker path and contact are confirmed.",
      audience: "Formal decision route, exact recipient not imported",
      requires: "Confirm the current source route, named recipient, evidence status, and sign-off path.",
      outline: ["Name the narrow source-backed ask.", "Show only verified public facts and reviewed local evidence.", "Request the next documented step without overstating authority."],
    },
    {
      id: "press_pitch",
      title: "Media or public update",
      channel: "Media",
      state: "Staged source outline",
      detail: "Media prompt for later escalation; no newsroom contact list, spokesperson consent, or provider is connected.",
      audience: "Local or specialist media, not imported",
      requires: "Verify public claims, decide whether escalation helps the strategy, and confirm any real media contacts.",
      outline: ["Lead with the verified campaign decision moment.", "Use role-attributed spokesperson placeholders only until consent exists.", "Avoid implying delivery, media contact, or campaign outcome."],
    },
  ];
}

function sourceDocumentSignature(source: CampaignSource) {
  const documentStatuses = source.documents
    .map((doc) => `${doc.key}:${doc.status}:${doc.resourceCount}`)
    .sort()
    .join("|");
  const evidenceTotals = source.evidence.totals;
  const nextChecks = source.evidence.nextChecks.map((check) => `${check.id}:${check.description}`).join("|");
  return `${documentStatuses}::${evidenceTotals.claims}/${evidenceTotals.loadBearing}/${evidenceTotals.verifiedLoadBearing}/${evidenceTotals.unresolvedLoadBearing}::${nextChecks}`;
}

function buildInitialStateForSource(source: CampaignSource): DemoState {
  const nextCheck = source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "Review the unresolved source checks before stronger campaign claims are used.";
  return {
    ...initialState,
    workspaceKey: source.campaignId,
    sourceStateVersion: source.stateVersion,
    sourceLastSequence: source.lastSequence,
    sourceDocumentSignature: sourceDocumentSignature(source),
    subject: `${source.title}: update for review`,
    body: [
      "Hello,",
      "",
      `This is a browser-local working draft for ${source.title}${source.place ? ` in ${source.place}` : ""}. No provider action, scheduling, contact import, or public source write-back has happened.`,
      "",
      `Current source status: ${sourceStatusPhrase(source)}; ${source.readyCount}/${source.documents.length} compiled documents are ready.`,
      "",
      `Next source check: ${nextCheck}`,
      "",
      "Before any real outreach, a campaigner must confirm the evidence boundary, contact consent, recipient list, and human approval route.",
      "",
      "Thank you,",
      "Campaign Factory operations workspace",
    ].join("\n"),
    activeDraft: "supporter_email",
    selectedSegment: "school_gates",
    contactFilter: "all",
    status: "draft",
    mode: "compose",
    queuedAt: null,
    localActions: [],
    workingDrafts: [],
    activeWorkingDraftId: null,
    sourceWorkingCopy: null,
    activity: [{ id: `source-${source.campaignId}`, label: `Real campaign source loaded read-only for ${source.title}; local operations state is separate.` }],
  };
}

function buildSourceContext(source: CampaignSource): typeof campaignContext {
  const byKey = new Map(source.documents.map((doc) => [doc.key, doc]));
  const brief = byKey.get("campaign_brief");
  const objective = byKey.get("objective_theory_of_change");
  const power = byKey.get("power_stakeholder_map");
  const strategy = byKey.get("campaign_strategy");
  const tactics = byKey.get("tactics_timeline");
  const media = byKey.get("media_pack");
  const evidenceTotals = source.evidence.totals;
  const nextGate = source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "Review unresolved load-bearing checks before the campaign changes phase.";
  const objectiveDecisionMaker = sourceSectionValue(objective, "Decision-maker");
  const objectiveAction = sourceSectionValue(objective, "Specific action");
  const objectiveBy = sourceSectionValue(objective, "By");
  const objectiveMinimumWin = sourceSectionValue(objective, "Minimum viable win");
  const routeToInfluence = sourceSectionValue(strategy, "Route to influence");
  const coalitionStrategy = sourceSectionValue(strategy, "Coalition strategy");
  const priorityAudiences = sourceLinesAfterHeading(strategy, "Priority audiences", 5);
  const tacticTitles = tactics?.plainText
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(P\d+|Phase\s+\d+)/i.test(line))
    .slice(0, 4) ?? [];

  return {
    brief: {
      title: "Campaign brief",
      intro: "Read-only public campaign source loaded through the typed Campaign Factory run and documents routes. Local operations work is layered on top; the source brief is not edited here.",
      rows: [
        {
          label: "Campaign",
          detail: source.title,
          use: "This is the canonical conference demo source for the Operations workspace.",
          owner: "Campaign source",
        },
        {
          label: "Place",
          detail: source.place || "Place was not exposed by the source read model.",
          use: "Keeps the operations workspace tied back to the real public brief rather than a demo fixture.",
          owner: "Campaign source",
        },
        {
          label: "Source status",
          detail: sourceStatusDetail(source),
          use: "Partial is usable, but incomplete documents remain visible rather than silently filled.",
          owner: "Workbench",
        },
        {
          label: "Brief excerpt",
          detail: documentExcerpt(brief),
          use: "Use source documents for campaign context; do not paste rendered-page snapshots into operations.",
          owner: "Campaign source",
        },
      ],
    },
    objectives: {
      title: "Objective & targets",
      intro: "The objective is read from labelled fields in the compiled public campaign documents, with unresolved official-decision checks kept prominent.",
      rows: [
        {
          label: "Decision-maker",
          detail: objectiveDecisionMaker ?? documentExcerpt(objective),
          use: "Names the route this local workspace is planning around; it does not import a recipient or contact record.",
          owner: "Campaign source",
        },
        {
          label: "Specific action",
          detail: objectiveAction ?? "The typed source did not expose a labelled specific-action field; use the source excerpt until a campaigner verifies it.",
          use: "Keeps drafts and actions attached to the actual ask rather than a fixture objective.",
          owner: "Campaign source",
        },
        {
          label: "Timing / decision window",
          detail: objectiveBy ?? nextGate,
          use: "Shows whether the operational gate is a live deadline, a missing date, or a source uncertainty.",
          owner: "Reviewer",
        },
        {
          label: "Minimum viable win",
          detail: objectiveMinimumWin ?? "Minimum viable win was not exposed as a labelled source field.",
          use: "Lets local actions target a truthful near-term win instead of overstating the campaign outcome.",
          owner: "Campaign source",
        },
        {
          label: "Evidence boundary",
          detail: `${evidenceTotals.verifiedLoadBearing}/${evidenceTotals.loadBearing} load-bearing claims verified; ${evidenceTotals.unresolvedLoadBearing} still unresolved.`,
          use: "Keep approval and local queueing conservative until a human understands the unresolved checks.",
          owner: "Reviewer",
        },
      ],
    },
    power: {
      title: "Power map",
      intro: "The stakeholder map is read from the real source document while contact inference, CRM import, and delivery targets stay disconnected.",
      rows: [
        ...extractSourceStakeholders(power, 4).map((stakeholder) => ({
          label: `${stakeholder.group}: ${stakeholder.name}`,
          detail: `${stakeholder.power}. ${stakeholder.position}`,
          use: "Plan an audience, briefing, or review question from the source role without claiming an imported contact.",
          owner: "Campaign source",
        })),
        {
          label: "Contact boundary",
          detail: "No CRM, consent register, or imported contact list is connected to this operations view.",
          use: "Audience work can be planned locally, but real contact import remains disconnected.",
          owner: "Workbench",
        },
      ],
    },
    strategy: {
      title: "Strategy & tactics",
      intro: "Strategy and tactics are loaded from labelled source sections, then kept separate from browser-local actions and drafts.",
      rows: [
        {
          label: "Route to influence",
          detail: routeToInfluence ?? documentExcerpt(strategy),
          use: "Keeps the operational runway anchored to the real strategic sequence.",
          owner: "Campaign source",
        },
        {
          label: "Coalition strategy",
          detail: coalitionStrategy ?? "Coalition strategy was not exposed as a labelled source section.",
          use: "Shapes ally/audience planning without creating a shared contact list.",
          owner: "Campaign source",
        },
        {
          label: "Priority audiences",
          detail: priorityAudiences.length ? priorityAudiences.join(" · ") : "Priority audiences were not exposed as a source list.",
          use: "Feeds the local audience-intent labels while keeping consent and CRM boundaries visible.",
          owner: "Campaign source",
        },
        {
          label: "Tactics timeline",
          detail: tacticTitles.length ? tacticTitles.join(" · ") : documentExcerpt(tactics),
          use: "Seed local action candidates from actual tactics without writing back to the source campaign.",
          owner: "Campaign source",
        },
      ],
    },
    evidence: {
      title: "Evidence & checks",
      intro: "The evidence ledger comes from the typed compiled campaign bundle and keeps unresolved load-bearing facts visible.",
      rows: [
        {
          label: "Fact totals",
          detail: `${evidenceTotals.claims} claims · ${evidenceTotals.loadBearing} load-bearing · ${evidenceTotals.verifiedLoadBearing} verified load-bearing · ${evidenceTotals.unresolvedLoadBearing} unresolved load-bearing.`,
          use: "Shows the public evidence boundary before a local reviewer approves any communication.",
          owner: "Campaign source",
        },
        {
          label: "Next source check",
          detail: nextGate,
          use: "This is the most important next operational check before the campaign changes phase.",
          owner: "Reviewer",
        },
        {
          label: "Media Pack",
          detail: media ? `${media.name} is ${media.status}.` : "Media Pack was not returned by the typed source route.",
          use: "Incomplete source work remains visible; it should become an action, not a false ready state.",
          owner: "Workbench",
        },
      ],
    },
  };
}

async function fetchCampaignSource(campaignId: string, signal: AbortSignal): Promise<CampaignSource> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SOURCE_CLIENT_TIMEOUT_MS);
  const abortSource = () => controller.abort();
  signal.addEventListener("abort", abortSource, { once: true });

  let sourceRes: Response;
  try {
    sourceRes = await fetch(`/api/operations/sources/${encodeURIComponent(campaignId)}`, {
      headers: SOURCE_CLIENT_FETCH_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`The Operations source adapter did not respond within ${SOURCE_CLIENT_TIMEOUT_MS / 1000} seconds. No fixture fallback was used.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abortSource);
  }
  if (!hasJsonResponseContentType(sourceRes)) {
    throw new Error(`The Operations source adapter returned a non-JSON content type (HTTP ${sourceRes.status}). No fixture fallback was used.`);
  }
  const sourceBody = (await sourceRes.json().catch(() => null)) as Partial<OperationsSourcePayload> | ({ error?: string; detail?: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string } & Record<string, unknown>) | null;
  if (!sourceRes.ok) {
    const errorBody = sourceBody as { error?: string; detail?: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string } | null;
    const sourceOrigin = normaliseOperationsSourceOrigin(errorBody?.sourceOrigin);
    const hasSourceOriginField = isRecord(errorBody) && Object.prototype.hasOwnProperty.call(errorBody, "sourceOrigin");
    const canUseSourceErrorDetail = !hasSourceOriginField || Boolean(sourceOrigin);
    const fallbackMessage = sourceRes.status === 404 && !hasSourceOriginField
      ? "No curated public campaign source was found for that campaign ID."
      : `The public campaign source could not be loaded (HTTP ${sourceRes.status}).`;
    const retryAfter = sanitizeSourceRetryAfter(sourceRes.headers.get("retry-after"));
    const err = new Error(canUseSourceErrorDetail ? errorBody?.detail || errorBody?.error || fallbackMessage : fallbackMessage);
    if (canUseSourceErrorDetail && errorBody?.runStatus) (err as Error & { runStatus?: RunReadModel["status"] }).runStatus = errorBody.runStatus;
    if (sourceOrigin) (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    if (retryAfter) (err as Error & { retryAfter?: string }).retryAfter = retryAfter;
    throw err;
  }
  if (!sourceBody) {
    throw new Error(`The Operations source adapter returned a non-JSON response (HTTP ${sourceRes.status}). No fixture fallback was used.`);
  }
  const sourceOrigin = normaliseOperationsSourceOrigin(sourceBody.sourceOrigin);
  const run = sourceBody.run;
  if (!sourceOrigin || !isOperationsRunReadModel(run, campaignId)) {
    const err = new Error("The public campaign source did not match the requested campaign.");
    if (sourceOrigin) (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    throw err;
  }
  if (sourceBody.sourceRunUnavailable === true) {
    const err = new Error("The public campaign source did not include a validated run header. No compiled document hydration was used.");
    (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    throw err;
  }
  if (sourceBody.sourceRunUnavailable !== undefined && sourceBody.sourceRunUnavailable !== false) {
    const err = new Error("The public campaign source returned malformed unavailable run-header provenance.");
    (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    throw err;
  }
  if (hasSyntheticUnavailableOperationsRunHeader(run)) {
    const err = new Error("The public campaign source returned an unvalidated synthetic run header.");
    (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    throw err;
  }

  const folded = foldEvents(campaignId, run.events);
  if (run.status !== "completed" && run.status !== "partial") {
    const err = new Error(`This campaign is ${statusPhrase(run.status).toLowerCase()}, so compiled operations source material is not available yet.`);
    (err as Error & { runStatus?: RunReadModel["status"] }).runStatus = run.status;
    throw err;
  }

  const body = { documents: sourceBody.documents, evidence: sourceBody.evidence };
  if (
    !isOperationsCompiledDocumentList(body.documents) ||
    !isOperationsEvidenceAndNextChecks(body.evidence) ||
    !hasConsistentOperationsDocumentEvidence(body.documents, body.evidence)
  ) {
    const err = new Error("The compiled campaign response did not match the typed public document contract.");
    (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    throw err;
  }
  const brief = body.documents.find((doc) => doc.key === "campaign_brief");
  const title = folded.campaignName || firstNonEmptyLine(brief?.plainText) || folded.problem || "Untitled campaign";
  const place = folded.place || extractPlaceFromBrief(brief?.plainText);
  const readyCount = body.documents.filter((doc) => doc.status === "ready").length;
  const incompleteDocuments = body.documents.filter((doc) => doc.status !== "ready");
  const priorityGate = body.evidence.nextChecks.find((check) => /appeal|inspectorate|decision status|housing|gla|s106|section 106|committee|minutes/i.test(`${check.description} ${check.reason}`));

  return {
    campaignId,
    title,
    problem: folded.problem,
    place,
    runStatus: run.status,
    stateVersion: run.stateVersion,
    lastSequence: run.lastSequence,
    loadedAt: new Date().toISOString(),
    documents: body.documents,
    evidence: body.evidence,
    readyCount,
    incompleteDocuments,
    nextGate: priorityGate?.description ?? body.evidence.nextChecks[0]?.description,
    sourceHref: `${sourceOrigin}/factory/c/${campaignId}`,
    sourceOrigin,
  };
}

function record(label: string): Activity {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label };
}

function formatQueuedTime(value: string | null) {
  if (!value) return "Not queued";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[var(--r-2xl)] border border-border bg-background p-5 ${className}`}>{children}</section>;
}

function SmallLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</p>;
}

function OperationsPortfolio() {
  const initialItems = () =>
    PORTFOLIO_CAMPAIGNS.map((campaign) => ({
      campaign,
      status: "loading" as const,
      local: { actions: 0, drafts: 0, reviews: 0, queued: 0 },
    }));
  const [items, setItems] = useState<PortfolioItem[]>(initialItems);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  const portfolioRefreshId = useRef(0);
  const portfolioControllers = useRef<AbortController[]>([]);

  const refresh = () => {
    portfolioRefreshId.current += 1;
    const currentRefreshId = portfolioRefreshId.current;
    portfolioControllers.current.forEach((controller) => controller.abort());
    portfolioControllers.current = [];
    setItems(
      PORTFOLIO_CAMPAIGNS.map((campaign) => ({
        campaign,
        status: "loading",
        local: portfolioLocalCounts(campaign.id),
      })),
    );
    PORTFOLIO_CAMPAIGNS.forEach((campaign) => {
      const controller = new AbortController();
      portfolioControllers.current.push(controller);
      fetchCampaignSource(campaign.id, controller.signal)
        .then((source) => {
          if (controller.signal.aborted || currentRefreshId !== portfolioRefreshId.current) return;
          setItems((current) =>
            current.map((item) =>
              item.campaign.id === campaign.id
                ? { campaign, status: "ready", source, local: portfolioLocalCounts(campaign.id) }
                : item,
            ),
          );
          setLastLoaded(new Date().toISOString());
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || currentRefreshId !== portfolioRefreshId.current) return;
          const message = error instanceof Error ? error.message : "This campaign source could not be loaded.";
          const sourceOrigin = (error as { sourceOrigin?: string } | null)?.sourceOrigin;
          const retryAfter = (error as { retryAfter?: string } | null)?.retryAfter;
          setItems((current) =>
            current.map((item) =>
              item.campaign.id === campaign.id
                ? { campaign, status: "error", title: "Campaign source unavailable", message, sourceOrigin, retryAfter, local: portfolioLocalCounts(campaign.id) }
                : item,
            ),
          );
          setLastLoaded(new Date().toISOString());
        });
    });
  };

  useEffect(() => {
    queueMicrotask(refresh);
    return () => {
      portfolioRefreshId.current += 1;
      portfolioControllers.current.forEach((controller) => controller.abort());
      portfolioControllers.current = [];
    };
  }, []);

  return (
    <div className="min-h-screen bg-ops-paper text-foreground">
      <header className="border-b border-ops-line bg-ops-paper/96">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/" className="rounded-full text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Campaign Factory
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="rounded-full bg-ops-ink px-3 py-1 text-sm font-medium text-white">Campaign Operations</span>
            <span className="rounded-full border border-ops-line bg-background/75 px-3 py-1 text-xs text-muted-foreground">Three real public sources</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{lastLoaded ? `Last refreshed ${formatQueuedTime(lastLoaded)}` : "Loading source status"}</span>
            <button type="button" onClick={refresh} className="rounded-full border border-ops-line bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Refresh portfolio
            </button>
            <Link href="/operations?demo=fixture" className="rounded-full border border-ops-line bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Open labelled fixture demo
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-8 lg:px-6">
        <section className="rounded-[var(--r-3xl)] border border-ops-line bg-background p-6 shadow-sm">
          <SmallLabel>Portfolio triage</SmallLabel>
          <h1 className="mt-2 max-w-4xl text-4xl font-medium tracking-tight sm:text-5xl">
            Three real campaigns, one operations portfolio.
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Open Ormskirk for the conference deep dive, or switch to Tower Hamlets and Barnet to prove the workspace loads different public source material without sharing local campaign work.
          </p>
        </section>

        <section className="mt-5 space-y-3" aria-label="Campaign operations portfolio">
          {items.map((item) => {
            const source = item.status === "ready" ? item.source : null;
            const localSignals = [
              item.local.actions ? `${item.local.actions} action${item.local.actions === 1 ? "" : "s"}` : null,
              item.local.drafts ? `${item.local.drafts} working draft${item.local.drafts === 1 ? "" : "s"}` : null,
              item.local.reviews ? `${item.local.reviews} review${item.local.reviews === 1 ? "" : "s"}` : null,
              item.local.queued ? `${item.local.queued} queued locally` : null,
            ].filter(Boolean);
            return (
              <article key={item.campaign.id} className={`rounded-[var(--r-2xl)] border p-4 shadow-sm ${item.campaign.conferenceHero ? "border-ops-ink bg-ops-yellow/50" : "border-ops-line bg-background"}`}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.campaign.conferenceHero ? <span className="rounded-full bg-ops-ink px-2.5 py-1 text-xs font-medium text-white">Conference deep dive</span> : null}
                      <span className="rounded-full bg-ops-blue px-2.5 py-1 text-xs text-ops-ink">{source ? sourceStatusPhrase(source) : item.status === "loading" ? "Loading source" : "Source issue"}</span>
                      <span className="rounded-full border border-ops-line bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">Browser-local state separate</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-medium tracking-tight">{item.status === "ready" ? item.source.title : item.status === "loading" ? "Loading campaign…" : item.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{item.status === "ready" ? item.source.place : item.status === "loading" ? "Reading public run and compiled documents." : item.message}</p>
                    {item.status === "error" && item.sourceOrigin ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Checked read-only source: <span className="font-medium text-foreground">{item.sourceOrigin}</span>
                      </p>
                    ) : null}
                    {item.status === "error" && retryAfterMessage(item.retryAfter) ? (
                      <p className="mt-2 text-xs font-medium text-ops-ink">{retryAfterMessage(item.retryAfter)}</p>
                    ) : null}
                    {source ? (
                      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <p className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3"><span className="block font-medium">{source.readyCount}/{source.documents.length} documents ready</span><span className="text-muted-foreground">{source.incompleteDocuments.map((doc) => `${doc.name}: ${doc.status}`).join(" · ") || "All compiled documents ready"}</span></p>
                        <p className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3"><span className="block font-medium">{source.evidence.totals.unresolvedLoadBearing} unresolved key facts</span><span className="text-muted-foreground">Source-derived evidence boundary</span></p>
                        <p className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3"><span className="block font-medium">Next gate</span><span className="text-muted-foreground line-clamp-2">{source.nextGate ?? "Review the first unresolved evidence check before stronger claims."}</span></p>
                      </div>
                    ) : null}
                    <p className="mt-3 text-sm text-muted-foreground">
                      Local signals: {localSignals.length ? localSignals.join(" · ") : "no browser-local operations work yet for this campaign"}.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Link href={`/operations?campaignId=${item.campaign.id}`} className="rounded-full bg-ops-ink px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      Open workspace
                    </Link>
                    <Link href={source?.sourceHref ?? item.campaign.sourceHref} className="rounded-full border border-ops-line bg-background px-4 py-2 text-center text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      View source brief
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function SourceStateShell({ state }: { state: Exclude<SourceState, { status: "fixture" } | { status: "ready" }> }) {
  const campaignId = state.campaignId;
  const curatedCampaign = PORTFOLIO_CAMPAIGNS.find((campaign) => campaign.id === campaignId);
  const sourceHref = curatedCampaign?.sourceHref ?? "/factory";
  const canLinkSource = Boolean(curatedCampaign);
  const title =
    state.status === "loading"
      ? "Loading campaign source"
      : state.status === "invalid"
        ? "Campaign ID not recognised"
        : state.title;
  const detail =
    state.status === "loading"
      ? "Reading the public run header and compiled campaign documents. The operations workspace will not fall back to fixture content if this load fails."
      : state.status === "invalid"
        ? "Operations accepts a Campaign Factory UUID in the campaignId query parameter. No fixture campaign has been substituted."
        : state.message;
  const sourceOrigin = "sourceOrigin" in state ? state.sourceOrigin : undefined;
  const retryMessage = "retryAfter" in state ? retryAfterMessage(state.retryAfter) : null;

  return (
    <div className="min-h-screen bg-ops-paper text-foreground">
      <header className="border-b border-ops-line bg-ops-paper/96">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/" className="rounded-full text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Campaign Factory
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="rounded-full bg-ops-ink px-3 py-1 text-sm font-medium text-white">Campaign Operations</span>
            <span className="rounded-full border border-ops-line bg-background/70 px-3 py-1 text-xs text-muted-foreground">Read-only source load</span>
          </div>
          <Link href={sourceHref} className="rounded-full border border-ops-line bg-background/70 px-3 py-1.5 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {canLinkSource ? "Back to source brief" : "Back to Factory"}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-10 lg:px-6">
        <Panel className="bg-background">
          <SmallLabel>{state.status === "loading" ? "Campaign source" : "Cannot open operations"}</SmallLabel>
          <h1 className="mt-2 max-w-3xl text-4xl font-medium tracking-tight">{title}</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">{detail}</p>
          {sourceOrigin ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-background/80 px-3 py-2 text-sm text-muted-foreground">
              Checked read-only source: <span className="font-medium text-foreground">{sourceOrigin}</span>
            </p>
          ) : null}
          {retryMessage ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-ops-yellow/60 px-3 py-2 text-sm font-medium text-ops-ink">
              {retryMessage}
            </p>
          ) : null}
          {state.status === "loading" ? (
            <div className="mt-6 rounded-[var(--r-2xl)] border border-ops-line bg-ops-blue/60 p-4 text-sm text-ops-ink" role="status">
              Loading public campaign data…
            </div>
          ) : (
            <div className="mt-6 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-secondary p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No fixture fallback used</p>
              <p className="mt-1">
                {canLinkSource ? "Fix the campaign ID or return to the source brief." : "Use one of the curated Operations campaign IDs or return to Campaign Factory."} External sending, imports, scheduling, and source write-back remain disconnected.
              </p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/operations?demo=fixture" className="rounded-full border border-ops-line bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Open labelled fixture demo
            </Link>
            {canLinkSource ? (
              <Link href={sourceHref} className="rounded-full bg-ops-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                View source brief
              </Link>
            ) : null}
          </div>
        </Panel>
      </main>
    </div>
  );
}

export function OperationsWorkspace({ campaignId, fixtureMode = false, initialView }: { campaignId?: string; fixtureMode?: boolean; initialView?: string }) {
  if (!campaignId && !fixtureMode) {
    return <OperationsPortfolio />;
  }
  return <OperationsCampaignWorkspace campaignId={campaignId} initialView={initialView} />;
}

function OperationsCampaignWorkspace({ campaignId, initialView }: { campaignId?: string; initialView?: string }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>(() =>
    campaignId ? { status: UUID_RE.test(campaignId) ? "loading" : "invalid", campaignId } : { status: "fixture" },
  );
  const [switcherItems, setSwitcherItems] = useState<CampaignSwitcherItem[]>(initialCampaignSwitcherItems);
  const [hasStoredLocalState, setHasStoredLocalState] = useState(false);
  const storageKey = useMemo(() => localStorageKeyFor(campaignId), [campaignId]);
  const source = sourceState.status === "ready" ? sourceState.source : null;

  useEffect(() => {
    queueMicrotask(() => {
      const stored = hasStoredState(storageKey);
      const loaded = loadState(storageKey);
      const expectedWorkspaceKey = campaignId ?? "fixture";
      const storedMatchesWorkspace = loaded.workspaceKey === expectedWorkspaceKey;
      const workspaceState = storedMatchesWorkspace ? sanitizeStateForWorkspace(loaded, expectedWorkspaceKey) : loaded;
      setHasStoredLocalState(stored && storedMatchesWorkspace);
      setState(viewIds.includes(initialView as ViewId) ? { ...workspaceState, activeView: initialView as ViewId } : workspaceState);
      setHydrated(true);
    });
  }, [campaignId, initialView, storageKey]);

  useEffect(() => {
    if (!campaignId) {
      queueMicrotask(() => setSourceState({ status: "fixture" }));
      return;
    }
    if (!UUID_RE.test(campaignId)) {
      queueMicrotask(() => setSourceState({ status: "invalid", campaignId }));
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => setSourceState({ status: "loading", campaignId }));
    fetchCampaignSource(campaignId, controller.signal)
      .then((source) => {
        if (controller.signal.aborted) return;
        setSourceState({ status: "ready", source });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "The public campaign source could not be loaded.";
        const runStatus = (error as { runStatus?: RunReadModel["status"] } | null)?.runStatus;
        const sourceOrigin = (error as { sourceOrigin?: string } | null)?.sourceOrigin;
        const retryAfter = (error as { retryAfter?: string } | null)?.retryAfter;
        if (runStatus && runStatus !== "completed" && runStatus !== "partial") {
          setSourceState({ status: "unavailable", campaignId, title: "Campaign not usable yet", message, runStatus, sourceOrigin, retryAfter });
          return;
        }
        setSourceState({ status: "error", campaignId, title: "Campaign source unavailable", message, sourceOrigin, retryAfter });
      });
    return () => controller.abort();
  }, [campaignId]);

  useEffect(() => {
    if (!hydrated || !source || hasStoredLocalState) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState((current) => ({ ...buildInitialStateForSource(source), activeView: current.activeView }));
      setHasStoredLocalState(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasStoredLocalState, hydrated, source]);

  useEffect(() => {
    if (!hydrated || !source || !hasStoredLocalState || state.workspaceKey !== source.campaignId || state.sourceStateVersion !== null) return;
    const signature = sourceDocumentSignature(source);
    queueMicrotask(() => {
      setState((current) => ({
        ...current,
        sourceStateVersion: source.stateVersion,
        sourceLastSequence: source.lastSequence,
        sourceDocumentSignature: signature,
      }));
    });
  }, [hasStoredLocalState, hydrated, source, state.sourceStateVersion, state.workspaceKey]);

  useEffect(() => {
    if (!hydrated) return;
    const expectedWorkspaceKey = campaignId ?? "fixture";
    if (state.workspaceKey !== expectedWorkspaceKey) return;
    if (campaignId && !hasStoredLocalState && sourceState.status !== "ready") return;
    if (campaignId && source && !hasStoredLocalState && state.activity[0]?.id !== `source-${source.campaignId}`) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (!campaignId) LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }, [campaignId, hasStoredLocalState, hydrated, source, sourceState.status, state, storageKey]);

  useEffect(() => {
    if (!campaignId || !UUID_RE.test(campaignId)) return;
    queueMicrotask(() => setSwitcherItems(initialCampaignSwitcherItems()));
    const controllers = PORTFOLIO_CAMPAIGNS.map((campaign) => {
      const controller = new AbortController();
      fetchCampaignSource(campaign.id, controller.signal)
        .then((source) => {
          if (controller.signal.aborted) return;
          setSwitcherItems((current) =>
            current.map((item) => (item.campaign.id === campaign.id ? { campaign, status: "ready", source } : item)),
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : "Campaign source could not be loaded.";
          setSwitcherItems((current) =>
            current.map((item) => (item.campaign.id === campaign.id ? { campaign, status: "error", message } : item)),
          );
        });
      return controller;
    });
    return () => controllers.forEach((controller) => controller.abort());
  }, [campaignId]);

  const sourceLoaded = Boolean(source);
  const sourceContext = useMemo(() => (source ? buildSourceContext(source) : campaignContext), [source]);
  const sourceStakeholders = useMemo(
    () => (source ? extractSourceStakeholders(source.documents.find((doc) => doc.key === "power_stakeholder_map"), 5) : []),
    [source],
  );
  const sourceTactics = useMemo(() => (source ? extractSourceTactics(source) : []), [source]);
  const sourceResources = useMemo(() => (source ? extractSourceResources(source) : []), [source]);
  const currentSourceDocumentSignature = useMemo(() => (source ? sourceDocumentSignature(source) : null), [source]);
  const sourceBaselineChanged = Boolean(
    source &&
      state.sourceStateVersion !== null &&
      (state.sourceStateVersion !== source.stateVersion || state.sourceLastSequence !== source.lastSequence || state.sourceDocumentSignature !== currentSourceDocumentSignature),
  );
  const sourceResourceGroups = useMemo(() => {
    const groups = new Map<string, SourceResource[]>();
    sourceResources.forEach((resource) => {
      groups.set(resource.sourceDocument, [...(groups.get(resource.sourceDocument) ?? []), resource]);
    });
    return Array.from(groups.entries()).map(([sourceDocument, resources]) => ({ sourceDocument, resources }));
  }, [sourceResources]);
  const audienceSegments = useMemo(() => (source ? buildSourceAudienceSegments(source) : segments), [source]);
  const workspaceDraftLibrary = useMemo(() => (source ? buildSourceDraftLibrary(source) : draftLibrary), [source]);
  const sourceAudienceSignals = useMemo(() => (source ? buildSourceAudienceSignals(source) : []), [source]);

  const selected = useMemo(
    () => audienceSegments.find((segment) => segment.id === state.selectedSegment) ?? audienceSegments[0],
    [audienceSegments, state.selectedSegment],
  );

  const activeDraft = workspaceDraftLibrary.find((draft) => draft.id === state.activeDraft) ?? workspaceDraftLibrary[0];
  const activeWorkingDraft = state.workingDrafts.find((draft) => draft.id === state.activeWorkingDraftId) ?? null;
  const activeDraftEditable = Boolean(activeWorkingDraft) || activeDraft.id === "supporter_email";
  const activeSourceWorkingCopy = activeWorkingDraft?.sourceWorkingCopy ?? (activeDraft.id === "supporter_email" ? state.sourceWorkingCopy : null);
  const communicationStatus = activeWorkingDraft?.status ?? state.status;
  const communicationSubject = activeWorkingDraft?.subject ?? state.subject;
  const communicationBody = activeWorkingDraft?.body ?? state.body;
  const reviewerNote = activeWorkingDraft?.reviewerNote ?? state.reviewerNote;
  const status = statusCopy[communicationStatus];
  const canRequestReview = communicationSubject.trim().length > 8 && communicationBody.trim().length > 80;
  const reviewBlocked = !canRequestReview;
  const reviewItemCount = (state.status === "review" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "review").length;
  const queuedItemCount = (state.status === "queued" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "queued").length;
  const queuedCount = queuedItemCount ? String(queuedItemCount) : undefined;
  const reviewBadge = reviewItemCount ? String(reviewItemCount) : undefined;
  const readinessMatches = (contact: ContactFixture) => {
    if (state.contactReadinessFilter === "all") return true;
    if (state.contactReadinessFilter === "ready") return contact.readiness === "Ready fixture";
    if (state.contactReadinessFilter === "review") return contact.readiness === "Review first";
    return contact.readiness === "Blocked";
  };
  const filteredContacts = contacts.filter(
    (contact) => (state.contactFilter === "all" || contact.segmentId === state.contactFilter) && readinessMatches(contact),
  );
  const incompleteSourceDocument = source?.incompleteDocuments[0] ?? null;
  const appealActionId = source && source.evidence.nextChecks[0] ? sourceCheckActionId(source, source.evidence.nextChecks[0], 0) : source ? `source:${source.campaignId}:primary-source-check` : "fixture:council-timing-check";
  const mediaActionId = source && incompleteSourceDocument ? incompleteDocumentActionId(source, incompleteSourceDocument) : source ? `source:${source.campaignId}:incomplete:escalation-boundary` : "fixture:media-boundary";
  const hasAppealAction = state.localActions.some((action) => action.id === appealActionId);
  const hasMediaAction = state.localActions.some((action) => action.id === mediaActionId);
  const selectedSegmentContacts = contacts.filter((contact) => contact.segmentId === selected.id);
  const readyContactCount = contacts.filter((contact) => contact.readiness === "Ready fixture").length;
  const reviewContactCount = contacts.filter((contact) => contact.readiness === "Review first").length;
  const blockedContactCount = contacts.filter((contact) => contact.readiness === "Blocked").length;
  const scheduleCopy: Record<DemoState["scheduleIntent"], string> = source
    ? {
        after_approval: "Hold until a campaigner connects a provider after review",
        tomorrow_morning: "Demo intent: next campaign review window after provider setup",
        school_run: "Demo intent: after the next source check and consent import",
      }
    : {
        after_approval: "Hold until a campaigner connects a provider after review",
        tomorrow_morning: "Demo intent: next school-run morning after provider setup",
        school_run: "Demo intent: school-run reminder window after consent import",
      };
  const runwayStages: RunwayStage[] = [
    {
      label: "Brief",
      view: "brief",
      status: "complete",
      statusLabel: source ? `${sourceStatusPhrase(source)} source loaded` : "Fixture brief loaded",
      detail: source
        ? `${source.readyCount}/${source.documents.length} public campaign documents ready; source stays read-only.`
        : "Outcome, place, and provenance are visible before any communication work starts.",
    },
    {
      label: "Evidence",
      view: "evidence",
      status: communicationStatus === "review" || communicationStatus === "approved" || communicationStatus === "queued" ? "complete" : "current",
      statusLabel: source ? `${source.evidence.totals.unresolvedLoadBearing} unresolved key facts` : communicationStatus === "draft" ? "Checks in view" : "Checks understood",
      detail: source?.nextGate ?? "Council timing, legal wording, and contact consent stay attached to review.",
    },
    {
      label: "Audience",
      view: "audiences",
      status: source ? "complete" : selected.ready > 0 ? "complete" : "blocked",
      statusLabel: source ? `${selected.name}: local intent only` : `${selected.name}: ${selected.ready}/${selected.contacts} ready fixtures`,
      detail: source ? "Audience planning remains local/demo-only until real contact import exists." : "The selected segment follows Drafts, Reviews, and the local queue.",
    },
    {
      label: "Draft",
      view: "drafts",
      status: !canRequestReview ? "blocked" : communicationStatus === "draft" ? "current" : "complete",
      statusLabel: !canRequestReview ? "Needs copy" : status.label,
      detail: activeDraftEditable ? "Supporter email is editable and saved in this browser." : source ? "Staged source outline; not available for approval." : "Staged fixture; not available for approval.",
    },
    {
      label: "Human approval",
      view: "reviews",
      status: communicationStatus === "approved" || communicationStatus === "queued" ? "complete" : communicationStatus === "review" ? "current" : "blocked",
      statusLabel: communicationStatus === "approved" || communicationStatus === "queued" ? "Approved by human" : communicationStatus === "review" ? "Waiting for approval" : "Required before queue",
      detail: "A person must explicitly approve before anything enters the local demo queue.",
    },
    {
      label: "Local outbox",
      view: "outbox",
      status: communicationStatus === "queued" ? "complete" : communicationStatus === "approved" ? "current" : "soon",
      statusLabel: communicationStatus === "queued" ? "Queued for demo" : communicationStatus === "approved" ? "Ready to queue locally" : "Provider off",
      detail: communicationStatus === "queued" ? "Stored locally in this browser; no provider used." : "Local queue only; production scheduling and provider connection remain off.",
    },
  ];

  const navGroups: { title: string; items: NavItem[] }[] = [
    {
      title: "Campaign",
      items: [
        { id: "overview", label: "Overview", note: "Today’s work and next decision" },
        { id: "actions", label: "Action plan", note: "Owned local checks and tactics", badge: state.localActions.length ? String(state.localActions.length) : undefined },
        { id: "brief", label: "Campaign brief", note: "Outcome, place, provenance" },
        { id: "objectives", label: "Objective & targets", note: "Decision-maker and influences" },
        { id: "power", label: "Power map", note: "Allies, blockers, persuadables" },
        { id: "strategy", label: "Strategy & tactics", note: "Pressure sequence and owners" },
        { id: "evidence", label: "Evidence & checks", note: "Claims needing verification" },
      ],
    },
    {
      title: "People",
      items: [
        { id: "audiences", label: "Audiences", note: "Segments and readiness" },
        { id: "contacts", label: "Contacts", note: source ? "Import boundary" : "Fixture contact list" },
      ],
    },
    {
      title: "Communications",
      items: [
        { id: "drafts", label: "Drafts", note: "Library, editor, preview" },
        { id: "reviews", label: "Reviews & approvals", note: "Human approval gate", badge: reviewBadge },
        { id: "outbox", label: "Outbox & schedule", note: "Local queue boundary", badge: queuedCount },
        { id: "responses", label: "Responses & results", note: "Coming soon boundary" },
      ],
    },
  ];

  const setView = (activeView: ViewId) => {
    setState((current) => ({ ...current, activeView }));
  };

  const setActiveDraft = (activeDraft: DraftId) => {
    setState((current) => ({
      ...current,
      activeDraft,
      activeWorkingDraftId: null,
      activity:
        current.activeDraft === activeDraft
          ? current.activity
          : [record(`Viewed draft library item: ${workspaceDraftLibrary.find((draft) => draft.id === activeDraft)?.title ?? "Draft"}.`), ...current.activity].slice(0, 7),
    }));
  };

  const setActiveWorkingDraft = (draftId: string) => {
    setState((current) => {
      const draft = current.workingDrafts.find((item) => item.id === draftId);
      return {
        ...current,
        activeWorkingDraftId: draft ? draft.id : current.activeWorkingDraftId,
        activeDraft: "supporter_email",
        activity:
          draft && current.activeWorkingDraftId !== draft.id
            ? [record(`Viewed local working copy: ${draft.title}.`), ...current.activity].slice(0, 7)
            : current.activity,
      };
    });
  };

  const createSourceWorkingCopy = (resource: SourceResource) => {
    if (!source) return;
    setState((current) => {
      const existing = current.workingDrafts.find((draft) => draft.id === resource.id);
      const sourceWorkingCopy: SourceWorkingCopy = existing?.sourceWorkingCopy ?? {
        id: resource.id,
        campaignId: source.campaignId,
        title: resource.title,
        channel: resource.channel,
        sourceDocument: resource.sourceDocument,
        sourceDocumentKey: resource.sourceDocumentKey,
        createdAt: new Date().toISOString(),
        warnings: resource.warnings,
        provenance: `Copied from ${resource.sourceDocument} in campaign ${source.campaignId}; this editable copy is browser-local and does not change the public source document.`,
      };
      const newDraft: WorkingDraft = {
        id: resource.id,
        title: resource.title,
        channel: resource.channel,
        subject: resource.subject,
        body: resource.body,
        reviewerNote: "",
        status: "draft",
        queuedAt: null,
        createdAt: sourceWorkingCopy.createdAt,
        updatedAt: new Date().toISOString(),
        sourceWorkingCopy,
      };
      return {
        ...current,
        activeView: "drafts",
        activeDraft: "supporter_email",
        activeWorkingDraftId: resource.id,
        mode: "compose",
        workingDrafts: existing ? current.workingDrafts : [newDraft, ...current.workingDrafts],
        sourceWorkingCopy: null,
        activity: [record(`${existing ? "Selected existing" : "Created"} editable local copy from source resource: ${resource.title}.`), ...current.activity].slice(0, 7),
      };
    });
  };

  const updateDraft = (patch: Partial<Pick<DemoState, "subject" | "body">>) => {
    setState((current) => ({
      ...current,
      ...(current.activeWorkingDraftId
        ? {
            workingDrafts: current.workingDrafts.map((draft) =>
              draft.id === current.activeWorkingDraftId
                ? {
                    ...draft,
                    ...patch,
                    status: draft.status === "approved" || draft.status === "queued" ? "draft" : draft.status,
                    queuedAt: draft.status === "queued" ? null : draft.queuedAt,
                    updatedAt: new Date().toISOString(),
                  }
                : draft,
            ),
          }
        : patch),
      status: !current.activeWorkingDraftId && (current.status === "approved" || current.status === "queued") ? "draft" : current.status,
      queuedAt: !current.activeWorkingDraftId && current.status === "queued" ? null : current.queuedAt,
      activity:
        (current.activeWorkingDraftId
          ? current.workingDrafts.find((draft) => draft.id === current.activeWorkingDraftId)?.status === "approved" || current.workingDrafts.find((draft) => draft.id === current.activeWorkingDraftId)?.status === "queued"
          : current.status === "approved" || current.status === "queued")
          ? [record("Edited communication copy; approval and local queue state were cleared for re-review."), ...current.activity].slice(0, 7)
          : current.activity,
    }));
  };

  const updateReviewerNote = (note: string) => {
    setState((current) => ({
      ...current,
      ...(current.activeWorkingDraftId
        ? {
            workingDrafts: current.workingDrafts.map((draft) =>
              draft.id === current.activeWorkingDraftId
                ? {
                    ...draft,
                    reviewerNote: note,
                    updatedAt: new Date().toISOString(),
                  }
                : draft,
            ),
          }
        : { reviewerNote: note }),
    }));
  };

  const selectSegment = (segment: Segment) => {
    setState((current) => ({
      ...current,
      selectedSegment: segment.id,
      contactFilter: segment.id,
      status: !current.activeWorkingDraftId && (current.status === "approved" || current.status === "queued") ? "draft" : current.status,
      queuedAt: !current.activeWorkingDraftId && current.status === "queued" ? null : current.queuedAt,
      workingDrafts: current.activeWorkingDraftId
        ? current.workingDrafts.map((draft) =>
            draft.id === current.activeWorkingDraftId
              ? { ...draft, status: draft.status === "approved" || draft.status === "queued" ? "draft" : draft.status, queuedAt: draft.status === "queued" ? null : draft.queuedAt, updatedAt: new Date().toISOString() }
              : draft,
          )
        : current.workingDrafts,
      activity: [record(`Selected audience segment: ${segment.name}.`), ...current.activity].slice(0, 7),
    }));
  };

  const requestReview = () => {
    setState((current) => ({
      ...current,
      status: current.activeWorkingDraftId ? current.status : "review",
      activeView: "reviews",
      workingDrafts: current.activeWorkingDraftId
        ? current.workingDrafts.map((draft) => (draft.id === current.activeWorkingDraftId ? { ...draft, status: "review", updatedAt: new Date().toISOString() } : draft))
        : current.workingDrafts,
      activity: [record("Marked the draft ready for human review."), ...current.activity].slice(0, 7),
    }));
  };

  const approve = () => {
    setState((current) => ({
      ...current,
      status: current.activeWorkingDraftId ? current.status : "approved",
      workingDrafts: current.activeWorkingDraftId
        ? current.workingDrafts.map((draft) => (draft.id === current.activeWorkingDraftId ? { ...draft, status: "approved", updatedAt: new Date().toISOString() } : draft))
        : current.workingDrafts,
      activity: [record("Human approval recorded for this local demo draft."), ...current.activity].slice(0, 7),
    }));
  };

  const queue = () => {
    setState((current) => ({
      ...current,
      status: current.activeWorkingDraftId ? current.status : "queued",
      activeView: "outbox",
      queuedAt: current.activeWorkingDraftId ? current.queuedAt : new Date().toISOString(),
      workingDrafts: current.activeWorkingDraftId
        ? current.workingDrafts.map((draft) => (draft.id === current.activeWorkingDraftId ? { ...draft, status: "queued", queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : draft))
        : current.workingDrafts,
      activity: [record("Placed approved draft into the local demo queue. No provider connection used."), ...current.activity].slice(0, 7),
    }));
  };

  const createLocalAction = (action: LocalAction) => {
    setState((current) => {
      if (current.localActions.some((item) => item.id === action.id)) return { ...current, activeView: "actions" };
      return {
        ...current,
        activeView: "actions",
        localActions: [action, ...current.localActions],
        activity: [record(`Created local action: ${action.title}.`), ...current.activity].slice(0, 7),
      };
    });
  };

  const createSourceCheckAction = (check: EvidenceAndNextChecks["nextChecks"][number], index: number) => {
    if (!source) return;
    createLocalAction({
      id: sourceCheckActionId(source, check, index),
      title: sourceCheckActionTitle(source, check, index),
      source: `Campaign source · Evidence & checks${check.affectedSections?.length ? ` · ${check.affectedSections.join(", ")}` : ""}`,
      owner: "Reviewer",
      timing: index === 0 ? "Before phase change or stronger public claims" : shortText(check.reason || "Before related copy or tactics move forward", 120),
      priority: index === 0 ? "High" : "Medium",
      status: "next",
      provenance: `Source campaign ${source.campaignId}; derived from next check ${check.id || index + 1}${check.claimIds?.length ? ` touching ${check.claimIds.length} source claim${check.claimIds.length === 1 ? "" : "s"}` : ""}; stored only in this browser.`,
    });
  };

  const createAppealStatusAction = () => {
    const primaryCheck = source?.evidence.nextChecks[0];
    if (source && primaryCheck) {
      createSourceCheckAction(primaryCheck, 0);
      return;
    }
    createLocalAction({
      id: appealActionId,
      title: "Verify council order status",
      source: "Fixture evidence check",
      owner: "Reviewer",
      timing: "Before phase change or stronger public claims",
      priority: "High",
      status: "next",
      provenance: "Derived from the fixture timing check and stored only in this browser.",
    });
  };

  const createIncompleteDocumentAction = (doc: CompiledDocument) => {
    if (!source) return;
    createLocalAction({
      id: incompleteDocumentActionId(source, doc),
      title: `Follow up incomplete ${doc.name}`,
      source: `Campaign source · ${doc.name} incomplete`,
      owner: doc.key === "media_pack" ? "Local organiser" : "Reviewer",
      timing: "After the primary source check and evidence warnings are understood",
      priority: doc.key === "media_pack" ? "Medium" : "Low",
      status: "blocked",
      provenance: `Source campaign ${source.campaignId}; ${doc.name} remains ${doc.status}, so this is a local work item rather than a false ready state.`,
    });
  };

  const createSourceTacticAction = (tactic: SourceTactic) => {
    if (!source) return;
    createLocalAction({
      id: tactic.id,
      title: tactic.title,
      source: `Campaign source · Tactics and Timeline · ${tactic.type}`,
      owner: tactic.owner,
      timing: tactic.timing,
      priority: tactic.priority,
      status: tactic.priority === "High" ? "next" : "blocked",
      provenance: `Source campaign ${source.campaignId}; tactic target: ${tactic.target}. This creates browser-local owned work only and does not change the public tactics document.`,
    });
  };

  const createMediaPackAction = () => {
    if (source && incompleteSourceDocument) {
      createIncompleteDocumentAction(incompleteSourceDocument);
      return;
    }
    createLocalAction({
      id: mediaActionId,
      title: source ? "Keep escalation blocked until checked" : "Keep media escalation blocked until checked",
      source: source ? "Campaign source · Escalation boundary" : "Fixture media boundary",
      owner: "Local organiser",
      timing: source ? "After the primary source check and evidence warnings are understood" : "After appeal status and evidence checks are understood",
      priority: "Medium",
      status: "blocked",
      provenance: source
        ? `Source campaign ${source.campaignId}; source escalation still needs human judgement, so this is a local work item rather than a false ready state.`
        : "Fixture media action stored locally; no newsroom or provider list exists.",
    });
  };

  const updateLocalActionStatus = (id: string, actionStatus: LocalActionStatus) => {
    setState((current) => ({
      ...current,
      localActions: current.localActions.map((action) => (action.id === id ? { ...action, status: actionStatus } : action)),
      activity: [record(`Updated action status: ${current.localActions.find((action) => action.id === id)?.title ?? "Local action"} → ${localActionStatusCopy[actionStatus]}.`), ...current.activity].slice(0, 7),
    }));
  };

  const acknowledgeSourceRefresh = () => {
    if (!source || !currentSourceDocumentSignature) return;
    setState((current) => ({
      ...current,
      sourceStateVersion: source.stateVersion,
      sourceLastSequence: source.lastSequence,
      sourceDocumentSignature: currentSourceDocumentSignature,
      activity: [record(`Acknowledged updated read-only source for ${source.title}; existing local work was preserved.`), ...current.activity].slice(0, 7),
    }));
  };

  const reset = () => {
    localStorage.removeItem(storageKey);
    if (storageKey === STORAGE_KEY) LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    const resetState = source ? buildInitialStateForSource(source) : initialState;
    setHasStoredLocalState(true);
    setState({
      ...resetState,
      activity: [record(source ? "Local source workspace state reset; public campaign data was not changed." : "Demo state reset to the seeded campaign workspace."), ...resetState.activity],
    });
  };

  const resetLabel = source ? "Reset local workspace" : "Reset demo state";

  const buildOperationsPack = () => {
    const queuedDrafts = [
      ...(state.status === "queued"
        ? [{ id: "seeded-supporter-email", title: "Supporter email", subject: state.subject, status: state.status, queuedAt: state.queuedAt, source: state.sourceWorkingCopy?.sourceDocument ?? (source ? "Browser-local source workspace draft" : "Demo fixture draft"), reviewerNote: state.reviewerNote }]
        : []),
      ...state.workingDrafts.map((draft) => ({
        id: draft.id,
        title: draft.title,
        subject: draft.subject,
        status: draft.status,
        queuedAt: draft.queuedAt,
        source: `${draft.sourceWorkingCopy.sourceDocument} (${draft.sourceWorkingCopy.sourceDocumentKey})`,
        provenance: draft.sourceWorkingCopy.provenance,
        warnings: draft.sourceWorkingCopy.warnings,
        reviewerNote: draft.reviewerNote,
      })),
    ];
    return {
      exportedAt: new Date().toISOString(),
      campaign: source
        ? {
            id: source.campaignId,
            title: source.title,
            place: source.place ?? null,
            sourceHref: source.sourceHref,
            sourceOrigin: source.sourceOrigin,
            runStatus: source.runStatus,
            sourceStateVersion: source.stateVersion,
            sourceLastSequence: source.lastSequence,
            sourceBaselineChanged,
          }
        : {
            id: "demo-fixture",
            title: "Make the St John the Baptist school street permanent",
            place: "Leicester",
            sourceHref: null,
            sourceOrigin: "Local fixture",
            runStatus: "demo-fixture",
            sourceBaselineChanged: false,
          },
      boundary: {
        sourceWriteBack: "Not connected",
        contactImport: source ? "No real contacts imported for this campaign" : "Fixture contacts only",
        providerSending: "Not connected",
        productionScheduling: "Not connected",
        responsesOrResults: "Not connected; no delivery or outcome is claimed",
      },
      objective: sourceContext.objectives.rows.map((row) => ({ label: row.label, detail: row.detail })),
      evidence: source
        ? {
            totals: source.evidence.totals,
            nextChecks: source.evidence.nextChecks.slice(0, 8).map((check) => ({ id: check.id, description: check.description, reason: check.reason, affectedSections: check.affectedSections })),
            incompleteDocuments: source.incompleteDocuments.map((doc) => ({ key: doc.key, name: doc.name, status: doc.status, resourceCount: doc.resourceCount })),
          }
        : {
            totals: { unresolvedLoadBearing: 2 },
            nextChecks: ["Verify council order status", "Keep media escalation blocked until checked"],
            incompleteDocuments: [],
          },
      selectedAudience: {
        name: selected.name,
        ask: selected.ask,
        readiness: selected.readiness,
        caveat: selected.caveat,
      },
      actions: state.localActions.map((action) => ({ ...action, statusLabel: localActionStatusCopy[action.status] })),
      drafts: queuedDrafts,
      outbox: {
        queuedCount: queuedItemCount,
        scheduleIntent: scheduleCopy[state.scheduleIntent],
      },
      activity: state.activity.map((item) => item.label),
    };
  };

  const exportOperationsPack = (format: "json" | "md") => {
    const pack = buildOperationsPack();
    const label = source?.title ?? "sample-campaign";
    if (format === "json") {
      downloadClientFile(exportFileName(label, "json"), `${JSON.stringify(pack, null, 2)}\n`, "application/json");
    } else {
      const campaign = pack.campaign;
      const content = [
        `# ${campaign.title} — Campaign Operations pack`,
        "",
        `Exported: ${pack.exportedAt}`,
        campaign.sourceHref ? `Source brief: ${campaign.sourceHref}` : `Source: ${campaign.sourceOrigin}`,
        `Status: ${campaign.runStatus}`,
        ...(campaign.sourceBaselineChanged
          ? ["Source update warning: read-only source changed after this local workspace started; re-check local actions and drafts before approval or queueing."]
          : []),
        "",
        "## Operating boundary",
        `- Source write-back: ${pack.boundary.sourceWriteBack}`,
        `- Contact import: ${pack.boundary.contactImport}`,
        `- Provider sending: ${pack.boundary.providerSending}`,
        `- Production scheduling: ${pack.boundary.productionScheduling}`,
        `- Responses/results: ${pack.boundary.responsesOrResults}`,
        "",
        "## Objective & targets",
        ...pack.objective.map((row) => `- **${row.label}:** ${row.detail}`),
        "",
        "## Evidence & checks",
        `- Unresolved load-bearing facts: ${pack.evidence.totals.unresolvedLoadBearing}`,
        ...pack.evidence.nextChecks.map((check) => (typeof check === "string" ? `- ${check}` : `- ${check.description}${check.reason ? ` — ${check.reason}` : ""}`)),
        ...pack.evidence.incompleteDocuments.map((doc) => `- Incomplete source document: ${doc.name} (${doc.status}, ${doc.resourceCount} resources)`),
        "",
        "## Selected audience",
        `- ${pack.selectedAudience.name}: ${pack.selectedAudience.ask}`,
        `- Readiness: ${pack.selectedAudience.readiness}`,
        `- Caveat: ${pack.selectedAudience.caveat}`,
        "",
        "## Local actions",
        ...(pack.actions.length ? pack.actions.map((action) => `- [${action.statusLabel}] ${action.title} — ${action.owner}; ${action.timing}`) : ["- No browser-local actions yet."]),
        "",
        "## Drafts & local outbox",
        ...(pack.drafts.length
          ? pack.drafts.flatMap((draft) => [
              `- [${draft.status}] ${draft.title}: ${draft.subject}${draft.queuedAt ? ` · queued locally ${formatQueuedTime(draft.queuedAt)}` : ""}`,
              `  - Source/provenance: ${draft.source}`,
              ...(draft.reviewerNote ? [`  - Reviewer note: ${draft.reviewerNote}`] : []),
            ])
          : ["- No local working drafts or queued items yet."]),
        `- Queue count: ${pack.outbox.queuedCount}`,
        `- Schedule intent: ${pack.outbox.scheduleIntent}`,
        "",
        "## Activity",
        ...(pack.activity.length ? pack.activity.map((item) => `- ${item}`) : ["- No local activity recorded."]),
        "",
      ].join("\n");
      downloadClientFile(exportFileName(label, "md"), content, "text/markdown");
    }
    setState((current) => ({ ...current, activity: [record(`Exported ${format === "json" ? "JSON" : "Markdown"} operations pack for ${source?.title ?? "the fixture workspace"}.`), ...current.activity].slice(0, 7) }));
  };

  const renderNav = (compact = false, ink = false) => (
    <nav aria-label="Campaign operations views" className="space-y-6">
      {navGroups.map((group) => (
        <div key={group.title}>
          <div className={`mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] ${ink ? "text-white/55" : "text-muted-foreground"}`}>
            {group.title}
          </div>
          <div className={compact ? "grid gap-2 sm:grid-cols-2" : "space-y-1"}>
            {group.items.map((item) => {
              const active = state.activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`ops-nav-button w-full rounded-[var(--r-xl)] border px-3 text-left motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out ${ink ? "py-2" : "py-2.5"} ${
                    active
                      ? ink
                        ? "border-white/15 bg-ops-yellow text-ops-ink shadow-sm"
                        : "border-foreground bg-foreground text-background"
                      : ink
                        ? "border-transparent text-white/88 hover:border-white/15 hover:bg-white/[0.08]"
                        : "border-transparent text-foreground hover:border-border hover:bg-secondary"
                  }`}
                  aria-current={active ? "page" : undefined}
                  aria-label={`${item.label}: ${active ? "Current view" : "Open view"}, ${item.note}${item.badge ? `, ${item.badge} item${item.badge === "1" ? "" : "s"}` : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {item.label}
                    {item.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-background text-foreground" : ink ? "bg-ops-coral text-ops-ink" : "bg-tint-yellow text-foreground"}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {ink ? null : (
                    <span className={`mt-0.5 block text-xs ${active ? "text-background/75" : "text-muted-foreground"}`}>{item.note}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const goButton = (view: ViewId, label: string) => (
    <Button type="button" variant="outline" onClick={() => setView(view)} className="max-w-full min-w-0 !shrink whitespace-normal text-left">
      {label}
    </Button>
  );

  const recommendedActions: RecommendedLocalAction[] = source
    ? [
        ...source.evidence.nextChecks.slice(0, 3).map((check, index) => {
          const id = sourceCheckActionId(source, check, index);
          return {
            id,
            title: sourceCheckActionTitle(source, check, index),
            detail: index === 0 ? check.description : `${check.description}${check.reason ? ` — ${shortText(check.reason, 110)}` : ""}`,
            priority: index === 0 ? "High" as const : "Medium" as const,
            disabled: state.localActions.some((action) => action.id === id),
            create: () => createSourceCheckAction(check, index),
          };
        }),
        ...source.incompleteDocuments.slice(0, 3).map((doc) => {
          const id = incompleteDocumentActionId(source, doc);
          return {
            id,
            title: `Follow up incomplete ${doc.name}`,
            detail: `${doc.name} is ${doc.status}; create owned local follow-up instead of treating the source pack as ready.`,
            priority: doc.key === "media_pack" ? "Medium" as const : "Low" as const,
            disabled: state.localActions.some((action) => action.id === id),
            create: () => createIncompleteDocumentAction(doc),
          };
        }),
        ...sourceTactics.slice(0, 3).map((tactic) => ({
          id: tactic.id,
          title: tactic.title,
          detail: `${tactic.type} · ${tactic.target}. ${tactic.detail}`,
          priority: tactic.priority,
          disabled: state.localActions.some((action) => action.id === tactic.id),
          create: () => createSourceTacticAction(tactic),
        })),
      ]
    : [
        {
          id: appealActionId,
          title: "Verify council order status",
          detail: "Check the current decision route before any stronger campaign claims are used.",
          priority: "High",
          disabled: hasAppealAction,
          create: createAppealStatusAction,
        },
        {
          id: mediaActionId,
          title: "Keep media escalation blocked until checked",
          detail: "Media escalation should wait until evidence, contact, and provider boundaries are understood.",
          priority: "Medium",
          disabled: hasMediaAction,
          create: createMediaPackAction,
        },
      ];

  const renderActionPlanView = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Action plan</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Owned local work from source checks</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Actions created here are browser-local operations work. They preserve source provenance and never write back to Campaign Factory, import contacts, or trigger provider scheduling.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2" aria-label="Recommended source actions">
          {recommendedActions.map((action) => (
            <div key={action.id} className="rounded-[var(--r-2xl)] border border-ops-line bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{action.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
                </div>
                <span className="rounded-full bg-ops-yellow px-2.5 py-1 text-xs font-medium text-ops-ink">{action.priority}</span>
              </div>
              <Button type="button" variant="outline" className="mt-4" onClick={action.create} disabled={action.disabled}>
                {action.disabled ? "Already in action plan" : "Create local action"}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
          <div className="hidden grid-cols-[minmax(0,1fr)_0.65fr_0.75fr_0.75fr_0.7fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:grid">
            <span>Action</span><span>Owner</span><span>Timing</span><span>Priority</span><span>Status</span>
          </div>
          {state.localActions.length ? state.localActions.map((action) => (
            <div key={action.id} className="grid gap-3 border-b border-border px-4 py-4 text-sm last:border-0 lg:grid-cols-[minmax(0,1fr)_0.65fr_0.75fr_0.75fr_0.7fr]">
              <div>
                <span className="font-medium lg:hidden">Action: </span><span className="font-medium">{action.title}</span>
                <p className="mt-1 text-xs text-muted-foreground">{action.source}</p>
                <p className="mt-2 text-xs text-muted-foreground">{action.provenance}</p>
              </div>
              <div><span className="font-medium lg:hidden">Owner: </span>{action.owner}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground lg:hidden">Timing: </span>{action.timing}</div>
              <div><span className="font-medium lg:hidden">Priority: </span>{action.priority}</div>
              <div>
                <Label htmlFor={`action-status-${action.id}`} className="sr-only">Status for {action.title}</Label>
                <select
                  id={`action-status-${action.id}`}
                  value={action.status}
                  onChange={(event) => updateLocalActionStatus(action.id, event.target.value as LocalActionStatus)}
                  className="h-10 w-full rounded-full border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {Object.entries(localActionStatusCopy).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No local actions yet. Create the primary source-check action to turn the campaign boundary into owned work.
            </div>
          )}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Read-only source boundary</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Local work, not source mutation</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          The action plan stores presenter work in this browser only. It keeps campaign ID, source section, timing, and evidence warnings attached without changing the public campaign run.
        </p>
        <div className="mt-5 space-y-3 rounded-[var(--r-xl)] border border-border p-3 text-sm">
          <p><span className="font-medium">Source:</span> {source ? source.title : "Fixture campaign"}</p>
          <p><span className="font-medium">Actions:</span> {state.localActions.length} local item{state.localActions.length === 1 ? "" : "s"}</p>
          <p><span className="font-medium">Write-back:</span> Not connected</p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("evidence", "Review checks")}
          {goButton("strategy", "Review tactics")}
          {goButton("drafts", "Open drafts")}
        </div>
      </Panel>
    </div>
  );

  const renderAudienceView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
      <Panel>
        <SmallLabel>Audiences</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{source ? "Plan audiences from this campaign source" : "Choose the contact set"}</h2>
        <p className="mt-3 text-muted-foreground">
          {source
            ? "Source documents can inform local audience planning, but no contact list, consent register, or live segment import is connected for this campaign."
            : "The selected segment follows the draft, review, and queue views. Counts are fixture contacts for this browser demo."}
        </p>
        <p className="mt-4 rounded-[var(--r-xl)] bg-tint-yellow px-4 py-3 text-sm">
          {source ? "Campaign-specific planning is read-only source plus browser-local selections; real import and consent matching are " : "Real import and consent matching are "}<span className="font-semibold">Coming soon</span>; this view does not contact people.
        </p>
        {sourceAudienceSignals.length ? (
          <div className="mt-5 space-y-3" aria-label="Source audience signals">
            {sourceAudienceSignals.map((signal) => (
              <div key={signal.label} className="rounded-[var(--r-xl)] border border-ops-line bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{signal.label}</p>
                  <span className="rounded-full bg-ops-blue px-2.5 py-1 text-xs text-ops-ink">{signal.status}</span>
                </div>
                <p className="mt-2 text-muted-foreground">{signal.detail}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
      <div className="space-y-3" role="list" aria-label="Audience segments">
        {audienceSegments.map((segment) => {
          const active = segment.id === selected.id;
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => selectSegment(segment)}
              className={`w-full rounded-[var(--r-2xl)] border p-4 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-ink focus-visible:ring-0 ${
                active ? "border-foreground bg-tint-blue" : "border-border bg-background hover:bg-secondary"
              }`}
              aria-pressed={active}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-medium">{segment.name}</span>
                  <span className="block text-sm text-muted-foreground">{segment.role}</span>
                </span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs">
                  {source ? "Local planning only" : `${segment.contacts} fixture contacts`}
                </span>
              </span>
              <span className="mt-3 block text-sm text-muted-foreground">{source ? "No imported contacts are counted for this real campaign; this local selection only carries audience intent into Drafts and Reviews." : segment.readiness}</span>
              <span className="mt-2 block text-sm">{segment.ask}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderDraftsView = () => (
    <div className="grid gap-5 xl:grid-cols-[285px_minmax(0,1fr)_275px]">
      <Panel className="bg-ops-ink text-white">
        <SmallLabel>Draft library</SmallLabel>
        <h2 className="mt-2 text-2xl font-medium tracking-tight">Communications</h2>
        <p className="mt-2 text-sm text-white/65">
          An editorial desk for the outreach sequence. Source pack resources can be copied into a browser-local editable working draft.
        </p>
        <div className="mt-5 space-y-3">
          {workspaceDraftLibrary.map((draft, index) => (
            <button
              key={draft.id}
              type="button"
              onClick={() => setActiveDraft(draft.id)}
              className={`w-full rounded-[var(--r-xl)] border p-3 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-yellow focus-visible:ring-0 ${
                state.activeDraft === draft.id ? "border-ops-yellow bg-ops-yellow text-ops-ink" : "border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.12]"
              }`}
              aria-pressed={state.activeDraft === draft.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{index + 1}. {draft.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${state.activeDraft === draft.id ? "bg-background/70" : "bg-white/10"}`}>{draft.id === "supporter_email" ? status.label : draft.state}</span>
              </div>
              <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.1em] ${state.activeDraft === draft.id ? "text-ops-ink/65" : "text-white/50"}`}>{draft.channel}</p>
              <p className={`mt-1 text-sm ${state.activeDraft === draft.id ? "text-ops-ink/75" : "text-white/[0.62]"}`}>{draft.detail}</p>
            </button>
          ))}
        </div>
        {state.workingDrafts.length ? (
          <div className="mt-6 border-t border-white/15 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Local working copies</p>
            <div className="mt-3 space-y-3" aria-label="Local working draft library">
              {state.workingDrafts.map((draft) => {
                const active = state.activeWorkingDraftId === draft.id;
                return (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={() => setActiveWorkingDraft(draft.id)}
                    className={`w-full rounded-[var(--r-xl)] border p-3 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-yellow focus-visible:ring-0 ${
                      active ? "border-ops-mint bg-ops-mint text-ops-ink" : "border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.12]"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{draft.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-background/70" : "bg-white/10"}`}>{statusCopy[draft.status].label}</span>
                    </div>
                    <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.1em] ${active ? "text-ops-ink/65" : "text-white/50"}`}>{draft.channel} · {draft.sourceWorkingCopy.sourceDocument}</p>
                    <p className={`mt-1 line-clamp-2 text-sm ${active ? "text-ops-ink/75" : "text-white/[0.62]"}`}>{draft.subject}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {sourceResources.length ? (
          <div className="mt-6 border-t border-white/15 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Real source resources</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">
                {sourceResources.length} ready candidate{sourceResources.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 space-y-4" aria-label="Source pack resources">
              {sourceResourceGroups.map((group) => (
                <div key={group.sourceDocument} className="rounded-[var(--r-xl)] border border-white/15 bg-white/[0.05] p-2">
                  <div className="flex items-center justify-between gap-2 px-1 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-white/45">
                    <span>{group.sourceDocument}</span>
                    <span>{group.resources.length} candidate{group.resources.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="space-y-3">
                    {group.resources.map((resource) => (
                      <div key={resource.id} className="rounded-[var(--r-xl)] border border-white/15 bg-white/[0.07] p-3 text-sm text-white">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{resource.title}</p>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-white/45">{resource.channel} · {resource.sourceDocument}</p>
                          </div>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">Source</span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-xs text-white/60">{resource.preview}</p>
                        <button
                          type="button"
                          onClick={() => createSourceWorkingCopy(resource)}
                          className="mt-3 rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-yellow"
                        >
                          {state.workingDrafts.some((draft) => draft.id === resource.id) ? "Open working copy" : "Use in editable draft"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : source ? (
          <div className="mt-6 rounded-[var(--r-xl)] border border-white/15 bg-white/[0.07] p-3 text-sm text-white/65">
            No ready source pack resources were exposed as editable candidates. Keep drafting local and conservative rather than substituting fixture copy.
          </div>
        ) : null}
      </Panel>
      <Panel className="bg-[linear-gradient(90deg,oklch(0.96_0.012_82)_0_1px,transparent_1px),linear-gradient(oklch(0.96_0.012_82)_0_1px,transparent_1px)] bg-[size:28px_28px] shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SmallLabel>{activeWorkingDraft?.channel ?? activeDraft.channel} draft</SmallLabel>
            <h2 className="mt-1 text-3xl font-medium tracking-tight">
              {activeWorkingDraft ? `Working copy: ${activeWorkingDraft.title}` : activeSourceWorkingCopy ? `Working copy: ${activeSourceWorkingCopy.title}` : activeDraftEditable ? `Parent update for ${selected.name.toLowerCase()}` : activeDraft.title}
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {activeSourceWorkingCopy ? activeSourceWorkingCopy.provenance : activeDraftEditable ? selected.ask : activeDraft.detail}
            </p>
          </div>
          <div className="flex rounded-full border border-border bg-background p-1" aria-label="Draft mode">
            {(["compose", "preview"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setState((current) => ({ ...current, mode }))}
                disabled={!activeDraftEditable}
                className={`rounded-full px-4 py-1.5 text-sm capitalize motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  state.mode === mode && activeDraftEditable ? "bg-ops-ink text-white" : "text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                }`}
                aria-pressed={state.mode === mode}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-ops-yellow/45 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Review warning:</span> {activeSourceWorkingCopy ? `This copy came from ${activeSourceWorkingCopy.sourceDocument}; keep its source warnings attached before approval.` : activeDraft.requires} {activeDraftEditable && !activeSourceWorkingCopy ? selected.caveat : !activeDraftEditable ? (source ? "This staged source outline is not available for approval or queueing." : "This staged fixture is not available for approval or queueing.") : null}
        </div>
        {activeSourceWorkingCopy ? (
          <div className="mt-4 rounded-[var(--r-2xl)] border border-ops-line bg-background/85 p-4 text-sm">
            <p className="font-medium">Source provenance attached</p>
            <p className="mt-1 text-muted-foreground">{activeSourceWorkingCopy.sourceDocument} · campaign {activeSourceWorkingCopy.campaignId} · local copy created {formatQueuedTime(activeSourceWorkingCopy.createdAt)}. The public campaign document is read-only.</p>
            {activeSourceWorkingCopy.warnings.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
                {activeSourceWorkingCopy.warnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!activeDraftEditable ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-[var(--r-2xl)] border border-border bg-white p-6 shadow-sm">
              <SmallLabel>Staged outline</SmallLabel>
              <h3 className="mt-2 text-2xl font-medium">{activeDraft.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Intended audience:</span> {activeDraft.audience}</p>
              <ol className="mt-5 space-y-3 text-sm">
                {activeDraft.outline.map((item, index) => (
                  <li key={item} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ops-blue text-xs font-semibold">{index + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-[var(--r-2xl)] border border-border bg-background/80 p-4 text-sm">
              <p className="font-medium">Why this is not editable yet</p>
              <p className="mt-2 text-muted-foreground">Campaign Factory can show the operational placeholder, but real recipients, evidence, and escalation judgement must be resolved before this item becomes working copy.</p>
              <div className="mt-4 flex flex-col gap-3">
                {goButton("evidence", "Review checks")}
                {goButton("contacts", "Inspect contacts")}
              </div>
            </div>
          </div>
        ) : state.mode === "compose" ? (
          <div className="mt-6 space-y-5 rounded-[var(--r-2xl)] border border-border bg-background p-5 shadow-sm">
            <div className="space-y-2">
              <Label htmlFor="operations-subject">Subject</Label>
              <Input
                id="operations-subject"
                value={communicationSubject}
                onChange={(event) => updateDraft({ subject: event.target.value })}
                className="h-auto rounded-full border-[1.5px] px-4 py-2.5 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operations-body">Message</Label>
              <Textarea
                id="operations-body"
                value={communicationBody}
                onChange={(event) => updateDraft({ body: event.target.value })}
                rows={13}
                className="min-h-[22rem] rounded-[var(--r-2xl)] border-[1.5px] p-4 text-base leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <article className="mt-6 rounded-[var(--r-2xl)] border border-border bg-white p-6 shadow-sm">
            <div className="border-b border-border pb-4 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">To:</span> {source ? `${selected.name} · local audience intent only` : `${selected.name} · ${selected.ready} ready fixture contacts`}</p>
              <p><span className="font-medium text-foreground">Status:</span> {status.label}</p>
            </div>
            <h3 className="mt-5 text-2xl font-medium">{communicationSubject || "Untitled campaign email"}</h3>
            <div className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{communicationBody}</div>
          </article>
        )}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!activeDraftEditable || !canRequestReview || communicationStatus === "review" || communicationStatus === "approved" || communicationStatus === "queued"}>
            Mark ready for review
          </Button>
          {goButton("reviews", "Open review gate")}
        </div>
      </Panel>
      <Panel className="bg-ops-blue/[0.65]">
        <SmallLabel>Desk notes</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Copy follows the runway</h3>
        <div className="mt-5 space-y-4 text-sm">
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Audience</p>
            <p className="mt-1 text-muted-foreground">{source ? `${selected.name}: local intent only; no imported contacts are claimed.` : `${selected.name}: ${selected.ready}/${selected.contacts} ready fixtures.`}</p>
          </div>
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Approval state</p>
            <p className="mt-1 text-muted-foreground">{status.text}</p>
          </div>
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Boundary</p>
            <p className="mt-1 text-muted-foreground">Provider, import, and production scheduling are not connected.</p>
          </div>
          {activeSourceWorkingCopy ? (
            <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
              <p className="font-medium">Source copy</p>
              <p className="mt-1 text-muted-foreground">{activeSourceWorkingCopy.title} from {activeSourceWorkingCopy.sourceDocument}; editable only in this browser.</p>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );

  const renderReviewView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.65fr)]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Reviews & approvals</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Human approval gate</h2>
        <p className="mt-3 text-muted-foreground">
          A draft cannot enter the local queue until a person explicitly approves it. Blockers are shown in text, not just colour.
        </p>
        {state.workingDrafts.length ? (
          <div className="mt-5 rounded-[var(--r-2xl)] border border-border bg-background p-4" aria-label="Local working drafts for review">
            <SmallLabel>Working draft queue</SmallLabel>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {state.workingDrafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => setActiveWorkingDraft(draft.id)}
                  className={`rounded-[var(--r-xl)] border p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${state.activeWorkingDraftId === draft.id ? "border-ops-ink bg-ops-yellow" : "border-border bg-secondary hover:bg-ops-blue/70"}`}
                  aria-pressed={state.activeWorkingDraftId === draft.id}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{draft.title}</span>
                    <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs">{statusCopy[draft.status].label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{draft.sourceWorkingCopy.sourceDocument} · local copy only</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-6 grid gap-3 md:grid-cols-2" aria-label="Approval gates">
          {[
            { label: "Message has enough substance to review", ok: canRequestReview, detail: canRequestReview ? "Subject and body are long enough for a meaningful check." : "Add a clear subject and message before requesting review." },
            { label: "Audience readiness understood", ok: source ? true : selected.ready > 0, detail: source ? "No imported contacts are claimed; the selected audience is a browser-local planning label only." : `${selected.ready}/${selected.contacts} selected fixture contacts are marked ready.` },
            { label: "Evidence checks still visible", ok: true, detail: "Council timing, legal-order wording, and consent remain called out before any real provider use." },
            { label: "External action blocked", ok: true, detail: "Provider connection is not active; approval only unlocks the local demo queue." },
          ].map((item) => (
            <div key={item.label} className={`rounded-[var(--r-xl)] border p-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${item.ok ? "border-ops-line bg-background" : "border-ops-coral bg-ops-coral/[0.55]"}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.label}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs ${item.ok ? "bg-ops-mint" : "bg-background"}`}>
                  {item.ok ? "Clear" : "Blocked"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!canRequestReview || communicationStatus === "review" || communicationStatus === "approved" || communicationStatus === "queued"}>
            Mark ready for review
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={approve} disabled={communicationStatus !== "review"}>
            Approve as human reviewer
          </Button>
          <Button type="button" size="lg" variant="secondary" onClick={queue} disabled={communicationStatus !== "approved"}>
            Queue locally for demo
          </Button>
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <Label htmlFor="operations-reviewer-note">Optional reviewer note</Label>
          <Textarea
            id="operations-reviewer-note"
            className="mt-2 min-h-24 bg-background"
            value={reviewerNote}
            onChange={(event) => updateReviewerNote(event.target.value)}
            placeholder="Record the human check, evidence caveat, or consent question that should travel with this local copy."
          />
          <p className="mt-2 text-xs text-muted-foreground">Saved only in this browser-local workspace and included in client-side exports; it does not write back to the campaign source.</p>
        </div>
      </Panel>
      <Panel className="bg-ops-ink text-white">
        <SmallLabel>Current review item</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">{status.label}</h3>
        <p className="mt-3 text-sm text-white/65">{status.text}</p>
        {reviewBlocked ? (
          <p className="mt-4 rounded-[var(--r-xl)] bg-ops-coral px-4 py-3 text-sm text-ops-ink">
            Blocked: the supporter email needs enough copy before it can be checked.
          </p>
        ) : null}
        <article className="mt-5 rounded-[var(--r-xl)] border border-white/15 bg-white p-4 text-sm text-foreground shadow-sm" aria-label="Communication preview for approval">
          <p className="font-medium">{communicationSubject || "Untitled campaign email"}</p>
          <p className="mt-1 text-muted-foreground">Audience: {selected.name}</p>
          {activeSourceWorkingCopy ? <p className="mt-1 text-muted-foreground">Source copy: {activeSourceWorkingCopy.title} · {activeSourceWorkingCopy.sourceDocument}</p> : null}
          {reviewerNote.trim() ? <p className="mt-3 rounded-[var(--r-lg)] bg-ops-yellow/60 p-3 text-foreground">Reviewer note: {reviewerNote}</p> : null}
          <div className="mt-4 line-clamp-6 whitespace-pre-wrap border-t border-border pt-4 text-muted-foreground">{communicationBody}</div>
        </article>
        <div className="mt-5 rounded-[var(--r-xl)] border border-white/15 bg-white/[0.08] p-3 text-sm">
          <p className="font-medium">Approval desk rule</p>
          <p className="mt-1 text-white/60">Human approval changes only this browser-local workflow. It never connects the provider.</p>
        </div>
      </Panel>
    </div>
  );

  const renderOutboxView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Outbox & schedule</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{queuedItemCount === 1 ? "One local queue item" : queuedItemCount ? `${queuedItemCount} local queue items` : "Nothing queued yet"}</h2>
        <p id="operations-provider-note" className="mt-3 text-muted-foreground">
          {queuedItemCount
            ? "The approved draft is stored in this browser for the conference demo. It is not connected to an email provider."
            : "Approve the draft before it can enter the local demo queue. Provider outreach stays disabled."}
        </p>
        <div className="mt-6 rounded-[var(--r-2xl)] border border-border bg-background p-4">
          <SmallLabel>Local dispatch runway</SmallLabel>
          <div className="mt-4 grid gap-3 md:grid-cols-4" aria-label="Local dispatch runway">
            {[
              { label: "Human approval", state: communicationStatus === "draft" ? "Blocked" : communicationStatus === "review" ? "Current" : "Complete", tone: communicationStatus === "draft" ? "bg-ops-coral" : communicationStatus === "review" ? "bg-ops-yellow" : "bg-ops-mint", detail: status.label },
              { label: "Local queue", state: communicationStatus === "queued" ? "Complete" : communicationStatus === "approved" ? "Current" : "Locked", tone: communicationStatus === "queued" ? "bg-ops-mint" : communicationStatus === "approved" ? "bg-ops-yellow" : "bg-ops-blue", detail: communicationStatus === "queued" ? "Stored in this browser" : "Needs approval first" },
              { label: "Provider", state: "Locked", tone: "bg-ops-blue", detail: "Coming soon · not connected" },
              { label: "Responses", state: "Locked", tone: "bg-ops-blue", detail: "Coming soon · no response stream" },
            ].map((step, index) => (
              <div key={step.label} className={`rounded-[var(--r-xl)] border border-ops-line p-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${step.tone}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/70 text-xs font-semibold">{index + 1}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.1em]">{step.state}</span>
                </div>
                <p className="mt-4 font-medium">{step.label}</p>
                <p className="mt-1 text-sm text-ops-ink/70">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
          <div className="hidden grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Communication</span><span>Audience</span><span>State</span><span>Local timing</span>
          </div>
          {queuedItemCount ? (
            [
              ...(state.status === "queued"
                ? [{ id: "seeded-supporter-email", subject: state.subject, sourceDocument: state.sourceWorkingCopy?.sourceDocument, queuedAt: state.queuedAt }]
                : []),
              ...state.workingDrafts.filter((draft) => draft.status === "queued").map((draft) => ({ id: draft.id, subject: draft.subject, sourceDocument: draft.sourceWorkingCopy.sourceDocument, queuedAt: draft.queuedAt })),
            ].map((item) => (
              <div key={item.id} className="grid gap-3 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr]">
                <div><span className="md:hidden font-medium">Communication: </span>{item.subject}{item.sourceDocument ? <p className="mt-1 text-xs text-muted-foreground">Local copy from {item.sourceDocument}</p> : null}</div>
                <div><span className="md:hidden font-medium">Audience: </span>{selected.name}</div>
                <div><span className="md:hidden font-medium">State: </span>Queued for demo</div>
                <div><span className="md:hidden font-medium">Local timing: </span>{formatQueuedTime(item.queuedAt)} · {scheduleCopy[state.scheduleIntent]}</div>
              </div>
            ))
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No local queue rows yet. Use the Reviews & approvals view to record human approval first.
            </div>
          )}
        </div>
        <button
          type="button"
          disabled
          aria-describedby="operations-provider-note"
          className="mt-5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground opacity-70"
          title="Provider connection is coming soon; this demo does not use email outreach."
        >
          Email provider · Coming soon
        </button>
      </Panel>
      <Panel>
        <SmallLabel>Scheduling boundary</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Local intent only</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Production scheduling is not connected. This workbench can show what a campaigner intends to prepare, but it cannot place work onto a live provider calendar.
        </p>
        <div className="mt-5 space-y-2">
          <Label htmlFor="operations-schedule-intent">Local schedule intent</Label>
          <select
            id="operations-schedule-intent"
            value={state.scheduleIntent}
            onChange={(event) => setState((current) => ({ ...current, scheduleIntent: event.target.value as DemoState["scheduleIntent"] }))}
            className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="after_approval">Hold after approval</option>
            <option value="tomorrow_morning">{source ? "Next campaign review window" : "Next school-run morning"}</option>
            <option value="school_run">{source ? "After next source check" : "School-run reminder window"}</option>
          </select>
          <p className="text-sm text-muted-foreground">{scheduleCopy[state.scheduleIntent]}</p>
        </div>
        <Button type="button" variant="outline" disabled className="mt-4" title="Production scheduling is coming soon and is not connected in this demo.">
          Production scheduler · Coming soon
        </Button>
        <div className="mt-5 rounded-[var(--r-2xl)] border border-border bg-secondary/55 p-4" aria-label="Export operations pack">
          <SmallLabel>Export operations pack</SmallLabel>
          <h4 className="mt-2 text-lg font-medium">Client-side download</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Export this campaign&apos;s local actions, drafts, source evidence boundaries, and disconnected-provider statement. The download is generated in the browser; no server write or source mutation happens.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => exportOperationsPack("md")}>Download Markdown</Button>
            <Button type="button" variant="outline" onClick={() => exportOperationsPack("json")}>Download JSON</Button>
          </div>
        </div>
        <Button type="button" variant="ghost" className="mt-5" onClick={reset}>
          {resetLabel}
        </Button>
      </Panel>
    </div>
  );

  const renderRunway = () => (
    <section aria-labelledby="campaign-runway-title" className="rounded-[var(--r-3xl)] bg-ops-ink p-2 text-ops-ink shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 px-3 pb-3 pt-2 text-white">
        <div>
          <SmallLabel>Campaign Runway</SmallLabel>
          <h2 id="campaign-runway-title" className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">
            Brief to safe local outbox, one stage at a time.
          </h2>
        </div>
        <p className="max-w-md text-sm text-white/65">
          {source ? "Every node is derived from this source campaign or local browser state." : "Every node is derived from source, fixture, or local browser state."} Select a stage to work there; no provider action is connected.
        </p>
      </div>
      <div className="ops-runway" role="list" aria-label="Six-stage campaign runway">
        {runwayStages.map((stage, index) => (
          <button
            key={stage.label}
            type="button"
            onClick={() => setView(stage.view)}
            className={`ops-runway-stage ${stageClass[stage.status]}`}
            aria-label={`${stage.label}: ${stageStatusCopy[stage.status]}, ${stage.statusLabel}`}
          >
            <span className="flex items-center gap-3" aria-hidden="true">
              <span className="ops-stage-node">{index + 1}</span>
              {index < runwayStages.length - 1 ? <span className="ops-stage-line" /> : null}
            </span>
            <span className="mt-4 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ops-ink/65">
              {stageStatusCopy[stage.status]}
            </span>
            <span className="mt-1 block text-xl font-medium tracking-tight">{stage.label}</span>
            <span className="mt-2 block text-sm font-semibold">{stage.statusLabel}</span>
            <span className="mt-3 block text-sm leading-snug text-ops-ink/72">{stage.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const renderOverview = () => (
    <div className="space-y-5">
      <Panel className="bg-ops-paper">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
          <SmallLabel>{source ? "Real campaign source" : "Today"}</SmallLabel>
          <h1 className="mt-2 max-w-3xl text-4xl font-medium tracking-tight sm:text-5xl">
            {source ? (
              <>
                {source.title} <span className="font-serif font-normal italic">into operations</span>.
              </>
            ) : (
              <>
                Make the St John the Baptist school street <span className="font-serif font-normal italic">permanent</span> before the order lapses.
              </>
            )}
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            {source
              ? `Loaded from the public Campaign Factory read model for ${source.place || "this campaign"}. The source is read-only; local operations can plan work without sending, importing, scheduling, or writing back.`
              : "The workbench keeps the campaign brief, audience choice, draft copy, review gate, and local queue in one place. Fixture data is labelled; real provider and import steps remain off."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {source ? (
              <Link href={source.sourceHref} className="rounded-full border border-ops-line bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                Return to source brief
              </Link>
            ) : null}
            {goButton("audiences", `Audience: ${selected.name}`)}
            {goButton("drafts", `Draft: ${status.label}`)}
            {goButton("reviews", communicationStatus === "review" ? "Approve now" : "Open approval gate")}
            {goButton("outbox", queuedItemCount ? "Inspect local queue" : "Outbox locked")}
          </div>
          </div>
          <div className="rounded-[var(--r-2xl)] border border-ops-line bg-background/80 p-4">
            <SmallLabel>Next human decision</SmallLabel>
            <h2 className="mt-2 text-2xl font-medium">{source ? `${sourcePrimaryCheckTitle(source)} before the campaign changes phase.` : "Approve only after the claim checks are understood."}</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {source?.nextGate ?? "Council timing, legal-order wording, and contact consent are the key checks before any real provider connection is considered."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">{goButton("reviews", "Open reviews")}{goButton("evidence", "See checks")}</div>
          </div>
        </div>
      </Panel>
      {source ? (
        <Panel className="bg-ops-blue/65" >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <SmallLabel>Source identity & provenance</SmallLabel>
              <h2 className="mt-2 text-2xl font-medium">{sourceStatusPhrase(source)} · loaded from public Campaign Factory data</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Campaign ID <span className="font-mono text-xs text-foreground">{source.campaignId}</span> · state v{source.stateVersion} · event #{source.lastSequence} · loaded {formatQueuedTime(source.loadedAt)}.
              </p>
              {sourceBaselineChanged ? (
                <div className="mt-4 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status">
                  <p className="font-medium">Read-only source has changed since this local workspace started.</p>
                  <p className="mt-1">Your browser-local actions and drafts were preserved. Re-check Evidence, Strategy, and Drafts before approving or queueing local work.</p>
                  <button
                    type="button"
                    onClick={acknowledgeSourceRefresh}
                    className="mt-3 rounded-full border border-ops-ink/20 bg-background/70 px-3 py-1.5 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Acknowledge updated source
                  </button>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={source.sourceHref} className="rounded-full bg-ops-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  View original brief
                </Link>
                {goButton("brief", "Inspect source mapping")}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/70 p-3">
                <p className="text-2xl font-medium">{source.readyCount}/{source.documents.length}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Documents ready</p>
              </div>
              <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/70 p-3">
                <p className="text-2xl font-medium">{source.evidence.totals.unresolvedLoadBearing}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Unresolved key facts</p>
              </div>
              <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/70 p-3">
                <p className="text-2xl font-medium">{source.incompleteDocuments.length}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Incomplete packs</p>
              </div>
              <p className="text-sm text-muted-foreground sm:col-span-3">
                {source.incompleteDocuments.map((doc) => `${doc.name}: ${doc.status}`).join(" · ") || "All compiled documents are ready."}
              </p>
            </div>
          </div>
        </Panel>
      ) : null}
      {renderRunway()}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Panel className="bg-ops-blue/70">
          <SmallLabel>Current communications</SmallLabel>
          <h2 className="mt-2 text-2xl font-medium">{status.label}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>
          <div className="mt-5 flex flex-wrap gap-3">{goButton("drafts", "Edit draft")}{goButton("outbox", "Open outbox")}</div>
        </Panel>
        <Panel className="bg-background">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SmallLabel>Field notes from this browser</SmallLabel>
              <p className="mt-2 text-sm text-muted-foreground">Only genuine local actions appear here.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{state.activity.length} local note{state.activity.length === 1 ? "" : "s"}</span>
          </div>
          <ul className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            {state.activity.slice(0, 4).map((item) => (
              <li key={item.id} className="border-l-2 border-ops-ink/25 pl-3 text-muted-foreground">
                {item.label}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );

  const renderPowerMapView = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Influence map</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Power map</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          {sourceLoaded
            ? "The source-backed stakeholder document is loaded read-only; this first slice keeps contact inference and CRM import explicitly disconnected."
            : "A spatial influence board for allies, persuadables, blockers, and the decision target. It is fixture-grounded and uses text labels as well as colour."}
        </p>
        {sourceLoaded ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)_minmax(0,1fr)] lg:items-stretch" aria-label="Source-backed stakeholder lanes">
            {sourceStakeholders.length ? sourceStakeholders.map((stakeholder, index) => (
              <div
                key={`${stakeholder.group}-${stakeholder.name}`}
                className={`rounded-[var(--r-2xl)] border border-ops-line p-4 ${index === 0 ? "border-2 border-ops-ink bg-background text-center shadow-sm" : index % 3 === 1 ? "bg-ops-mint" : index % 3 === 2 ? "bg-ops-yellow" : "bg-ops-blue/70"}`}
              >
                <SmallLabel>{stakeholder.group} · {stakeholder.power}</SmallLabel>
                <h3 className="mt-2 text-xl font-medium">{stakeholder.name}</h3>
                <p className="mt-2 text-sm text-ops-ink/72">{stakeholder.position}</p>
                <p className="mt-3 text-xs text-ops-ink/60">Read-only source role; no contact record or delivery target is imported.</p>
              </div>
            )) : (
              <div className="rounded-[var(--r-2xl)] border border-ops-line bg-background p-5 lg:col-span-3">
                <SmallLabel>Read-only source document</SmallLabel>
                <h3 className="mt-2 text-2xl font-medium">Stakeholder map loaded from the public campaign bundle</h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  The source did not expose parseable stakeholder lanes, so the complete power-map layout shows the document table below without inventing a contact graph, imported list, or delivery target.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)_minmax(0,1fr)] lg:items-stretch">
            <div className="space-y-4">
              <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-mint p-4">
                <SmallLabel>Allies · ready to validate</SmallLabel>
                <h3 className="mt-2 text-xl font-medium">School-gate families</h3>
                <p className="mt-2 text-sm text-ops-ink/72">Primary supporter base; selected audience can move directly into the supporter email after review.</p>
              </div>
              <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-mint/[0.70] p-4">
                <SmallLabel>Allies · process check</SmallLabel>
                <h3 className="mt-2 text-xl font-medium">Clean-air supporters</h3>
                <p className="mt-2 text-sm text-ops-ink/72">Useful for spotting escalation risks before a public-facing press prompt exists.</p>
              </div>
            </div>
            <div className="flex flex-col justify-between rounded-[var(--r-2xl)] border-2 border-ops-ink bg-background p-5 text-center shadow-sm">
              <SmallLabel>Decision target</SmallLabel>
              <h3 className="mt-3 text-2xl font-medium">Leicester transport decision route</h3>
              <p className="mt-3 text-sm text-muted-foreground">Exact committee/officer path must be verified before formal decision-maker copy is unlocked.</p>
              <div className="mt-5 rounded-full bg-ops-coral px-3 py-2 text-sm font-medium text-ops-ink">Current blocker: route verification</div>
            </div>
            <div className="space-y-4">
              <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-yellow p-4">
                <SmallLabel>Persuadables · broaden pressure</SmallLabel>
                <h3 className="mt-2 text-xl font-medium">Nearby ward parents</h3>
                <p className="mt-2 text-sm text-ops-ink/72">Neighbourhood framing makes the safety issue wider than one school gate.</p>
              </div>
              <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-coral p-4">
                <SmallLabel>Potential blockers · answer carefully</SmallLabel>
                <h3 className="mt-2 text-xl font-medium">Cost, enforcement, traffic objections</h3>
                <p className="mt-2 text-sm text-ops-ink/72">Keep public claims conservative until evidence checks and local consent are clear.</p>
              </div>
            </div>
          </div>
        )}
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
          <div className="hidden gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
            <span>Group</span><span>{sourceLoaded ? "What the source says" : "What the fixture says"}</span><span>Operational use</span><span>Owner</span>
          </div>
          {sourceContext.power.rows.map((row) => (
            <div key={row.label} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
              <div><span className="font-medium md:hidden">Group: </span><span className="font-medium">{row.label}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">{sourceLoaded ? "What the source says: " : "What the fixture says: "}</span>{row.detail}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Operational use: </span>{row.use}</div>
              <div><span className="font-medium md:hidden">Owner: </span>{row.owner}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Use this map next</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Move from influence to copy</h3>
        <p className="mt-3 text-sm text-muted-foreground">Select the audience that best matches the pressure path, then keep blockers visible in review.</p>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("audiences", "Choose audience")}
          {goButton("drafts", "Open drafts")}
          {goButton("evidence", "Review blockers")}
        </div>
      </Panel>
    </div>
  );

  const renderCampaignContextView = (section: (typeof campaignContext)[keyof typeof campaignContext]) => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <SmallLabel>Campaign context</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{section.title}</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">{section.intro}</p>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Brief item</span>
            <span>{sourceLoaded ? "What the source says" : "What the fixture says"}</span>
            <span>Operational use</span>
            <span>Owner</span>
          </div>
          {section.rows.map((row) => (
            <div key={row.label} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
              <div><span className="font-medium md:hidden">Brief item: </span><span className="font-medium">{row.label}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">{sourceLoaded ? "What the source says: " : "What the fixture says: "}</span>{row.detail}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Operational use: </span>{row.use}</div>
              <div><span className="font-medium md:hidden">Owner: </span>{row.owner}</div>
            </div>
          ))}
        </div>
        {source && section.title === "Evidence & checks" ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
            <div className="overflow-hidden rounded-[var(--r-2xl)] border border-ops-line bg-background" aria-label="Source next checks ledger">
              <div className="border-b border-border bg-ops-blue/55 px-4 py-3">
                <p className="text-sm font-semibold">Next checks from the source bundle</p>
                <p className="mt-1 text-xs text-muted-foreground">Each row can become browser-local work; no source claim is edited here.</p>
              </div>
              {source.evidence.nextChecks.length ? source.evidence.nextChecks.slice(0, 5).map((check, index) => {
                const actionId = sourceCheckActionId(source, check, index);
                const actionExists = state.localActions.some((action) => action.id === actionId);
                return (
                  <div key={check.id || index} className="grid gap-3 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[minmax(0,1fr)_170px] md:items-start">
                    <div>
                      <p className="font-medium">{check.description}</p>
                      {check.reason ? <p className="mt-1 text-muted-foreground">{check.reason}</p> : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {check.claimIds?.length ? `${check.claimIds.length} linked source claim${check.claimIds.length === 1 ? "" : "s"}` : "No individual claim IDs exposed"}
                        {check.affectedSections?.length ? ` · ${check.affectedSections.join(", ")}` : ""}
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => createSourceCheckAction(check, index)} disabled={actionExists}>
                      {actionExists ? "Action created" : "Create action"}
                    </Button>
                  </div>
                );
              }) : (
                <div className="px-4 py-5 text-sm text-muted-foreground">No next checks were exposed by the source bundle.</div>
              )}
            </div>
            <div className="overflow-hidden rounded-[var(--r-2xl)] border border-ops-line bg-background" aria-label="Source document readiness">
              <div className="border-b border-border bg-ops-yellow/60 px-4 py-3">
                <p className="text-sm font-semibold">Document readiness</p>
                <p className="mt-1 text-xs text-muted-foreground">Incomplete documents become follow-up actions, not hidden fallback content.</p>
              </div>
              {source.incompleteDocuments.length ? source.incompleteDocuments.map((doc) => {
                const actionId = incompleteDocumentActionId(source, doc);
                const actionExists = state.localActions.some((action) => action.id === actionId);
                return (
                  <div key={doc.key} className="border-b border-border px-4 py-4 text-sm last:border-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{doc.name}</p>
                        <p className="mt-1 text-muted-foreground">Status: {doc.status}; resource count {doc.resourceCount}.</p>
                      </div>
                      <span className="rounded-full bg-ops-coral px-2.5 py-1 text-xs text-ops-ink">Incomplete</span>
                    </div>
                    <Button type="button" variant="outline" className="mt-3" onClick={() => createIncompleteDocumentAction(doc)} disabled={actionExists}>
                      {actionExists ? "Follow-up created" : "Create follow-up"}
                    </Button>
                  </div>
                );
              }) : (
                <div className="px-4 py-5 text-sm text-muted-foreground">All compiled documents exposed by this source route are ready.</div>
              )}
            </div>
          </div>
        ) : null}
        {source && section.title === "Strategy & tactics" ? (
          <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-ops-line bg-background" aria-label="Source tactic action candidates">
            <div className="border-b border-border bg-ops-mint/60 px-4 py-3">
              <p className="text-sm font-semibold">Tactic actions from the source timeline</p>
              <p className="mt-1 text-xs text-muted-foreground">Tactics can become browser-local owned work; the public campaign source remains read-only.</p>
            </div>
            {sourceTactics.length ? sourceTactics.map((tactic) => {
              const actionExists = state.localActions.some((action) => action.id === tactic.id);
              return (
                <div key={tactic.id} className="grid gap-3 border-b border-border px-4 py-4 text-sm last:border-0 lg:grid-cols-[minmax(0,1fr)_170px] lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{tactic.title}</p>
                      <span className="rounded-full bg-ops-yellow px-2 py-0.5 text-xs text-ops-ink">{tactic.priority}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{tactic.type} · target: {tactic.target}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Owner: {tactic.owner}; timing: {tactic.timing}. {tactic.detail}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => createSourceTacticAction(tactic)} disabled={actionExists}>
                    {actionExists ? "Action created" : "Create local action"}
                  </Button>
                </div>
              );
            }) : (
              <div className="px-4 py-5 text-sm text-muted-foreground">No parseable tactic rows were exposed by the source timeline; use the source excerpt above instead of inventing actions.</div>
            )}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <SmallLabel>Use this context next</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Keep the brief tied to action</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          These rows are intentionally operational: each one either shapes audience choice, copy, review, or the provider boundary.
        </p>
        <div className="mt-5 space-y-3 rounded-[var(--r-xl)] border border-border p-3 text-sm">
          <p><span className="font-medium">Selected audience:</span> {selected.name}</p>
          <p><span className="font-medium">Draft status:</span> {status.label}</p>
          <p><span className="font-medium">Action plan:</span> {state.localActions.length} local item{state.localActions.length === 1 ? "" : "s"}</p>
          <p><span className="font-medium">Provider:</span> Not connected</p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {section.title === "Evidence & checks" ? (
            <Button type="button" onClick={createAppealStatusAction} disabled={hasAppealAction}>
              {hasAppealAction ? (source ? "Source-check action created" : "Appeal-status action created") : source ? sourcePrimaryCheckButton(source) : "Create appeal-status action"}
            </Button>
          ) : null}
          {section.title === "Strategy & tactics" ? goButton("actions", "Open Action plan") : null}
          {goButton("audiences", "Choose Audiences")}
          {goButton("drafts", "Open Drafts")}
          {goButton("reviews", "Open Reviews")}
        </div>
      </Panel>
    </div>
  );

  const renderContacts = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Contacts</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{source ? "Contact import boundary for this campaign" : "Fixture-backed contact readiness"}</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          {source
            ? "This real campaign workspace does not invent a contact list. It keeps source audience clues visible and leaves real import, consent reconciliation, and provider sync disconnected."
            : "This work area helps a campaigner see which local fixture contacts are usable for the demo draft, which need a check, and which are blocked until real import exists."}
        </p>
        {source ? (
          <div className="mt-5 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-ops-yellow/45 p-4 text-sm">
            <p className="font-medium">No imported contacts for {source.title}</p>
            <p className="mt-2 text-muted-foreground">
              Source documents may name audiences or stakeholders, but Operations has not connected a CRM, consent database, deduplication pass, or provider list. Local drafts can carry audience intent without claiming reachable people.
            </p>
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 md:grid-cols-3" aria-label="Contact readiness summary">
          {[
            source ? { label: "Imported contacts", count: 0, detail: "No campaign contact list connected" } : { label: "Ready fixtures", count: readyContactCount, detail: "Can be used in reviewed local demo copy" },
            source ? { label: "Source audience clues", count: sourceAudienceSignals.length, detail: "Read-only documents inform planning" } : { label: "Review first", count: reviewContactCount, detail: "Needs a human consent or claim check" },
            source ? { label: "Provider lists", count: 0, detail: "Provider sync remains disconnected" } : { label: "Blocked", count: blockedContactCount, detail: "Requires real import before use" },
          ].map((item) => (
            <div key={item.label} className="rounded-[var(--r-xl)] border border-border bg-secondary/55 p-4">
              <p className="text-2xl font-medium">{item.count}</p>
              <p className="mt-1 text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>

        {source ? (
          <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
            <div className="hidden grid-cols-[0.8fr_minmax(0,1.2fr)_0.9fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
              <span>Source clue</span><span>Planning use</span><span>Boundary</span>
            </div>
            {sourceAudienceSignals.length ? sourceAudienceSignals.map((signal) => (
              <div key={signal.label} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.8fr_minmax(0,1.2fr)_0.9fr]">
                <div><span className="font-medium md:hidden">Source clue: </span><span className="font-medium">{signal.label}</span><p className="text-xs text-muted-foreground">{signal.status}</p></div>
                <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Planning use: </span>{signal.detail}</div>
                <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Boundary: </span>No imported contacts or consent records are created from this document.</div>
              </div>
            )) : (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No source audience clues were exposed by the typed documents. Keep contacts disconnected rather than substituting fixture people.
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 rounded-[var(--r-2xl)] border border-border bg-secondary/45 p-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="operations-contact-segment">Segment filter</Label>
                <select
                  id="operations-contact-segment"
                  value={state.contactFilter}
                  onChange={(event) => setState((current) => ({ ...current, contactFilter: event.target.value as DemoState["contactFilter"] }))}
                  className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">All fixture contacts</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operations-contact-readiness">Readiness filter</Label>
                <select
                  id="operations-contact-readiness"
                  value={state.contactReadinessFilter}
                  onChange={(event) => setState((current) => ({ ...current, contactReadinessFilter: event.target.value as DemoState["contactReadinessFilter"] }))}
                  className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">All readiness states</option>
                  <option value="ready">Ready fixtures</option>
                  <option value="review">Review first</option>
                  <option value="blocked">Blocked until import</option>
                </select>
              </div>
              <p className="text-sm text-muted-foreground md:col-span-2">
                Real contact import, deduplication, consent reconciliation, and provider sync are <span className="font-medium text-foreground">Coming soon</span>; these rows are local fixture records only.
              </p>
            </div>

            <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
              <div className="hidden grid-cols-[0.8fr_0.8fr_0.75fr_1fr_1fr_0.65fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:grid">
                <span>Name</span><span>Segment</span><span>Readiness</span><span>Consent boundary</span><span>Next check</span><span>Owner</span>
              </div>
              {filteredContacts.length ? filteredContacts.map((contact) => (
                <div key={contact.id} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 lg:grid-cols-[0.8fr_0.8fr_0.75fr_1fr_1fr_0.65fr]">
                  <div><span className="font-medium lg:hidden">Name: </span><span className="font-medium">{contact.name}</span><p className="text-xs text-muted-foreground">{contact.role}</p></div>
                  <div><span className="font-medium lg:hidden">Segment: </span>{contact.segment}</div>
                  <div><span className="font-medium lg:hidden">Readiness: </span>{contact.readiness}</div>
                  <div className="text-muted-foreground"><span className="font-medium text-foreground lg:hidden">Consent boundary: </span>{contact.consent}</div>
                  <div className="text-muted-foreground"><span className="font-medium text-foreground lg:hidden">Next check: </span>{contact.check}</div>
                  <div><span className="font-medium lg:hidden">Owner: </span>{contact.owner}</div>
                </div>
              )) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No fixture contacts match those filters. Clear a filter or use this as a reminder that real import is not connected.
                </div>
              )}
            </div>
          </>
        )}
      </Panel>
      <Panel>
        <SmallLabel>Selected audience check</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">{selected.name}</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          {source
            ? "This is a browser-local audience intent only. It helps label local drafts and reviews without claiming imported contacts for the real campaign."
            : `${selectedSegmentContacts.filter((contact) => contact.readiness === "Ready fixture").length}/${selectedSegmentContacts.length} fixture contacts in this segment are ready enough for the local supporter email after review.`}
        </p>
        {!source ? <div className="mt-5 space-y-3 text-sm">
          {selectedSegmentContacts.map((contact) => (
            <div key={contact.id} className="rounded-[var(--r-xl)] border border-border p-3">
              <p className="font-medium">{contact.name} · {contact.readiness}</p>
              <p className="mt-1 text-muted-foreground">{contact.nextAction}</p>
            </div>
          ))}
        </div> : null}
        <div className="mt-5 flex flex-col gap-3">
          {goButton("audiences", "Change selected audience")}
          {goButton("drafts", "Use in supporter draft")}
          <Button type="button" variant="outline" disabled title="Real import is coming soon; this demo has no provider or consent database.">
            Import contacts · Coming soon
          </Button>
        </div>
      </Panel>
    </div>
  );

  const renderResponses = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Responses & results</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Coming soon: response handling after a real provider exists</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          There are no fabricated analytics here. This page records the boundary and the review questions that would matter once a provider, consent-safe import, and response stream exist.
        </p>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[0.8fr_1fr_0.9fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Future signal</span><span>Why it matters</span><span>Current boundary</span>
          </div>
          {[
            { signal: "Replies", why: "Would show supporter questions or local stories needing a human response.", boundary: "No provider or inbox stream is connected." },
            { signal: "List health", why: "Would help spot bounce and consent issues after a real import.", boundary: "No live list, bounce, or suppression data exists." },
            { signal: "Campaign outcome notes", why: "Would connect communications to the council decision route.", boundary: "No result is claimed from this demo queue." },
          ].map((item) => (
            <div key={item.signal} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.8fr_1fr_0.9fr]">
              <div><span className="font-medium md:hidden">Future signal: </span><span className="font-medium">{item.signal}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Why it matters: </span>{item.why}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Current boundary: </span>{item.boundary}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Empty state</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Not connected</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          No live provider, response stream, external measurement, or production result tracking is used in this demo workspace.
        </p>
        <div className="mt-5 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-secondary p-5 text-sm">
          <p className="font-medium">What campaigners can do now</p>
          <p className="mt-2 text-muted-foreground">Use Reviews and Outbox to prepare a locally queued item, then stop before any real outreach.</p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("reviews", "Open approval gate")}
          {goButton("outbox", "Inspect local queue")}
        </div>
      </Panel>
    </div>
  );

  const viewContent: Record<ViewId, React.ReactNode> = {
    overview: renderOverview(),
    actions: renderActionPlanView(),
    brief: renderCampaignContextView(sourceContext.brief),
    objectives: renderCampaignContextView(sourceContext.objectives),
    power: renderPowerMapView(),
    strategy: renderCampaignContextView(sourceContext.strategy),
    evidence: renderCampaignContextView(sourceContext.evidence),
    audiences: renderAudienceView(),
    contacts: renderContacts(),
    drafts: renderDraftsView(),
    reviews: renderReviewView(),
    outbox: renderOutboxView(),
    responses: renderResponses(),
  };

  if (sourceState.status !== "fixture" && sourceState.status !== "ready") {
    return <SourceStateShell state={sourceState} />;
  }

  return (
    <div className="min-h-screen bg-ops-paper text-foreground">
      <header className="sticky top-0 z-40 border-b border-ops-line bg-ops-paper/96 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">
              Campaign Factory
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="rounded-full bg-ops-ink px-3 py-1 text-sm font-medium text-white">Campaign Operations</span>
            <span className="rounded-full bg-ops-yellow px-3 py-1 text-xs font-semibold uppercase tracking-[0.09em] text-ops-ink">{source ? "Real campaign source" : "Demo workspace"}</span>
            <span className="rounded-full border border-ops-line bg-background/70 px-3 py-1 text-xs text-muted-foreground">{source ? "Read-only public data" : "Local fixture state"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{source ? `${source.title}${source.place ? ` · ${source.place}` : ""}` : "St John the Baptist school street · Leicester"}</span>
            {source ? (
              <span className="rounded-full bg-ops-blue px-3 py-1 text-xs text-ops-ink">
                {sourceStatusPhrase(source)} · {source.readyCount}/{source.documents.length} docs ready
              </span>
            ) : null}
            <span className="rounded-full bg-ops-mint px-3 py-1 text-xs text-ops-ink">
              {hydrated ? "Saved in this browser" : "Loading local state"}
            </span>
            <Link href={source?.sourceHref ?? "/factory"} className="rounded-full border border-ops-line bg-background/70 px-3 py-1.5 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {source ? "Back to source brief" : "Back to Factory"}
            </Link>
            <Link href="/operations" className="rounded-full border border-ops-line bg-background/70 px-3 py-1.5 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Portfolio
            </Link>
            {source ? (
              <div className="flex flex-wrap items-center gap-1" aria-label="Campaign switcher">
                {switcherItems.map((item) => {
                  const active = item.campaign.id === source.campaignId;
                  const label = active
                    ? `Current: ${compactCampaignLabel(source.title)}`
                    : item.status === "ready"
                      ? compactCampaignLabel(item.source.title)
                      : item.status === "loading"
                        ? "Loading campaign"
                        : "Source issue";
                  const title = item.status === "ready" ? `${item.source.title}${item.source.place ? ` · ${item.source.place}` : ""}` : item.status === "error" ? item.message : "Loading public campaign name";
                  return (
                    <Link
                      key={item.campaign.id}
                      href={`/operations?campaignId=${item.campaign.id}&view=${state.activeView}`}
                      className={`rounded-full px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "bg-ops-ink text-white" : "border border-ops-line bg-background/70 text-muted-foreground hover:bg-secondary"}`}
                      aria-current={active ? "page" : undefined}
                      title={title}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-[5.25rem] max-h-[calc(100vh-6rem)] overflow-auto rounded-[var(--r-2xl)] border border-ops-ink bg-ops-ink p-3 shadow-sm">
            <div className="mb-4 rounded-[var(--r-xl)] border border-white/10 bg-white/10 p-3 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">Runway state</p>
              <p className="mt-1 text-sm font-medium">{runwayStages.find((stage) => stage.status === "current")?.label ?? (communicationStatus === "queued" ? "Local outbox" : "Human approval")}</p>
              <p className="mt-1 text-xs text-white/55">{status.label} · {selected.name}</p>
            </div>
            {renderNav(false, true)}
          </div>
        </aside>

        <details className="rounded-[var(--r-2xl)] border border-ops-line bg-background/70 p-3 lg:hidden">
          <summary className="cursor-pointer rounded-[var(--r-xl)] px-2 py-1 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Operations navigation · {navGroups.flatMap((group) => group.items).find((item) => item.id === state.activeView)?.label}
          </summary>
          <div className="mt-4">{renderNav(true)}</div>
        </details>

        <main className="min-w-0" aria-live="polite">
          {viewContent[state.activeView]}
        </main>
      </div>

      <footer className="border-t border-ops-line bg-ops-paper">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 py-3 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <p>
            {source ? `Source ${source.campaignId} read-only · Local demo storage · Provider/import/schedule write-back not connected.` : "Local demo storage · Email provider not connected · Human approval required before local queueing."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/how" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">How it works</Link>
            <Link href="/" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">New campaign</Link>
            <button type="button" onClick={reset} className="rounded-full border border-border px-3 py-1.5 hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {resetLabel}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
