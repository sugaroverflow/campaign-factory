import type { RunReadModel } from "@/lib/factory/contracts/api";
import { FACTORY_EVENT_TYPES, type FactoryEvent } from "@/lib/factory/contracts/core";
import { CANONICAL_DOCUMENTS, DOCUMENT_STATUSES } from "@/lib/factory/contracts/documents";
import { DOC_SECTIONS, type CompiledDocument, type EvidenceAndNextChecks } from "@/lib/factory/documents";
import { DOCUMENT_DISCLAIMER } from "@/lib/factory/documents/language";
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
    if (url.username || url.password) return null;
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return null;
    const origin = url.origin.replace(/\/+$/, "");
    return origin === OPERATIONS_DEFAULT_SOURCE_ORIGIN ? origin : null;
  } catch {
    return null;
  }
}

export type OperationsSourcePayload = {
  sourceOrigin: string;
  run: RunReadModel;
  documents: CompiledDocument[];
  evidence: EvidenceAndNextChecks;
  sourceRunUnavailable?: boolean;
};

export function hasSyntheticUnavailableOperationsRunHeader(value: RunReadModel) {
  return value.status === "partial" && value.stateVersion === 0 && value.lastSequence === 0 && value.events.length === 0;
}

export function hasUnavailableOperationsRunHeaderProvenance(value: RunReadModel, sourceRunUnavailable: boolean) {
  return hasSyntheticUnavailableOperationsRunHeader(value) === sourceRunUnavailable;
}

export function isOperationsSourceRunUnavailableMarker(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalNonEmptySourceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() && value === value.normalize("NFC") && normaliseSourceInlineText(value) === value;
}

