"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { foldEvents } from "@/lib/factory/client/fold";
import type { RunReadModel } from "@/lib/factory/contracts/api";
import { CANONICAL_DOCUMENTS } from "@/lib/factory/contracts/documents";
import type { CompiledDocument, EvidenceAndNextChecks } from "@/lib/factory/documents";
import {
  OPERATIONS_PUBLIC_CAMPAIGNS,
  hasConsistentOperationsDocumentEvidence,
  hasSyntheticUnavailableOperationsRunHeader,
  isOperationsCompiledDocumentList,
  isOperationsEvidenceAndNextChecks,
  isOperationsRunReadModel,
  normaliseOperationsSourceInlineText,
  normaliseOperationsSourceOrigin,
  type OperationsSourcePayload,
} from "@/lib/operations/source";

const STORAGE_KEY = "cf_operations_demo_v3";
const LEGACY_STORAGE_KEYS = ["cf_operations_demo_v2", "cf_operations_demo_v1"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PORTFOLIO_CAMPAIGNS: PortfolioCampaign[] = [...OPERATIONS_PUBLIC_CAMPAIGNS];
const CURATED_CAMPAIGN_TEXT_GUARDS: Record<string, RegExp[]> = {
  "69f257b6-9913-4395-94f7-5c25b4b5fe95": [
    /\bKeep KFC Out of Ormskirk\b/i,
    /\bKFC (?:being built|appeal|out) in Ormskirk\b/i,
    /\b(?:Ormskirk\b.{0,80}\bKFC|KFC\b.{0,80}\bOrmskirk)\b/i,
    /\bOrmskirk, Lancashire\b/i,
    /\bOrmskirk\b/i,
  ],
  "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": [
    /\bBuild 5,000 affordable (?:homes|houses) in Tower Hamlets\b/i,
    /\b5,000 affordable (?:homes|houses)\b/i,
    /\bTower Hamlets (?:affordable housing|housing targets?|café outreach)\b/i,
    /\bTower Hamlets, London\b/i,
    /\bTower Hamlets\b/i,
  ],
  "6b54225d-afa3-41d1-b053-89741094f153": [
    /\bStop the leisure park redevelopment in Barnet\b/i,
    /\bleisure park redevelopment\b/i,
    /\bBarnet (?:Council committee|decision records?|GLA|leisure park)\b/i,
    /\bBarnet, London\b/i,
    /\bBarnet\b/i,
  ],
};
const CURATED_CAMPAIGN_TITLE_SLUG_PREFIXES: Record<string, string[]> = {
  "69f257b6-9913-4395-94f7-5c25b4b5fe95": ["ormskirk", "keep-kfc-out-of-ormskirk"],
  "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": ["tower-hamlets", "build-5-000-affordable-houses-in-tower-hamlets-in-the-next-3-years"],
  "6b54225d-afa3-41d1-b053-89741094f153": ["barnet", "stop-the-leisure-park-redevelopment-in-barnet"],
};
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

const RETRY_AFTER_HTTP_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function sanitizeSourceRetryAfter(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,5}$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds >= 1 && seconds <= 86_400 ? String(seconds) : undefined;
  }
  if (trimmed.length <= 64 && RETRY_AFTER_HTTP_DATE_RE.test(trimmed) && Number.isFinite(Date.parse(trimmed))) return trimmed;
  return undefined;
}

function sanitizeSourceHttpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function sanitizeSourceRequestId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_.-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

function retryAfterMessage(retryAfter?: string) {
  if (!retryAfter) return null;
  if (/^\d+$/.test(retryAfter)) return `Source retry guidance: try again after ${retryAfter} second${retryAfter === "1" ? "" : "s"}.`;
  return `Source retry guidance: try again after ${retryAfter}.`;
}

const SOURCE_HTTP_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function sanitizeSourceBodyEmpty(value: unknown) {
  return value === true ? true : undefined;
}

function sanitizeSourceBodyTruncated(value: unknown) {
  return value === true ? true : undefined;
}

function sanitizeSourceContentType(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(trimmed) && trimmed.length <= 80 ? trimmed : undefined;
}

function sanitizeSourceContentTypeMissing(value: unknown) {
  return value === true ? true : undefined;
}

function sanitizeSourceMatchedPath(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\/[A-Za-z0-9/_.\[\]-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourcePath(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\/api\/factory\/runs\/[0-9a-f-]{36}(\/documents)?$/i.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourceCacheStatus(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourceCacheControl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9_,= -]{1,120}$/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : undefined;
}

function sanitizeSourceAgeSeconds(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999 ? value : undefined;
}

function sanitizeSourceResponseDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= 64 && SOURCE_HTTP_DATE_RE.test(trimmed) && Number.isFinite(Date.parse(trimmed)) ? trimmed : undefined;
}

function sanitizeSourceContentLength(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999 ? value : undefined;
}

function sanitizeSourceContentLengthMalformed(value: unknown) {
  return value === true ? true : undefined;
}

function sanitizeSourceServer(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9 ._-]{1,80}$/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : undefined;
}

