import type { RunReadModel } from "@/lib/factory/contracts/api";
import { FACTORY_EVENT_TYPES, type FactoryEvent } from "@/lib/factory/contracts/core";
import { CANONICAL_DOCUMENTS, DOCUMENT_STATUSES } from "@/lib/factory/contracts/documents";
import { DOC_SECTIONS, type CompiledDocument, type EvidenceAndNextChecks } from "@/lib/factory/documents";
import { UNRESOLVED_LABELS } from "@/lib/factory/documents/render";
import { JOURNEY_STEPS } from "@/lib/factory/contracts/journey";
import { VERIFICATION_LABELS } from "@/lib/pipeline/labels";

export const OPERATIONS_DEFAULT_SOURCE_ORIGIN = "https://campaign-factory.vercel.app";

export const OPERATIONS_PUBLIC_CAMPAIGNS = [
  { id: "69f257b6-9913-4395-94f7-5c25b4b5fe95", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95`, conferenceHero: true },
  { id: "57678ae0-29fd-4b4b-8a53-5c711cdb21cf", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/57678ae0-29fd-4b4b-8a53-5c711cdb21cf` },
  { id: "6b54225d-afa3-41d1-b053-89741094f153", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/6b54225d-afa3-41d1-b053-89741094f153` },
] as const;

export const OPERATIONS_PUBLIC_CAMPAIGN_IDS = new Set<string>(OPERATIONS_PUBLIC_CAMPAIGNS.map((campaign) => campaign.id));

export function normaliseOperationsSourceOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export type OperationsSourcePayload = {
  sourceOrigin: string;
  run: RunReadModel;
  documents: CompiledDocument[];
  evidence: EvidenceAndNextChecks;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isNonEmptyString(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

const OPERATIONS_DOCUMENT_KEYS = new Set<string>(CANONICAL_DOCUMENTS.map((doc) => doc.key));
const OPERATIONS_DOCUMENT_BY_KEY = new Map<string, (typeof CANONICAL_DOCUMENTS)[number]>(CANONICAL_DOCUMENTS.map((doc) => [doc.key, doc]));
const OPERATIONS_DOCUMENT_STATUSES = new Set<string>(DOCUMENT_STATUSES);
const OPERATIONS_RUN_STATUSES = new Set<string>(["queued", "running", "partial", "completed", "failed", "cancelled"]);
const OPERATIONS_EVENT_TYPES = new Set<string>(FACTORY_EVENT_TYPES);
const OPERATIONS_EVENT_VISIBILITIES = new Set<string>(["public", "internal"]);
const OPERATIONS_SECTION_STATUSES = new Set<string>(["empty", "assembling", "under_review", "accepted", "needs_verification"]);
const OPERATIONS_JOURNEY_SECTION_KEYS = new Set<string>(JOURNEY_STEPS.map((step) => step.key));
const OPERATIONS_VERIFICATION_LABELS = new Set<string>(VERIFICATION_LABELS);
const OPERATIONS_CLAIM_CONFIDENCES = new Set<string>(["high", "medium", "low"]);

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalJourneyStep(value: unknown): value is number | undefined {
  return value === undefined || (isNonNegativeInteger(value) && value >= 1 && value <= 10);
}

function isOptionalDocumentKey(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && OPERATIONS_DOCUMENT_KEYS.has(value));
}

function isOptionalDocumentStatus(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && OPERATIONS_DOCUMENT_STATUSES.has(value));
}

function isOptionalSectionStatus(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && OPERATIONS_SECTION_STATUSES.has(value));
}

function isIsoDateTimeString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isOptionalUniqueNonEmptyStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isUniqueNonEmptyStringArray(value);
}

function isJourneySectionKeyArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !OPERATIONS_JOURNEY_SECTION_KEYS.has(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isOperationsAffectedOutputArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === "string" && (OPERATIONS_JOURNEY_SECTION_KEYS.has(item) || OPERATIONS_DOCUMENT_KEYS.has(item)));
}

function isOperationsAffectedSectionArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item) || (!OPERATIONS_JOURNEY_SECTION_KEYS.has(item) && !OPERATIONS_DOCUMENT_KEYS.has(item))) return false;
    seen.add(item);
  }
  return true;
}

function matchesCanonicalDocumentSections(key: string, isPack: boolean, sectionKeys: string[]) {
  if (isPack) return sectionKeys.length === 0;
  const expected = DOC_SECTIONS[key as keyof typeof DOC_SECTIONS];
  if (!expected || sectionKeys.length === 0) return false;
  let previousIndex = -1;
  for (const sectionKey of sectionKeys) {
    const index = expected.indexOf(sectionKey as never);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function isOperationsFactoryEvent(value: unknown, campaignId: string): value is FactoryEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  return (
    isNonEmptyString(value.eventId) &&
    isPositiveInteger(value.sequence) &&
    value.campaignId === campaignId &&
    isOptionalString(value.batchId) &&
    isOptionalString(value.agentRunId) &&
    isOptionalString(value.parentAgentRunId) &&
    isOptionalJourneyStep(value.journeyStep) &&
    typeof value.type === "string" &&
    OPERATIONS_EVENT_TYPES.has(value.type) &&
    isIsoDateTimeString(value.at) &&
    isOptionalNonNegativeInteger(value.stateVersion) &&
    typeof value.visibility === "string" &&
    OPERATIONS_EVENT_VISIBILITIES.has(value.visibility) &&
    typeof payload.summary === "string" &&
    isOptionalString(payload.verb) &&
    isOptionalString(payload.agentKey) &&
    isOptionalString(payload.agentDisplayName) &&
    isOptionalUniqueNonEmptyStringArray(payload.sourceIds) &&
    isOptionalUniqueNonEmptyStringArray(payload.claimIds) &&
    isOptionalString(payload.proposalId) &&
    isOptionalString(payload.judgementId) &&
    isOptionalString(payload.handoffToAgentRunId) &&
    isOptionalJourneyStep(payload.sectionStep) &&
    isOptionalSectionStatus(payload.sectionStatus) &&
    isOptionalDocumentKey(payload.documentKey) &&
    isOptionalDocumentStatus(payload.documentStatus) &&
    (payload.detail === undefined || isRecord(payload.detail))
  );
}

function hasConsistentOperationsRunEvents(value: RunReadModel) {
  const seenEventIds = new Set<string>();
  const seenSequences = new Set<number>();
  for (const event of value.events) {
    if (seenEventIds.has(event.eventId) || seenSequences.has(event.sequence) || event.sequence > value.lastSequence) return false;
    seenEventIds.add(event.eventId);
    seenSequences.add(event.sequence);
  }
  return true;
}

export function isOperationsRunReadModel(value: unknown, campaignId: string): value is RunReadModel {
  if (!isRecord(value) || value.campaignId !== campaignId) return false;
  if (
    !isOptionalString(value.batchId) ||
    typeof value.status !== "string" ||
    !OPERATIONS_RUN_STATUSES.has(value.status) ||
    !isNonNegativeInteger(value.stateVersion) ||
    !isNonNegativeInteger(value.lastSequence) ||
    !Array.isArray(value.events) ||
    !value.events.every((event) => isOperationsFactoryEvent(event, campaignId))
  ) {
    return false;
  }
  return hasConsistentOperationsRunEvents(value as unknown as RunReadModel);
}

export function isOperationsCompiledDocument(value: unknown): value is CompiledDocument {
  if (!isRecord(value) || typeof value.key !== "string") return false;
  const canonicalDocument = OPERATIONS_DOCUMENT_BY_KEY.get(value.key);
  if (!canonicalDocument) return false;
  const shouldBePack = "ownerAgentKey" in canonicalDocument;
  return (
    value.num === canonicalDocument.num &&
    value.name === canonicalDocument.name &&
    typeof value.status === "string" &&
    OPERATIONS_DOCUMENT_STATUSES.has(value.status) &&
    typeof value.html === "string" &&
    typeof value.plainText === "string" &&
    value.isPack === shouldBePack &&
    isJourneySectionKeyArray(value.sectionKeys) &&
    matchesCanonicalDocumentSections(value.key, value.isPack, value.sectionKeys) &&
    isNonNegativeInteger(value.resourceCount) &&
    isStringArray(value.flags)
  );
}

export function isOperationsCompiledDocumentList(value: unknown): value is CompiledDocument[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const doc of value) {
    if (!isOperationsCompiledDocument(doc) || seen.has(doc.key)) return false;
    seen.add(doc.key);
  }
  return true;
}

function isOperationsEvidenceClaimView(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.text === "string" &&
    typeof value.type === "string" &&
    typeof value.label === "string" &&
    OPERATIONS_VERIFICATION_LABELS.has(value.label) &&
    typeof value.loadBearing === "boolean" &&
    typeof value.confidence === "string" &&
    OPERATIONS_CLAIM_CONFIDENCES.has(value.confidence) &&
    isOptionalString(value.excerpt) &&
    isNonNegativeInteger(value.sourceCount) &&
    isOperationsAffectedOutputArray(value.affectedOutputs) &&
    isOptionalUniqueNonEmptyStringArray(value.contradictsClaimIds)
  );
}

function isOperationsSourceLedgerGroup(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.claims)) return false;
  return (
    typeof value.label === "string" &&
    OPERATIONS_VERIFICATION_LABELS.has(value.label) &&
    isNonNegativeInteger(value.count) &&
    value.count > 0 &&
    value.count === value.claims.length &&
    value.claims.every((claim) => isOperationsEvidenceClaimView(claim) && claim.label === value.label)
  );
}

function hasCanonicalOperationsEvidenceGroups(value: EvidenceAndNextChecks) {
  const labels = Array.from(OPERATIONS_VERIFICATION_LABELS);
  let previousIndex = -1;
  for (const group of value.groups) {
    const index = labels.indexOf(group.label);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function hasConsistentOperationsEvidenceTotals(value: EvidenceAndNextChecks) {
  const seenClaimIds = new Set<string>();
  let groupedClaims = 0;
  let groupedLoadBearing = 0;
  let groupedUnresolvedLoadBearing = 0;

  for (const group of value.groups) {
    groupedClaims += group.count;
    for (const claim of group.claims) {
      if (seenClaimIds.has(claim.id)) return false;
      seenClaimIds.add(claim.id);
      if (!claim.loadBearing) continue;
      groupedLoadBearing += 1;
      if (UNRESOLVED_LABELS.has(claim.label)) groupedUnresolvedLoadBearing += 1;
    }
  }

  if (groupedClaims === 0) return true;

  return (
    groupedClaims === value.totals.claims &&
    groupedLoadBearing === value.totals.loadBearing &&
    groupedUnresolvedLoadBearing === value.totals.unresolvedLoadBearing &&
    groupedLoadBearing - groupedUnresolvedLoadBearing === value.totals.verifiedLoadBearing
  );
}

function isOperationsNextCheck(value: unknown) {
  const claimIds = isRecord(value) ? value.claimIds : undefined;
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.description === "string" &&
    typeof value.reason === "string" &&
    isOptionalUniqueNonEmptyStringArray(claimIds) &&
    isOperationsAffectedSectionArray(value.affectedSections)
  );
}

function isOperationsTerminalGap(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.description === "string" &&
    isOptionalString(value.agentRunId) &&
    isOptionalNonNegativeInteger(value.step) &&
    isIsoDateTimeString(value.at)
  );
}

function isOperationsDraftNote(value: unknown) {
  return isRecord(value) && typeof value.text === "string" && typeof value.section === "string";
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function matchesOperationsEvidenceClaim(left: EvidenceAndNextChecks["groups"][number]["claims"][number], right: EvidenceAndNextChecks["groups"][number]["claims"][number]) {
  return (
    left.id === right.id &&
    left.text === right.text &&
    left.type === right.type &&
    left.label === right.label &&
    left.loadBearing === right.loadBearing &&
    left.confidence === right.confidence &&
    left.excerpt === right.excerpt &&
    left.sourceCount === right.sourceCount &&
    sameStringArray(left.affectedOutputs, right.affectedOutputs) &&
    sameStringArray(left.contradictsClaimIds, right.contradictsClaimIds)
  );
}

function hasConsistentOperationsEvidenceReferences(value: EvidenceAndNextChecks) {
  const claimsById = new Map<string, EvidenceAndNextChecks["groups"][number]["claims"][number]>();
  for (const group of value.groups) {
    for (const claim of group.claims) {
      if (claimsById.has(claim.id)) return false;
      claimsById.set(claim.id, claim);
    }
  }

  if (claimsById.size > 0) {
    for (const claim of claimsById.values()) {
      if (claim.contradictsClaimIds?.some((claimId) => claimId === claim.id || !claimsById.has(claimId))) return false;
    }
  }

  const seenConflictIds = new Set<string>();
  for (const conflict of value.conflicts) {
    const sourceClaim = claimsById.get(conflict.id);
    if (seenConflictIds.has(conflict.id) || !sourceClaim || !matchesOperationsEvidenceClaim(conflict, sourceClaim)) return false;
    if (conflict.label !== "Conflicting evidence" && !conflict.contradictsClaimIds?.length) return false;
    seenConflictIds.add(conflict.id);
  }

  const seenNextCheckIds = new Set<string>();
  for (const check of value.nextChecks) {
    if (seenNextCheckIds.has(check.id)) return false;
    if (claimsById.size > 0 && check.claimIds?.some((claimId) => !claimsById.has(claimId))) return false;
    seenNextCheckIds.add(check.id);
  }

  const seenTerminalGapIds = new Set<string>();
  for (const gap of value.terminalGaps) {
    if (seenTerminalGapIds.has(gap.id)) return false;
    seenTerminalGapIds.add(gap.id);
  }

  return true;
}

export function isOperationsEvidenceAndNextChecks(value: unknown): value is EvidenceAndNextChecks {
  if (!isRecord(value) || !isRecord(value.totals)) return false;
  const totals = value.totals;
  if (
    !isNonNegativeInteger(totals.claims) ||
    !isNonNegativeInteger(totals.loadBearing) ||
    !isNonNegativeInteger(totals.verifiedLoadBearing) ||
    !isNonNegativeInteger(totals.unresolvedLoadBearing)
  ) {
    return false;
  }
  if (totals.verifiedLoadBearing + totals.unresolvedLoadBearing !== totals.loadBearing || totals.loadBearing > totals.claims) {
    return false;
  }

  if (
    !Array.isArray(value.groups) ||
    !value.groups.every(isOperationsSourceLedgerGroup) ||
    !Array.isArray(value.conflicts) ||
    !value.conflicts.every(isOperationsEvidenceClaimView)
  ) {
    return false;
  }

  return (
    Array.isArray(value.nextChecks) &&
    value.nextChecks.every(isOperationsNextCheck) &&
    Array.isArray(value.terminalGaps) &&
    value.terminalGaps.every(isOperationsTerminalGap) &&
    Array.isArray(value.draftNotes) &&
    value.draftNotes.every(isOperationsDraftNote) &&
    hasCanonicalOperationsEvidenceGroups(value as unknown as EvidenceAndNextChecks) &&
    hasConsistentOperationsEvidenceTotals(value as unknown as EvidenceAndNextChecks) &&
    hasConsistentOperationsEvidenceReferences(value as unknown as EvidenceAndNextChecks)
  );
}

export function isOperationsPublicCampaignId(id: string) {
  return OPERATIONS_PUBLIC_CAMPAIGN_IDS.has(id);
}