function normaliseSourcePresentationText(value: string) {
  return decodeOperationsSourceTextEntities(value)
    .normalize("NFC")
    .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function normaliseSourceInlineText(value: string) {
  return normaliseSourcePresentationText(value).replace(/\s+/g, " ");
}

export function normaliseOperationsSourcePresentationText(value: string) {
  return normaliseSourcePresentationText(value);
}

export function normaliseOperationsSourceInlineText(value: string) {
  return normaliseSourceInlineText(value);
}

function sourceTextIncludes(value: string, expected: string) {
  return normaliseSourceInlineText(value).includes(normaliseSourceInlineText(expected));
}

function sourceTextIncludesIgnoreCase(value: string, expected: string) {
  return normaliseSourceInlineText(value).toLowerCase().includes(normaliseSourceInlineText(expected).toLowerCase());
}

const OPERATIONS_SOURCE_HTML_ENTITIES: Record<string, string> = {
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

const SOURCE_ENTITY_BOUNDARY = String.raw`(?=\s|$|[<.,:!?()[\]{}'"’”/\\-])`;
const SOURCE_SPACE_ENTITY_RE = new RegExp(String.raw`&(?:nbsp|ensp|emsp|thinsp|hairsp|numsp|puncsp|mediumspace|nobreak|#160|#xA0)(?:;|${SOURCE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_DECIMAL_ENTITY_RE = new RegExp(String.raw`&#(\d+)(?:;|${SOURCE_ENTITY_BOUNDARY})`, "g");
const SOURCE_HEX_ENTITY_RE = new RegExp(String.raw`&#x([0-9a-f]+)(?:;|${SOURCE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_NAMED_ENTITY_RE = new RegExp(String.raw`&([a-z][a-z0-9]+)(?:;|${SOURCE_ENTITY_BOUNDARY})`, "gi");
const SOURCE_UNKNOWN_ENTITY_RE = new RegExp(String.raw`&[a-z0-9#]+(?:;|${SOURCE_ENTITY_BOUNDARY})`, "gi");

function decodeOperationsSourceTextEntities(value: string) {
  return value
    .replace(SOURCE_SPACE_ENTITY_RE, " ")
    .replace(SOURCE_DECIMAL_ENTITY_RE, (_entity, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : "";
    })
    .replace(SOURCE_HEX_ENTITY_RE, (_entity, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 16);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : "";
    })
    .replace(SOURCE_NAMED_ENTITY_RE, (entity: string, name: string) => {
      const named = OPERATIONS_SOURCE_HTML_ENTITIES[name];
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
    .replace(SOURCE_UNKNOWN_ENTITY_RE, "");
}

function visibleRenderedText(value: string) {
  return normaliseSourcePresentationText(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function hasRenderedText(value: unknown): value is string {
  return isNonEmptyString(value) && visibleRenderedText(value).length > 0;
}

function isOptionalRenderedText(value: unknown): value is string | undefined {
  return value === undefined || hasRenderedText(value);
}

function hasCompiledDocumentDisclaimer(value: Pick<CompiledDocument, "html" | "plainText">) {
  return sourceTextIncludes(value.plainText, DOCUMENT_DISCLAIMER) && sourceTextIncludes(visibleRenderedText(value.html), DOCUMENT_DISCLAIMER);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value > 0;
}

const OPERATIONS_DOCUMENT_KEYS = new Set<string>(CANONICAL_DOCUMENTS.map((doc) => doc.key));
const OPERATIONS_DOCUMENT_BY_KEY = new Map<string, (typeof CANONICAL_DOCUMENTS)[number]>(CANONICAL_DOCUMENTS.map((doc) => [doc.key, doc]));
const OPERATIONS_DOCUMENT_STATUSES = new Set<string>(DOCUMENT_STATUSES);
const OPERATIONS_RUN_STATUSES = new Set<string>(["queued", "running", "partial", "completed", "failed", "cancelled"]);
const OPERATIONS_EVENT_TYPES = new Set<string>(FACTORY_EVENT_TYPES);
const OPERATIONS_EVENT_VISIBILITIES = new Set<string>(["public"]);
const OPERATIONS_SECTION_STATUSES = new Set<string>(["empty", "assembling", "under_review", "accepted", "needs_verification"]);
const OPERATIONS_JOURNEY_SECTION_KEYS = new Set<string>(JOURNEY_STEPS.map((step) => step.key));
const OPERATIONS_VERIFICATION_LABELS = new Set<string>(VERIFICATION_LABELS);
const OPERATIONS_CLAIM_CONFIDENCES = new Set<string>(["high", "medium", "low"]);
const OPERATIONS_DOCUMENT_FLAG_PREFIX_CLAIM = "Unresolved load-bearing claim: ";
const OPERATIONS_DOCUMENT_FLAG_NEEDS_VERIFICATION = "A source section is flagged needs verification.";
const OPERATIONS_DOCUMENT_FLAG_PLACEHOLDERS = "Contains explicit verification placeholders.";
const OPERATIONS_DOCUMENT_NEEDS_VERIFICATION_NOTE = "Some facts in this section couldn't be fully checked in time";
const OPERATIONS_PACK_VERIFICATION_NOTES_HEADING = "Before you send this, check";
const OPERATIONS_DOCUMENT_FLAGS = new Set<string>([
  OPERATIONS_DOCUMENT_FLAG_NEEDS_VERIFICATION,
  OPERATIONS_DOCUMENT_FLAG_PLACEHOLDERS,
]);
const OPERATIONS_CLAIM_TYPES = new Set<string>([
  "authority",
  "process",
  "deadline",
  "officeholder",
  "policy",
  "stakeholder_position",
  "number",
  "context",
  "other",
]);

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalCanonicalNonEmptySourceId(value: unknown): value is string | undefined {
  return value === undefined || isCanonicalNonEmptySourceId(value);
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

function isUniqueCanonicalSourceIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isCanonicalNonEmptySourceId(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isOptionalUniqueCanonicalSourceIdArray(value: unknown): value is string[] | undefined {
  return value === undefined || isUniqueCanonicalSourceIdArray(value);
}

function isOperationsDocumentFlag(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const normalized = normaliseSourceInlineText(value);
  if (OPERATIONS_DOCUMENT_FLAGS.has(normalized)) return true;
  if (!normalized.startsWith(OPERATIONS_DOCUMENT_FLAG_PREFIX_CLAIM)) return false;
  return normalized.slice(OPERATIONS_DOCUMENT_FLAG_PREFIX_CLAIM.length).trim().length > 0;
}

function operationsDocumentFlagClaimText(value: string) {
  const normalized = normaliseSourceInlineText(value);
  if (!normalized.startsWith(OPERATIONS_DOCUMENT_FLAG_PREFIX_CLAIM)) return null;
  return normalized.slice(OPERATIONS_DOCUMENT_FLAG_PREFIX_CLAIM.length).trim();
}

function isOperationsDocumentFlagArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? normaliseSourceInlineText(item) : "";
    if (!isOperationsDocumentFlag(item) || seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
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
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item) || (!OPERATIONS_JOURNEY_SECTION_KEYS.has(item) && !OPERATIONS_DOCUMENT_KEYS.has(item))) return false;
    seen.add(item);
  }
  return true;
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
  if (!expected || sectionKeys.length !== expected.length) return false;
  return expected.every((sectionKey, index) => sectionKeys[index] === sectionKey);
}

function isOperationsFactoryEvent(value: unknown, campaignId: string): value is FactoryEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  return (
    isCanonicalNonEmptySourceId(value.eventId) &&
    isPositiveInteger(value.sequence) &&
    value.campaignId === campaignId &&
    isOptionalCanonicalNonEmptySourceId(value.batchId) &&
    isOptionalCanonicalNonEmptySourceId(value.agentRunId) &&
    isOptionalCanonicalNonEmptySourceId(value.parentAgentRunId) &&
    isOptionalJourneyStep(value.journeyStep) &&
    typeof value.type === "string" &&
    OPERATIONS_EVENT_TYPES.has(value.type) &&
    isIsoDateTimeString(value.at) &&
    isOptionalNonNegativeInteger(value.stateVersion) &&
    typeof value.visibility === "string" &&
    OPERATIONS_EVENT_VISIBILITIES.has(value.visibility) &&
    hasRenderedText(payload.summary) &&
    isOptionalString(payload.verb) &&
    isOptionalString(payload.agentKey) &&
    isOptionalString(payload.agentDisplayName) &&
    isOptionalUniqueCanonicalSourceIdArray(payload.sourceIds) &&
    isOptionalUniqueCanonicalSourceIdArray(payload.claimIds) &&
    isOptionalCanonicalNonEmptySourceId(payload.proposalId) &&
    isOptionalCanonicalNonEmptySourceId(payload.judgementId) &&
    isOptionalCanonicalNonEmptySourceId(payload.handoffToAgentRunId) &&
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
  const currentTimestamp = Date.now();
  let previousSequence = 0;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousStateVersion = Number.NEGATIVE_INFINITY;
  for (const event of value.events) {
    const eventTimestamp = Date.parse(event.at);
    if (
      seenEventIds.has(event.eventId) ||
      seenSequences.has(event.sequence) ||
      event.sequence <= previousSequence ||
      event.sequence > value.lastSequence ||
      eventTimestamp > currentTimestamp ||
      eventTimestamp < previousTimestamp ||
      (event.stateVersion !== undefined && event.stateVersion > value.stateVersion) ||
      (event.stateVersion !== undefined && event.stateVersion < previousStateVersion)
    ) {
      return false;
    }
    seenEventIds.add(event.eventId);
    seenSequences.add(event.sequence);
    previousSequence = event.sequence;
    previousTimestamp = eventTimestamp;
    if (event.stateVersion !== undefined) previousStateVersion = event.stateVersion;
  }
  return true;
}

export function isOperationsRunReadModel(value: unknown, campaignId: string): value is RunReadModel {
  if (!isRecord(value) || value.campaignId !== campaignId) return false;
  if (
    !isOptionalCanonicalNonEmptySourceId(value.batchId) ||
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
    hasRenderedText(value.html) &&
    isNonEmptyString(value.plainText) &&
    hasCompiledDocumentDisclaimer(value as Pick<CompiledDocument, "html" | "plainText">) &&
    value.isPack === shouldBePack &&
    isJourneySectionKeyArray(value.sectionKeys) &&
    matchesCanonicalDocumentSections(value.key, value.isPack, value.sectionKeys) &&
    isNonNegativeInteger(value.resourceCount) &&
    (shouldBePack || value.resourceCount === 0) &&
    isOperationsDocumentFlagArray(value.flags)
  );
}

export function isOperationsCompiledDocumentList(value: unknown): value is CompiledDocument[] {
  if (!Array.isArray(value)) return false;
  if (value.length !== CANONICAL_DOCUMENTS.length) return false;
  const seen = new Set<string>();
  for (const [index, doc] of value.entries()) {
    const canonicalDocument = CANONICAL_DOCUMENTS[index];
    if (!isOperationsCompiledDocument(doc) || seen.has(doc.key) || doc.key !== canonicalDocument.key) return false;
    seen.add(doc.key);
  }
  return true;
}

export function hasConsistentOperationsDocumentEvidence(documents: CompiledDocument[], evidence: EvidenceAndNextChecks) {
  const unresolvedLoadBearingClaimTexts = new Set<string>();
  for (const group of evidence.groups) {
    for (const claim of group.claims) {
      if (claim.loadBearing && UNRESOLVED_LABELS.has(claim.label)) {
        unresolvedLoadBearingClaimTexts.add(normaliseSourceInlineText(claim.text));
      }
    }
  }

  for (const doc of documents) {
    const plainText = doc.plainText;
    const renderedText = visibleRenderedText(doc.html);
    const flags = new Set(doc.flags.map(normaliseSourceInlineText));
    const hasVerificationNote = sourceTextIncludes(plainText, OPERATIONS_DOCUMENT_NEEDS_VERIFICATION_NOTE) || sourceTextIncludes(renderedText, OPERATIONS_DOCUMENT_NEEDS_VERIFICATION_NOTE);
    const hasPackVerificationNotes = doc.isPack && (sourceTextIncludes(plainText, OPERATIONS_PACK_VERIFICATION_NOTES_HEADING) || sourceTextIncludes(renderedText, OPERATIONS_PACK_VERIFICATION_NOTES_HEADING));
    if (hasVerificationNote && !flags.has(OPERATIONS_DOCUMENT_FLAG_NEEDS_VERIFICATION)) return false;
    if (hasPackVerificationNotes && !flags.has(OPERATIONS_DOCUMENT_FLAG_PLACEHOLDERS)) return false;
    for (const flag of doc.flags) {
      const normalizedFlag = normaliseSourceInlineText(flag);
      const claimText = operationsDocumentFlagClaimText(flag);
      if (claimText !== null && !unresolvedLoadBearingClaimTexts.has(claimText)) return false;
      if (normalizedFlag === OPERATIONS_DOCUMENT_FLAG_NEEDS_VERIFICATION && (!sourceTextIncludes(plainText, OPERATIONS_DOCUMENT_NEEDS_VERIFICATION_NOTE) || !sourceTextIncludes(renderedText, OPERATIONS_DOCUMENT_NEEDS_VERIFICATION_NOTE))) return false;
      if (normalizedFlag === OPERATIONS_DOCUMENT_FLAG_PLACEHOLDERS && (!doc.isPack || !sourceTextIncludes(plainText, OPERATIONS_PACK_VERIFICATION_NOTES_HEADING) || !sourceTextIncludes(renderedText, OPERATIONS_PACK_VERIFICATION_NOTES_HEADING))) return false;
    }
  }

  for (const note of evidence.draftNotes) {
    if (!documents.some((doc) => sourceTextIncludesIgnoreCase(doc.plainText, note.section) || sourceTextIncludesIgnoreCase(visibleRenderedText(doc.html), note.section))) return false;
  }

  return true;
}

function isOperationsEvidenceClaimView(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    isCanonicalNonEmptySourceId(value.id) &&
    hasRenderedText(value.text) &&
    typeof value.type === "string" &&
    OPERATIONS_CLAIM_TYPES.has(value.type) &&
    typeof value.label === "string" &&
    OPERATIONS_VERIFICATION_LABELS.has(value.label) &&
    typeof value.loadBearing === "boolean" &&
    typeof value.confidence === "string" &&
    OPERATIONS_CLAIM_CONFIDENCES.has(value.confidence) &&
    isOptionalRenderedText(value.excerpt) &&
    isNonNegativeInteger(value.sourceCount) &&
    isOperationsAffectedOutputArray(value.affectedOutputs) &&
    isOptionalUniqueCanonicalSourceIdArray(value.contradictsClaimIds)
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
    isCanonicalNonEmptySourceId(value.id) &&
    hasRenderedText(value.description) &&
    hasRenderedText(value.reason) &&
    isOptionalUniqueCanonicalSourceIdArray(claimIds) &&
    isOperationsAffectedSectionArray(value.affectedSections)
  );
}

function isOperationsTerminalGap(value: unknown) {
  const at = isRecord(value) ? value.at : undefined;
  return (
    isRecord(value) &&
    isCanonicalNonEmptySourceId(value.id) &&
    hasRenderedText(value.description) &&
    isOptionalCanonicalNonEmptySourceId(value.agentRunId) &&
    isOptionalJourneyStep(value.step) &&
    isIsoDateTimeString(at) &&
    Date.parse(at) <= Date.now()
  );
}

function isOperationsDraftNote(value: unknown) {
  return isRecord(value) && hasRenderedText(value.text) && hasRenderedText(value.section);
}

function sameSourceReferenceArray(left: string[] | undefined, right: string[] | undefined) {
  const leftValues = [...(left ?? [])].sort();
  const rightValues = [...(right ?? [])].sort();
  return leftValues.length === rightValues.length && leftValues.every((item, index) => item === rightValues[index]);
}

function sameOptionalSourceText(left: string | undefined, right: string | undefined) {
  if (!left || !right) return left === right || (!left && !right);
  return normaliseSourceInlineText(left) === normaliseSourceInlineText(right);
}

function matchesOperationsEvidenceClaim(left: EvidenceAndNextChecks["groups"][number]["claims"][number], right: EvidenceAndNextChecks["groups"][number]["claims"][number]) {
  return (
    left.id === right.id &&
    normaliseSourceInlineText(left.text) === normaliseSourceInlineText(right.text) &&
    normaliseSourceInlineText(left.type) === normaliseSourceInlineText(right.type) &&
    normaliseSourceInlineText(left.label) === normaliseSourceInlineText(right.label) &&
    left.loadBearing === right.loadBearing &&
    normaliseSourceInlineText(left.confidence) === normaliseSourceInlineText(right.confidence) &&
    sameOptionalSourceText(left.excerpt, right.excerpt) &&
    left.sourceCount === right.sourceCount &&
    sameSourceReferenceArray(left.affectedOutputs, right.affectedOutputs) &&
    sameSourceReferenceArray(left.contradictsClaimIds, right.contradictsClaimIds)
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

  const expectedConflicts = Array.from(claimsById.values()).filter(
    (claim) => claim.label === "Conflicting evidence" || (claim.contradictsClaimIds?.length ?? 0) > 0,
  );
  if (expectedConflicts.length !== value.conflicts.length) return false;

  const seenConflictIds = new Set<string>();
  for (const [index, conflict] of value.conflicts.entries()) {
    const sourceClaim = claimsById.get(conflict.id);
    if (
      seenConflictIds.has(conflict.id) ||
      !sourceClaim ||
      expectedConflicts[index]?.id !== conflict.id ||
      !matchesOperationsEvidenceClaim(conflict, sourceClaim)
    ) {
      return false;
    }
    seenConflictIds.add(conflict.id);
  }

  const seenNextCheckIds = new Set<string>();
  for (const check of value.nextChecks) {
    if (seenNextCheckIds.has(check.id)) return false;
    if (check.claimIds?.some((claimId) => !claimsById.has(claimId))) return false;
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