function sanitizeSourceContentEncoding(value: unknown) {
  if (typeof value !== "string") return undefined;
  const tokens = value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => /^[a-z0-9!#$&^_.+-]{1,40}$/.test(token)) ? tokens.join(", ") : undefined;
}

function sanitizeSourceContentCharset(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourceContentRange(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (trimmed === "malformed") return trimmed;
  return /^bytes (?:\d{1,9}-\d{1,9}|\*)\/(?:\d{1,9}|\*)$/.test(trimmed) && trimmed.length <= 80 ? trimmed : undefined;
}

function sanitizeSourceTextEncoding(value: unknown) {
  return value === "malformed" ? value : undefined;
}

function sanitizeSourceElapsedMs(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 15_000 ? value : undefined;
}

function sourceFailureKindLabel(kind?: SourceFailureKind) {
  if (kind === "configuration") return "source configuration blocked";
  if (kind === "http_error") return "source failure HTTP error";
  if (kind === "redirect") return "source failure redirect blocked";
  if (kind === "non_json") return "source failure non-JSON";
  if (kind === "encoded_body") return "source failure encoded body";
  if (kind === "malformed_json") return "source failure malformed JSON";
  if (kind === "oversized_json") return "source failure oversized JSON";
  if (kind === "contract_mismatch") return "source failure contract mismatch";
  if (kind === "not_ready") return "source status not usable yet";
  if (kind === "timeout") return "source failure timeout";
  if (kind === "network") return "source failure network";
  return null;
}

function sanitizeSourceFailureKind(value: unknown): SourceFailureKind | undefined {
  return value === "configuration" ||
    value === "http_error" ||
    value === "redirect" ||
    value === "non_json" ||
    value === "encoded_body" ||
    value === "malformed_json" ||
    value === "oversized_json" ||
    value === "contract_mismatch" ||
    value === "not_ready" ||
    value === "timeout" ||
    value === "network"
    ? value
    : undefined;
}

function upstreamDiagnosticPhrase(sourceFailureKind?: SourceFailureKind, sourceHttpStatus?: number, sourceElapsedMs?: number, sourceRequestId?: string, sourcePath?: string, sourceMatchedPath?: string, sourceCacheStatus?: string, sourceCacheControl?: string, sourceAgeSeconds?: number, sourceResponseDate?: string, sourceContentLength?: number, sourceContentLengthMalformed?: boolean, sourceContentRange?: string, sourceServer?: string, sourceContentEncoding?: string, sourceContentCharset?: string, sourceBodyEmpty?: boolean, sourceBodyTruncated?: boolean, sourceContentType?: string, sourceContentTypeMissing?: boolean, sourceTextEncoding?: "malformed") {
  const kindPart = sourceFailureKindLabel(sourceFailureKind);
  const elapsedPart = sourceElapsedMs !== undefined ? `source fetch ${sourceElapsedMs}ms` : null;
  const contentTypePart = sourceContentType ? `upstream content type ${sourceContentType}` : sourceContentTypeMissing ? "no upstream content type" : null;
  const sourcePathPart = sourcePath ? `source path ${sourcePath}` : null;
  const matchedPathPart = sourceMatchedPath ? `matched ${sourceMatchedPath}` : null;
  const cachePart = sourceCacheStatus ? `cache ${sourceCacheStatus}` : null;
  const cachePolicyPart = sourceCacheControl ? `cache policy ${sourceCacheControl}` : null;
  const agePart = sourceAgeSeconds !== undefined ? `age ${sourceAgeSeconds}s` : null;
  const responseDatePart = sourceResponseDate ? `source date ${sourceResponseDate}` : null;
  const lengthPart = sourceContentLength !== undefined ? `content length ${sourceContentLength} bytes` : sourceContentLengthMalformed ? "content length malformed" : null;
  const rangePart = sourceContentRange ? `content range ${sourceContentRange}` : null;
  const serverPart = sourceServer ? `server ${sourceServer}` : null;
  const encodingPart = sourceContentEncoding ? `content encoding ${sourceContentEncoding}` : null;
  const charsetPart = sourceContentCharset ? `content charset ${sourceContentCharset}` : null;
  const textEncodingPart = sourceTextEncoding ? `text encoding ${sourceTextEncoding}` : null;
  const parts = [kindPart, sourceHttpStatus ? `upstream HTTP ${sourceHttpStatus}` : null, elapsedPart, sourceRequestId ? `request ${sourceRequestId}` : null, sourcePathPart, matchedPathPart, cachePart, cachePolicyPart, agePart, responseDatePart, lengthPart, rangePart, serverPart, encodingPart, charsetPart, textEncodingPart, sourceBodyEmpty ? "empty upstream body" : null, sourceBodyTruncated ? "upstream body truncated" : null, contentTypePart].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

type SourceFailureStep = "run" | "documents" | "configuration";
type SourceFailureKind = "configuration" | "http_error" | "redirect" | "non_json" | "encoded_body" | "malformed_json" | "oversized_json" | "contract_mismatch" | "not_ready" | "timeout" | "network";

function sourceFailureStepLabel(step?: SourceFailureStep) {
  if (step === "run") return "run header";
  if (step === "documents") return "compiled documents";
  if (step === "configuration") return "source configuration";
  return null;
}

function sanitizeSourceFailureStep(value: unknown): SourceFailureStep | undefined {
  return value === "run" || value === "documents" || value === "configuration" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type FixtureSegmentId = "school_gates" | "ward_parents" | "local_allies";
type SourceSegmentId = "source_primary" | "source_secondary" | "source_allies";
type SegmentId = FixtureSegmentId | SourceSegmentId;
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
  sourceAcknowledgedAt: string | null;
  sourceRecheckStateVersion: number | null;
  sourceRecheckLastSequence: number | null;
  sourceRecheckDocumentSignature: string | null;
  sourceRecheckVisitedViews: ViewId[];
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
  scheduleIntent: "after_approval" | "tomorrow_morning" | "after_next_check";
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

type NavItem = { id: ViewId; label: string; badge?: string; badgeLabel?: string; badgeTone?: "default" | "source" | "checked"; note: string };
type CampaignContextRow = { label: string; detail: string; use: string; owner: string };
type RunwayStage = { label: string; view: ViewId; status: StageStatus; statusLabel: string; detail: string };
type SourceStakeholder = { group: string; name: string; power: string; position: string; caresAbout?: string; ask?: string; approach?: string };
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
  | { status: "error"; campaignId: string; title: string; message: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: SourceFailureStep; sourceFailureKind?: SourceFailureKind; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed"; checkedAt?: string }
  | { status: "unavailable"; campaignId: string; title: string; message: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: SourceFailureStep; sourceFailureKind?: SourceFailureKind; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed"; checkedAt?: string }
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
  | { campaign: PortfolioCampaign; status: "error"; title: string; message: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: SourceFailureStep; sourceFailureKind?: SourceFailureKind; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed"; checkedAt?: string; local: PortfolioLocalCounts };

type CampaignSwitcherItem =
  | { campaign: PortfolioCampaign; status: "loading" }
  | { campaign: PortfolioCampaign; status: "ready"; source: CampaignSource }
  | { campaign: PortfolioCampaign; status: "error"; message: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: SourceFailureStep; sourceFailureKind?: SourceFailureKind; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed"; checkedAt?: string };

type ContactFixture = {
  id: string;
  name: string;
  segmentId: FixtureSegmentId;
  segment: string;
  role: string;
  readiness: "Ready fixture" | "Review first" | "Blocked";
  consent: string;
  check: string;
  nextAction: string;
  owner: string;
};

const SOURCE_PRIMARY_SEGMENT_ID: SourceSegmentId = "source_primary";
const fixtureSegmentIds = ["school_gates", "ward_parents", "local_allies"] satisfies FixtureSegmentId[];
const sourceSegmentIds = [SOURCE_PRIMARY_SEGMENT_ID, "source_secondary", "source_allies"] satisfies SourceSegmentId[];

function isSegmentId(value: unknown): value is SegmentId {
  return typeof value === "string" && ([...fixtureSegmentIds, ...sourceSegmentIds] as string[]).includes(value);
}

function isSourceSegmentId(value: unknown): value is SourceSegmentId {
  return typeof value === "string" && (sourceSegmentIds as readonly string[]).includes(value);
}

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
  sourceAcknowledgedAt: null,
  sourceRecheckStateVersion: null,
  sourceRecheckLastSequence: null,
  sourceRecheckDocumentSignature: null,
  sourceRecheckVisitedViews: [],
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

const SOURCE_RECHECK_REQUIRED_VIEWS: ViewId[] = ["evidence", "strategy", "drafts"];

const sourceRecheckViewLabels: Record<ViewId, string> = {
  overview: "Overview",
  actions: "Action plan",
  brief: "Campaign brief",
  objectives: "Objective & targets",
  power: "Power map",
  strategy: "Strategy & tactics",
  evidence: "Evidence & checks",
  audiences: "Audiences",
  contacts: "Contacts",
  drafts: "Drafts",
  reviews: "Reviews & approvals",
  outbox: "Outbox & schedule",
  responses: "Responses & results",
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

const ACTIVITY_LIMIT = 7;

const workspaceSanitizedActivity: Activity = {
  id: "workspace-sanitized",
  label: "Browser-local state was sanitized for this real campaign workspace; public source data was not changed.",
};

function normaliseActivity(activity: unknown): Activity[] {
  if (!Array.isArray(activity)) return initialState.activity;
  const seenIds = new Set<string>();
  const normalised: Activity[] = [];
  for (const item of activity) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<Activity>;
    const rawId = candidate.id;
    const rawLabel = candidate.label;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
    if (
      !id ||
      !label ||
      !storedTextHasVisibleText(id) ||
      !storedTextHasVisibleText(label) ||
      storedSourceMetadataTextIsMalformed(rawId) ||
      storedSourceMetadataTextIsMalformed(rawLabel) ||
      storedSourceScopedIdIsMalformed(rawId)
    ) continue;
    const idKey = id.toLowerCase();
    if (seenIds.has(idKey)) continue;
    seenIds.add(idKey);
    normalised.push({ id, label });
  }
  return normalised.slice(0, ACTIVITY_LIMIT);
}

function withWorkspaceSanitizedActivity(activity: Activity[]) {
  return [workspaceSanitizedActivity, ...activity.filter((item) => item.id.toLowerCase() !== workspaceSanitizedActivity.id)].slice(0, ACTIVITY_LIMIT);
}

const INVALID_LOCAL_ACTION_TITLE = "Local action unavailable";
const INVALID_LOCAL_ACTION_SOURCE = "Malformed browser-local action";

function storedTextHasVisibleText(value: string) {
  return normaliseOperationsSourceInlineText(value).length > 0;
}

function storedTextIsInvisible(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && !storedTextHasVisibleText(value);
}

function storedSourceScopedIdIsMalformed(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:source:)?([0-9a-f-]{36})(?::|$)/i);
  if (!match) return false;
  const storedCampaignId = match[1] ?? "";
  return value !== trimmed || value !== value.normalize("NFC") || normaliseOperationsSourceInlineText(value) !== value || storedCampaignId !== storedCampaignId.toLowerCase();
}

function storedSourceMetadataTextIsMalformed(value: unknown) {
  if (typeof value !== "string") return false;
  return value !== value.trim() || value !== value.normalize("NFC") || normaliseOperationsSourceInlineText(value) !== value;
}

function storedCampaignIdIsMalformed(value: unknown) {
  if (typeof value !== "string") return value !== undefined;
  const canonicalCampaignId = value.trim().toLowerCase();
  return value !== canonicalCampaignId || value !== value.normalize("NFC") || normaliseOperationsSourceInlineText(value) !== value || !UUID_RE.test(canonicalCampaignId);
}

function localActionHasMalformedField(action: Record<string, unknown>) {
  return ["id", "title", "source", "owner", "timing", "provenance", "priority", "status"].some((field) => {
    const value = action[field];
    return (
      (value !== undefined && typeof value !== "string") ||
      storedTextIsInvisible(value) ||
      (typeof value === "string" && field !== "status" && field !== "priority" && storedSourceMetadataTextIsMalformed(value)) ||
      (field === "id" && storedSourceScopedIdIsMalformed(value))
    );
  }) ||
    (action.priority !== undefined && action.priority !== "High" && action.priority !== "Medium" && action.priority !== "Low") ||
    (action.status !== undefined && action.status !== "next" && action.status !== "in_progress" && action.status !== "blocked" && action.status !== "done");
}

function normaliseLocalActions(actions: unknown): LocalAction[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action): action is Record<string, unknown> => Boolean(action) && typeof action === "object")
    .map((action, index) => {
      const malformed = localActionHasMalformedField(action);
      const id = typeof action.id === "string" ? action.id.trim() : "";
      const title = typeof action.title === "string" ? action.title.trim() : "";
      const source = typeof action.source === "string" ? action.source.trim() : "";
      const owner = typeof action.owner === "string" ? action.owner.trim() : "";
      const timing = typeof action.timing === "string" ? action.timing.trim() : "";
      const provenance = typeof action.provenance === "string" ? action.provenance.trim() : "";
      return {
        id: id || `local-action-${index + 1}`,
        title: malformed || (typeof action.title === "string" && !title) ? INVALID_LOCAL_ACTION_TITLE : title || "Untitled local action",
        source: malformed || (typeof action.source === "string" && !source) ? INVALID_LOCAL_ACTION_SOURCE : source || "Local workspace",
        owner: owner || "Campaigner",
        timing: timing || "Next",
        priority: action.priority === "High" || action.priority === "Medium" || action.priority === "Low" ? action.priority : "Medium",
        status: action.status === "next" || action.status === "in_progress" || action.status === "blocked" || action.status === "done" ? action.status : "next",
        provenance: provenance || "Created in this browser-local operations workspace.",
      };
    });
}

function sourceWorkingCopyDocumentKeyMatchesSourceDocument(sourceDocumentKey: string, sourceDocument: string) {
  const key = sourceDocumentKey.trim().toLowerCase();
  const document = sourceDocument.trim().toLowerCase();
  if (key === "lobbying_pack") return document === "lobbying pack";
  if (key === "digital_pack" || key === "digital_campaign_pack") return document === "digital campaign pack";
  if (key === "media_pack") return document === "media pack";
  return false;
}

function canonicalSourceDocumentKey(value: string) {
  const key = value.trim().toLowerCase();
  return key === "digital_campaign_pack" ? "digital_pack" : key;
}

function sourceWorkingCopyIdDocumentKeyMatchesSourceKey(copyId: string, sourceDocumentKey: string) {
  const id = copyId.trim().toLowerCase();
  const sourceKey = canonicalSourceDocumentKey(sourceDocumentKey);
  const resourceMatch = id.match(/^source:[0-9a-f-]{36}:resource:([^:]+):/i);
  if (resourceMatch) return canonicalSourceDocumentKey(resourceMatch[1] ?? "") === sourceKey;
  const directMatch = id.match(/^[0-9a-f-]{36}:([^:]+):/i);
  if (directMatch) return canonicalSourceDocumentKey(directMatch[1] ?? "") === sourceKey;
  return false;
}

function sourceResourceTitleSlug(value: string) {
  return normaliseOperationsSourceInlineText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceWorkingCopyIdStoredTitleSlug(copyId: string) {
  const sourceTitleMatch = copyId.match(/^source:[0-9a-f-]{36}:resource:[^:]+:(.+)$/i);
  const directTitleMatch = copyId.match(/^[0-9a-f-]{36}:[^:]+:(.+)$/i);
  const storedTitle = sourceTitleMatch?.[1] ?? directTitleMatch?.[1] ?? "";
  return sourceResourceTitleSlug(storedTitle);
}

function slugMatchesWithAllowedCampaignPrefix(longerSlug: string, shorterSlug: string, campaignId: string) {
  if (!longerSlug || !shorterSlug || !longerSlug.endsWith(`-${shorterSlug}`)) return false;
  const prefix = longerSlug.slice(0, -(shorterSlug.length + 1));
  return (CURATED_CAMPAIGN_TITLE_SLUG_PREFIXES[campaignId] ?? []).includes(prefix);
}

function sourceWorkingCopyIdTitleMatchesSourceTitle(copyId: string, title: string) {
  const storedTitleSlug = sourceWorkingCopyIdStoredTitleSlug(copyId);
  const visibleTitleSlug = sourceResourceTitleSlug(title);
  return Boolean(
    storedTitleSlug &&
      visibleTitleSlug &&
      (storedTitleSlug === visibleTitleSlug || visibleTitleSlug.endsWith(`-${storedTitleSlug}`) || storedTitleSlug.endsWith(`-${visibleTitleSlug}`)),
  );
}

function sourceWorkingCopyIdTitleMatchesWorkspaceTitle(copyId: string, title: string, campaignId: string) {
  const storedTitleSlug = sourceWorkingCopyIdStoredTitleSlug(copyId);
  const visibleTitleSlug = sourceResourceTitleSlug(title);
  const campaignIdentitySlugs = CURATED_CAMPAIGN_TITLE_SLUG_PREFIXES[campaignId] ?? [];
  if (campaignIdentitySlugs.includes(storedTitleSlug) || campaignIdentitySlugs.includes(visibleTitleSlug)) return false;
  return Boolean(
    storedTitleSlug &&
      visibleTitleSlug &&
      (storedTitleSlug === visibleTitleSlug || slugMatchesWithAllowedCampaignPrefix(visibleTitleSlug, storedTitleSlug, campaignId) || slugMatchesWithAllowedCampaignPrefix(storedTitleSlug, visibleTitleSlug, campaignId)),
  );
}

function sourceWorkingCopyHasMalformedOptionalField(copy: Partial<SourceWorkingCopy>) {
  const createdAt = copy.createdAt;
  const title = typeof copy.title === "string" ? copy.title.trim() : "";
  const sourceDocument = typeof copy.sourceDocument === "string" ? copy.sourceDocument.trim() : "";
  const sourceDocumentKey = typeof copy.sourceDocumentKey === "string" ? copy.sourceDocumentKey.trim() : "";
  return storedCampaignIdIsMalformed(copy.campaignId) || ["channel", "sourceDocumentKey", "provenance"].some((field) => {
    const value = copy[field as keyof SourceWorkingCopy];
    return (value !== undefined && (typeof value !== "string" || !storedTextHasVisibleText(value) || storedSourceMetadataTextIsMalformed(value)));
  }) ||
    storedSourceMetadataTextIsMalformed(copy.title) ||
    storedSourceMetadataTextIsMalformed(copy.sourceDocument) ||
    !sourceDocumentKey ||
    storedTextIsInvisible(copy.id) ||
    storedSourceScopedIdIsMalformed(copy.id) ||
    storedTextIsInvisible(copy.title) ||
    storedTextIsInvisible(copy.sourceDocument) ||
    !storedTextHasVisibleText(sourceDocumentKey) ||
    !storedTextHasVisibleText(sourceDocument) ||
    sourceDocumentKey !== canonicalSourceDocumentKey(sourceDocumentKey) ||
    !sourceWorkingCopyDocumentKeyMatchesSourceDocument(sourceDocumentKey, sourceDocument) ||
    (typeof copy.id === "string" && !sourceWorkingCopyIdDocumentKeyMatchesSourceKey(copy.id, sourceDocumentKey)) ||
    (typeof copy.id === "string" && !sourceWorkingCopyIdTitleMatchesSourceTitle(copy.id, title)) ||
    typeof createdAt !== "string" ||
    !isCurrentOrPastStoredTimestamp(createdAt) ||
    (copy.warnings !== undefined && (!Array.isArray(copy.warnings) || copy.warnings.some((warning) => typeof warning !== "string" || !storedTextHasVisibleText(warning) || storedSourceMetadataTextIsMalformed(warning))));
}

function normaliseSourceWorkingCopy(value: unknown): SourceWorkingCopy | null {
  if (!value || typeof value !== "object") return null;
  const copy = value as Partial<SourceWorkingCopy>;
  const campaignId = normaliseStoredCampaignId(copy.campaignId);
  const id = typeof copy.id === "string" ? copy.id.trim() : "";
  const title = typeof copy.title === "string" ? copy.title.trim() : "";
  const channel = typeof copy.channel === "string" ? copy.channel.trim() : "";
  const sourceDocument = typeof copy.sourceDocument === "string" ? copy.sourceDocument.trim() : "";
  const sourceDocumentKey = typeof copy.sourceDocumentKey === "string" ? copy.sourceDocumentKey.trim() : "";
  const provenance = typeof copy.provenance === "string" ? copy.provenance.trim() : "";
  if (
    !id ||
    !title ||
    !sourceDocument ||
    !campaignId ||
    !storedTextHasVisibleText(id) ||
    !storedTextHasVisibleText(title) ||
    !storedTextHasVisibleText(sourceDocument) ||
    sourceWorkingCopyHasMalformedOptionalField(copy)
  ) {
    return null;
  }
  return {
    id,
    campaignId,
    title,
    channel: channel || "Source draft",
    sourceDocument,
    sourceDocumentKey: sourceDocumentKey || "source_document",
    createdAt: normaliseStoredTimestamp(copy.createdAt) ?? new Date().toISOString(),
    warnings: Array.isArray(copy.warnings) ? copy.warnings.map((warning) => warning.trim()).filter(Boolean) : [],
    provenance: provenance || "Copied from a read-only Campaign Factory source document into this browser-local workspace.",
  };
}

function referencedCampaignIds(value: string) {
  return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
}

function textReferencesOnlyExpectedCampaign(value: string, expectedWorkspaceKey: string) {
  const expectedKey = expectedWorkspaceKey.toLowerCase();
  const uuidMatchesExpected = referencedCampaignIds(value).every((campaignId) => campaignId.toLowerCase() === expectedKey);
  if (!uuidMatchesExpected) return false;
  return Object.entries(CURATED_CAMPAIGN_TEXT_GUARDS).every(([campaignId, guards]) => {
    if (campaignId === expectedKey) return true;
    return guards.every((guard) => !guard.test(value));
  });
}

function textFieldsReferenceOnlyExpectedCampaign(values: string[], expectedWorkspaceKey: string) {
  return values.every((value) => textReferencesOnlyExpectedCampaign(value, expectedWorkspaceKey));
}

function sourceBaselineSignatureMatchesWorkspace(value: string, expectedWorkspaceKey: string) {
  if (!storedTextHasVisibleText(value) || storedSourceMetadataTextIsMalformed(value)) return false;
  const expectedKey = expectedWorkspaceKey.toLowerCase();
  const match = value.match(/^source:([0-9a-f-]{36})(?::|$)/i);
  return Boolean(match && match[1] === expectedKey && textReferencesOnlyExpectedCampaign(value, expectedKey));
}

function sourceScopedLocalIdMatchesWorkspace(value: string, expectedWorkspaceKey: string) {
  const expectedKey = expectedWorkspaceKey.toLowerCase();
  const match = value.match(/^(?:source:)?([0-9a-f-]{36})(?::|$)/i);
  return Boolean(match && match[1]?.toLowerCase() === expectedKey && textReferencesOnlyExpectedCampaign(value, expectedKey));
}

function localActionMatchesWorkspace(action: LocalAction, expectedWorkspaceKey: string) {
  const expectedCampaignId = expectedWorkspaceKey.toLowerCase();
  const idCampaignId = action.id.match(/^source:([0-9a-f-]{36})(?::|$)/i)?.[1]?.toLowerCase();
  if (idCampaignId && idCampaignId !== expectedCampaignId) return false;
  if (!textFieldsReferenceOnlyExpectedCampaign([action.id, action.title, action.source, action.owner, action.timing, action.provenance], expectedCampaignId)) return false;
  if (!localActionSourceMatchesStoredSourceId(action)) return false;
  const provenanceCampaignId = action.provenance.match(/Source campaign\s+([0-9a-f-]{36})/i)?.[1]?.toLowerCase();
  if (provenanceCampaignId && provenanceCampaignId !== expectedCampaignId) return false;
  return Boolean(idCampaignId === expectedCampaignId && provenanceCampaignId === expectedCampaignId);
}

const CANONICAL_SOURCE_ACTION_DOCUMENTS_BY_KEY = new Map<string, string>(CANONICAL_DOCUMENTS.map((document) => [document.key, document.name]));

function localActionIncompleteDocumentMatchesStoredSourceId(actionId: string, title: string, source: string, provenance: string) {
  const match = actionId.match(/^source:[0-9a-f-]{36}:incomplete:([a-z0-9_]+)$/i);
  if (!match) return false;
  const documentKey = match[1] ?? "";
  const documentName = CANONICAL_SOURCE_ACTION_DOCUMENTS_BY_KEY.get(documentKey);
  if (!documentName || documentKey !== canonicalSourceDocumentKey(documentKey)) return false;
  const canonicalDocumentName = normaliseOperationsSourceInlineText(documentName).toLowerCase();
  return (
    title.includes("incomplete") &&
    source.includes("incomplete") &&
    (provenance.includes("remains") || provenance.includes("incomplete")) &&
    title.includes(canonicalDocumentName) &&
    source.includes(canonicalDocumentName) &&
    provenance.includes(canonicalDocumentName)
  );
}

function localActionTacticMatchesStoredSourceId(actionId: string, title: string, source: string, provenance: string) {
  const match = actionId.match(/^source:[0-9a-f-]{36}:tactic:(\d+)-([a-z0-9-]{1,48})$/);
  if (!match) return false;
  const tacticNumber = Number(match[1]);
  if (!Number.isInteger(tacticNumber) || tacticNumber < 1 || tacticNumber > 6) return false;
  const storedTitleSlug = match[2] ?? "";
  const canonicalTitleSlug = sourceResourceTitleSlug(title).slice(0, 48);
  return Boolean(storedTitleSlug && canonicalTitleSlug && storedTitleSlug === canonicalTitleSlug && source.includes("tactics and timeline") && provenance.includes("tactic target"));
}

function localActionSourceMatchesStoredSourceId(action: LocalAction) {
  const source = normaliseOperationsSourceInlineText(action.source).toLowerCase();
  const title = normaliseOperationsSourceInlineText(action.title).toLowerCase();
  const provenance = normaliseOperationsSourceInlineText(action.provenance).toLowerCase();
  const describesNextCheck = source.includes("evidence & checks") && provenance.includes("next check");

  if (/^source:[0-9a-f-]{36}:primary-source-check$/i.test(action.id) || /^source:[0-9a-f-]{36}:next-check:/i.test(action.id)) {
    return describesNextCheck;
  }
  if (/^source:[0-9a-f-]{36}:incomplete:/i.test(action.id)) {
    return localActionIncompleteDocumentMatchesStoredSourceId(action.id, title, source, provenance);
  }
  if (/^source:[0-9a-f-]{36}:tactic:/i.test(action.id)) {
    return localActionTacticMatchesStoredSourceId(action.id, title, source, provenance);
  }
  return false;
}

function sourceWorkingCopyMatchesWorkspace(copy: SourceWorkingCopy, expectedWorkspaceKey: string) {
  const expectedCampaignId = expectedWorkspaceKey.toLowerCase();
  if (copy.campaignId !== expectedCampaignId) return false;
  if (!sourceScopedLocalIdMatchesWorkspace(copy.id, expectedCampaignId)) return false;
  if (!sourceWorkingCopyIdTitleMatchesWorkspaceTitle(copy.id, copy.title, expectedCampaignId)) return false;
  if (!referencedCampaignIds(copy.provenance).some((campaignId) => campaignId.toLowerCase() === expectedCampaignId)) return false;
  if (!textFieldsReferenceOnlyExpectedCampaign([copy.id, copy.title, copy.channel, copy.sourceDocument, copy.sourceDocumentKey, copy.provenance, ...copy.warnings], expectedCampaignId)) return false;
  const provenanceCampaignId = copy.provenance.match(/Source campaign\s+([0-9a-f-]{36})/i)?.[1]?.toLowerCase();
  if (provenanceCampaignId && provenanceCampaignId !== expectedCampaignId) return false;
  return provenanceCampaignId === expectedCampaignId;
}

function workingDraftMatchesWorkspace(draft: WorkingDraft, expectedWorkspaceKey: string) {
  const expectedCampaignId = expectedWorkspaceKey.toLowerCase();
  if (draft.id !== draft.sourceWorkingCopy.id || !sourceScopedLocalIdMatchesWorkspace(draft.id, expectedCampaignId)) return false;
  if (normaliseOperationsSourceInlineText(draft.title) !== normaliseOperationsSourceInlineText(draft.sourceWorkingCopy.title)) return false;
  if (normaliseOperationsSourceInlineText(draft.channel) !== normaliseOperationsSourceInlineText(draft.sourceWorkingCopy.channel)) return false;
  if (!textFieldsReferenceOnlyExpectedCampaign([draft.id, draft.title, draft.channel, draft.subject, draft.body, draft.reviewerNote], expectedCampaignId)) return false;
  return sourceWorkingCopyMatchesWorkspace(draft.sourceWorkingCopy, expectedCampaignId);
}

function stableTextCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableLowercase(value: string) {
  return value.toLowerCase();
}

function uniqueByStoredId<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = stableLowercase(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STORED_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidStoredTimestamp(value: string) {
  if (!STORED_TIMESTAMP_RE.test(value)) return false;
  return new Date(value).toISOString() === value;
}

function isCurrentOrPastStoredTimestamp(value: string) {
  return isValidStoredTimestamp(value) && new Date(value).getTime() <= Date.now();
}

function hasRecordedLocalQueue(status: DraftStatus, queuedAt: string | null) {
  return status === "queued" && Boolean(queuedAt && isCurrentOrPastStoredTimestamp(queuedAt));
}

function normaliseQueuedStatus(status: unknown, queuedAt: string | null): DraftStatus {
  if (status === "draft" || status === "review" || status === "approved") return status;
  if (status === "queued") return queuedAt ? "queued" : "approved";
  return "draft";
}

function normaliseStoredTimestamp(value: unknown) {
  return typeof value === "string" && value && isCurrentOrPastStoredTimestamp(value) ? value : null;
}

function normaliseStoredAcknowledgedTimestamp(value: unknown) {
  const timestamp = normaliseStoredTimestamp(value);
  if (!timestamp) return null;
  return new Date(timestamp).getTime() <= Date.now() ? timestamp : null;
}

function normaliseStoredCampaignId(value: unknown) {
  if (typeof value !== "string") return null;
  const campaignId = value.trim().toLowerCase();
  return UUID_RE.test(campaignId) ? campaignId : null;
}

function legacyTopLevelDraftHasMalformedField(state: Partial<DemoState>) {
  return ["subject", "body", "reviewerNote", "status"].some((field) => {
    const value = state[field as keyof DemoState];
    return (value !== undefined && typeof value !== "string") || storedTextIsInvisible(value);
  }) ||
    (state.queuedAt !== undefined && state.queuedAt !== null && typeof state.queuedAt !== "string") ||
    (typeof state.queuedAt === "string" && !isCurrentOrPastStoredTimestamp(state.queuedAt));
}

function normaliseWorkingDrafts(value: unknown, legacyState: Partial<DemoState>): WorkingDraft[] {
  const drafts = Array.isArray(value) ? value : [];
  const normalised = drafts
    .filter((draft): draft is Partial<WorkingDraft> => Boolean(draft) && typeof draft === "object")
    .map((draft) => {
      const sourceWorkingCopy = normaliseSourceWorkingCopy(draft.sourceWorkingCopy);
      const id = typeof draft.id === "string" ? draft.id.trim() : "";
      const title = typeof draft.title === "string" ? draft.title.trim() : "";
      const channel = typeof draft.channel === "string" ? draft.channel.trim() : "";
      const subject = typeof draft.subject === "string" ? draft.subject.trim() : "";
      const body = typeof draft.body === "string" ? draft.body.trim() : "";
      const reviewerNote = typeof draft.reviewerNote === "string" ? draft.reviewerNote.trim() : "";
      if (!sourceWorkingCopy || !id || !title || !storedTextHasVisibleText(id) || !storedTextHasVisibleText(title)) return null;
      const malformed = workingDraftHasMalformedField(draft);
      const createdAt = normaliseStoredTimestamp(draft.createdAt) ?? sourceWorkingCopy.createdAt;
      const parsedQueuedAt = malformed ? null : normaliseStoredTimestamp(draft.queuedAt);
      const status = malformed ? "draft" : normaliseQueuedStatus(draft.status, parsedQueuedAt);
      return {
        id,
        title: malformed ? INVALID_LOCAL_DRAFT_SUBJECT : title,
        channel: malformed ? "Malformed browser-local draft" : channel || sourceWorkingCopy.channel || "Source draft",
        subject: malformed ? INVALID_LOCAL_DRAFT_SUBJECT : subject || title,
        body: malformed ? INVALID_LOCAL_DRAFT_BODY : body,
        reviewerNote: malformed ? "" : reviewerNote,
        status,
        queuedAt: status === "queued" ? parsedQueuedAt : null,
        createdAt,
        updatedAt: normaliseStoredTimestamp(draft.updatedAt) ?? createdAt,
        sourceWorkingCopy,
      } satisfies WorkingDraft;
    })
    .filter((draft): draft is WorkingDraft => Boolean(draft));

  const legacyCopy = legacyTopLevelDraftHasMalformedField(legacyState) ? null : normaliseSourceWorkingCopy(legacyState.sourceWorkingCopy);
  if (legacyCopy && !normalised.some((draft) => stableLowercase(draft.id) === stableLowercase(legacyCopy.id))) {
    const parsedQueuedAt = normaliseStoredTimestamp(legacyState.queuedAt);
    const status = normaliseQueuedStatus(legacyState.status, parsedQueuedAt);
    const legacyQueuePrecedesSourceCopy = Boolean(status === "queued" && parsedQueuedAt && storedTimestampIsBefore(parsedQueuedAt, legacyCopy.createdAt));
    const restoredStatus = legacyQueuePrecedesSourceCopy ? "approved" : status;
    const legacySubject = typeof legacyState.subject === "string" ? legacyState.subject.trim() : "";
    const legacyBody = typeof legacyState.body === "string" ? legacyState.body.trim() : "";
    const legacyReviewerNote = typeof legacyState.reviewerNote === "string" ? legacyState.reviewerNote.trim() : "";
    normalised.unshift({
      id: legacyCopy.id,
      title: legacyCopy.title,
      channel: legacyCopy.channel,
      subject: legacySubject || legacyCopy.title,
      body: legacyBody,
      reviewerNote: legacyReviewerNote,
      status: restoredStatus,
      queuedAt: restoredStatus === "queued" ? parsedQueuedAt : null,
      createdAt: legacyCopy.createdAt,
      updatedAt: legacyCopy.createdAt,
      sourceWorkingCopy: legacyCopy,
    });
  }

  return normalised;
}

const INVALID_LOCAL_DRAFT_SUBJECT = "Local draft unavailable";
const INVALID_LOCAL_DRAFT_BODY = "This browser-local draft could not be restored because its saved subject or body was malformed.";

function storedTimestampIsBefore(left: string, right: string) {
  return new Date(left).getTime() < new Date(right).getTime();
}

function workingDraftHasMalformedField(draft: Partial<WorkingDraft>) {
  return ["title", "channel", "subject", "body", "reviewerNote", "status", "createdAt", "updatedAt"].some((field) => {
    const value = draft[field as keyof WorkingDraft];
    return (value !== undefined && typeof value !== "string") || storedTextIsInvisible(value);
  }) ||
    storedSourceMetadataTextIsMalformed(draft.title) ||
    storedSourceMetadataTextIsMalformed(draft.channel) ||
    storedSourceScopedIdIsMalformed(draft.id) ||
    typeof draft.createdAt !== "string" ||
    !isCurrentOrPastStoredTimestamp(draft.createdAt) ||
    typeof draft.updatedAt !== "string" ||
    !isCurrentOrPastStoredTimestamp(draft.updatedAt) ||
    storedTimestampIsBefore(draft.updatedAt, draft.createdAt) ||
    (typeof draft.queuedAt === "string" && !isCurrentOrPastStoredTimestamp(draft.queuedAt)) ||
    (typeof draft.queuedAt === "string" && storedTimestampIsBefore(draft.queuedAt, draft.createdAt)) ||
    (typeof draft.queuedAt === "string" && storedTimestampIsBefore(draft.queuedAt, draft.updatedAt)) ||
    (draft.queuedAt !== undefined && draft.queuedAt !== null && typeof draft.queuedAt !== "string");
}

function normaliseOptionalSourceSequence(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normaliseState(parsed: Partial<DemoState>): DemoState {
  const malformedLegacyTopLevelDraft = legacyTopLevelDraftHasMalformedField(parsed);
  const workingDrafts = normaliseWorkingDrafts(parsed.workingDrafts, parsed);
  const parsedQueuedAt = normaliseStoredTimestamp(parsed.queuedAt);
  const status = normaliseQueuedStatus(parsed.status, parsedQueuedAt);
  const sourceWorkingCopy = malformedLegacyTopLevelDraft ? null : normaliseSourceWorkingCopy(parsed.sourceWorkingCopy);
  const topLevelQueuePrecedesSourceCopy = Boolean(sourceWorkingCopy && status === "queued" && parsedQueuedAt && storedTimestampIsBefore(parsedQueuedAt, sourceWorkingCopy.createdAt));
  const restoredStatus = topLevelQueuePrecedesSourceCopy ? "approved" : status;
  const queuedAt = restoredStatus === "queued" ? parsedQueuedAt : null;
  const staleQueueTimestamp = Boolean(parsedQueuedAt && status !== "queued");
  const activeWorkingDraftId = workingDrafts.some((draft) => draft.id === parsed.activeWorkingDraftId)
    ? parsed.activeWorkingDraftId ?? null
    : parsed.sourceWorkingCopy && workingDrafts[0]
      ? workingDrafts[0].id
      : null;
  const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  const visibleSubject = subject && storedTextHasVisibleText(subject) ? subject : "";
  const visibleBody = body && storedTextHasVisibleText(body) ? body : "";
  const malformedWorkspaceKey = storedCampaignIdIsMalformed(parsed.workspaceKey);
  const parsedSourceRecheckVisitedViews = Array.isArray(parsed.sourceRecheckVisitedViews) ? parsed.sourceRecheckVisitedViews : [];
  const parsedRequiredSourceRecheckViews = parsedSourceRecheckVisitedViews.filter((view): view is ViewId => SOURCE_RECHECK_REQUIRED_VIEWS.includes(view as ViewId));
  const parsedRequiredSourceRecheckViewSet = new Set(parsedRequiredSourceRecheckViews);
  const sourceRecheckVisitedViews = SOURCE_RECHECK_REQUIRED_VIEWS.filter((view) => parsedRequiredSourceRecheckViewSet.has(view));
  const scrubbedSourceRecheckVisitedViews =
    parsedSourceRecheckVisitedViews.length !== sourceRecheckVisitedViews.length ||
    parsedSourceRecheckVisitedViews.some((view) => !SOURCE_RECHECK_REQUIRED_VIEWS.includes(view as ViewId)) ||
    parsedRequiredSourceRecheckViews.some((view, index) => sourceRecheckVisitedViews[index] !== view);
  const normalizedActivity = staleQueueTimestamp || topLevelQueuePrecedesSourceCopy ? normaliseActivity(parsed.activity).filter((item) => !activityLooksLikeQueueWorkflow(item)) : normaliseActivity(parsed.activity);
  return {
    ...initialState,
    ...parsed,
    selectedSegment: isSegmentId(parsed.selectedSegment) ? parsed.selectedSegment : initialState.selectedSegment,
    subject: visibleSubject || INVALID_LOCAL_DRAFT_SUBJECT,
    body: visibleBody || INVALID_LOCAL_DRAFT_BODY,
    status: restoredStatus,
    activeDraft: draftLibrary.some((draft) => draft.id === parsed.activeDraft)
      ? (parsed.activeDraft as DraftId)
      : initialState.activeDraft,
    workspaceKey: normaliseStoredCampaignId(parsed.workspaceKey) ?? (typeof parsed.workspaceKey === "string" ? parsed.workspaceKey : initialState.workspaceKey),
    sourceStateVersion: normaliseOptionalSourceSequence(parsed.sourceStateVersion),
    sourceLastSequence: normaliseOptionalSourceSequence(parsed.sourceLastSequence),
    sourceDocumentSignature: typeof parsed.sourceDocumentSignature === "string" ? parsed.sourceDocumentSignature : null,
    sourceAcknowledgedAt: normaliseStoredAcknowledgedTimestamp(parsed.sourceAcknowledgedAt),
    sourceRecheckStateVersion: normaliseOptionalSourceSequence(parsed.sourceRecheckStateVersion),
    sourceRecheckLastSequence: normaliseOptionalSourceSequence(parsed.sourceRecheckLastSequence),
    sourceRecheckDocumentSignature: typeof parsed.sourceRecheckDocumentSignature === "string" ? parsed.sourceRecheckDocumentSignature : null,
    sourceRecheckVisitedViews,
    reviewerNote: typeof parsed.reviewerNote === "string" && storedTextHasVisibleText(parsed.reviewerNote) ? parsed.reviewerNote.trim() : "",
    activeView: viewIds.includes(parsed.activeView as ViewId) ? (parsed.activeView as ViewId) : "overview",
    contactFilter: parsed.contactFilter === "all" || isSegmentId(parsed.contactFilter) ? parsed.contactFilter : initialState.contactFilter,
    contactReadinessFilter: ["all", "ready", "review", "blocked"].includes(parsed.contactReadinessFilter || "")
      ? (parsed.contactReadinessFilter as DemoState["contactReadinessFilter"])
      : initialState.contactReadinessFilter,
    scheduleIntent: staleQueueTimestamp
      ? initialState.scheduleIntent
      : (parsed as { scheduleIntent?: unknown }).scheduleIntent === "school_run"
        ? "after_next_check"
        : ["after_approval", "tomorrow_morning", "after_next_check"].includes(parsed.scheduleIntent || "")
          ? (parsed.scheduleIntent as DemoState["scheduleIntent"])
          : initialState.scheduleIntent,
    queuedAt,
    localActions: normaliseLocalActions(parsed.localActions),
    workingDrafts,
    activeWorkingDraftId,
    sourceWorkingCopy,
    activity: scrubbedSourceRecheckVisitedViews || malformedWorkspaceKey ? withWorkspaceSanitizedActivity(normalizedActivity) : normalizedActivity,
    mode: parsed.mode === "preview" ? "preview" : "compose",
  };
}

const FIXTURE_LEAKAGE_RE = /St John the Baptist|school[\s_-]?street|school[\s_-]?run|school[\s_-]?gates?|Leicester City Council|Clean Air Leicester|Ward casework watcher|\bA\. Patel\b|\bR\. Johnson\b|\bM\. Davies\b|\bS\. Hussain\b|Campaign Factory demo workspace|seeded campaign brief|(?:local\s+)?fixture contacts|fixture evidence check|fixture timing check|fixture media boundary|fixture campaign copy/i;
const FIXTURE_IDENTIFIER_RE = /\b(?:demo-)?fixture(?:[_:-][a-z0-9_-]+)+\b|\bfixture:[a-z0-9_-]+\b/i;

function hasFixtureLeakage(value: string) {
  return FIXTURE_LEAKAGE_RE.test(value) || FIXTURE_IDENTIFIER_RE.test(value);
}

function topLevelDraftLooksFixtureBound(state: DemoState) {
  const fixtureText = [state.subject, state.body, state.reviewerNote, ...state.activity.map((item) => item.label)].join("\n");
  return hasFixtureLeakage(fixtureText);
}

function topLevelDraftReferencesOnlyExpectedCampaign(state: DemoState, expectedWorkspaceKey: string) {
  return textFieldsReferenceOnlyExpectedCampaign([state.subject, state.body, state.reviewerNote], expectedWorkspaceKey);
}

function localActionLooksMalformed(action: LocalAction) {
  return action.title === INVALID_LOCAL_ACTION_TITLE || action.source === INVALID_LOCAL_ACTION_SOURCE;
}

function localActionLooksFixtureBound(action: LocalAction) {
  return hasFixtureLeakage([action.id, action.title, action.source, action.owner, action.timing, action.provenance].join("\n"));
}

function sourceWorkingCopyLooksFixtureBound(copy: SourceWorkingCopy) {
  return hasFixtureLeakage([copy.id, copy.title, copy.channel, copy.sourceDocument, copy.sourceDocumentKey, copy.provenance, ...copy.warnings].join("\n"));
}

function workingDraftLooksMalformed(draft: WorkingDraft) {
  return draft.title === INVALID_LOCAL_DRAFT_SUBJECT || draft.subject === INVALID_LOCAL_DRAFT_SUBJECT || draft.body === INVALID_LOCAL_DRAFT_BODY;
}

function workingDraftLooksFixtureBound(draft: WorkingDraft) {
  return hasFixtureLeakage([
    draft.id,
    draft.title,
    draft.channel,
    draft.subject,
    draft.body,
    draft.reviewerNote,
    draft.sourceWorkingCopy.id,
    draft.sourceWorkingCopy.title,
    draft.sourceWorkingCopy.channel,
    draft.sourceWorkingCopy.sourceDocument,
    draft.sourceWorkingCopy.sourceDocumentKey,
    draft.sourceWorkingCopy.provenance,
    ...draft.sourceWorkingCopy.warnings,
  ].join("\n"));
}

function activityLooksFixtureBound(activity: Activity) {
  return hasFixtureLeakage([activity.id, activity.label].join("\n"));
}

function activityReferencesOnlyExpectedCampaign(activity: Activity, expectedWorkspaceKey: string) {
  return textFieldsReferenceOnlyExpectedCampaign([activity.id, activity.label], expectedWorkspaceKey);
}

function activityLooksTiedToRemovedLocalWork(activity: Activity, removedLocalWorkReferences: string[]) {
  const label = stableLowercase(activity.label);
  const id = stableLowercase(activity.id);
  return removedLocalWorkReferences.some((removedReference) => {
    const normalized = stableLowercase(removedReference.trim());
    return normalized.length >= 8 && (label.includes(normalized) || id.includes(normalized));
  });
}

function activityLooksLikeTopLevelDraftWorkflow(activity: Activity) {
  return /\b(marked the draft ready|human approval recorded|placed approved draft|approved draft|local demo queue|queued local\b.{0,60}\b(?:draft|copy)|queued\b.{0,80}\b(?:draft|copy|locally)|submitted(?:\b.{0,80}\bdraft)?\b.{0,40}\bfor review|ready for human review)\b/i.test(
    activity.label,
  );
}

function activityLooksLikeDraftWorkflow(activity: Activity) {
  return (
    activityLooksLikeTopLevelDraftWorkflow(activity) ||
    /\b(created|selected|viewed|edited|duplicated|archived)\b.{0,80}\b(local copy|working copy|source resource|draft|communication copy)\b/i.test(activity.label)
  );
}

function activityLooksLikeQueueWorkflow(activity: Activity) {
  return /\b(placed approved draft|local demo queue|queued local\b.{0,60}\b(?:draft|copy)|queued\b.{0,80}\blocally)\b/i.test(activity.label);
}

function activityLooksLikeLocalActionWorkflow(activity: Activity) {
  return /\b(created action|added action|updated action|action status|marked action|moved action|completed action|blocked action)\b/i.test(activity.label);
}

function topLevelDraftLooksAlreadyReset(state: DemoState) {
  return state.subject === "Local source draft reset" && state.body.startsWith("This browser-local");
}

function topLevelDraftHasUnprovenancedLocalCopy(state: DemoState) {
  if (state.sourceWorkingCopy || topLevelDraftLooksAlreadyReset(state)) return false;
  return Boolean(
    state.status !== "draft" ||
      state.queuedAt ||
      state.reviewerNote ||
      state.subject !== initialState.subject ||
      state.body !== initialState.body,
  );
}

function topLevelDraftResetRetainsWorkflowState(state: DemoState) {
  if (!topLevelDraftLooksAlreadyReset(state)) return false;
  return Boolean(state.status !== "draft" || state.queuedAt || state.reviewerNote);
}

function sanitizeStateForWorkspace(state: DemoState, expectedWorkspaceKey: string): DemoState {
  if (!UUID_RE.test(expectedWorkspaceKey)) return state;
  const selectedSegment = isSourceSegmentId(state.selectedSegment) ? state.selectedSegment : SOURCE_PRIMARY_SEGMENT_ID;
  const contactFilter = state.contactFilter === "all" || isSourceSegmentId(state.contactFilter) ? state.contactFilter : "all";
  const localActions = uniqueByStoredId(
    state.localActions.filter((action) => localActionMatchesWorkspace(action, expectedWorkspaceKey) && !localActionLooksMalformed(action) && !localActionLooksFixtureBound(action)),
  );
  const workspaceWorkingDrafts = uniqueByStoredId(
    state.workingDrafts.filter((draft) => workingDraftMatchesWorkspace(draft, expectedWorkspaceKey) && !workingDraftLooksMalformed(draft) && !workingDraftLooksFixtureBound(draft)),
  );
  const demotedWorkingDraftQueueState = workspaceWorkingDrafts.some((draft) => draft.status === "queued" && !draft.queuedAt);
  const staleWorkingDraftQueueTimestamp = workspaceWorkingDrafts.some((draft) => draft.status !== "queued" && Boolean(draft.queuedAt));
  const workingDrafts = workspaceWorkingDrafts.map((draft) =>
    draft.status === "queued" && !draft.queuedAt
      ? { ...draft, status: "approved" as const, updatedAt: new Date().toISOString() }
      : draft.status !== "queued" && draft.queuedAt
        ? { ...draft, queuedAt: null, updatedAt: new Date().toISOString() }
        : draft,
  );
  const sourceWorkingCopyCandidate = state.sourceWorkingCopy && sourceWorkingCopyMatchesWorkspace(state.sourceWorkingCopy, expectedWorkspaceKey) && !sourceWorkingCopyLooksFixtureBound(state.sourceWorkingCopy) ? state.sourceWorkingCopy : null;
  const removedLocalWorkReferences = [
    ...state.localActions
      .filter((action) => !localActions.some((keptAction) => keptAction.id === action.id))
      .flatMap((action) => [action.id, action.title, action.source, action.owner, action.timing, action.provenance]),
    ...state.workingDrafts
      .filter((draft) => !workingDrafts.some((keptDraft) => keptDraft.id === draft.id))
      .flatMap((draft) => [
        draft.id,
        draft.title,
        draft.channel,
        draft.subject,
        draft.body,
        draft.reviewerNote,
        draft.sourceWorkingCopy.id,
        draft.sourceWorkingCopy.title,
        draft.sourceWorkingCopy.channel,
        draft.sourceWorkingCopy.sourceDocument,
        draft.sourceWorkingCopy.sourceDocumentKey,
        draft.sourceWorkingCopy.provenance,
        ...draft.sourceWorkingCopy.warnings,
      ]),
    ...(state.sourceWorkingCopy && !sourceWorkingCopyCandidate
      ? [
          state.sourceWorkingCopy.id,
          state.sourceWorkingCopy.title,
          state.sourceWorkingCopy.channel,
          state.sourceWorkingCopy.sourceDocument,
          state.sourceWorkingCopy.sourceDocumentKey,
          state.sourceWorkingCopy.provenance,
          ...state.sourceWorkingCopy.warnings,
        ]
      : []),
  ];
  const activeWorkingDraftId = workingDrafts.some((draft) => draft.id === state.activeWorkingDraftId)
    ? state.activeWorkingDraftId
    : workingDrafts[0]?.id ?? null;
  const removedDuplicatedTopLevelSourceCopy = Boolean(
    sourceWorkingCopyCandidate && workingDrafts.some((draft) => stableLowercase(draft.id) === stableLowercase(sourceWorkingCopyCandidate.id)),
  );
  const sourceWorkingCopy = removedDuplicatedTopLevelSourceCopy ? null : sourceWorkingCopyCandidate;
  const removedMismatchedLocalWork = localActions.length !== state.localActions.length || workingDrafts.length !== state.workingDrafts.length;
  const removedFixtureSourceWorkingCopy = Boolean(state.sourceWorkingCopy && sourceWorkingCopyLooksFixtureBound(state.sourceWorkingCopy));
  const removedMismatchedTopLevelSourceCopy = Boolean(state.sourceWorkingCopy && !sourceWorkingCopyCandidate && !removedFixtureSourceWorkingCopy);
  const removedFixtureTopLevelCopy = !topLevelDraftLooksAlreadyReset(state) && topLevelDraftLooksFixtureBound(state);
  const removedForeignTopLevelCopy = !topLevelDraftLooksAlreadyReset(state) && !topLevelDraftReferencesOnlyExpectedCampaign(state, expectedWorkspaceKey);
  const removedUnprovenancedTopLevelReviewState = !sourceWorkingCopy && topLevelDraftHasUnprovenancedLocalCopy(state);
  const removedResetTopLevelWorkflowState = !sourceWorkingCopy && topLevelDraftResetRetainsWorkflowState(state);
  const demotedTopLevelQueueState = Boolean(sourceWorkingCopy && state.status === "queued" && !hasRecordedLocalQueue(state.status, state.queuedAt));
  const staleTopLevelQueueTimestamp = Boolean(sourceWorkingCopy && state.status !== "queued" && state.queuedAt);
  const reversedTopLevelQueueTimestamp = Boolean(
    sourceWorkingCopy &&
      state.status === "queued" &&
      state.queuedAt &&
      isValidStoredTimestamp(state.queuedAt) &&
      storedTimestampIsBefore(state.queuedAt, sourceWorkingCopy.createdAt),
  );
  const removedFixtureAcknowledgedSourceBaseline = Boolean(state.sourceDocumentSignature && hasFixtureLeakage(state.sourceDocumentSignature));
  const removedFixtureSourceRecheckBaseline = Boolean(state.sourceRecheckDocumentSignature && hasFixtureLeakage(state.sourceRecheckDocumentSignature));
  const removedForeignAcknowledgedSourceBaseline = Boolean(state.sourceDocumentSignature && !textReferencesOnlyExpectedCampaign(state.sourceDocumentSignature, expectedWorkspaceKey));
  const removedForeignSourceRecheckBaseline = Boolean(state.sourceRecheckDocumentSignature && !textReferencesOnlyExpectedCampaign(state.sourceRecheckDocumentSignature, expectedWorkspaceKey));
  const removedMalformedAcknowledgedSourceBaseline = Boolean(
    state.sourceDocumentSignature && !removedFixtureAcknowledgedSourceBaseline && !removedForeignAcknowledgedSourceBaseline && !sourceBaselineSignatureMatchesWorkspace(state.sourceDocumentSignature, expectedWorkspaceKey),
  );
  const removedMalformedSourceRecheckBaseline = Boolean(
    state.sourceRecheckDocumentSignature && !removedFixtureSourceRecheckBaseline && !removedForeignSourceRecheckBaseline && !sourceBaselineSignatureMatchesWorkspace(state.sourceRecheckDocumentSignature, expectedWorkspaceKey),
  );
  const removedIncompleteAcknowledgedSourceBaseline = Boolean(
    ((state.sourceStateVersion !== null || state.sourceLastSequence !== null || state.sourceAcknowledgedAt) && !state.sourceDocumentSignature) ||
      (state.sourceDocumentSignature && (state.sourceStateVersion === null || state.sourceLastSequence === null || !state.sourceAcknowledgedAt)),
  );
  const removedIncompleteSourceRecheckBaseline = Boolean(
    ((state.sourceRecheckStateVersion !== null || state.sourceRecheckLastSequence !== null || state.sourceRecheckVisitedViews.length) && !state.sourceRecheckDocumentSignature) ||
      (state.sourceRecheckDocumentSignature && (state.sourceRecheckStateVersion === null || state.sourceRecheckLastSequence === null)),
  );
  const removedStaleSourceRecheckBaseline = Boolean(
    state.sourceRecheckDocumentSignature &&
      state.sourceStateVersion !== null &&
      state.sourceLastSequence !== null &&
      state.sourceRecheckStateVersion !== null &&
      state.sourceRecheckLastSequence !== null &&
      (state.sourceRecheckStateVersion < state.sourceStateVersion ||
        (state.sourceRecheckStateVersion === state.sourceStateVersion && state.sourceRecheckLastSequence <= state.sourceLastSequence)),
  );
  const resetTopLevelDraft =
    removedMismatchedTopLevelSourceCopy ||
    removedFixtureSourceWorkingCopy ||
    removedFixtureTopLevelCopy ||
    removedForeignTopLevelCopy ||
    removedUnprovenancedTopLevelReviewState ||
    removedResetTopLevelWorkflowState ||
    removedDuplicatedTopLevelSourceCopy;
  const activeDraft = resetTopLevelDraft
    ? initialState.activeDraft
    : activeWorkingDraftId || sourceWorkingCopy || state.status !== "draft" || state.queuedAt
      ? "supporter_email"
      : state.activeDraft;
  const hasRetainedDraftWork = Boolean(workingDrafts.length || sourceWorkingCopy || (!resetTopLevelDraft && (state.status !== "draft" || state.queuedAt)));
  const removedOrphanedDraftWorkflowActivity = !hasRetainedDraftWork && state.activity.some(activityLooksLikeDraftWorkflow);
  const removedQueuedWorkingDraft = state.workingDrafts.some((draft) => draft.status === "queued" && !workingDrafts.some((keptDraft) => keptDraft.id === draft.id));
  const hasQueuedWorkingDraft = workingDrafts.some((draft) => hasRecordedLocalQueue(draft.status, draft.queuedAt));
  const hasQueuedTopLevelSourceCopy = Boolean(sourceWorkingCopy && hasRecordedLocalQueue(state.status, state.queuedAt) && !reversedTopLevelQueueTimestamp);
  const demotedQueuedLocalWork = demotedWorkingDraftQueueState || demotedTopLevelQueueState || reversedTopLevelQueueTimestamp;
  const staleQueueTimestamp = staleWorkingDraftQueueTimestamp || staleTopLevelQueueTimestamp;
  const resetScheduleIntent = (resetTopLevelDraft || removedQueuedWorkingDraft || removedOrphanedDraftWorkflowActivity || demotedQueuedLocalWork || staleQueueTimestamp) && !hasQueuedWorkingDraft && !hasQueuedTopLevelSourceCopy;
  const resetAcknowledgedSourceBaseline =
    removedFixtureAcknowledgedSourceBaseline ||
    removedForeignAcknowledgedSourceBaseline ||
    removedMalformedAcknowledgedSourceBaseline ||
    removedIncompleteAcknowledgedSourceBaseline ||
    (resetTopLevelDraft && localActions.length === 0 && workingDrafts.length === 0 && !sourceWorkingCopy);
  const resetSourceRecheckBaseline =
    resetAcknowledgedSourceBaseline ||
    removedFixtureSourceRecheckBaseline ||
    removedForeignSourceRecheckBaseline ||
    removedMalformedSourceRecheckBaseline ||
    removedIncompleteSourceRecheckBaseline ||
    removedStaleSourceRecheckBaseline;
  const unprovenancedActiveDraft = removedUnprovenancedTopLevelReviewState && !state.sourceWorkingCopy ? draftLibrary.find((draft) => draft.id === state.activeDraft) : null;
  const topLevelDraftResetReferences = resetTopLevelDraft
    ? [
        state.subject,
        state.body,
        state.reviewerNote,
        state.status,
        state.queuedAt,
        state.sourceWorkingCopy?.id,
        state.sourceWorkingCopy?.title,
        state.sourceWorkingCopy?.sourceDocument,
        state.sourceWorkingCopy?.sourceDocumentKey,
        unprovenancedActiveDraft?.id,
        unprovenancedActiveDraft?.title,
        unprovenancedActiveDraft?.channel,
      ].filter((reference): reference is string => typeof reference === "string" && reference.length > 0)
    : [];
  const removedTopLevelDraftWorkflowActivity = resetTopLevelDraft && !hasQueuedWorkingDraft && !hasQueuedTopLevelSourceCopy;
  const activity = state.activity.filter(
    (item) =>
      !activityLooksFixtureBound(item) &&
      activityReferencesOnlyExpectedCampaign(item, expectedWorkspaceKey) &&
      !activityLooksTiedToRemovedLocalWork(item, [...removedLocalWorkReferences, ...topLevelDraftResetReferences]) &&
      !(removedTopLevelDraftWorkflowActivity && activityLooksLikeTopLevelDraftWorkflow(item)) &&
      !(removedOrphanedDraftWorkflowActivity && activityLooksLikeDraftWorkflow(item)) &&
      !((demotedQueuedLocalWork || staleQueueTimestamp) && !hasQueuedWorkingDraft && !hasQueuedTopLevelSourceCopy && activityLooksLikeQueueWorkflow(item)) &&
      !(removedMismatchedLocalWork && activityLooksLikeLocalActionWorkflow(item)),
  );
  const removedFixtureActivity = activity.length !== state.activity.length;

  if (
    localActions.length === state.localActions.length &&
    workingDrafts.length === state.workingDrafts.length &&
    activeWorkingDraftId === state.activeWorkingDraftId &&
    sourceWorkingCopy === state.sourceWorkingCopy &&
    activeDraft === state.activeDraft &&
    selectedSegment === state.selectedSegment &&
    contactFilter === state.contactFilter &&
    !removedFixtureTopLevelCopy &&
    !removedForeignTopLevelCopy &&
    !removedUnprovenancedTopLevelReviewState &&
    !removedResetTopLevelWorkflowState &&
    !removedDuplicatedTopLevelSourceCopy &&
    !demotedQueuedLocalWork &&
    !staleQueueTimestamp &&
    !removedOrphanedDraftWorkflowActivity &&
    !resetAcknowledgedSourceBaseline &&
    !resetSourceRecheckBaseline &&
    !removedFixtureActivity
  ) {
    return state;
  }

  return {
    ...state,
    selectedSegment,
    contactFilter,
    sourceStateVersion: resetAcknowledgedSourceBaseline ? null : state.sourceStateVersion,
    sourceLastSequence: resetAcknowledgedSourceBaseline ? null : state.sourceLastSequence,
    sourceDocumentSignature: resetAcknowledgedSourceBaseline ? null : state.sourceDocumentSignature,
    sourceAcknowledgedAt: resetAcknowledgedSourceBaseline ? null : state.sourceAcknowledgedAt,
    sourceRecheckStateVersion: resetSourceRecheckBaseline ? null : state.sourceRecheckStateVersion,
    sourceRecheckLastSequence: resetSourceRecheckBaseline ? null : state.sourceRecheckLastSequence,
    sourceRecheckDocumentSignature: resetSourceRecheckBaseline ? null : state.sourceRecheckDocumentSignature,
    sourceRecheckVisitedViews: resetSourceRecheckBaseline ? [] : state.sourceRecheckVisitedViews,
    activeDraft,
    subject: resetTopLevelDraft ? "Local source draft reset" : state.subject,
    body: resetTopLevelDraft
      ? removedMismatchedTopLevelSourceCopy
        ? "This browser-local draft was reset because its stored source provenance belonged to another campaign. Use a source resource from this campaign before review or local queueing."
        : removedDuplicatedTopLevelSourceCopy
          ? "This browser-local top-level draft was reset because the same source working copy already exists in the local drafts list. The campaign-specific local draft was preserved, and duplicate review or queue counts were removed."
          : removedForeignTopLevelCopy
            ? "This browser-local draft was reset because its text referenced another curated campaign. Use source material from this campaign before review or local queueing."
            : (removedUnprovenancedTopLevelReviewState || removedResetTopLevelWorkflowState) && !removedFixtureSourceWorkingCopy && !removedFixtureTopLevelCopy
              ? "This browser-local review or queue state was reset because it did not retain canonical source-resource provenance for this real campaign. Use this campaign's source resources to create a local working copy before review or local queueing."
              : "This browser-local draft was reset because it still contained fixture campaign copy or fixture-bound provenance. Use this real campaign's source material before review or local queueing."
      : state.body,
    reviewerNote: resetTopLevelDraft ? "" : state.reviewerNote,
    status: resetTopLevelDraft ? "draft" : demotedTopLevelQueueState || reversedTopLevelQueueTimestamp ? "approved" : state.status,
    queuedAt: resetTopLevelDraft || demotedTopLevelQueueState || reversedTopLevelQueueTimestamp || staleTopLevelQueueTimestamp ? null : state.queuedAt,
    scheduleIntent: resetScheduleIntent ? initialState.scheduleIntent : state.scheduleIntent,
    localActions,
    workingDrafts,
    activeWorkingDraftId,
    sourceWorkingCopy,
    activity:
      removedMismatchedLocalWork || resetTopLevelDraft || demotedQueuedLocalWork || staleQueueTimestamp || removedOrphanedDraftWorkflowActivity || resetAcknowledgedSourceBaseline || resetSourceRecheckBaseline || removedFixtureActivity
        ? withWorkspaceSanitizedActivity(activity)
        : state.activity,
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

const emptyPortfolioLocalCounts = (): PortfolioLocalCounts => ({ actions: 0, drafts: 0, reviews: 0, queued: 0 });

function isSharedLegacyStorageKey(key: string) {
  return key === STORAGE_KEY || LEGACY_STORAGE_KEYS.includes(key);
}

function loadSanitizedWorkspaceState(campaignId: string, persistSanitized = false): DemoState | null {
  if (typeof window === "undefined") return null;
  const storageKey = localStorageKeyFor(campaignId);
  for (const candidateKey of localStorageKeysForCampaign(campaignId)) {
    const raw = localStorage.getItem(candidateKey);
    if (!raw) continue;
    const loaded = loadState(candidateKey);
    if (loaded.workspaceKey !== campaignId) {
      if (persistSanitized && !isSharedLegacyStorageKey(candidateKey)) localStorage.removeItem(candidateKey);
      continue;
    }
    const state = sanitizeStateForWorkspace(loaded, campaignId);
    if (persistSanitized) {
      const sanitizedRaw = JSON.stringify(state);
      if (candidateKey !== storageKey || sanitizedRaw !== raw) localStorage.setItem(storageKey, sanitizedRaw);
      if (candidateKey !== storageKey) localStorage.removeItem(candidateKey);
    }
    return state;
  }
  return null;
}

function portfolioLocalCounts(campaignId: string, persistSanitized = false): PortfolioLocalCounts {
  const state = loadSanitizedWorkspaceState(campaignId, persistSanitized);
  if (!state) return emptyPortfolioLocalCounts();
  const topLevelSourceDraftCount = state.sourceWorkingCopy ? 1 : 0;
  return {
    actions: state.localActions.length,
    drafts: topLevelSourceDraftCount + state.workingDrafts.length,
    reviews: (state.status === "review" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "review").length,
    queued: (hasRecordedLocalQueue(state.status, state.queuedAt) ? 1 : 0) + state.workingDrafts.filter((draft) => hasRecordedLocalQueue(draft.status, draft.queuedAt)).length,
  };
}

function sourceBoundPrimaryDraftCount(state: DemoState) {
  return state.status !== "draft" || state.sourceWorkingCopy ? 1 : 0;
}

function sourceBoundLocalWorkCount(state: DemoState) {
  return state.localActions.length + sourceBoundPrimaryDraftCount(state) + state.workingDrafts.length;
}

function localSignalPhrases(counts: PortfolioLocalCounts, sourceRecheckItemCount = 0, sourceUpdateNeedsAcknowledgement = false) {
  return [
    sourceRecheckItemCount
      ? `${sourceRecheckItemCount} source re-check${sourceRecheckItemCount === 1 ? "" : "s"} required`
      : sourceUpdateNeedsAcknowledgement
        ? "source update acknowledgement needed"
        : null,
    counts.actions ? `${counts.actions} action${counts.actions === 1 ? "" : "s"}` : null,
    counts.drafts ? `${counts.drafts} working draft${counts.drafts === 1 ? "" : "s"}` : null,
    counts.reviews ? `${counts.reviews} review${counts.reviews === 1 ? "" : "s"}` : null,
    counts.queued ? `${counts.queued} queued locally` : null,
  ].filter(Boolean);
}

function storedSourceRecheckSummary(campaignId: string, source: CampaignSource) {
  const state = loadSanitizedWorkspaceState(campaignId);
  if (!state) return null;
  const currentDocumentSignature = sourceDocumentSignature(source);
  const baselineChanged = Boolean(
    (state.sourceStateVersion === null && sourceBoundLocalWorkCount(state) > 0) ||
      (state.sourceStateVersion !== null &&
        (state.sourceStateVersion !== source.stateVersion || state.sourceLastSequence !== source.lastSequence || state.sourceDocumentSignature !== currentDocumentSignature)),
  );
  if (!baselineChanged) return null;
  const recheckMatchesCurrentSource =
    state.sourceRecheckStateVersion === source.stateVersion && state.sourceRecheckLastSequence === source.lastSequence && state.sourceRecheckDocumentSignature === currentDocumentSignature;
  const visitedViews = new Set(recheckMatchesCurrentSource ? state.sourceRecheckVisitedViews : []);
  const checkedViews = SOURCE_RECHECK_REQUIRED_VIEWS.filter((view) => visitedViews.has(view));
  const missingViews = SOURCE_RECHECK_REQUIRED_VIEWS.filter((view) => !visitedViews.has(view));
  return {
    itemCount: sourceBoundLocalWorkCount(state),
    checkedCount: checkedViews.length,
    requiredCount: SOURCE_RECHECK_REQUIRED_VIEWS.length,
    missingLabels: missingViews.map((view) => sourceRecheckViewLabels[view]),
  };
}

function initialCampaignSwitcherItems(): CampaignSwitcherItem[] {
  return PORTFOLIO_CAMPAIGNS.map((campaign) => ({ campaign, status: "loading" }));
}

function localStorageKeyFor(campaignId?: string) {
  return campaignId ? `${STORAGE_KEY}:${campaignId.toLowerCase()}` : STORAGE_KEY;
}

function storageKeySuffixMatchesCampaign(value: string, campaignId: string) {
  const canonicalSuffix = value.toLowerCase();
  return value === value.trim() && value === value.normalize("NFC") && UUID_RE.test(canonicalSuffix) && canonicalSuffix === campaignId;
}

function localStorageKeysForCampaign(campaignId: string) {
  if (typeof window === "undefined") return [];
  const canonicalKey = localStorageKeyFor(campaignId);
  const keyedPrefixes = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].map((key) => `${key}:`);
  const keys = [canonicalKey];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || key === canonicalKey || key === STORAGE_KEY || LEGACY_STORAGE_KEYS.includes(key)) continue;
    const prefix = keyedPrefixes.find((candidate) => key.startsWith(candidate));
    if (!prefix) continue;
    if (storageKeySuffixMatchesCampaign(key.slice(prefix.length), campaignId)) keys.push(key);
  }
  return [...new Set([...keys, STORAGE_KEY, ...LEGACY_STORAGE_KEYS])];
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
  "Theory of change",
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

function sourceParagraphAfterHeading(doc: CompiledDocument | undefined, heading: string, max = 300) {
  const lines = doc?.plainText?.split(/\r?\n/).map((line) => line.trim()) ?? [];
  const start = lines.findIndex((line) => line.replace(/:$/, "").toLowerCase() === heading.toLowerCase());
  if (start < 0) return null;
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) {
      if (paragraph.length) break;
      continue;
    }
    if (SOURCE_SECTION_BOUNDARY.test(line) || /^[A-Z][A-Z0-9 /&'(),-]{3,}:?$/.test(line)) break;
    if (/^[-•]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^(P\d+|Phase\s+\d+)/i.test(line)) break;
    paragraph.push(line);
  }
  const value = paragraph.join(" ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return shortText(value, max);
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

function sourceLabelFromLines(lines: string[], label: string, max = 150) {
  const value = lines.find((line) => line.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`))
    ?.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "")
    .trim();
  return value ? shortText(value, max) : undefined;
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
    const window = lines.slice(index + 1, index + 14);
    const power = sourceLabelFromLines(window, "Power") || "Power not labelled";
    const position = sourceLabelFromLines(window, "Position") || "Position not labelled in source excerpt";
    const caresAbout = sourceLabelFromLines(window, "Cares about");
    const ask = sourceLabelFromLines(window, "What we ask of them");
    const approach = sourceLabelFromLines(window, "Recommended approach");
    stakeholders.push({ group, name: name.trim(), power, position, caresAbout, ask, approach });
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
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || stableTextCompare(a.title, b.title))
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

function isSourceRunNotReadyStatus(status?: RunReadModel["status"]): status is Exclude<RunReadModel["status"], "partial" | "completed"> {
  return Boolean(status && status !== "partial" && status !== "completed");
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
      id: SOURCE_PRIMARY_SEGMENT_ID,
      name: audienceNames[0] ?? "Core campaign supporters",
      role: "Source audience · browser-local intent",
      contacts: 0,
      ready: 0,
      readiness: `No imported contacts are counted for ${source.title}; this is only a planning label from the public source.`,
      ask: asks[0] ? cleanAudienceLabel(asks[0], 180) : `Prepare a careful update for people already close to ${source.title}, with unresolved checks still visible.`,
      caveat: "No live consent source, CRM import, or provider list is connected for this real campaign.",
    },
    {
      id: "source_secondary",
      name: audienceNames[1] ?? "Decision-route watchers",
      role: "Source audience · evidence/process reviewers",
      contacts: 0,
      ready: 0,
      readiness: `Use source documents to plan who should check the route in ${place}; do not infer reachable contacts.`,
      ask: asks[1] ? cleanAudienceLabel(asks[1], 180) : source.nextGate ?? "Ask a campaigner to verify the next public decision-route check before stronger copy is used.",
      caveat: "This local audience intent does not create, import, or message a real person.",
    },
    {
      id: "source_allies",
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

function sourceSignatureHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceSignatureText(value: string) {
  return decodeSourceSignatureEntities(value)
    .normalize("NFC")
    .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function sourceSignaturePlainText(value: string) {
  return sourceSignatureText(value.replace(/\s+/g, " "));
}

const SOURCE_SIGNATURE_HTML_ENTITIES: Record<string, string> = {
  aacute: "á",
  Aacute: "Á",
  agrave: "à",
  Agrave: "À",
  acirc: "â",
  Acirc: "Â",
  aring: "å",
  Aring: "Å",
  atilde: "ã",
  Atilde: "Ã",
  auml: "ä",
  Auml: "Ä",
  ccedil: "ç",
  Ccedil: "Ç",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  Egrave: "È",
  ecirc: "ê",
  Ecirc: "Ê",
  euml: "ë",
  Euml: "Ë",
  iacute: "í",
  Iacute: "Í",
  igrave: "ì",
  Igrave: "Ì",
  icirc: "î",
  Icirc: "Î",
  iuml: "ï",
  Iuml: "Ï",
  ntilde: "ñ",
  Ntilde: "Ñ",
  oacute: "ó",
  Oacute: "Ó",
  ograve: "ò",
  Ograve: "Ò",
  ocirc: "ô",
  Ocirc: "Ô",
  otilde: "õ",
  Otilde: "Õ",
  ouml: "ö",
  Ouml: "Ö",
  uacute: "ú",
  Uacute: "Ú",
  ugrave: "ù",
  Ugrave: "Ù",
  ucirc: "û",
  Ucirc: "Û",
  uuml: "ü",
  Uuml: "Ü",
  yacute: "ý",
  Yacute: "Ý",
  yuml: "ÿ",
  Yuml: "Ÿ",
  szlig: "ß",
  pound: "£",
  euro: "€",
  reg: "®",
  copy: "©",
  trade: "™",
};

const SOURCE_SIGNATURE_ENTITY_BOUNDARY = String.raw`(?=\s|$|[<.,:!?()[\]{}'"’”/\\-])`;
const SOURCE_SIGNATURE_SPACE_ENTITY_RE = new RegExp(String.raw`&(?:nbsp|ensp|emsp|thinsp|hairsp|numsp|puncsp|mediumspace|nobreak|#160|#xA0)(?:;|${SOURCE_SIGNATURE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_SIGNATURE_DECIMAL_ENTITY_RE = new RegExp(String.raw`&#(\d+)(?:;|${SOURCE_SIGNATURE_ENTITY_BOUNDARY})`, "g");
const SOURCE_SIGNATURE_HEX_ENTITY_RE = new RegExp(String.raw`&#x([0-9a-f]+)(?:;|${SOURCE_SIGNATURE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_SIGNATURE_NAMED_ENTITY_RE = new RegExp(String.raw`&([a-z][a-z0-9]+)(?:;|${SOURCE_SIGNATURE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_SIGNATURE_UNKNOWN_ENTITY_RE = new RegExp(String.raw`&[a-z0-9#]+(?:;|${SOURCE_SIGNATURE_ENTITY_BOUNDARY})`, "gi");

function decodeSourceSignatureEntities(value: string) {
  return value
    .replace(SOURCE_SIGNATURE_SPACE_ENTITY_RE, " ")
    .replace(SOURCE_SIGNATURE_DECIMAL_ENTITY_RE, (_entity, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : "";
    })
    .replace(SOURCE_SIGNATURE_HEX_ENTITY_RE, (_entity, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 16);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : "";
    })
    .replace(SOURCE_SIGNATURE_NAMED_ENTITY_RE, (entity: string, name: string) => {
      const named = SOURCE_SIGNATURE_HTML_ENTITIES[name];
      if (named) return named;
      switch (name.toLowerCase()) {
        case "mdash":
          return "—";
        case "ndash":
          return "–";
        case "lsquo":
        case "rsquo":
        case "apos":
          return "'";
        case "ldquo":
        case "rdquo":
        case "quot":
          return '"';
        case "hellip":
          return "…";
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        default:
          return entity;
      }
    })
    .replace(SOURCE_SIGNATURE_UNKNOWN_ENTITY_RE, "");
}

function sourceSignatureHtmlText(value: string) {
  return sourceSignatureText(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function sourceSignatureCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceSignatureStrings(values: string[] | undefined) {
  return [...(values ?? [])].sort(sourceSignatureCompare);
}

function sourceEvidenceClaimSignature(claim: EvidenceAndNextChecks["groups"][number]["claims"][number]) {
  return {
    id: claim.id,
    text: sourceSignaturePlainText(claim.text),
    type: sourceSignaturePlainText(claim.type),
    label: sourceSignaturePlainText(claim.label),
    loadBearing: claim.loadBearing,
    confidence: sourceSignaturePlainText(claim.confidence),
    excerpt: claim.excerpt ? sourceSignaturePlainText(claim.excerpt) : null,
    sourceCount: claim.sourceCount,
    affectedOutputs: sourceSignatureStrings(claim.affectedOutputs),
    contradictsClaimIds: sourceSignatureStrings(claim.contradictsClaimIds),
  };
}

function sourceEvidenceClaimSortKey(claim: ReturnType<typeof sourceEvidenceClaimSignature>) {
  return `${claim.id}\u0000${claim.label}\u0000${claim.text}`;
}

function sourceDocumentSignature(source: CampaignSource) {
  const sourceIdentity = sourceSignatureHash(sourceSignatureText(`${source.title}\n${source.place ?? ""}`));
  const documentStatuses = source.documents
    .map((doc) => {
      const documentText = sourceSignatureText(`${doc.name}\n${sourceSignaturePlainText(doc.plainText)}\n${sourceSignatureHtmlText(doc.html)}`);
      const documentFlags = sourceSignatureStrings(doc.flags.map(sourceSignaturePlainText)).join("~");
      return `${doc.key}:${doc.status}:${doc.resourceCount}:${documentFlags}:${sourceSignatureHash(documentText)}`;
    })
    .sort(sourceSignatureCompare)
    .join("|");
  const evidenceTotals = source.evidence.totals;
  const evidenceSignature = sourceSignatureHash(
    sourceSignatureText(
      JSON.stringify({
        groups: source.evidence.groups
          .map((group) => ({
            label: sourceSignaturePlainText(group.label),
            claims: group.claims.map(sourceEvidenceClaimSignature).sort((left, right) => sourceSignatureCompare(sourceEvidenceClaimSortKey(left), sourceEvidenceClaimSortKey(right))),
          }))
          .sort((left, right) => sourceSignatureCompare(left.label, right.label)),
        conflicts: source.evidence.conflicts.map(sourceEvidenceClaimSignature).sort((left, right) => sourceSignatureCompare(sourceEvidenceClaimSortKey(left), sourceEvidenceClaimSortKey(right))),
        nextChecks: source.evidence.nextChecks
          .map((check) => ({
            id: check.id,
            description: sourceSignaturePlainText(check.description),
            reason: sourceSignaturePlainText(check.reason),
            claimIds: sourceSignatureStrings(check.claimIds),
            affectedSections: sourceSignatureStrings(check.affectedSections),
          }))
          .sort((left, right) =>
            sourceSignatureCompare(
              `${left.id}\u0000${left.description}\u0000${left.reason}`,
              `${right.id}\u0000${right.description}\u0000${right.reason}`,
            ),
          ),
        terminalGaps: source.evidence.terminalGaps
          .map((gap) => ({ id: gap.id, description: sourceSignaturePlainText(gap.description), agentRunId: gap.agentRunId ?? null, step: gap.step ?? null, at: gap.at }))
          .sort((left, right) =>
            sourceSignatureCompare(
              `${left.id}\u0000${left.description}\u0000${left.at}\u0000${left.agentRunId ?? ""}\u0000${left.step ?? ""}`,
              `${right.id}\u0000${right.description}\u0000${right.at}\u0000${right.agentRunId ?? ""}\u0000${right.step ?? ""}`,
            ),
          ),
        draftNotes: source.evidence.draftNotes
          .map((note) => ({ section: sourceSignaturePlainText(note.section), text: sourceSignaturePlainText(note.text) }))
          .sort((left, right) => sourceSignatureCompare(`${left.section}\u0000${left.text}`, `${right.section}\u0000${right.text}`)),
      }),
    ),
  );
  return `source:${source.campaignId}:${source.runStatus}:${sourceIdentity}::${documentStatuses}::${evidenceTotals.claims}/${evidenceTotals.loadBearing}/${evidenceTotals.verifiedLoadBearing}/${evidenceTotals.unresolvedLoadBearing}::${evidenceSignature}`;
}

function buildInitialStateForSource(source: CampaignSource): DemoState {
  const nextCheck = source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "Review the unresolved source checks before stronger campaign claims are used.";
  return {
    ...initialState,
    workspaceKey: source.campaignId,
    sourceStateVersion: source.stateVersion,
    sourceLastSequence: source.lastSequence,
    sourceDocumentSignature: sourceDocumentSignature(source),
    sourceAcknowledgedAt: source.loadedAt,
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
    selectedSegment: SOURCE_PRIMARY_SEGMENT_ID,
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
  const sourceProblem = source.problem || sourceParagraphAfterHeading(brief, "THE PROBLEM") || sourceParagraphAfterHeading(brief, "Problem");
  const objectiveDecisionMaker = sourceSectionValue(objective, "Decision-maker");
  const objectiveAction = sourceSectionValue(objective, "Specific action");
  const objectiveBy = sourceSectionValue(objective, "By");
  const objectiveMinimumWin = sourceSectionValue(objective, "Minimum viable win");
  const theoryOfChange = sourceSectionValue(objective, "Theory of change", 420) || sourceParagraphAfterHeading(objective, "THEORY OF CHANGE", 420);
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
          label: "Problem",
          detail: sourceProblem ?? "The typed campaign source did not expose a distinct problem paragraph; use the brief excerpt until a campaigner verifies the framing.",
          use: "Keeps the workspace anchored to the actual source problem without substituting fixture narrative.",
          owner: "Campaign source",
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
          label: "Theory of change",
          detail: theoryOfChange ?? "Theory of change was not exposed as a labelled source field; retain the source document rather than inventing causal steps.",
          use: "Connects strategy, tactics, and local communications to the real source logic when it is available.",
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
          detail: [stakeholder.power, stakeholder.position, stakeholder.caresAbout ? `Cares about: ${stakeholder.caresAbout}` : null, stakeholder.ask ? `Ask: ${stakeholder.ask}` : null, stakeholder.approach ? `Approach: ${stakeholder.approach}` : null].filter(Boolean).join(" · "),
          use: stakeholder.ask ? `Turn the source ask into a review question or local action without claiming an imported contact: ${stakeholder.ask}` : "Plan an audience, briefing, or review question from the source role without claiming an imported contact.",
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
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
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
    const retryAfter = sanitizeSourceRetryAfter(sourceRes.headers.get("retry-after"));
    const err = new Error(`The Operations source adapter returned a non-JSON content type (HTTP ${sourceRes.status}). No fixture fallback was used.`);
    if (retryAfter) (err as Error & { retryAfter?: string }).retryAfter = retryAfter;
    throw err;
  }
  let sourceBody: Partial<OperationsSourcePayload> | ({ error?: string; detail?: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: unknown; sourceFailureKind?: unknown; sourcePath?: unknown; sourceHttpStatus?: unknown; sourceElapsedMs?: unknown; sourceRequestId?: unknown; sourceMatchedPath?: unknown; sourceCacheStatus?: unknown; sourceCacheControl?: unknown; sourceAgeSeconds?: unknown; sourceResponseDate?: unknown; sourceContentLength?: unknown; sourceContentLengthMalformed?: unknown; sourceContentRange?: unknown; sourceServer?: unknown; sourceContentEncoding?: unknown; sourceContentCharset?: unknown; sourceBodyEmpty?: unknown; sourceBodyTruncated?: unknown; sourceContentType?: unknown; sourceContentTypeMissing?: unknown; sourceTextEncoding?: unknown } & Record<string, unknown>) | null = null;
  let malformedJson = false;
  try {
    sourceBody = (await sourceRes.json()) as Partial<OperationsSourcePayload> | ({ error?: string; detail?: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: unknown; sourceFailureKind?: unknown; sourcePath?: unknown; sourceHttpStatus?: unknown; sourceElapsedMs?: unknown; sourceRequestId?: unknown; sourceMatchedPath?: unknown; sourceCacheStatus?: unknown; sourceCacheControl?: unknown; sourceAgeSeconds?: unknown; sourceResponseDate?: unknown; sourceContentLength?: unknown; sourceContentLengthMalformed?: unknown; sourceContentRange?: unknown; sourceServer?: unknown; sourceContentEncoding?: unknown; sourceContentCharset?: unknown; sourceBodyEmpty?: unknown; sourceBodyTruncated?: unknown; sourceContentType?: unknown; sourceContentTypeMissing?: unknown; sourceTextEncoding?: unknown } & Record<string, unknown>);
  } catch {
    malformedJson = true;
  }
  if (!sourceRes.ok) {
    if (malformedJson) {
      const retryAfter = sanitizeSourceRetryAfter(sourceRes.headers.get("retry-after"));
      const err = new Error(`The Operations source adapter returned malformed JSON (HTTP ${sourceRes.status}). No fixture fallback was used.`);
      if (retryAfter) (err as Error & { retryAfter?: string }).retryAfter = retryAfter;
      throw err;
    }
    const errorBody = sourceBody as { error?: string; detail?: string; runStatus?: RunReadModel["status"]; sourceOrigin?: string; sourceStep?: unknown; sourceFailureKind?: unknown; sourcePath?: unknown; sourceHttpStatus?: unknown; sourceElapsedMs?: unknown; sourceRequestId?: unknown; sourceMatchedPath?: unknown; sourceCacheStatus?: unknown; sourceCacheControl?: unknown; sourceAgeSeconds?: unknown; sourceResponseDate?: unknown; sourceContentLength?: unknown; sourceContentLengthMalformed?: unknown; sourceContentRange?: unknown; sourceServer?: unknown; sourceContentEncoding?: unknown; sourceContentCharset?: unknown; sourceBodyEmpty?: unknown; sourceBodyTruncated?: unknown; sourceContentType?: unknown; sourceContentTypeMissing?: unknown; sourceTextEncoding?: unknown } | null;
    const sourceOrigin = normaliseOperationsSourceOrigin(errorBody?.sourceOrigin);
    const sourceStep = sanitizeSourceFailureStep(errorBody?.sourceStep);
    const sourceFailureKind = sanitizeSourceFailureKind(errorBody?.sourceFailureKind);
    const sourcePath = sanitizeSourcePath(errorBody?.sourcePath);
    const sourceHttpStatus = sanitizeSourceHttpStatus(errorBody?.sourceHttpStatus);
    const sourceElapsedMs = sanitizeSourceElapsedMs(errorBody?.sourceElapsedMs);
    const sourceRequestId = sanitizeSourceRequestId(errorBody?.sourceRequestId);
    const sourceMatchedPath = sanitizeSourceMatchedPath(errorBody?.sourceMatchedPath);
    const sourceCacheStatus = sanitizeSourceCacheStatus(errorBody?.sourceCacheStatus);
    const sourceCacheControl = sanitizeSourceCacheControl(errorBody?.sourceCacheControl);
    const sourceAgeSeconds = sanitizeSourceAgeSeconds(errorBody?.sourceAgeSeconds);
    const sourceResponseDate = sanitizeSourceResponseDate(errorBody?.sourceResponseDate);
    const sourceContentLength = sanitizeSourceContentLength(errorBody?.sourceContentLength);
    const sourceContentLengthMalformed = sanitizeSourceContentLengthMalformed(errorBody?.sourceContentLengthMalformed);
    const sourceContentRange = sanitizeSourceContentRange(errorBody?.sourceContentRange);
    const sourceServer = sanitizeSourceServer(errorBody?.sourceServer);
    const sourceContentEncoding = sanitizeSourceContentEncoding(errorBody?.sourceContentEncoding);
    const sourceContentCharset = sanitizeSourceContentCharset(errorBody?.sourceContentCharset);
    const sourceBodyEmpty = sanitizeSourceBodyEmpty(errorBody?.sourceBodyEmpty);
    const sourceBodyTruncated = sanitizeSourceBodyTruncated(errorBody?.sourceBodyTruncated);
    const sourceContentType = sanitizeSourceContentType(errorBody?.sourceContentType);
    const sourceContentTypeMissing = sanitizeSourceContentTypeMissing(errorBody?.sourceContentTypeMissing);
    const sourceTextEncoding = sanitizeSourceTextEncoding(errorBody?.sourceTextEncoding);
    const hasSourceOriginField = isRecord(errorBody) && Object.prototype.hasOwnProperty.call(errorBody, "sourceOrigin");
    const canUseSourceErrorDetail = !hasSourceOriginField || Boolean(sourceOrigin);
    const fallbackMessage = sourceRes.status === 404 && !hasSourceOriginField
      ? "No curated public campaign source was found for that campaign ID."
      : `The public campaign source could not be loaded (HTTP ${sourceRes.status}).`;
    const retryAfter = sanitizeSourceRetryAfter(sourceRes.headers.get("retry-after"));
    const preferSafeFallbackMessage = sourceRes.status === 404 && !hasSourceOriginField;
    const err = new Error(canUseSourceErrorDetail && !preferSafeFallbackMessage ? errorBody?.detail || errorBody?.error || fallbackMessage : fallbackMessage);
    if (canUseSourceErrorDetail && errorBody?.runStatus) (err as Error & { runStatus?: RunReadModel["status"] }).runStatus = errorBody.runStatus;
    if (sourceOrigin) (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
    if (sourceStep) (err as Error & { sourceStep?: SourceFailureStep }).sourceStep = sourceStep;
    if (sourceFailureKind) (err as Error & { sourceFailureKind?: SourceFailureKind }).sourceFailureKind = sourceFailureKind;
    if (retryAfter) (err as Error & { retryAfter?: string }).retryAfter = retryAfter;
    if (sourcePath) (err as Error & { sourcePath?: string }).sourcePath = sourcePath;
    if (sourceHttpStatus) (err as Error & { sourceHttpStatus?: number }).sourceHttpStatus = sourceHttpStatus;
    if (sourceElapsedMs !== undefined) (err as Error & { sourceElapsedMs?: number }).sourceElapsedMs = sourceElapsedMs;
    if (sourceRequestId) (err as Error & { sourceRequestId?: string }).sourceRequestId = sourceRequestId;
    if (sourceMatchedPath) (err as Error & { sourceMatchedPath?: string }).sourceMatchedPath = sourceMatchedPath;
    if (sourceCacheStatus) (err as Error & { sourceCacheStatus?: string }).sourceCacheStatus = sourceCacheStatus;
    if (sourceCacheControl) (err as Error & { sourceCacheControl?: string }).sourceCacheControl = sourceCacheControl;
    if (sourceAgeSeconds !== undefined) (err as Error & { sourceAgeSeconds?: number }).sourceAgeSeconds = sourceAgeSeconds;
    if (sourceResponseDate) (err as Error & { sourceResponseDate?: string }).sourceResponseDate = sourceResponseDate;
    if (sourceContentLength !== undefined) (err as Error & { sourceContentLength?: number }).sourceContentLength = sourceContentLength;
    if (sourceContentLengthMalformed) (err as Error & { sourceContentLengthMalformed?: boolean }).sourceContentLengthMalformed = sourceContentLengthMalformed;
    if (sourceContentRange) (err as Error & { sourceContentRange?: string }).sourceContentRange = sourceContentRange;
    if (sourceServer) (err as Error & { sourceServer?: string }).sourceServer = sourceServer;
    if (sourceContentEncoding) (err as Error & { sourceContentEncoding?: string }).sourceContentEncoding = sourceContentEncoding;
    if (sourceContentCharset) (err as Error & { sourceContentCharset?: string }).sourceContentCharset = sourceContentCharset;
    if (sourceBodyEmpty) (err as Error & { sourceBodyEmpty?: boolean }).sourceBodyEmpty = sourceBodyEmpty;
    if (sourceBodyTruncated) (err as Error & { sourceBodyTruncated?: boolean }).sourceBodyTruncated = sourceBodyTruncated;
    if (sourceContentType) (err as Error & { sourceContentType?: string }).sourceContentType = sourceContentType;
    if (sourceContentTypeMissing) (err as Error & { sourceContentTypeMissing?: boolean }).sourceContentTypeMissing = sourceContentTypeMissing;
    if (sourceTextEncoding) (err as Error & { sourceTextEncoding?: "malformed" }).sourceTextEncoding = sourceTextEncoding;
    throw err;
  }
  if (!sourceBody) {
    throw new Error(`The Operations source adapter returned malformed JSON (HTTP ${sourceRes.status}). No fixture fallback was used.`);
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
    (err as Error & { sourceOrigin?: string }).sourceOrigin = sourceOrigin;
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
  if (!value || !isValidStoredTimestamp(value)) return "Not queued";
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
  const portfolioItemRefreshIds = useRef<Record<string, number>>({});
  const portfolioControllers = useRef<AbortController[]>([]);

  const refreshCampaign = useCallback((campaign: PortfolioCampaign, currentRefreshId = portfolioRefreshId.current) => {
    const itemRefreshId = (portfolioItemRefreshIds.current[campaign.id] ?? 0) + 1;
    portfolioItemRefreshIds.current[campaign.id] = itemRefreshId;
    const controller = new AbortController();
    const loadingLocalCounts = portfolioLocalCounts(campaign.id, true);
    portfolioControllers.current.push(controller);
    setItems((current) =>
      current.map((item) =>
        item.campaign.id === campaign.id
          ? { campaign, status: "loading", local: loadingLocalCounts }
          : item,
      ),
    );
    fetchCampaignSource(campaign.id, controller.signal)
      .then((source) => {
        if (controller.signal.aborted || currentRefreshId !== portfolioRefreshId.current || itemRefreshId !== portfolioItemRefreshIds.current[campaign.id]) return;
        const localCounts = portfolioLocalCounts(campaign.id, true);
        setItems((current) =>
          current.map((item) =>
            item.campaign.id === campaign.id
              ? { campaign, status: "ready", source, local: localCounts }
              : item,
          ),
        );
        setLastLoaded(new Date().toISOString());
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || currentRefreshId !== portfolioRefreshId.current || itemRefreshId !== portfolioItemRefreshIds.current[campaign.id]) return;
        const message = error instanceof Error ? error.message : "This campaign source could not be loaded.";
        const sourceOrigin = (error as { sourceOrigin?: string } | null)?.sourceOrigin;
        const sourceStep = (error as { sourceStep?: SourceFailureStep } | null)?.sourceStep;
        const sourceFailureKind = (error as { sourceFailureKind?: SourceFailureKind } | null)?.sourceFailureKind;
        const retryAfter = (error as { retryAfter?: string } | null)?.retryAfter;
        const sourcePath = (error as { sourcePath?: string } | null)?.sourcePath;
        const sourceHttpStatus = (error as { sourceHttpStatus?: number } | null)?.sourceHttpStatus;
        const sourceElapsedMs = (error as { sourceElapsedMs?: number } | null)?.sourceElapsedMs;
        const sourceRequestId = (error as { sourceRequestId?: string } | null)?.sourceRequestId;
        const sourceMatchedPath = (error as { sourceMatchedPath?: string } | null)?.sourceMatchedPath;
        const sourceCacheStatus = (error as { sourceCacheStatus?: string } | null)?.sourceCacheStatus;
        const sourceCacheControl = (error as { sourceCacheControl?: string } | null)?.sourceCacheControl;
        const sourceAgeSeconds = (error as { sourceAgeSeconds?: number } | null)?.sourceAgeSeconds;
        const sourceResponseDate = (error as { sourceResponseDate?: string } | null)?.sourceResponseDate;
        const sourceContentLength = (error as { sourceContentLength?: number } | null)?.sourceContentLength;
        const sourceContentLengthMalformed = (error as { sourceContentLengthMalformed?: boolean } | null)?.sourceContentLengthMalformed;
        const sourceContentRange = (error as { sourceContentRange?: string } | null)?.sourceContentRange;
        const sourceServer = (error as { sourceServer?: string } | null)?.sourceServer;
        const sourceContentEncoding = (error as { sourceContentEncoding?: string } | null)?.sourceContentEncoding;
        const sourceContentCharset = (error as { sourceContentCharset?: string } | null)?.sourceContentCharset;
        const sourceBodyEmpty = (error as { sourceBodyEmpty?: boolean } | null)?.sourceBodyEmpty;
        const sourceBodyTruncated = (error as { sourceBodyTruncated?: boolean } | null)?.sourceBodyTruncated;
        const sourceContentType = (error as { sourceContentType?: string } | null)?.sourceContentType;
        const sourceContentTypeMissing = (error as { sourceContentTypeMissing?: boolean } | null)?.sourceContentTypeMissing;
        const sourceTextEncoding = (error as { sourceTextEncoding?: "malformed" } | null)?.sourceTextEncoding;
        const runStatus = (error as { runStatus?: RunReadModel["status"] } | null)?.runStatus;
        const localCounts = portfolioLocalCounts(campaign.id, true);
        setItems((current) =>
          current.map((item) =>
            item.campaign.id === campaign.id
              ? { campaign, status: "error", title: isSourceRunNotReadyStatus(runStatus) ? "Campaign not usable yet" : "Campaign source unavailable", message, runStatus, sourceOrigin, sourceStep, sourceFailureKind, retryAfter, sourcePath, sourceHttpStatus, sourceElapsedMs, sourceRequestId, sourceMatchedPath, sourceCacheStatus, sourceCacheControl, sourceAgeSeconds, sourceResponseDate, sourceContentLength, sourceContentLengthMalformed, sourceContentRange, sourceServer, sourceContentEncoding, sourceContentCharset, sourceBodyEmpty, sourceBodyTruncated, sourceContentType, sourceContentTypeMissing, sourceTextEncoding, checkedAt: new Date().toISOString(), local: localCounts }
              : item,
          ),
        );
        setLastLoaded(new Date().toISOString());
      });
  }, []);

  const refresh = useCallback(() => {
    portfolioRefreshId.current += 1;
    const currentRefreshId = portfolioRefreshId.current;
    portfolioControllers.current.forEach((controller) => controller.abort());
    portfolioControllers.current = [];
    setItems(
      PORTFOLIO_CAMPAIGNS.map((campaign) => ({
        campaign,
        status: "loading",
        local: portfolioLocalCounts(campaign.id, true),
      })),
    );
    PORTFOLIO_CAMPAIGNS.forEach((campaign) => refreshCampaign(campaign, currentRefreshId));
  }, [refreshCampaign]);

  useEffect(() => {
    queueMicrotask(refresh);
    return () => {
      portfolioRefreshId.current += 1;
      portfolioControllers.current.forEach((controller) => controller.abort());
      portfolioControllers.current = [];
    };
  }, [refresh]);

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
            const sourceRecheckSummary = source ? storedSourceRecheckSummary(item.campaign.id, source) : null;
            const sourceRecheckItemCount = sourceRecheckSummary?.itemCount ?? 0;
            const localSignals = localSignalPhrases(item.local, sourceRecheckItemCount, Boolean(sourceRecheckSummary));
            return (
              <article key={item.campaign.id} className={`rounded-[var(--r-2xl)] border p-4 shadow-sm ${item.campaign.conferenceHero ? "border-ops-ink bg-ops-yellow/50" : "border-ops-line bg-background"}`}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.campaign.conferenceHero ? <span className="rounded-full bg-ops-ink px-2.5 py-1 text-xs font-medium text-white">Conference deep dive</span> : null}
                      <span className="rounded-full bg-ops-blue px-2.5 py-1 text-xs text-ops-ink">{source ? sourceStatusPhrase(source) : item.status === "loading" ? "Loading source" : item.status === "error" && isSourceRunNotReadyStatus(item.runStatus) ? `Source ${statusPhrase(item.runStatus).toLowerCase()}` : "Source issue"}</span>
                      <span className="rounded-full border border-ops-line bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">Browser-local state separate</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-medium tracking-tight">{item.status === "ready" ? item.source.title : item.status === "loading" ? "Loading campaign…" : item.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{item.status === "ready" ? item.source.place : item.status === "loading" ? "Reading public run and compiled documents." : item.message}</p>
                    {item.status === "error" && item.sourceOrigin ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Checked read-only source: <span className="font-medium text-foreground">{item.sourceOrigin}</span>
                      </p>
                    ) : null}
                    {item.status === "error" && item.runStatus ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Source run status: <span className="font-medium text-foreground">{statusPhrase(item.runStatus)}</span>
                      </p>
                    ) : null}
                    {item.status === "error" && sourceFailureStepLabel(item.sourceStep) ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Failed source step: <span className="font-medium text-foreground">{sourceFailureStepLabel(item.sourceStep)}</span>
                      </p>
                    ) : null}
                    {item.status === "error" && upstreamDiagnosticPhrase(item.sourceFailureKind, item.sourceHttpStatus, item.sourceElapsedMs, item.sourceRequestId, item.sourcePath, item.sourceMatchedPath, item.sourceCacheStatus, item.sourceCacheControl, item.sourceAgeSeconds, item.sourceResponseDate, item.sourceContentLength, item.sourceContentLengthMalformed, item.sourceContentRange, item.sourceServer, item.sourceContentEncoding, item.sourceContentCharset, item.sourceBodyEmpty, item.sourceBodyTruncated, item.sourceContentType, item.sourceContentTypeMissing, item.sourceTextEncoding) ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Source response: <span className="font-medium text-foreground">{upstreamDiagnosticPhrase(item.sourceFailureKind, item.sourceHttpStatus, item.sourceElapsedMs, item.sourceRequestId, item.sourcePath, item.sourceMatchedPath, item.sourceCacheStatus, item.sourceCacheControl, item.sourceAgeSeconds, item.sourceResponseDate, item.sourceContentLength, item.sourceContentLengthMalformed, item.sourceContentRange, item.sourceServer, item.sourceContentEncoding, item.sourceContentCharset, item.sourceBodyEmpty, item.sourceBodyTruncated, item.sourceContentType, item.sourceContentTypeMissing, item.sourceTextEncoding)}</span>
                      </p>
                    ) : null}
                    {item.status === "error" && item.checkedAt ? (
                      <p className="mt-2 text-xs text-muted-foreground">Last source attempt {formatQueuedTime(item.checkedAt)}.</p>
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
                    {sourceRecheckSummary ? (
                      <p className="mt-2 rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/35 px-3 py-2 text-xs text-ops-ink" aria-label="Portfolio source re-check progress">
                        Source re-check progress: {sourceRecheckSummary.checkedCount}/{sourceRecheckSummary.requiredCount} required source views checked
                        {sourceRecheckSummary.missingLabels.length
                          ? `; ${sourceRecheckSummary.missingLabels.join(", ")} still needed before acknowledgement.`
                          : "; ready to acknowledge in the workspace Overview."}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3">
                    {item.status === "error" ? (
                      <button type="button" onClick={() => refreshCampaign(item.campaign)} className="rounded-full bg-ops-ink px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        Try this source again
                      </button>
                    ) : null}
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

function SourceStateShell({ state, onRetry }: { state: Exclude<SourceState, { status: "fixture" } | { status: "ready" }>; onRetry?: () => void }) {
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
  const runStatus = "runStatus" in state ? state.runStatus : undefined;
  const sourceStep = "sourceStep" in state ? sourceFailureStepLabel(state.sourceStep) : null;
  const retryMessage = "retryAfter" in state ? retryAfterMessage(state.retryAfter) : null;
  const sourceDiagnostic = "sourceHttpStatus" in state ? upstreamDiagnosticPhrase(state.sourceFailureKind, state.sourceHttpStatus, state.sourceElapsedMs, state.sourceRequestId, state.sourcePath, state.sourceMatchedPath, state.sourceCacheStatus, state.sourceCacheControl, state.sourceAgeSeconds, state.sourceResponseDate, state.sourceContentLength, state.sourceContentLengthMalformed, state.sourceContentRange, state.sourceServer, state.sourceContentEncoding, state.sourceContentCharset, state.sourceBodyEmpty, state.sourceBodyTruncated, state.sourceContentType, state.sourceContentTypeMissing, state.sourceTextEncoding) : null;
  const checkedAt = "checkedAt" in state ? state.checkedAt : undefined;
  const showSourceStepWithoutOrigin = canLinkSource && !sourceOrigin && Boolean(sourceStep) && state.status !== "loading";
  const noFallbackInstruction =
    state.status === "invalid" || !canLinkSource
      ? "Use one of the curated Operations campaign IDs or return to Campaign Factory."
      : "Retry the read-only source load or inspect the public source brief; the labelled fixture demo remains sample-only and is not substituted for this campaign.";
  const localCounts = canLinkSource && state.status !== "loading" ? portfolioLocalCounts(campaignId) : emptyPortfolioLocalCounts();
  const localSignals = localSignalPhrases(localCounts);

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
              Checked read-only source: <span className="font-medium text-foreground">{sourceOrigin}</span>{runStatus ? ` · source run status: ${statusPhrase(runStatus)}` : ""}{sourceStep ? ` · failed source step: ${sourceStep}` : ""}{checkedAt ? ` · last attempt ${formatQueuedTime(checkedAt)}` : ""}
            </p>
          ) : null}
          {sourceDiagnostic ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-background/80 px-3 py-2 text-sm text-muted-foreground">
              Source response: <span className="font-medium text-foreground">{sourceDiagnostic}</span>
            </p>
          ) : null}
          {showSourceStepWithoutOrigin ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-background/80 px-3 py-2 text-sm text-muted-foreground">
              Failed source step: <span className="font-medium text-foreground">{sourceStep}</span>{checkedAt ? ` · last attempt ${formatQueuedTime(checkedAt)}` : ""}
            </p>
          ) : null}
          {retryMessage ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-ops-yellow/60 px-3 py-2 text-sm font-medium text-ops-ink">
              {retryMessage}
            </p>
          ) : null}
          {canLinkSource && state.status !== "loading" ? (
            <p className="mt-3 max-w-3xl rounded-[var(--r-xl)] border border-ops-line bg-background/80 px-3 py-2 text-sm text-muted-foreground" aria-label="Stored local operations summary">
              Stored browser-local work for this campaign: <span className="font-medium text-foreground">{localSignals.length ? localSignals.join(" · ") : "no browser-local operations work yet"}</span>. No fixture content is substituted while the read-only source is unavailable.
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
                {noFallbackInstruction} External sending, imports, scheduling, and source write-back remain disconnected.
              </p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {canLinkSource && state.status !== "loading" && onRetry ? (
              <Button type="button" onClick={onRetry} className="rounded-full bg-ops-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                Try source load again
              </Button>
            ) : null}
            <Link href="/operations?demo=fixture" className="rounded-full border border-ops-line bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Open labelled fixture demo
            </Link>
            {canLinkSource ? (
              <Link href={sourceHref} className={`${state.status === "loading" ? "bg-ops-ink text-white hover:opacity-90" : "border border-ops-line bg-background hover:bg-secondary"} rounded-full px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50`}>
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
  const normalizedCampaignId = campaignId?.trim().toLowerCase();
  if (!normalizedCampaignId && !fixtureMode) {
    return <OperationsPortfolio />;
  }
  return <OperationsCampaignWorkspace campaignId={normalizedCampaignId} initialView={initialView} />;
}

function OperationsCampaignWorkspace({ campaignId, initialView }: { campaignId?: string; initialView?: string }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>(() =>
    campaignId ? { status: UUID_RE.test(campaignId) ? "loading" : "invalid", campaignId } : { status: "fixture" },
  );
  const [switcherItems, setSwitcherItems] = useState<CampaignSwitcherItem[]>(initialCampaignSwitcherItems);
  const [hasStoredLocalState, setHasStoredLocalState] = useState(false);
  const [sourceRetryCount, setSourceRetryCount] = useState(0);
  const storageKey = useMemo(() => localStorageKeyFor(campaignId), [campaignId]);
  const sourceStateCampaignId = sourceState.status === "ready" ? sourceState.source.campaignId : "campaignId" in sourceState ? sourceState.campaignId : undefined;
  const sourceStateMatchesCampaign = !campaignId || sourceState.status === "fixture" || sourceStateCampaignId === campaignId;
  const renderedSourceState: SourceState = sourceStateMatchesCampaign
    ? sourceState
    : campaignId && UUID_RE.test(campaignId)
      ? { status: "loading", campaignId }
      : campaignId
        ? { status: "invalid", campaignId }
        : { status: "fixture" };
  const source = renderedSourceState.status === "ready" ? renderedSourceState.source : null;

  useEffect(() => {
    queueMicrotask(() => {
      const recoveredWorkspaceState = campaignId ? loadSanitizedWorkspaceState(campaignId, true) : null;
      const stored = Boolean(recoveredWorkspaceState) || hasStoredState(storageKey);
      const loaded = recoveredWorkspaceState ?? loadState(storageKey);
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
        const sourceStep = (error as { sourceStep?: SourceFailureStep } | null)?.sourceStep;
        const sourceFailureKind = (error as { sourceFailureKind?: SourceFailureKind } | null)?.sourceFailureKind;
        const retryAfter = (error as { retryAfter?: string } | null)?.retryAfter;
        const sourcePath = (error as { sourcePath?: string } | null)?.sourcePath;
        const sourceHttpStatus = (error as { sourceHttpStatus?: number } | null)?.sourceHttpStatus;
        const sourceElapsedMs = (error as { sourceElapsedMs?: number } | null)?.sourceElapsedMs;
        const sourceRequestId = (error as { sourceRequestId?: string } | null)?.sourceRequestId;
        const sourceMatchedPath = (error as { sourceMatchedPath?: string } | null)?.sourceMatchedPath;
        const sourceCacheStatus = (error as { sourceCacheStatus?: string } | null)?.sourceCacheStatus;
        const sourceCacheControl = (error as { sourceCacheControl?: string } | null)?.sourceCacheControl;
        const sourceAgeSeconds = (error as { sourceAgeSeconds?: number } | null)?.sourceAgeSeconds;
        const sourceResponseDate = (error as { sourceResponseDate?: string } | null)?.sourceResponseDate;
        const sourceContentLength = (error as { sourceContentLength?: number } | null)?.sourceContentLength;
        const sourceContentLengthMalformed = (error as { sourceContentLengthMalformed?: boolean } | null)?.sourceContentLengthMalformed;
        const sourceContentRange = (error as { sourceContentRange?: string } | null)?.sourceContentRange;
        const sourceServer = (error as { sourceServer?: string } | null)?.sourceServer;
        const sourceContentEncoding = (error as { sourceContentEncoding?: string } | null)?.sourceContentEncoding;
        const sourceContentCharset = (error as { sourceContentCharset?: string } | null)?.sourceContentCharset;
        const sourceBodyEmpty = (error as { sourceBodyEmpty?: boolean } | null)?.sourceBodyEmpty;
        const sourceBodyTruncated = (error as { sourceBodyTruncated?: boolean } | null)?.sourceBodyTruncated;
        const sourceContentType = (error as { sourceContentType?: string } | null)?.sourceContentType;
        const sourceContentTypeMissing = (error as { sourceContentTypeMissing?: boolean } | null)?.sourceContentTypeMissing;
        const sourceTextEncoding = (error as { sourceTextEncoding?: "malformed" } | null)?.sourceTextEncoding;
        if (runStatus && runStatus !== "completed" && runStatus !== "partial") {
          setSourceState({ status: "unavailable", campaignId, title: "Campaign not usable yet", message, runStatus, sourceOrigin, sourceStep, sourceFailureKind, retryAfter, sourcePath, sourceHttpStatus, sourceElapsedMs, sourceRequestId, sourceMatchedPath, sourceCacheStatus, sourceCacheControl, sourceAgeSeconds, sourceResponseDate, sourceContentLength, sourceContentLengthMalformed, sourceContentRange, sourceServer, sourceContentEncoding, sourceContentCharset, sourceBodyEmpty, sourceBodyTruncated, sourceContentType, sourceContentTypeMissing, sourceTextEncoding, checkedAt: new Date().toISOString() });
          return;
        }
        setSourceState({ status: "error", campaignId, title: "Campaign source unavailable", message, runStatus, sourceOrigin, sourceStep, sourceFailureKind, retryAfter, sourcePath, sourceHttpStatus, sourceElapsedMs, sourceRequestId, sourceMatchedPath, sourceCacheStatus, sourceCacheControl, sourceAgeSeconds, sourceResponseDate, sourceContentLength, sourceContentLengthMalformed, sourceContentRange, sourceServer, sourceContentEncoding, sourceContentCharset, sourceBodyEmpty, sourceBodyTruncated, sourceContentType, sourceContentTypeMissing, sourceTextEncoding, checkedAt: new Date().toISOString() });
      });
    return () => controller.abort();
  }, [campaignId, sourceRetryCount]);

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
      setState((current) => {
        if (sourceBoundLocalWorkCount(current) > 0) return current;
        const refreshedBaselineActivity = `Updated read-only source baseline for ${source.title}; no local actions or drafts needed re-check.`;
        return {
          ...current,
          sourceStateVersion: source.stateVersion,
          sourceLastSequence: source.lastSequence,
          sourceDocumentSignature: signature,
          sourceAcknowledgedAt: source.loadedAt,
          sourceRecheckStateVersion: null,
          sourceRecheckLastSequence: null,
          sourceRecheckDocumentSignature: null,
          sourceRecheckVisitedViews: [],
          activity: current.activity.some((item) => item.label === refreshedBaselineActivity)
            ? current.activity
            : [record(refreshedBaselineActivity), ...current.activity].slice(0, 7),
        };
      });
    });
  }, [hasStoredLocalState, hydrated, source, state.sourceStateVersion, state.workspaceKey]);

  useEffect(() => {
    if (!hydrated || !source || !hasStoredLocalState || state.workspaceKey !== source.campaignId || state.sourceStateVersion === null || state.sourceAcknowledgedAt) return;
    queueMicrotask(() => {
      setState((current) => ({
        ...current,
        sourceAcknowledgedAt: source.loadedAt,
      }));
    });
  }, [hasStoredLocalState, hydrated, source, state.sourceAcknowledgedAt, state.sourceStateVersion, state.workspaceKey]);

  useEffect(() => {
    if (!hydrated) return;
    const expectedWorkspaceKey = campaignId ?? "fixture";
    if (state.workspaceKey !== expectedWorkspaceKey) return;
    if (campaignId && !hasStoredLocalState && renderedSourceState.status !== "ready") return;
    if (campaignId && source && !hasStoredLocalState && state.activity[0]?.id !== `source-${source.campaignId}`) return;
    if (!campaignId && !hasStoredLocalState && state === initialState) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (!campaignId) LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }, [campaignId, hasStoredLocalState, hydrated, renderedSourceState.status, source, state, storageKey]);

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
          const runStatus = (error as { runStatus?: RunReadModel["status"] } | null)?.runStatus;
          const sourceOrigin = (error as { sourceOrigin?: string } | null)?.sourceOrigin;
          const sourceStep = (error as { sourceStep?: SourceFailureStep } | null)?.sourceStep;
          const sourceFailureKind = (error as { sourceFailureKind?: SourceFailureKind } | null)?.sourceFailureKind;
          const retryAfter = (error as { retryAfter?: string } | null)?.retryAfter;
          const sourcePath = (error as { sourcePath?: string } | null)?.sourcePath;
          const sourceHttpStatus = (error as { sourceHttpStatus?: number } | null)?.sourceHttpStatus;
          const sourceElapsedMs = (error as { sourceElapsedMs?: number } | null)?.sourceElapsedMs;
          const sourceRequestId = (error as { sourceRequestId?: string } | null)?.sourceRequestId;
          const sourceMatchedPath = (error as { sourceMatchedPath?: string } | null)?.sourceMatchedPath;
          const sourceCacheStatus = (error as { sourceCacheStatus?: string } | null)?.sourceCacheStatus;
          const sourceCacheControl = (error as { sourceCacheControl?: string } | null)?.sourceCacheControl;
          const sourceAgeSeconds = (error as { sourceAgeSeconds?: number } | null)?.sourceAgeSeconds;
          const sourceResponseDate = (error as { sourceResponseDate?: string } | null)?.sourceResponseDate;
          const sourceContentLength = (error as { sourceContentLength?: number } | null)?.sourceContentLength;
          const sourceContentLengthMalformed = (error as { sourceContentLengthMalformed?: boolean } | null)?.sourceContentLengthMalformed;
          const sourceContentRange = (error as { sourceContentRange?: string } | null)?.sourceContentRange;
          const sourceServer = (error as { sourceServer?: string } | null)?.sourceServer;
          const sourceContentEncoding = (error as { sourceContentEncoding?: string } | null)?.sourceContentEncoding;
          const sourceContentCharset = (error as { sourceContentCharset?: string } | null)?.sourceContentCharset;
          const sourceBodyEmpty = (error as { sourceBodyEmpty?: boolean } | null)?.sourceBodyEmpty;
          const sourceBodyTruncated = (error as { sourceBodyTruncated?: boolean } | null)?.sourceBodyTruncated;
          const sourceContentType = (error as { sourceContentType?: string } | null)?.sourceContentType;
          const sourceContentTypeMissing = (error as { sourceContentTypeMissing?: boolean } | null)?.sourceContentTypeMissing;
          const sourceTextEncoding = (error as { sourceTextEncoding?: "malformed" } | null)?.sourceTextEncoding;
          setSwitcherItems((current) =>
            current.map((item) =>
              item.campaign.id === campaign.id
                ? { campaign, status: "error", message, runStatus, sourceOrigin, sourceStep, sourceFailureKind, retryAfter, sourcePath, sourceHttpStatus, sourceElapsedMs, sourceRequestId, sourceMatchedPath, sourceCacheStatus, sourceCacheControl, sourceAgeSeconds, sourceResponseDate, sourceContentLength, sourceContentLengthMalformed, sourceContentRange, sourceServer, sourceContentEncoding, sourceContentCharset, sourceBodyEmpty, sourceBodyTruncated, sourceContentType, sourceContentTypeMissing, sourceTextEncoding, checkedAt: new Date().toISOString() }
                : item,
            ),
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
  const sourceBaselineMissing = Boolean(source && state.workspaceKey === source.campaignId && state.sourceStateVersion === null && sourceBoundLocalWorkCount(state) > 0);
  const sourceBaselineChanged = Boolean(
    source &&
      (sourceBaselineMissing ||
        (state.sourceStateVersion !== null &&
          (state.sourceStateVersion !== source.stateVersion || state.sourceLastSequence !== source.lastSequence || state.sourceDocumentSignature !== currentSourceDocumentSignature))),
  );
  const sourceChangedActionsToRecheck = sourceBaselineChanged ? state.localActions : [];
  const sourceChangedDraftsToRecheck = sourceBaselineChanged
    ? [
        ...(state.status !== "draft" || state.sourceWorkingCopy
          ? [
              {
                id: "seeded-supporter-email",
                title: state.sourceWorkingCopy?.title ?? "Supporter email",
                status: statusCopy[state.status].label,
                source: state.sourceWorkingCopy ? `${state.sourceWorkingCopy.sourceDocument} (${state.sourceWorkingCopy.sourceDocumentKey})` : "Browser-local source workspace draft",
              },
            ]
          : []),
        ...state.workingDrafts.map((draft) => ({
          id: draft.id,
          title: draft.title,
          status: statusCopy[draft.status].label,
          source: `${draft.sourceWorkingCopy.sourceDocument} (${draft.sourceWorkingCopy.sourceDocumentKey})`,
        })),
      ]
    : [];
  const sourceRecheckItemCount = sourceChangedActionsToRecheck.length + sourceChangedDraftsToRecheck.length;
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
  const canCreateSourceDerivedWork = !sourceBaselineChanged;
  const canEditCommunicationCopy = activeDraftEditable && !sourceBaselineChanged;
  const canRequestReviewWithCurrentSource = canRequestReview && !sourceBaselineChanged;
  const canApproveCommunication = communicationStatus === "review" && !sourceBaselineChanged;
  const canQueueCommunication = communicationStatus === "approved" && !sourceBaselineChanged;
  const canChangeLocalQueueSchedule = !sourceBaselineChanged;
  const canSelectAudienceWithCurrentSource = !sourceBaselineChanged;
  const canEditReviewerNoteWithCurrentSource = !sourceBaselineChanged;
  const sourceRecheckMatchesCurrentSource = Boolean(
    sourceBaselineChanged &&
      source &&
      state.sourceRecheckStateVersion === source.stateVersion &&
      state.sourceRecheckLastSequence === source.lastSequence &&
      state.sourceRecheckDocumentSignature === currentSourceDocumentSignature,
  );
  const sourceRecheckVisitedViews = new Set(sourceRecheckMatchesCurrentSource ? state.sourceRecheckVisitedViews : []);
  const missingSourceRecheckViews = SOURCE_RECHECK_REQUIRED_VIEWS.filter((view) => !sourceRecheckVisitedViews.has(view));
  const sourceRecheckCheckedCount = SOURCE_RECHECK_REQUIRED_VIEWS.length - missingSourceRecheckViews.length;
  const canAcknowledgeSourceRefresh = !sourceBaselineChanged || missingSourceRecheckViews.length === 0;
  const reviewBlocked = !canRequestReview;
  const reviewItemCount = (state.status === "review" ? 1 : 0) + state.workingDrafts.filter((draft) => draft.status === "review").length;
  const queuedItemCount = (hasRecordedLocalQueue(state.status, state.queuedAt) ? 1 : 0) + state.workingDrafts.filter((draft) => hasRecordedLocalQueue(draft.status, draft.queuedAt)).length;
  const queuedCount = queuedItemCount ? String(queuedItemCount) : undefined;
  const reviewBadge = sourceBaselineChanged && sourceRecheckItemCount ? String(sourceRecheckItemCount) : reviewItemCount ? String(reviewItemCount) : undefined;
  const sourceRecheckNavState = (view: ViewId) => {
    if (!sourceBaselineChanged || !SOURCE_RECHECK_REQUIRED_VIEWS.includes(view)) return null;
    const checked = sourceRecheckVisitedViews.has(view);
    return {
      badge: checked ? "Checked" : "Needed",
      badgeLabel: checked ? "source re-check checked" : "source re-check needed",
      badgeTone: checked ? "checked" : "source",
    } satisfies Pick<NavItem, "badge" | "badgeLabel" | "badgeTone">;
  };
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
        after_next_check: "Demo intent: after the next source check and consent import",
      }
    : {
        after_approval: "Hold until a campaigner connects a provider after review",
        tomorrow_morning: "Demo intent: next school-run morning after provider setup",
        after_next_check: "Demo intent: school-run reminder window after consent import",
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
      status: sourceBaselineChanged ? "blocked" : communicationStatus === "approved" || communicationStatus === "queued" ? "complete" : communicationStatus === "review" ? "current" : "blocked",
      statusLabel: sourceBaselineChanged
        ? "Source re-check required"
        : communicationStatus === "approved" || communicationStatus === "queued"
          ? "Approved by human"
          : communicationStatus === "review"
            ? "Waiting for approval"
            : "Required before queue",
      detail: sourceBaselineChanged
        ? "Read-only source changed; re-check local work and acknowledge the source before approval continues."
        : "A person must explicitly approve before anything enters the local demo queue.",
    },
    {
      label: "Local outbox",
      view: "outbox",
      status: sourceBaselineChanged ? "blocked" : communicationStatus === "queued" ? "complete" : communicationStatus === "approved" ? "current" : "soon",
      statusLabel: sourceBaselineChanged ? "Paused for source update" : communicationStatus === "queued" ? "Queued for demo" : communicationStatus === "approved" ? "Ready to queue locally" : "Provider off",
      detail: sourceBaselineChanged
        ? "Existing local queue rows are preserved, but new queue changes wait for source acknowledgement."
        : communicationStatus === "queued"
          ? "Stored locally in this browser; no provider used."
          : "Local queue only; production scheduling and provider connection remain off.",
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
        { id: "strategy", label: "Strategy & tactics", note: "Pressure sequence and owners", ...(sourceRecheckNavState("strategy") ?? {}) },
        { id: "evidence", label: "Evidence & checks", note: "Claims needing verification", ...(sourceRecheckNavState("evidence") ?? {}) },
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
        { id: "drafts", label: "Drafts", note: "Library, editor, preview", ...(sourceRecheckNavState("drafts") ?? {}) },
        { id: "reviews", label: "Reviews & approvals", note: sourceBaselineChanged ? "Source re-check gate" : "Human approval gate", badge: reviewBadge },
        { id: "outbox", label: "Outbox & schedule", note: sourceBaselineChanged ? "Paused for source update" : "Local queue boundary", badge: queuedCount },
        { id: "responses", label: "Responses & results", note: "Coming soon boundary" },
      ],
    },
  ];

  useEffect(() => {
    if (!sourceBaselineChanged || !source || !currentSourceDocumentSignature || sourceRecheckItemCount > 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState((current) => {
        if (current.workspaceKey !== source.campaignId) return current;
        const hasSourceBoundLocalWork = Boolean(current.localActions.length || current.workingDrafts.length || current.sourceWorkingCopy || current.status !== "draft" || current.queuedAt);
        if (hasSourceBoundLocalWork) return current;
        if (
          current.sourceStateVersion === source.stateVersion &&
          current.sourceLastSequence === source.lastSequence &&
          current.sourceDocumentSignature === currentSourceDocumentSignature
        ) {
          return current;
        }
        return {
          ...current,
          sourceStateVersion: source.stateVersion,
          sourceLastSequence: source.lastSequence,
          sourceDocumentSignature: currentSourceDocumentSignature,
          sourceAcknowledgedAt: source.loadedAt,
          sourceRecheckStateVersion: null,
          sourceRecheckLastSequence: null,
          sourceRecheckDocumentSignature: null,
          sourceRecheckVisitedViews: [],
          activity: [record(`Updated read-only source baseline for ${source.title}; no local actions or drafts needed re-check.`), ...current.activity].slice(0, 7),
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentSourceDocumentSignature, source, sourceBaselineChanged, sourceRecheckItemCount]);

  useEffect(() => {
    if (!sourceBaselineChanged || !source || !currentSourceDocumentSignature || !SOURCE_RECHECK_REQUIRED_VIEWS.includes(state.activeView)) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState((current) => {
        if (current.workspaceKey !== source.campaignId || !SOURCE_RECHECK_REQUIRED_VIEWS.includes(current.activeView)) return current;
        const matchesCurrentSource =
          current.sourceRecheckStateVersion === source.stateVersion &&
          current.sourceRecheckLastSequence === source.lastSequence &&
          current.sourceRecheckDocumentSignature === currentSourceDocumentSignature;
        if (matchesCurrentSource && current.sourceRecheckVisitedViews.includes(current.activeView)) return current;
        return {
          ...current,
          sourceRecheckStateVersion: source.stateVersion,
          sourceRecheckLastSequence: source.lastSequence,
          sourceRecheckDocumentSignature: currentSourceDocumentSignature,
          sourceRecheckVisitedViews: Array.from(new Set([...(matchesCurrentSource ? current.sourceRecheckVisitedViews : []), current.activeView])),
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentSourceDocumentSignature, source, sourceBaselineChanged, state.activeView]);

  const setView = (activeView: ViewId) => {
    setState((current) => ({
      ...current,
      activeView,
      sourceRecheckStateVersion:
        sourceBaselineChanged && source && SOURCE_RECHECK_REQUIRED_VIEWS.includes(activeView) ? source.stateVersion : current.sourceRecheckStateVersion,
      sourceRecheckLastSequence:
        sourceBaselineChanged && source && SOURCE_RECHECK_REQUIRED_VIEWS.includes(activeView) ? source.lastSequence : current.sourceRecheckLastSequence,
      sourceRecheckDocumentSignature:
        sourceBaselineChanged && source && SOURCE_RECHECK_REQUIRED_VIEWS.includes(activeView) ? currentSourceDocumentSignature : current.sourceRecheckDocumentSignature,
      sourceRecheckVisitedViews:
        sourceBaselineChanged && source && SOURCE_RECHECK_REQUIRED_VIEWS.includes(activeView)
          ? Array.from(
              new Set([
                ...(current.sourceRecheckStateVersion === source.stateVersion && current.sourceRecheckLastSequence === source.lastSequence && current.sourceRecheckDocumentSignature === currentSourceDocumentSignature
                  ? current.sourceRecheckVisitedViews
                  : []),
                activeView,
              ]),
            )
          : current.sourceRecheckVisitedViews,
    }));
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
      if (!existing && sourceBaselineChanged) return current;
      const sourceWorkingCopy: SourceWorkingCopy = existing?.sourceWorkingCopy ?? {
        id: resource.id,
        campaignId: source.campaignId,
        title: resource.title,
        channel: resource.channel,
        sourceDocument: resource.sourceDocument,
        sourceDocumentKey: resource.sourceDocumentKey,
        createdAt: new Date().toISOString(),
        warnings: resource.warnings,
        provenance: `Source campaign ${source.campaignId}; copied from ${resource.sourceDocument} into a browser-local editable copy; this does not change the public source document.`,
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
    if (sourceBaselineChanged) return;
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
    if (!canEditReviewerNoteWithCurrentSource) return;
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
    if (!canSelectAudienceWithCurrentSource) return;
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
    if (!canRequestReviewWithCurrentSource) return;
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
    if (!canApproveCommunication) return;
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
    if (!canQueueCommunication) return;
    setState((current) => {
      const queuedAt = new Date().toISOString();
      return {
        ...current,
        status: current.activeWorkingDraftId ? current.status : "queued",
        activeView: "outbox",
        queuedAt: current.activeWorkingDraftId ? current.queuedAt : queuedAt,
        workingDrafts: current.activeWorkingDraftId
          ? current.workingDrafts.map((draft) => (draft.id === current.activeWorkingDraftId ? { ...draft, status: "queued", queuedAt, updatedAt: queuedAt } : draft))
          : current.workingDrafts,
        activity: [record("Placed approved draft into the local demo queue. No provider connection used."), ...current.activity].slice(0, 7),
      };
    });
  };

  const createLocalAction = (action: LocalAction) => {
    if (sourceBaselineChanged) return;
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
    if (sourceBaselineChanged) return;
    setState((current) => ({
      ...current,
      localActions: current.localActions.map((action) => (action.id === id ? { ...action, status: actionStatus } : action)),
      activity: [record(`Updated action status: ${current.localActions.find((action) => action.id === id)?.title ?? "Local action"} → ${localActionStatusCopy[actionStatus]}.`), ...current.activity].slice(0, 7),
    }));
  };

  const acknowledgeSourceRefresh = () => {
    if (!source || !currentSourceDocumentSignature || !canAcknowledgeSourceRefresh) return;
    setState((current) => ({
      ...current,
      sourceStateVersion: source.stateVersion,
      sourceLastSequence: source.lastSequence,
      sourceDocumentSignature: currentSourceDocumentSignature,
      sourceAcknowledgedAt: new Date().toISOString(),
      sourceRecheckStateVersion: null,
      sourceRecheckLastSequence: null,
      sourceRecheckDocumentSignature: null,
      sourceRecheckVisitedViews: [],
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
  const resetScopeCopy = source
    ? sourceBaselineChanged && sourceRecheckItemCount
      ? `Reset clears this campaign's ${sourceRecheckItemCount} browser-local item${sourceRecheckItemCount === 1 ? "" : "s"} currently paused for source re-check, then reloads the current read-only source baseline. Public campaign data is unchanged.`
      : "Reset clears only this campaign's browser-local actions, drafts, review notes, local queue intent, and source acknowledgement. Public campaign data is unchanged."
    : "Reset clears only the explicit demo fixture state stored in this browser; it does not affect any real campaign source.";

  const buildOperationsPack = () => {
    const includeTopLevelDraft = state.status !== "draft" || Boolean(state.sourceWorkingCopy);
    const localDrafts = [
      ...(includeTopLevelDraft
        ? [
            {
              id: "seeded-supporter-email",
              title: state.sourceWorkingCopy?.title ?? "Supporter email",
              subject: state.subject,
              status: state.status,
              queuedAt: state.queuedAt,
              source: state.sourceWorkingCopy ? `${state.sourceWorkingCopy.sourceDocument} (${state.sourceWorkingCopy.sourceDocumentKey})` : source ? "Browser-local source workspace draft" : "Demo fixture draft",
              provenance: state.sourceWorkingCopy?.provenance,
              warnings: state.sourceWorkingCopy?.warnings ?? [],
              reviewerNote: state.reviewerNote,
            },
          ]
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
            acknowledgedSourceStateVersion: state.sourceStateVersion,
            acknowledgedSourceLastSequence: state.sourceLastSequence,
            currentSourceDocumentSignature,
            acknowledgedSourceDocumentSignature: state.sourceDocumentSignature,
            sourceAcknowledgedAt: state.sourceAcknowledgedAt,
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
            conflicts: source.evidence.conflicts.slice(0, 8).map((claim) => ({ id: claim.id, text: claim.text, label: claim.label, contradictsClaimIds: claim.contradictsClaimIds ?? [] })),
            terminalGaps: source.evidence.terminalGaps.slice(0, 8).map((gap) => ({ id: gap.id, description: gap.description, agentRunId: gap.agentRunId ?? null, step: gap.step ?? null, at: gap.at })),
            draftNotes: source.evidence.draftNotes.slice(0, 8).map((note) => ({ section: note.section, text: note.text })),
            incompleteDocuments: source.incompleteDocuments.map((doc) => ({ key: doc.key, name: doc.name, status: doc.status, resourceCount: doc.resourceCount })),
          }
        : {
            totals: { unresolvedLoadBearing: 2 },
            nextChecks: ["Verify council order status", "Keep media escalation blocked until checked"],
            conflicts: [],
            terminalGaps: [],
            draftNotes: [],
            incompleteDocuments: [],
          },
      sourceDocuments: source
        ? source.documents.map((doc) => ({
            key: doc.key,
            name: doc.name,
            status: doc.status,
            resourceCount: doc.resourceCount,
            flags: doc.flags,
          }))
        : [],
      sourceResources: sourceResources.map((resource) => ({
        title: resource.title,
        channel: resource.channel,
        sourceDocument: resource.sourceDocument,
        sourceDocumentKey: resource.sourceDocumentKey,
        subject: resource.subject,
        warnings: resource.warnings,
        preview: resource.preview,
      })),
      selectedAudience: {
        name: selected.name,
        ask: selected.ask,
        readiness: selected.readiness,
        caveat: selected.caveat,
      },
      sourceChangeReview: source
        ? {
            baselineChanged: sourceBaselineChanged,
            previousStateVersion: state.sourceStateVersion,
            currentStateVersion: source.stateVersion,
            previousLastSequence: state.sourceLastSequence,
            currentLastSequence: source.lastSequence,
            previousDocumentSignature: state.sourceDocumentSignature,
            currentDocumentSignature: currentSourceDocumentSignature,
            sourceAcknowledgedAt: state.sourceAcknowledgedAt,
            warning: sourceBaselineChanged
              ? "Read-only source changed after this local workspace started; re-check local actions and drafts before approval or queueing."
              : "Read-only source matches the baseline acknowledged for this local workspace.",
            requiredRecheckViews: SOURCE_RECHECK_REQUIRED_VIEWS.map((view) => sourceRecheckViewLabels[view]),
            checkedRecheckViews: sourceBaselineChanged
              ? SOURCE_RECHECK_REQUIRED_VIEWS.filter((view) => sourceRecheckVisitedViews.has(view)).map((view) => sourceRecheckViewLabels[view])
              : [],
            missingRecheckViews: missingSourceRecheckViews.map((view) => sourceRecheckViewLabels[view]),
            localItemCount: sourceRecheckItemCount,
            localActionsToRecheck: sourceBaselineChanged ? state.localActions.map((action) => ({ title: action.title, source: action.source, status: localActionStatusCopy[action.status] })) : [],
            localDraftsToRecheck: sourceChangedDraftsToRecheck.map((draft) => ({ title: draft.title, status: draft.status, source: draft.source })),
          }
        : null,
      actions: state.localActions.map((action) => ({ ...action, statusLabel: localActionStatusCopy[action.status] })),
      drafts: localDrafts,
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
        `Canonical source origin: ${campaign.sourceOrigin}`,
        `Status: ${campaign.runStatus}`,
        ...(source
          ? [
              `Source baseline: ${campaign.sourceBaselineChanged ? "changed since local acknowledgement" : "matches local acknowledgement"}`,
              `Current source baseline: state v${campaign.sourceStateVersion}, event #${campaign.sourceLastSequence}`,
              `Acknowledged baseline: ${campaign.acknowledgedSourceStateVersion !== null && campaign.acknowledgedSourceLastSequence !== null ? `state v${campaign.acknowledgedSourceStateVersion}, event #${campaign.acknowledgedSourceLastSequence}` : "not recorded"}${campaign.sourceAcknowledgedAt ? `, acknowledged ${formatQueuedTime(campaign.sourceAcknowledgedAt)}` : ", not acknowledged yet"}`,
            ]
          : []),
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
        ...(pack.evidence.conflicts.length
          ? pack.evidence.conflicts.map((claim) => `- Source conflict: ${claim.text}${claim.contradictsClaimIds.length ? ` (contradicts ${claim.contradictsClaimIds.join(", ")})` : ""}`)
          : ["- Source conflicts: none exposed by typed source"]),
        ...(pack.evidence.terminalGaps.length
          ? pack.evidence.terminalGaps.map((gap) => `- Terminal source gap: ${gap.description}${gap.step ? ` (journey step ${gap.step})` : ""}${gap.agentRunId ? ` · run ${gap.agentRunId}` : ""}`)
          : ["- Terminal source gaps: none exposed by typed source"]),
        ...(pack.evidence.draftNotes.length
          ? pack.evidence.draftNotes.map((note) => `- Draft verification note: ${note.section} — ${note.text}`)
          : ["- Draft verification notes: none exposed by typed source"]),
        ...pack.evidence.incompleteDocuments.map((doc) => `- Incomplete source document: ${doc.name} (${doc.status}, ${doc.resourceCount} resources)`),
        "",
        "## Source documents",
        ...(pack.sourceDocuments.length
          ? pack.sourceDocuments.flatMap((doc) => [
              `- ${doc.name} (${doc.key}) — ${doc.status}; ${doc.resourceCount} resource${doc.resourceCount === 1 ? "" : "s"}`,
              ...(doc.flags.length ? doc.flags.map((flag) => `  - Source document flag: ${flag}`) : ["  - Source document flag: none exposed by typed source"]),
            ])
          : ["- Fixture workspace does not expose public source document metadata."]),
        "",
        "## Source pack resources",
        ...(pack.sourceResources.length
          ? pack.sourceResources.flatMap((resource) => [
              `- ${resource.title} (${resource.channel}) — ${resource.sourceDocument} (${resource.sourceDocumentKey})`,
              `  - Subject/source heading: ${resource.subject}`,
              `  - Preview: ${resource.preview}`,
              ...(resource.warnings.length ? resource.warnings.map((warning) => `  - Source warning: ${warning}`) : ["  - Source warning: none exposed by typed pack resource"]),
            ])
          : [source ? "- No ready source pack resources were exposed as editable candidates." : "- Fixture workspace does not expose public source pack resources."]),
        "",
        "## Selected audience",
        `- ${pack.selectedAudience.name}: ${pack.selectedAudience.ask}`,
        `- Readiness: ${pack.selectedAudience.readiness}`,
        `- Caveat: ${pack.selectedAudience.caveat}`,
        "",
        "## Local actions",
        ...(pack.actions.length
          ? pack.actions.flatMap((action) => [
              `- [${action.statusLabel}] ${action.title} — ${action.owner}; ${action.timing}`,
              `  - Source/provenance: ${action.source}`,
              `  - Local boundary: ${action.provenance}`,
              ...(pack.sourceChangeReview?.baselineChanged ? ["  - Source update review: re-check this action against the updated read-only source before approving or queueing local work."] : []),
            ])
          : ["- No browser-local actions yet."]),
        "",
        ...(pack.sourceChangeReview?.baselineChanged
          ? [
              "## Source update review",
              `- ${pack.sourceChangeReview.warning}`,
              `- Previous source baseline: state v${pack.sourceChangeReview.previousStateVersion}, event #${pack.sourceChangeReview.previousLastSequence}`,
              `- Current source baseline: state v${pack.sourceChangeReview.currentStateVersion}, event #${pack.sourceChangeReview.currentLastSequence}`,
              `- Required source re-check views: ${pack.sourceChangeReview.requiredRecheckViews.join(", ")}`,
              `- Source re-check views reopened: ${pack.sourceChangeReview.checkedRecheckViews.length ? pack.sourceChangeReview.checkedRecheckViews.join(", ") : "none yet"}`,
              `- Source re-check views still to inspect: ${pack.sourceChangeReview.missingRecheckViews.length ? pack.sourceChangeReview.missingRecheckViews.join(", ") : "none"}`,
              `- Local items requiring re-check: ${pack.sourceChangeReview.localItemCount}`,
              ...(pack.sourceChangeReview.localActionsToRecheck.length
                ? pack.sourceChangeReview.localActionsToRecheck.map((action) => `- Re-check action: ${action.title} (${action.status}) — ${action.source}`)
                : ["- No browser-local actions currently require source re-check."]),
              ...(pack.sourceChangeReview.localDraftsToRecheck.length
                ? pack.sourceChangeReview.localDraftsToRecheck.map((draft) => `- Re-check draft: ${draft.title} (${draft.status}) — ${draft.source}`)
                : ["- No browser-local drafts currently require source re-check."]),
              "",
            ]
          : []),
        "## Drafts & local outbox",
        ...(pack.drafts.length
          ? pack.drafts.flatMap((draft) => [
              `- [${draft.status}] ${draft.title}: ${draft.subject}${draft.queuedAt ? ` · queued locally ${formatQueuedTime(draft.queuedAt)}` : ""}`,
              `  - Source/provenance: ${draft.source}`,
              ...(draft.provenance ? [`  - Source boundary: ${draft.provenance}`] : []),
              ...(draft.warnings?.length ? draft.warnings.map((warning) => `  - Source warning: ${warning}`) : []),
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
              const badgeClass = active
                ? "bg-background text-foreground"
                : item.badgeTone === "source"
                  ? ink
                    ? "bg-ops-coral text-ops-ink"
                    : "bg-ops-coral/30 text-foreground"
                  : item.badgeTone === "checked"
                    ? ink
                      ? "bg-ops-mint text-ops-ink"
                      : "bg-ops-mint/45 text-foreground"
                    : ink
                      ? "bg-ops-coral text-ops-ink"
                      : "bg-tint-yellow text-foreground";
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
                  aria-label={`${item.label}: ${active ? "Current view" : "Open view"}, ${item.note}${item.badge ? `, ${item.badgeLabel ?? `${item.badge} item${item.badge === "1" ? "" : "s"}`}` : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {item.label}
                    {item.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${badgeClass}`}>
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

  const renderSourceRecheckProgress = (ariaLabel: string) =>
    sourceBaselineChanged ? (
      <div className="mt-3 rounded-[var(--r-lg)] border border-ops-ink/15 bg-background/65 p-3 text-xs text-ops-ink/75" aria-label={ariaLabel}>
        <p className="font-semibold uppercase tracking-[0.1em] text-ops-ink/70">Source re-check progress</p>
        <p className="mt-1">
          Checked {sourceRecheckCheckedCount}/{SOURCE_RECHECK_REQUIRED_VIEWS.length} required source views for the current baseline.
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-3">
          {SOURCE_RECHECK_REQUIRED_VIEWS.map((view) => {
            const visited = sourceRecheckVisitedViews.has(view);
            return (
              <li key={view} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${visited ? "bg-ops-mint text-ops-ink" : "bg-ops-coral text-ops-ink"}`}>
                  {visited ? "Checked" : "Needed"}
                </span>
                <span>{sourceRecheckViewLabels[view]}</span>
              </li>
            );
          })}
        </ul>
        {missingSourceRecheckViews.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-medium">Reopen next:</span>
            {missingSourceRecheckViews.map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setView(view)}
                className="rounded-full border border-ops-ink/20 bg-background/70 px-2.5 py-1 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Re-check {sourceRecheckViewLabels[view]}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2">All required views have been reopened; return to Overview to acknowledge this source baseline.</p>
        )}
      </div>
    ) : null;

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
        {sourceBaselineChanged ? (
          <div className="mt-4 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status" aria-label="Action plan source update pause">
            <p className="font-medium">Action statuses need source re-check.</p>
            <p className="mt-1">
              The read-only campaign source changed after these browser-local actions were created. Keep the actions visible, then re-check their evidence and tactic provenance before approval or local queueing resumes.
            </p>
            {renderSourceRecheckProgress("Action plan source re-check progress")}
          </div>
        ) : null}
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
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={action.create}
                disabled={action.disabled || !canCreateSourceDerivedWork}
                aria-describedby={!canCreateSourceDerivedWork ? "operations-action-source-pause" : undefined}
                title={!canCreateSourceDerivedWork ? "Acknowledge the updated read-only source before creating new source-derived local actions." : undefined}
              >
                {action.disabled ? "Already in action plan" : !canCreateSourceDerivedWork ? "Source re-check required" : "Create local action"}
              </Button>
            </div>
          ))}
        </div>
        {!canCreateSourceDerivedWork ? (
          <p id="operations-action-source-pause" className="mt-3 rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-2 text-xs text-ops-ink">
            Creating new source-derived actions is paused until the updated read-only source is acknowledged, so new local work starts from the current campaign material.
          </p>
        ) : null}

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
                {sourceBaselineChanged ? (
                  <p className="mt-2 rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/35 px-2 py-1 text-xs text-ops-ink">
                    Source re-check required before this local action informs approval or queueing.
                  </p>
                ) : null}
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
                  disabled={sourceBaselineChanged}
                  title={sourceBaselineChanged ? "Acknowledge the updated read-only source before changing this local action status." : undefined}
                  className="h-10 w-full rounded-full border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
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
        {sourceBaselineChanged ? (
          <div id="operations-audience-source-pause" className="mt-4 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 px-4 py-3 text-sm text-ops-ink" role="status" aria-label="Audience source update pause">
            <p>Audience selection is paused until the updated read-only source is acknowledged, so local drafts cannot be retargeted against stale campaign material.</p>
            {renderSourceRecheckProgress("Audience source re-check progress")}
          </div>
        ) : null}
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
              disabled={!canSelectAudienceWithCurrentSource}
              aria-describedby={!canSelectAudienceWithCurrentSource ? "operations-audience-source-pause" : undefined}
              title={!canSelectAudienceWithCurrentSource ? "Acknowledge the updated read-only source before changing the local audience intent." : undefined}
              className={`w-full rounded-[var(--r-2xl)] border p-4 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-ink focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-65 ${
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
                    {group.resources.map((resource) => {
                      const existingWorkingCopy = state.workingDrafts.some((draft) => draft.id === resource.id);
                      const sourceCopyPaused = sourceBaselineChanged && !existingWorkingCopy;
                      return (
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
                            disabled={sourceCopyPaused}
                            aria-describedby={sourceCopyPaused ? "operations-source-copy-pause" : undefined}
                            title={sourceCopyPaused ? "Acknowledge the updated read-only source before creating a new editable working copy." : undefined}
                            className="mt-3 rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-yellow disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                          >
                            {existingWorkingCopy ? "Open working copy" : sourceCopyPaused ? "Acknowledge source update" : "Use in editable draft"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {sourceBaselineChanged ? (
              <p id="operations-source-copy-pause" className="mt-3 rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-2 text-xs text-ops-ink">
                New editable copies from source resources are paused until the updated source is acknowledged; existing working copies stay selectable for review.
              </p>
            ) : null}
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
        {sourceBaselineChanged && activeDraftEditable ? (
          <div id="operations-draft-edit-source-pause" className="mt-4 rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status">
            <p>Editing local draft copy is paused until the updated read-only source is acknowledged, so re-checking cannot accidentally rewrite a draft against stale campaign material.</p>
            {renderSourceRecheckProgress("Draft source re-check progress")}
          </div>
        ) : null}
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
                disabled={!canEditCommunicationCopy}
                aria-describedby={sourceBaselineChanged ? "operations-draft-edit-source-pause" : undefined}
                title={sourceBaselineChanged ? "Acknowledge the updated read-only source before editing this local draft copy." : undefined}
                className="h-auto rounded-full border-[1.5px] px-4 py-2.5 text-base disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operations-body">Message</Label>
              <Textarea
                id="operations-body"
                value={communicationBody}
                onChange={(event) => updateDraft({ body: event.target.value })}
                rows={13}
                disabled={!canEditCommunicationCopy}
                aria-describedby={sourceBaselineChanged ? "operations-draft-edit-source-pause" : undefined}
                title={sourceBaselineChanged ? "Acknowledge the updated read-only source before editing this local draft copy." : undefined}
                className="min-h-[22rem] rounded-[var(--r-2xl)] border-[1.5px] p-4 text-base leading-relaxed disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
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
          <Button
            type="button"
            size="lg"
            onClick={requestReview}
            disabled={!activeDraftEditable || !canRequestReviewWithCurrentSource || communicationStatus === "review" || communicationStatus === "approved" || communicationStatus === "queued"}
            aria-describedby={sourceBaselineChanged ? "operations-draft-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before marking this local draft ready for review." : undefined}
          >
            Mark ready for review
          </Button>
          {sourceBaselineChanged ? (
            <p id="operations-draft-source-pause" className="basis-full rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-2 text-xs text-ops-ink">
              Review requests are paused until the updated source is acknowledged, so local copy cannot move forward against stale campaign material.
            </p>
          ) : null}
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
            {
              label: "Evidence checks still visible",
              ok: true,
              detail: source
                ? `${source.evidence.totals.unresolvedLoadBearing} unresolved load-bearing source fact${source.evidence.totals.unresolvedLoadBearing === 1 ? "" : "s"} remain visible before approval; next check: ${shortText(source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "Review unresolved source evidence.", 120)}`
                : "Council timing, legal-order wording, and consent remain called out before any real provider use.",
            },
            {
              label: "Read-only source baseline current",
              ok: !sourceBaselineChanged,
              detail: sourceBaselineChanged
                ? "The public source changed after this local workspace started. Acknowledge the updated source on Overview after re-checking local actions and drafts before approval or queueing."
                : source
                  ? "Local approvals are checking against the latest acknowledged read-only source baseline."
                  : "The fixture source is static for this browser demo.",
            },
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
        {sourceBaselineChanged ? (
          <div id="operations-review-source-pause" className="mt-5 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status" aria-label="Review source update pause">
            <p>Approval and local queue controls stay locked until the updated read-only source is acknowledged after re-checking this local work.</p>
            {renderSourceRecheckProgress("Review source re-check progress")}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button
            type="button"
            size="lg"
            onClick={requestReview}
            disabled={!canRequestReviewWithCurrentSource || communicationStatus === "review" || communicationStatus === "approved" || communicationStatus === "queued"}
            aria-describedby={sourceBaselineChanged ? "operations-review-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before marking this local draft ready for review." : undefined}
          >
            Mark ready for review
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={approve}
            disabled={!canApproveCommunication}
            aria-describedby={sourceBaselineChanged ? "operations-review-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before recording human approval." : undefined}
          >
            Approve as human reviewer
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            onClick={queue}
            disabled={!canQueueCommunication}
            aria-describedby={sourceBaselineChanged ? "operations-review-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before changing the local queue." : undefined}
          >
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
            disabled={!canEditReviewerNoteWithCurrentSource}
            aria-describedby={sourceBaselineChanged ? "operations-review-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before changing this local reviewer note." : undefined}
            placeholder="Record the human check, evidence caveat, or consent question that should travel with this local copy."
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {sourceBaselineChanged
              ? "Reviewer notes stay preserved but paused until the updated source is acknowledged, so review metadata cannot change against stale campaign material."
              : "Saved only in this browser-local workspace and included in client-side exports; it does not write back to the campaign source."}
          </p>
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
        {sourceBaselineChanged ? (
          <div className="mt-4 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status" aria-label="Outbox source update pause">
            <p className="font-medium">Local queue changes are paused for source re-check.</p>
            <p className="mt-1">
              Existing browser-local queue rows stay visible, but approval and queue changes stay locked until the updated read-only source is acknowledged on Overview.
            </p>
            {renderSourceRecheckProgress("Outbox source re-check progress")}
          </div>
        ) : null}
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
              ...(hasRecordedLocalQueue(state.status, state.queuedAt)
                ? [{ id: "seeded-supporter-email", subject: state.subject, sourceDocument: state.sourceWorkingCopy?.sourceDocument, queuedAt: state.queuedAt, sourceCopy: state.sourceWorkingCopy }]
                : []),
              ...state.workingDrafts.filter((draft) => hasRecordedLocalQueue(draft.status, draft.queuedAt)).map((draft) => ({ id: draft.id, subject: draft.subject, sourceDocument: draft.sourceWorkingCopy.sourceDocument, queuedAt: draft.queuedAt, sourceCopy: draft.sourceWorkingCopy })),
            ].map((item) => (
              <div key={item.id} className="grid gap-3 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr]">
                <div>
                  <span className="md:hidden font-medium">Communication: </span>{item.subject}
                  {item.sourceDocument ? <p className="mt-1 text-xs text-muted-foreground">Local copy from {item.sourceDocument}</p> : null}
                  {item.sourceCopy ? (
                    <div className="mt-2 rounded-[var(--r-lg)] border border-ops-line bg-ops-yellow/45 p-2 text-xs text-muted-foreground" aria-label="Queued source boundary">
                      <p><span className="font-medium text-foreground">Source boundary:</span> {item.sourceCopy.provenance}</p>
                      {item.sourceCopy.warnings.length ? (
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {item.sourceCopy.warnings.slice(0, 2).map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : source ? (
                    <p className="mt-2 rounded-[var(--r-lg)] border border-ops-line bg-ops-yellow/45 p-2 text-xs text-muted-foreground">
                      Source boundary: browser-local source workspace draft; keep {shortText(source.nextGate ?? source.evidence.nextChecks[0]?.description ?? "the next source check", 96)} visible before any provider setup.
                    </p>
                  ) : null}
                </div>
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
            onChange={(event) => {
              if (!canChangeLocalQueueSchedule) return;
              setState((current) => ({ ...current, scheduleIntent: event.target.value as DemoState["scheduleIntent"] }));
            }}
            disabled={!canChangeLocalQueueSchedule}
            aria-describedby={sourceBaselineChanged ? "operations-local-schedule-source-pause" : undefined}
            title={sourceBaselineChanged ? "Acknowledge the updated read-only source before changing local schedule intent." : undefined}
            className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="after_approval">Hold after approval</option>
            <option value="tomorrow_morning">{source ? "Next campaign review window" : "Next school-run morning"}</option>
            <option value="after_next_check">{source ? "After next source check" : "School-run reminder window"}</option>
          </select>
          <p className="text-sm text-muted-foreground">{scheduleCopy[state.scheduleIntent]}</p>
          {sourceBaselineChanged ? (
            <p id="operations-local-schedule-source-pause" className="rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-2 text-xs text-ops-ink">
              Local schedule intent is paused until the updated read-only source is acknowledged, so queued work cannot be retimed against stale campaign material.
            </p>
          ) : null}
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
          {sourceBaselineChanged ? (
            <div className="mt-3 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/50 p-3 text-sm text-ops-ink" role="status" aria-label="Export source update boundary">
              <p className="font-medium">Exports include this source-update warning.</p>
              <p className="mt-1">
                The pack remains available for handover, but it marks the read-only source baseline as changed and lists required source views before local approval or queue work resumes.
              </p>
              {renderSourceRecheckProgress("Export source re-check progress")}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => exportOperationsPack("md")}>Download Markdown</Button>
            <Button type="button" variant="outline" onClick={() => exportOperationsPack("json")}>Download JSON</Button>
          </div>
        </div>
        <div className="mt-5 rounded-[var(--r-xl)] border border-border bg-background/70 p-3" aria-label="Reset local workspace scope">
          <p className="text-sm text-muted-foreground">{resetScopeCopy}</p>
          <Button type="button" variant="ghost" className="mt-3" onClick={reset}>
            {resetLabel}
          </Button>
        </div>
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
              <p className="mt-1 text-xs text-muted-foreground">
                Local approval baseline: {state.sourceAcknowledgedAt ? `acknowledged ${formatQueuedTime(state.sourceAcknowledgedAt)}` : "not acknowledged yet"}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground" aria-label="Source document baseline state">
                Source document baseline: {sourceBaselineChanged ? "changed since local acknowledgement" : "matches local acknowledgement"}.
              </p>
              {sourceBaselineChanged ? (
                <div className="mt-4 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status">
                  <p className="font-medium">Read-only source has changed since this local workspace started.</p>
                  <p className="mt-1">Your browser-local actions and drafts were preserved. Re-check Evidence, Strategy, and Drafts before approving or queueing local work.</p>
                  <div className="mt-3 rounded-[var(--r-lg)] border border-ops-ink/15 bg-background/65 p-3" aria-label="Local work requiring source re-check">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ops-ink/70">
                      {sourceChangedActionsToRecheck.length + sourceChangedDraftsToRecheck.length} local item{sourceChangedActionsToRecheck.length + sourceChangedDraftsToRecheck.length === 1 ? "" : "s"} {sourceChangedActionsToRecheck.length + sourceChangedDraftsToRecheck.length === 1 ? "needs" : "need"} source re-check
                    </p>
                    {sourceChangedActionsToRecheck.length || sourceChangedDraftsToRecheck.length ? (
                      <ul className="mt-2 space-y-1 text-xs text-ops-ink/75">
                        {sourceChangedActionsToRecheck.slice(0, 3).map((action) => (
                          <li key={`source-recheck-action-${action.id}`}>
                            Action: {action.title} · {localActionStatusCopy[action.status]} · {action.source}
                          </li>
                        ))}
                        {sourceChangedDraftsToRecheck.slice(0, 3).map((draft) => (
                          <li key={`source-recheck-draft-${draft.id}`}>
                            Draft: {draft.title} · {draft.status} · {draft.source}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-ops-ink/70">No browser-local action or draft has been created yet; inspect the updated source before starting new work.</p>
                    )}
                  </div>
                  <div className="mt-3 rounded-[var(--r-lg)] border border-ops-ink/15 bg-background/65 p-3 text-xs text-ops-ink/75" aria-label="Source re-check acknowledgement checklist">
                    <p className="font-semibold uppercase tracking-[0.1em] text-ops-ink/70">Acknowledge after re-checking</p>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-3">
                      {SOURCE_RECHECK_REQUIRED_VIEWS.map((view) => {
                        const visited = sourceRecheckVisitedViews.has(view);
                        return (
                          <li key={view} className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${visited ? "bg-ops-mint text-ops-ink" : "bg-ops-coral text-ops-ink"}`}>
                              {visited ? "Checked" : "Needed"}
                            </span>
                            <span>{sourceRecheckViewLabels[view]}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {missingSourceRecheckViews.length ? (
                      <>
                        <p className="mt-2">Still inspect {missingSourceRecheckViews.map((view) => sourceRecheckViewLabels[view]).join(", ")} before acknowledging the new source baseline.</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Overview source re-check shortcuts">
                          <span className="font-medium">Reopen from Overview:</span>
                          {missingSourceRecheckViews.map((view) => (
                            <button
                              key={view}
                              type="button"
                              onClick={() => setView(view)}
                              className="rounded-full border border-ops-ink/20 bg-background/70 px-2.5 py-1 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              Re-check {sourceRecheckViewLabels[view]}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="mt-2">Required source views have been reopened in this browser; acknowledgement can now unlock local approval and queue controls.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={acknowledgeSourceRefresh}
                    disabled={!canAcknowledgeSourceRefresh}
                    title={!canAcknowledgeSourceRefresh ? `Reopen ${missingSourceRecheckViews.map((view) => sourceRecheckViewLabels[view]).join(", ")} before acknowledging this source update.` : undefined}
                    className="mt-3 rounded-full border border-ops-ink/20 bg-background/70 px-3 py-1.5 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background/70"
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
                {stakeholder.ask ? <p className="mt-2 text-sm text-ops-ink/72"><span className="font-medium">Source ask:</span> {stakeholder.ask}</p> : null}
                {stakeholder.approach ? <p className="mt-2 text-xs text-ops-ink/65"><span className="font-medium">Approach:</span> {stakeholder.approach}</p> : null}
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
        {sourceBaselineChanged && (section.title === "Evidence & checks" || section.title === "Strategy & tactics") ? (
          <div className="mt-5 rounded-[var(--r-xl)] border border-ops-coral/70 bg-ops-coral/35 p-3 text-sm text-ops-ink" aria-label={`${section.title} source update pause`}>
            <p className="font-medium">This source view is part of the required re-check.</p>
            <p className="mt-1 text-ops-ink/75">
              Review the refreshed {section.title.toLowerCase()} source material before returning to Overview to acknowledge the update and unlock local approval or queue changes.
            </p>
            {renderSourceRecheckProgress(`${section.title} source re-check progress`)}
          </div>
        ) : null}
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => createSourceCheckAction(check, index)}
                      disabled={actionExists || !canCreateSourceDerivedWork}
                      aria-describedby={!canCreateSourceDerivedWork ? "operations-section-source-action-pause" : undefined}
                      title={!canCreateSourceDerivedWork ? "Acknowledge the updated read-only source before creating new source-derived local actions." : undefined}
                    >
                      {actionExists ? "Action created" : !canCreateSourceDerivedWork ? "Source re-check required" : "Create action"}
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
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3"
                      onClick={() => createIncompleteDocumentAction(doc)}
                      disabled={actionExists || !canCreateSourceDerivedWork}
                      aria-describedby={!canCreateSourceDerivedWork ? "operations-section-source-action-pause" : undefined}
                      title={!canCreateSourceDerivedWork ? "Acknowledge the updated read-only source before creating new source-derived local actions." : undefined}
                    >
                      {actionExists ? "Follow-up created" : !canCreateSourceDerivedWork ? "Source re-check required" : "Create follow-up"}
                    </Button>
                  </div>
                );
              }) : (
                <div className="px-4 py-5 text-sm text-muted-foreground">All compiled documents exposed by this source route are ready.</div>
              )}
            </div>
          </div>
        ) : null}
        {source && section.title === "Evidence & checks" ? (
          <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-ops-line bg-background" aria-label="Source claim verification notes">
            <div className="border-b border-border bg-ops-coral/45 px-4 py-3">
              <p className="text-sm font-semibold">Claim warnings and verification notes</p>
              <p className="mt-1 text-xs text-muted-foreground">These are read from the typed evidence bundle and source documents; they are planning warnings, not local results.</p>
            </div>
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
              <div className="border-b border-border lg:border-b-0 lg:border-r">
                {source.evidence.groups.length ? source.evidence.groups.slice(0, 3).map((group) => (
                  <div key={group.label} className="border-b border-border px-4 py-4 text-sm last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{group.label}</p>
                      <span className="rounded-full bg-ops-yellow px-2 py-0.5 text-xs text-ops-ink">{group.count} claim{group.count === 1 ? "" : "s"}</span>
                    </div>
                    <ul className="mt-3 space-y-2 text-muted-foreground">
                      {group.claims.slice(0, 3).map((claim) => (
                        <li key={claim.id} className="border-l-2 border-ops-ink/20 pl-3">
                          <span className="text-foreground">{claim.text}</span>
                          <span className="mt-1 block text-xs">
                            {claim.loadBearing ? "Key fact" : "Supporting fact"} · confidence {claim.confidence || "not stated"} · {claim.sourceCount || 0} source{claim.sourceCount === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )) : (
                  <div className="px-4 py-5 text-sm text-muted-foreground">No individual source claim groups were exposed by the typed evidence bundle.</div>
                )}
              </div>
              <div>
                {source.evidence.conflicts.length ? (
                  <div className="border-b border-border px-4 py-4 text-sm">
                    <p className="font-medium">Source conflicts</p>
                    <ul className="mt-2 space-y-2 text-muted-foreground">
                      {source.evidence.conflicts.slice(0, 3).map((claim) => <li key={claim.id}>{claim.text}</li>)}
                    </ul>
                  </div>
                ) : null}
                {source.evidence.draftNotes.length ? (
                  <div className="border-b border-border px-4 py-4 text-sm">
                    <p className="font-medium">Draft verification notes</p>
                    <ul className="mt-2 space-y-2 text-muted-foreground">
                      {source.evidence.draftNotes.slice(0, 4).map((note) => <li key={`${note.section}-${note.text}`}>{note.section}: {note.text}</li>)}
                    </ul>
                  </div>
                ) : null}
                {source.evidence.terminalGaps.length ? (
                  <div className="border-b border-border px-4 py-4 text-sm">
                    <p className="font-medium">Terminal gaps</p>
                    <ul className="mt-2 space-y-2 text-muted-foreground">
                      {source.evidence.terminalGaps.slice(0, 4).map((gap, index) => <li key={gap.id || index}>{gap.description}</li>)}
                    </ul>
                  </div>
                ) : null}
                {!source.evidence.conflicts.length && !source.evidence.draftNotes.length && !source.evidence.terminalGaps.length ? (
                  <div className="px-4 py-5 text-sm text-muted-foreground">No conflicts, draft verification notes, or terminal gaps were exposed by the source bundle.</div>
                ) : null}
              </div>
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => createSourceTacticAction(tactic)}
                    disabled={actionExists || !canCreateSourceDerivedWork}
                    aria-describedby={!canCreateSourceDerivedWork ? "operations-section-source-action-pause" : undefined}
                    title={!canCreateSourceDerivedWork ? "Acknowledge the updated read-only source before creating new source-derived local actions." : undefined}
                  >
                    {actionExists ? "Action created" : !canCreateSourceDerivedWork ? "Source re-check required" : "Create local action"}
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
            <Button
              type="button"
              onClick={createAppealStatusAction}
              disabled={hasAppealAction || !canCreateSourceDerivedWork}
              aria-describedby={!canCreateSourceDerivedWork ? "operations-section-source-action-pause" : undefined}
              title={!canCreateSourceDerivedWork ? "Acknowledge the updated read-only source before creating new source-derived local actions." : undefined}
            >
              {hasAppealAction ? (source ? "Source-check action created" : "Appeal-status action created") : !canCreateSourceDerivedWork ? "Source re-check required" : source ? sourcePrimaryCheckButton(source) : "Create appeal-status action"}
            </Button>
          ) : null}
          {!canCreateSourceDerivedWork ? (
            <p id="operations-section-source-action-pause" className="rounded-[var(--r-lg)] border border-ops-coral bg-ops-coral/55 p-2 text-xs text-ops-ink">
              New source-derived local work waits until the refreshed source baseline is acknowledged.
            </p>
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
        {sourceBaselineChanged ? (
          <div className="mt-5 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/55 p-3 text-sm text-ops-ink" role="status" aria-label="Contacts source update boundary">
            <p className="font-medium">Contact planning stays read-only while the source is re-checked.</p>
            <p className="mt-1">
              No imported contacts are created here, but audience clues and named stakeholders should still be reviewed against the refreshed source before local copy or queue decisions resume.
            </p>
            {renderSourceRecheckProgress("Contacts source re-check progress")}
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
          <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background" aria-label="Source audience and stakeholder contact boundary">
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
            {sourceStakeholders.length ? (
              <div className="border-t border-border bg-ops-blue/35 px-4 py-4">
                <p className="text-sm font-semibold">Named stakeholders from the source power map</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These names help plan who might need research or consent checks; they are not imported contacts, provider recipients, or approval to approach anyone.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {sourceStakeholders.slice(0, 4).map((stakeholder) => (
                    <div key={`${stakeholder.group}-${stakeholder.name}`} className="rounded-[var(--r-xl)] border border-border bg-background/75 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{stakeholder.name}</p>
                        <span className="rounded-full bg-ops-yellow px-2 py-0.5 text-xs text-ops-ink">{stakeholder.group}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{stakeholder.power}</p>
                      {stakeholder.ask ? <p className="mt-1 text-xs text-muted-foreground">Source ask: {stakeholder.ask}</p> : null}
                      {stakeholder.approach ? <p className="mt-1 text-xs text-muted-foreground">Approach: {stakeholder.approach}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">Boundary: source mention only; no contact record or consent state exists.</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
        {sourceBaselineChanged ? (
          <div className="mt-5 rounded-[var(--r-xl)] border border-ops-coral bg-ops-coral/50 p-3 text-sm text-ops-ink" role="status" aria-label="Responses source update boundary">
            <p className="font-medium">Response planning stays empty while the source is re-checked.</p>
            <p className="mt-1 text-ops-ink/75">
              No reply stream, list-health result, or outcome claim exists here; if the source changes, the workspace keeps this future-results area paused until the required source views are reopened and acknowledged.
            </p>
            {renderSourceRecheckProgress("Responses source re-check progress")}
          </div>
        ) : null}
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

  if (renderedSourceState.status !== "fixture" && renderedSourceState.status !== "ready") {
    return <SourceStateShell state={renderedSourceState} onRetry={() => setSourceRetryCount((count) => count + 1)} />;
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
            {sourceBaselineChanged ? (
              <span
                className="rounded-full border border-ops-coral/70 bg-ops-coral px-3 py-1 text-xs font-medium text-ops-ink"
                aria-label="Source re-check header status"
                title={missingSourceRecheckViews.length ? `Reopen ${missingSourceRecheckViews.map((view) => sourceRecheckViewLabels[view]).join(", ")} before acknowledging this source update.` : "All required source views have been reopened; return to Overview to acknowledge this source update."}
              >
                Source re-check pending · {sourceRecheckCheckedCount}/{SOURCE_RECHECK_REQUIRED_VIEWS.length} views checked
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
                  const failureStep = item.status === "error" ? sourceFailureStepLabel(item.sourceStep) : null;
                  const retryMessage = item.status === "error" ? retryAfterMessage(item.retryAfter) : null;
                  const failureDetails = item.status === "error"
                    ? [
                        item.message,
                        item.runStatus ? `source run status: ${statusPhrase(item.runStatus)}` : null,
                        failureStep ? `failed source step: ${failureStep}` : null,
                        upstreamDiagnosticPhrase(item.sourceFailureKind, item.sourceHttpStatus, item.sourceElapsedMs, item.sourceRequestId, item.sourcePath, item.sourceMatchedPath, item.sourceCacheStatus, item.sourceCacheControl, item.sourceAgeSeconds, item.sourceResponseDate, item.sourceContentLength, item.sourceContentLengthMalformed, item.sourceContentRange, item.sourceServer, item.sourceContentEncoding, item.sourceContentCharset, item.sourceBodyEmpty, item.sourceBodyTruncated, item.sourceContentType, item.sourceContentTypeMissing, item.sourceTextEncoding),
                        item.sourceOrigin ? `checked source: ${item.sourceOrigin}` : null,
                        item.checkedAt ? `last attempt ${formatQueuedTime(item.checkedAt)}` : null,
                        retryMessage,
                      ].filter(Boolean).join(" · ")
                    : null;
                  const label = active
                    ? `Current: ${compactCampaignLabel(source.title)}`
                    : item.status === "ready"
                      ? compactCampaignLabel(item.source.title)
                      : item.status === "loading"
                        ? "Loading campaign"
                        : isSourceRunNotReadyStatus(item.runStatus)
                          ? `Source ${statusPhrase(item.runStatus).toLowerCase()}`
                          : "Source issue";
                  const title = item.status === "ready" ? `${item.source.title}${item.source.place ? ` · ${item.source.place}` : ""}` : item.status === "error" ? failureDetails ?? item.message : "Loading public campaign name";
                  return (
                    <Link
                      key={item.campaign.id}
                      href={`/operations?campaignId=${item.campaign.id}&view=${state.activeView}`}
                      className={`rounded-full px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "bg-ops-ink text-white" : "border border-ops-line bg-background/70 text-muted-foreground hover:bg-secondary"}`}
                      aria-current={active ? "page" : undefined}
                      aria-label={item.status === "error" ? `${label}: ${title}` : undefined}
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
          <div>
            <p>
              {source ? `Source ${source.campaignId} read-only · Local demo storage · Provider/import/schedule write-back not connected.` : "Local demo storage · Email provider not connected · Human approval required before local queueing."}
            </p>
            <p className="mt-1 text-xs">{resetScopeCopy}</p>
          </div>
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
