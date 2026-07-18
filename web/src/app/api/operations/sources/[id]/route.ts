import { NextResponse } from "next/server";
import {
  OPERATIONS_DEFAULT_SOURCE_ORIGIN,
  hasConsistentOperationsDocumentEvidence,
  hasUnavailableOperationsRunHeaderProvenance,
  isOperationsCompiledDocumentList,
  isOperationsEvidenceAndNextChecks,
  isOperationsPublicCampaignId,
  isOperationsRunReadModel,
  normaliseOperationsSourceInlineText,
  normaliseOperationsSourceOrigin,
  normaliseOperationsSourcePresentationText,
  type OperationsSourcePayload,
} from "@/lib/operations/source";
import { VERIFICATION_LABELS } from "@/lib/pipeline/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  Expires: "0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const READ_ONLY_ALLOW_HEADERS = { ...NO_STORE_HEADERS, Allow: "GET" };
const SOURCE_FETCH_HEADERS = {
  accept: "application/json",
  "accept-encoding": "identity",
  "cache-control": "no-cache",
  pragma: "no-cache",
};
const SOURCE_FETCH_TIMEOUT_MS = 10_000;
const SOURCE_DIAGNOSTIC_BODY_LIMIT_BYTES = 64 * 1024;
const SOURCE_JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const SOURCE_AFFECTED_SECTION_KEYS = new Set([
  "problem",
  "evidence",
  "objective",
  "decision_route",
  "power",
  "pressure",
  "strategy",
  "tactics",
  "organising",
  "campaign_brief",
  "objective_theory_of_change",
  "power_stakeholder_map",
  "campaign_strategy",
  "tactics_timeline",
  "organising_plan",
  "lobbying_pack",
  "media_pack",
  "digital_pack",
]);
const SOURCE_DOCUMENT_PACK_KEYS = new Set(["lobbying_pack", "media_pack", "digital_pack"]);
const SOURCE_JOURNEY_SECTION_KEYS = new Set(["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"]);
const SOURCE_AFFECTED_SECTION_ALIASES: Record<string, string> = {
  problemstatement: "problem",
  theproblem: "problem",
  researchandevidence: "evidence",
  evidencebase: "evidence",
  research: "evidence",
  objectiveandtheoryofchange: "objective",
  objectivetheoryofchange: "objective",
  theoryofchange: "objective",
  thedecisionroute: "decision_route",
  powerandstakeholders: "power",
  powerstakeholdermap: "power",
  powerandstakeholdermap: "power",
  stakeholdermap: "power",
  pressureanalysis: "pressure",
  campaignstrategy: "strategy",
  tacticsandsequencing: "tactics",
  tacticsandtimeline: "tactics",
  tacticstimeline: "tactics",
  organisingplan: "organising",
  campaignbrief: "campaign_brief",
  campaignbriefdocument: "campaign_brief",
  brief: "campaign_brief",
  objectiveandtheoryofchangedocument: "objective_theory_of_change",
  powerandstakeholdermapdocument: "power_stakeholder_map",
  campaignstrategydocument: "campaign_strategy",
  tacticsandtimelinedocument: "tactics_timeline",
  organisingplandocument: "organising_plan",
  organizingplandocument: "organising_plan",
  lobbyingpack: "lobbying_pack",
  lobbyingpackdocument: "lobbying_pack",
  mediapack: "media_pack",
  mediapackdocument: "media_pack",
  digitalcampaignpack: "digital_pack",
  digitalcampaignpackdocument: "digital_pack",
  digitalpack: "digital_pack",
  digitalpackdocument: "digital_pack",
};
const SOURCE_VERIFICATION_LABELS = new Set<string>(VERIFICATION_LABELS);
const SOURCE_VERIFICATION_LABEL_BY_VISIBLE_TEXT = new Map<string, string>(VERIFICATION_LABELS.map((label) => [normaliseOperationsSourceInlineText(label), label]));
const SOURCE_UNRESOLVED_LABELS = new Set(["Conflicting evidence", "Verification incomplete", "External information unavailable"]);
const SOURCE_CLAIM_TYPES = new Set(["authority", "process", "deadline", "officeholder", "policy", "stakeholder_position", "number", "context", "other"]);
const SOURCE_CLAIM_CONFIDENCES = new Set(["high", "medium", "low"]);
const SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM = "Unresolved load-bearing claim: ";
// Operations only needs the source run header; request an event-free polling
// page when recovering from an empty canonical run-read failure so large public
// event streams do not block real workspace hydration.
const SOURCE_RUN_HEADER_ONLY_AFTER_SEQUENCE = 2_147_483_647;

function sourceJson<T>(body: T, status = 200, headers: Record<string, string> = NO_STORE_HEADERS) {
  return NextResponse.json(body, { status, headers });
}

function sourceMethodNotAllowed() {
  return sourceJson(
    { error: "Operations source is read-only", detail: "This preview-safe source adapter exposes read-only GET behaviour only." },
    405,
    READ_ONLY_ALLOW_HEADERS,
  );
}

export const HEAD = sourceMethodNotAllowed;
export const OPTIONS = sourceMethodNotAllowed;
export const POST = sourceMethodNotAllowed;
export const PUT = sourceMethodNotAllowed;
export const PATCH = sourceMethodNotAllowed;
export const DELETE = sourceMethodNotAllowed;

function sourceOrigin(): { ok: true; origin: string } | { ok: false } {
  const configuredOrigin = process.env.OPERATIONS_SOURCE_ORIGIN;
  if (configuredOrigin === undefined || configuredOrigin.trim() === "") return { ok: true, origin: OPERATIONS_DEFAULT_SOURCE_ORIGIN };
  const origin = normaliseOperationsSourceOrigin(configuredOrigin);
  return origin ? { ok: true, origin } : { ok: false };
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

function unavailableSourceStatus(status: number) {
  return status >= 400 && status < 600 ? status : 502;
}

function hasExpectedSourceStatus(response: Response) {
  return response.status === 200;
}

function hasJsonContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function sourceJsonCharset(value: string | null) {
  if (!value) return undefined;
  const charsets = value
    .split(";")
    .slice(1)
    .map((part) => {
      const [name, ...rest] = part.split("=");
      if (name?.trim().toLowerCase() !== "charset" || rest.length === 0) return undefined;
      const raw = rest.join("=").trim().toLowerCase();
      const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).trim() : raw;
      return /^[a-z0-9._-]{1,40}$/.test(unquoted) ? unquoted : "malformed";
    })
    .filter((charset): charset is string => Boolean(charset));
  if (charsets.length === 0) return undefined;
  if (charsets.length > 1) return "malformed";
  return charsets[0];
}

function sanitizeSourceJsonCharset(value: string | null) {
  return sourceJsonCharset(value);
}

function sourceJsonCharsetContractMismatch(response: Response) {
  const charset = sourceJsonCharset(response.headers.get("content-type"));
  if (charset === undefined || charset === "utf-8") return undefined;
  return charset === "malformed" ? "malformed" : "unsupported";
}

const RETRY_AFTER_HTTP_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const SOURCE_ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function sanitizeRetryAfter(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,5}$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds >= 1 && seconds <= 86_400 ? String(seconds) : undefined;
  }
  if (trimmed.length <= 64 && RETRY_AFTER_HTTP_DATE_RE.test(trimmed) && Number.isFinite(Date.parse(trimmed))) return trimmed;
  return undefined;
}

function sanitizeSourceResponseDate(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length <= 64 && RETRY_AFTER_HTTP_DATE_RE.test(trimmed) && Number.isFinite(Date.parse(trimmed)) ? trimmed : undefined;
}

function sanitizeSourceRequestId(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_.-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourceContentType(value: string | null) {
  if (value === null) return { missing: true as const };
  const mediaType = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) && mediaType.length <= 80 ? { value: mediaType } : {};
}

function sourceContentEncodingTokens(value: string | null) {
  if (!value) return undefined;
  const tokens = value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return undefined;
  if (!tokens.every((token) => /^[a-z0-9!#$&^_.+-]{1,40}$/.test(token))) return null;
  return tokens;
}

function sanitizeSourceContentEncoding(value: string | null) {
  const tokens = sourceContentEncodingTokens(value);
  if (tokens === null) return "malformed";
  return tokens?.join(", ") || undefined;
}

function hasNonIdentitySourceContentEncoding(response: Response) {
  const tokens = sourceContentEncodingTokens(response.headers.get("content-encoding"));
  if (tokens === undefined) return false;
  if (tokens === null) return true;
  return tokens.some((token) => token !== "identity");
}

function sanitizeSourceMatchedPath(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\/[A-Za-z0-9/_.\[\]-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourcePath(value: string | null | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const [pathname, search = ""] = trimmed.split("?", 2);
  if (!/^\/api\/factory\/runs\/[0-9a-f-]{36}(\/documents)?$/i.test(pathname)) return undefined;
  if (!search) return pathname;
  return /^after=\d{1,10}$/.test(search) ? pathname : undefined;
}

function sanitizeSourceCacheStatus(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourceCacheControl(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9_,= -]{1,120}$/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : undefined;
}

function sanitizeSourceAgeSeconds(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,8}$/.test(trimmed)) return undefined;
  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function sanitizeSourceContentLength(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return undefined;
  const bytes = Number(trimmed);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function hasMalformedSourceContentLength(response: Response) {
  return response.headers.has("content-length") && sanitizeSourceContentLength(response.headers.get("content-length")) === undefined;
}

function sanitizeSourceContentRange(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (trimmed.length > 80) return "malformed";

  const unsatisfiedMatch = trimmed.match(/^bytes \*\/(\d{1,9}|\*)$/);
  if (unsatisfiedMatch) {
    const totalValue = unsatisfiedMatch[1];
    if (totalValue === "*") return trimmed;
    const total = Number(totalValue);
    return Number.isSafeInteger(total) && total > 0 ? trimmed : "malformed";
  }

  const rangeMatch = trimmed.match(/^bytes (\d{1,9})-(\d{1,9})\/(\d{1,9}|\*)$/);
  if (!rangeMatch) return trimmed ? "malformed" : undefined;

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return "malformed";

  const totalValue = rangeMatch[3];
  if (totalValue !== "*") {
    const total = Number(totalValue);
    if (!Number.isSafeInteger(total) || total <= 0 || end >= total) return "malformed";
  }

  return trimmed;
}

function hasSourceContentRange(response: Response) {
  return response.headers.has("content-range");
}

function declaredSourceContentLength(response: Response) {
  return sanitizeSourceContentLength(response.headers.get("content-length"));
}

function sourceElapsedMs(startedAt: number) {
  const elapsed = Date.now() - startedAt;
  return Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= SOURCE_FETCH_TIMEOUT_MS + 5_000 ? elapsed : undefined;
}

function sanitizeSourceServer(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9 ._-]{1,80}$/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : undefined;
}

function hasEmptyObservedBody(response: Response, bodyText?: string) {
  if (hasExplicitEmptyBody(response)) return true;
  return bodyText !== undefined && bodyText.trim().length === 0;
}

async function safeReadBoundedResponseText(response: Response, limitBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return { text: undefined, truncated: false, bytes: 0, invalidTextEncoding: false };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  let truncated = false;
  let invalidTextEncoding = false;

  function appendDecoded(chunk?: Uint8Array, options?: TextDecodeOptions) {
    try {
      text += decoder.decode(chunk, options);
      return true;
    } catch {
      invalidTextEncoding = true;
      return false;
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = limitBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      if (value.byteLength > remaining) {
        appendDecoded(value.slice(0, remaining), { stream: true });
        bytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      bytes += value.byteLength;
      if (!appendDecoded(value, { stream: true })) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    return { text: undefined, truncated, bytes, invalidTextEncoding };
  }

  if (!truncated && !invalidTextEncoding) appendDecoded();
  return { text: invalidTextEncoding ? undefined : text, truncated, bytes, invalidTextEncoding };
}

async function safeReadDiagnosticResponseText(response: Response) {
  return safeReadBoundedResponseText(response, SOURCE_DIAGNOSTIC_BODY_LIMIT_BYTES);
}

async function safeReadJsonResponseText(response: Response) {
  return safeReadBoundedResponseText(response, SOURCE_JSON_BODY_LIMIT_BYTES);
}

function upstreamResponseMetadata(response: Response, elapsedMs: number | undefined, bodyText?: string, sourcePath?: string, bodyTruncated = false, sourceTextEncoding?: "malformed") {
  const contentType = sanitizeSourceContentType(response.headers.get("content-type"));
  return {
    sourcePath: sanitizeSourcePath(sourcePath),
    sourceHttpStatus: response.status,
    ...(elapsedMs !== undefined ? { sourceElapsedMs: elapsedMs } : {}),
    sourceRequestId: sanitizeSourceRequestId(response.headers.get("x-vercel-id")),
    sourceMatchedPath: sanitizeSourceMatchedPath(response.headers.get("x-matched-path")),
    sourceCacheStatus: sanitizeSourceCacheStatus(response.headers.get("x-vercel-cache")),
    sourceCacheControl: sanitizeSourceCacheControl(response.headers.get("cache-control")),
    sourceAgeSeconds: sanitizeSourceAgeSeconds(response.headers.get("age")),
    sourceResponseDate: sanitizeSourceResponseDate(response.headers.get("date")),
    sourceContentLength: sanitizeSourceContentLength(response.headers.get("content-length")),
    ...(hasMalformedSourceContentLength(response) ? { sourceContentLengthMalformed: true } : {}),
    sourceContentRange: sanitizeSourceContentRange(response.headers.get("content-range")),
    sourceServer: sanitizeSourceServer(response.headers.get("server")),
    sourceContentEncoding: sanitizeSourceContentEncoding(response.headers.get("content-encoding")),
    sourceContentCharset: sanitizeSourceJsonCharset(response.headers.get("content-type")),
    sourceBodyEmpty: !bodyTruncated && hasEmptyObservedBody(response, bodyText),
    ...(bodyTruncated ? { sourceBodyTruncated: true } : {}),
    ...(sourceTextEncoding ? { sourceTextEncoding } : {}),
    ...("value" in contentType ? { sourceContentType: contentType.value } : {}),
    ...("missing" in contentType ? { sourceContentTypeMissing: true } : {}),
  };
}

type UpstreamMetadata = ReturnType<typeof upstreamResponseMetadata>;

function sourceFailureHeaders(result: { retryAfter?: string }) {
  return result.retryAfter ? { ...NO_STORE_HEADERS, "Retry-After": result.retryAfter } : NO_STORE_HEADERS;
}

type SourceStep = "run" | "documents" | "configuration";
type SourceFailureKind = "configuration" | "http_error" | "redirect" | "non_json" | "encoded_body" | "malformed_json" | "oversized_json" | "contract_mismatch" | "not_ready" | "timeout" | "network";

function sourceFailureBody(step: SourceStep, body: Record<string, unknown>) {
  return { ...body, sourceStep: step };
}

function hasExplicitEmptyBody(response: Response) {
  return response.headers.get("content-length")?.trim() === "0";
}

function sourceRunHeaderOnly(value: unknown) {
  if (typeof value !== "object" || value === null) return value;
  const header: Record<string, unknown> = { ...(value as Record<string, unknown>), events: [] };
  if (header.batchId !== undefined && typeof header.batchId !== "string") delete header.batchId;
  return header;
}

function uniqueStrings(values: unknown) {
  if (!Array.isArray(values)) return values;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function normalizeSourceReferenceId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id.length > 0 ? id : undefined;
}

function normalizeSourceIsoDateTime(value: unknown) {
  if (typeof value !== "string") return undefined;
  const at = value.trim();
  return SOURCE_ISO_DATETIME_RE.test(at) && Number.isFinite(Date.parse(at)) ? at : undefined;
}

function uniqueSourceReferenceIds(values: unknown) {
  if (!Array.isArray(values)) return values;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const id = normalizeSourceReferenceId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function normalizeSourceVisibleText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = normaliseOperationsSourceInlineText(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSourceVerificationLabel(value: unknown) {
  const normalized = normalizeSourceVisibleText(value);
  return normalized ? SOURCE_VERIFICATION_LABEL_BY_VISIBLE_TEXT.get(normalized) : undefined;
}

function normalizeSourceClaimType(value: unknown) {
  const normalized = normalizeSourceVisibleText(value);
  if (!normalized) return undefined;
  const key = normalized
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return SOURCE_CLAIM_TYPES.has(key) ? key : undefined;
}

function normalizeSourceClaimConfidence(value: unknown) {
  const normalized = normalizeSourceVisibleText(value)?.toLowerCase();
  return normalized && SOURCE_CLAIM_CONFIDENCES.has(normalized) ? normalized : undefined;
}

function normalizeSourceAffectedSectionKey(value: string) {
  const visibleValue = normaliseOperationsSourceInlineText(value);
  if (SOURCE_AFFECTED_SECTION_KEYS.has(visibleValue)) return visibleValue;
  const folded = visibleValue
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  return SOURCE_AFFECTED_SECTION_ALIASES[folded] ?? value;
}

function normalizeSourceAffectedSectionValues(values: unknown) {
  if (!Array.isArray(values)) return values;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const section = normalizeSourceAffectedSectionKey(value);
    if (seen.has(section)) continue;
    seen.add(section);
    normalized.push(section);
  }
  return normalized;
}

function isRecoverableSourceTerminalGap(value: Record<string, unknown>) {
  const at = normalizeSourceIsoDateTime(value.at);
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    Boolean(at)
  );
}

function normalizeSourceTerminalGap(value: Record<string, unknown>) {
  const normalized = { ...value };
  const id = normalizeSourceReferenceId(normalized.id);
  const description = normalizeSourceVisibleText(normalized.description);
  const at = normalizeSourceIsoDateTime(normalized.at);
  if (id) normalized.id = id;
  if (description) normalized.description = description;
  if (at) normalized.at = at;
  if (normalized.agentRunId !== undefined && typeof normalized.agentRunId !== "string") delete normalized.agentRunId;
  if (normalized.step !== undefined) {
    const step = normalized.step;
    if (typeof step !== "number" || !Number.isInteger(step) || step < 1 || step > 10) delete normalized.step;
  }
  return normalized;
}

function isRecoverableSourceNextCheck(value: Record<string, unknown>) {
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    Array.isArray(value.affectedSections) &&
    value.affectedSections.every((section) => typeof section === "string" && SOURCE_AFFECTED_SECTION_KEYS.has(section)) &&
    (value.claimIds === undefined || (Array.isArray(value.claimIds) && value.claimIds.every((claimId) => typeof claimId === "string" && claimId.trim().length > 0)))
  );
}

function normalizeSourceNextCheck(value: Record<string, unknown>, claimIds: Set<string>): Record<string, unknown> {
  const id = normalizeSourceReferenceId(value.id);
  const description = normalizeSourceVisibleText(value.description);
  const reason = normalizeSourceVisibleText(value.reason);
  const checkClaimIds = Array.isArray(value.claimIds) ? (uniqueSourceReferenceIds(value.claimIds) as string[]) : value.claimIds;
  const affectedSections = normalizeSourceAffectedSectionValues(value.affectedSections);
  return {
    ...value,
    ...(id ? { id } : {}),
    ...(description ? { description } : {}),
    ...(reason ? { reason } : {}),
    claimIds: Array.isArray(checkClaimIds) && claimIds.size > 0 ? checkClaimIds.filter((claimId) => claimIds.has(claimId)) : checkClaimIds === null ? undefined : checkClaimIds,
    affectedSections: Array.isArray(affectedSections) ? affectedSections.filter((section) => SOURCE_AFFECTED_SECTION_KEYS.has(section)) : affectedSections,
  };
}

function canonicalSourceDocumentFlag(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = normaliseOperationsSourceInlineText(value);
  if (normalized === SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM.trim()) return value;
  if (normalized.startsWith(SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM)) {
    const claimText = normalized.slice(SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM.length).trim();
    return claimText ? `${SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM}${claimText}` : value;
  }
  return normalized || value;
}

function uniqueSourceDocumentFlags(values: unknown) {
  if (!Array.isArray(values)) return values;
  const seen = new Set<string>();
  const flags: unknown[] = [];
  for (const value of values) {
    const flag = canonicalSourceDocumentFlag(value);
    const key = typeof flag === "string" ? normaliseOperationsSourceInlineText(flag) : undefined;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    flags.push(flag);
  }
  return flags;
}

function normalizeSourceDocumentPlainText(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = normaliseOperationsSourcePresentationText(value);
  return normalized.length > 0 ? normalized : value;
}

function normalizeSourceDocumentSectionKeys(value: unknown, documentKey: unknown) {
  if (typeof documentKey === "string" && SOURCE_DOCUMENT_PACK_KEYS.has(documentKey)) return [];
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const section of value) {
    if (typeof section !== "string") continue;
    const key = normalizeSourceAffectedSectionKey(section);
    if (!SOURCE_JOURNEY_SECTION_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeSourceDocuments(value: unknown) {
  return Array.isArray(value)
    ? value.map((document) =>
        typeof document === "object" && document !== null
          ? {
              ...(document as Record<string, unknown>),
              plainText: normalizeSourceDocumentPlainText((document as Record<string, unknown>).plainText),
              sectionKeys: normalizeSourceDocumentSectionKeys((document as Record<string, unknown>).sectionKeys, (document as Record<string, unknown>).key),
              flags: uniqueSourceDocumentFlags((document as Record<string, unknown>).flags),
            }
          : document,
      )
    : value;
}

function normalizeSourceDocumentEvidenceFlags(documents: unknown, evidence: unknown) {
  if (!Array.isArray(documents) || typeof evidence !== "object" || evidence === null || !Array.isArray((evidence as Record<string, unknown>).groups)) return documents;

  const unresolvedLoadBearingClaimTexts = new Set<string>();
  for (const group of (evidence as Record<string, unknown>).groups as unknown[]) {
    if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) continue;
    for (const claim of (group as Record<string, unknown>).claims as unknown[]) {
      if (typeof claim !== "object" || claim === null) continue;
      const claimRecord = claim as Record<string, unknown>;
      if (claimRecord.loadBearing === true && typeof claimRecord.label === "string" && SOURCE_UNRESOLVED_LABELS.has(claimRecord.label) && typeof claimRecord.text === "string") {
        unresolvedLoadBearingClaimTexts.add(normaliseOperationsSourceInlineText(claimRecord.text));
      }
    }
  }

  return documents.map((document) => {
    if (typeof document !== "object" || document === null || !Array.isArray((document as Record<string, unknown>).flags)) return document;
    const flags = ((document as Record<string, unknown>).flags as unknown[]).flatMap((flag) => {
      const canonicalFlag = canonicalSourceDocumentFlag(flag);
      if (typeof canonicalFlag !== "string") return [canonicalFlag];
      const normalizedFlag = normaliseOperationsSourceInlineText(canonicalFlag);
      if (!normalizedFlag.startsWith(SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM)) return [canonicalFlag];
      const claimText = normalizedFlag.slice(SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM.length).trim();
      return unresolvedLoadBearingClaimTexts.has(claimText) ? [`${SOURCE_DOCUMENT_FLAG_PREFIX_CLAIM}${claimText}`] : [];
    });
    return { ...(document as Record<string, unknown>), flags: uniqueSourceDocumentFlags(flags) };
  });
}

function normalizeSourceEvidenceClaim(value: unknown, claimIds: Set<string>, fallbackLabel?: string) {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const id = normalizeSourceReferenceId(record.id);
  const text = normalizeSourceVisibleText(record.text);
  const excerpt = normalizeSourceVisibleText(record.excerpt);
  const affectedOutputs = normalizeSourceAffectedSectionValues(record.affectedOutputs);
  const contradictsClaimIds = Array.isArray(record.contradictsClaimIds) ? (uniqueSourceReferenceIds(record.contradictsClaimIds) as string[]) : record.contradictsClaimIds;
  const label = normalizeSourceVerificationLabel(record.label) ?? fallbackLabel;
  const type = normalizeSourceClaimType(record.type);
  const confidence = normalizeSourceClaimConfidence(record.confidence);
  return {
    ...record,
    ...(id ? { id } : {}),
    ...(text ? { text } : {}),
    ...(label ? { label } : {}),
    ...(type ? { type } : {}),
    ...(confidence ? { confidence } : {}),
    ...(record.excerpt === null ? { excerpt: undefined } : excerpt ? { excerpt } : {}),
    affectedOutputs,
    contradictsClaimIds: Array.isArray(contradictsClaimIds) && claimIds.size > 0 ? contradictsClaimIds.filter((claimId) => claimId !== id && claimIds.has(claimId)) : contradictsClaimIds === null ? undefined : contradictsClaimIds,
  };
}

function normalizeSourceEvidenceGroups(record: Record<string, unknown>, claimIds: Set<string>) {
  if (!Array.isArray(record.groups)) return record.groups;

  const groupedByLabel = new Map<string, { label: string; claims: unknown[] }>();
  const passthroughGroups: unknown[] = [];
  const seenClaimIds = new Set<string>();

  for (const group of record.groups) {
    if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) {
      passthroughGroups.push(group);
      continue;
    }

    const groupRecord = group as Record<string, unknown>;
    const fallbackGroupLabel = normalizeSourceVerificationLabel(groupRecord.label);
    const claimsByLabel = new Map<string, unknown[]>();
    const passthroughClaims: unknown[] = [];

    for (const claim of groupRecord.claims as unknown[]) {
      const normalizedClaim = normalizeSourceEvidenceClaim(claim, claimIds, fallbackGroupLabel);
      const claimRecord = typeof normalizedClaim === "object" && normalizedClaim !== null ? (normalizedClaim as Record<string, unknown>) : undefined;
      const claimLabel = normalizeSourceVerificationLabel(claimRecord?.label);
      const claimId = claimRecord && typeof claimRecord.id === "string" ? claimRecord.id : undefined;
      const duplicateClaim = claimId ? seenClaimIds.has(claimId) : false;
      if (!claimLabel) {
        passthroughClaims.push(normalizedClaim);
        continue;
      }
      if (duplicateClaim) continue;
      if (claimId) seenClaimIds.add(claimId);
      claimsByLabel.set(claimLabel, [...(claimsByLabel.get(claimLabel) ?? []), normalizedClaim]);
    }

    for (const [label, claims] of claimsByLabel) {
      const existingGroup = groupedByLabel.get(label);
      if (existingGroup) {
        existingGroup.claims.push(...claims);
      } else {
        groupedByLabel.set(label, { label, claims });
      }
    }

    if (passthroughClaims.length > 0) {
      passthroughGroups.push({ ...groupRecord, count: passthroughClaims.length, claims: passthroughClaims });
    }
  }

  const orderedGroups = VERIFICATION_LABELS.flatMap((label) => {
    const group = groupedByLabel.get(label);
    return group && group.claims.length > 0 ? [{ label: group.label, count: group.claims.length, claims: group.claims }] : [];
  });
  const unknownLabelGroups = Array.from(groupedByLabel.values()).flatMap((group) => (SOURCE_VERIFICATION_LABELS.has(group.label) || group.claims.length === 0 ? [] : [{ label: group.label, count: group.claims.length, claims: group.claims }]));
  const unresolvedPassthroughGroups = passthroughGroups.flatMap((group) => {
    if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) return [group];
    const remainingClaims = ((group as Record<string, unknown>).claims as unknown[]).filter((claim) => {
      if (typeof claim !== "object" || claim === null) return true;
      const claimId = normalizeSourceReferenceId((claim as Record<string, unknown>).id);
      return !claimId || !seenClaimIds.has(claimId);
    });
    return remainingClaims.length > 0 ? [{ ...(group as Record<string, unknown>), count: remainingClaims.length, claims: remainingClaims }] : [];
  });
  return [...orderedGroups, ...unknownLabelGroups, ...unresolvedPassthroughGroups];
}

function normalizeSourceEvidenceTotals(record: Record<string, unknown>, groups: unknown) {
  if (!Array.isArray(groups)) return record.totals;
  let claims = 0;
  let loadBearing = 0;
  let unresolvedLoadBearing = 0;

  for (const group of groups) {
    if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) continue;
    for (const claim of (group as Record<string, unknown>).claims as unknown[]) {
      if (typeof claim !== "object" || claim === null) continue;
      const claimRecord = claim as Record<string, unknown>;
      claims += 1;
      if (claimRecord.loadBearing === true) {
        loadBearing += 1;
        if (typeof claimRecord.label === "string" && SOURCE_UNRESOLVED_LABELS.has(claimRecord.label)) unresolvedLoadBearing += 1;
      }
    }
  }

  return {
    ...(typeof record.totals === "object" && record.totals !== null ? (record.totals as Record<string, unknown>) : {}),
    claims,
    loadBearing,
    verifiedLoadBearing: loadBearing - unresolvedLoadBearing,
    unresolvedLoadBearing,
  };
}

function normalizeSourceDraftNotes(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const notes: unknown[] = [];
  for (const note of value) {
    if (note === undefined || note === null) continue;
    if (typeof note !== "object") {
      notes.push(note);
      continue;
    }
    const record = note as Record<string, unknown>;
    if (typeof record.text !== "string" || record.text.trim().length === 0 || typeof record.section !== "string" || record.section.trim().length === 0) {
      notes.push(note);
      continue;
    }
    const normalizedSection = normalizeSourceVisibleText(record.section);
    const normalizedText = normalizeSourceVisibleText(record.text);
    if (!normalizedSection || !normalizedText) {
      notes.push(note);
      continue;
    }
    const key = `${normalizedSection}\u0000${normalizedText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ ...record, section: normalizedSection, text: normalizedText });
  }
  return notes;
}

function normalizeSourceEvidenceArray(value: unknown) {
  return value === undefined || value === null ? [] : value;
}

function normalizeSourceEvidence(value: unknown) {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const claimIds = new Set<string>();
  if (Array.isArray(record.groups)) {
    for (const group of record.groups) {
      if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) continue;
      for (const claim of (group as Record<string, unknown>).claims as unknown[]) {
        if (typeof claim !== "object" || claim === null) continue;
        const claimId = normalizeSourceReferenceId((claim as Record<string, unknown>).id);
        if (claimId) claimIds.add(claimId);
      }
    }
  }
  const groups = normalizeSourceEvidenceGroups(record, claimIds);
  const totals = normalizeSourceEvidenceTotals(record, groups);
  const currentClaims: Record<string, unknown>[] = [];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) continue;
      for (const claim of (group as Record<string, unknown>).claims as unknown[]) {
        if (typeof claim === "object" && claim !== null) currentClaims.push(claim as Record<string, unknown>);
      }
    }
  }
  const seenNextCheckIds = new Set<string>();
  const nextChecksById = new Map<string, Record<string, unknown>>();
  const nextCheckOrder: string[] = [];
  const passthroughNextChecks: unknown[] = [];
  if (Array.isArray(record.nextChecks)) {
    for (const check of record.nextChecks) {
      if (typeof check !== "object" || check === null) {
        passthroughNextChecks.push(check);
        continue;
      }
      const checkRecord = normalizeSourceNextCheck(check as Record<string, unknown>, claimIds);
      if (typeof checkRecord.id !== "string") {
        passthroughNextChecks.push(checkRecord);
        continue;
      }
      if (!seenNextCheckIds.has(checkRecord.id)) {
        seenNextCheckIds.add(checkRecord.id);
        nextCheckOrder.push(checkRecord.id);
      }
      const current = nextChecksById.get(checkRecord.id);
      if (!current || (!isRecoverableSourceNextCheck(current) && isRecoverableSourceNextCheck(checkRecord))) {
        nextChecksById.set(checkRecord.id, checkRecord);
      }
    }
  }
  const terminalGapsById = new Map<string, Record<string, unknown>>();
  const terminalGapOrder: string[] = [];
  const passthroughTerminalGaps: unknown[] = [];
  if (Array.isArray(record.terminalGaps)) {
    for (const gap of record.terminalGaps) {
      if (typeof gap !== "object" || gap === null) {
        passthroughTerminalGaps.push(gap);
        continue;
      }
      const gapRecord = normalizeSourceTerminalGap(gap as Record<string, unknown>);
      if (typeof gapRecord.id !== "string") {
        passthroughTerminalGaps.push(gapRecord);
        continue;
      }
      if (!terminalGapsById.has(gapRecord.id)) terminalGapOrder.push(gapRecord.id);
      const current = terminalGapsById.get(gapRecord.id);
      if (!current || (!isRecoverableSourceTerminalGap(current) && isRecoverableSourceTerminalGap(gapRecord))) {
        terminalGapsById.set(gapRecord.id, gapRecord);
      }
    }
  }
  return {
    ...record,
    groups,
    totals,
    conflicts: currentClaims.filter((claim) => claim.label === "Conflicting evidence" || (Array.isArray(claim.contradictsClaimIds) && claim.contradictsClaimIds.length > 0)),
    nextChecks: Array.isArray(record.nextChecks)
      ? [
          ...nextCheckOrder
            .map((id) => nextChecksById.get(id))
            .filter((check): check is Record<string, unknown> => Boolean(check)),
          ...passthroughNextChecks,
        ]
      : normalizeSourceEvidenceArray(record.nextChecks),
    terminalGaps: Array.isArray(record.terminalGaps)
      ? [
          ...terminalGapOrder
            .map((id) => terminalGapsById.get(id))
            .filter((gap): gap is Record<string, unknown> => Boolean(gap)),
          ...passthroughTerminalGaps,
        ]
      : normalizeSourceEvidenceArray(record.terminalGaps),
    draftNotes: normalizeSourceDraftNotes(record.draftNotes),
  };
}

function upstreamFailureMetadata(result: { sourceFailureKind?: SourceFailureKind; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed" }) {
  return {
    ...(result.sourceFailureKind ? { sourceFailureKind: result.sourceFailureKind } : {}),
    ...(result.sourcePath ? { sourcePath: result.sourcePath } : {}),
    ...(result.sourceHttpStatus ? { sourceHttpStatus: result.sourceHttpStatus } : {}),
    ...(result.sourceElapsedMs !== undefined ? { sourceElapsedMs: result.sourceElapsedMs } : {}),
    ...(result.sourceRequestId ? { sourceRequestId: result.sourceRequestId } : {}),
    ...(result.sourceMatchedPath ? { sourceMatchedPath: result.sourceMatchedPath } : {}),
    ...(result.sourceCacheStatus ? { sourceCacheStatus: result.sourceCacheStatus } : {}),
    ...(result.sourceCacheControl ? { sourceCacheControl: result.sourceCacheControl } : {}),
    ...(result.sourceAgeSeconds !== undefined ? { sourceAgeSeconds: result.sourceAgeSeconds } : {}),
    ...(result.sourceResponseDate ? { sourceResponseDate: result.sourceResponseDate } : {}),
    ...(result.sourceContentLength !== undefined ? { sourceContentLength: result.sourceContentLength } : {}),
    ...(result.sourceContentLengthMalformed ? { sourceContentLengthMalformed: true } : {}),
    ...(result.sourceContentRange ? { sourceContentRange: result.sourceContentRange } : {}),
    ...(result.sourceServer ? { sourceServer: result.sourceServer } : {}),
    ...(result.sourceContentEncoding ? { sourceContentEncoding: result.sourceContentEncoding } : {}),
    ...(result.sourceContentCharset ? { sourceContentCharset: result.sourceContentCharset } : {}),
    ...(result.sourceBodyEmpty ? { sourceBodyEmpty: true } : {}),
    ...(result.sourceBodyTruncated ? { sourceBodyTruncated: true } : {}),
    ...(result.sourceContentType ? { sourceContentType: result.sourceContentType } : {}),
    ...(result.sourceContentTypeMissing ? { sourceContentTypeMissing: true } : {}),
    ...(result.sourceTextEncoding ? { sourceTextEncoding: result.sourceTextEncoding } : {}),
  };
}

async function fetchSourceJson<T>(
  origin: string,
  path: string,
): Promise<
  | { ok: true; value: T; metadata: UpstreamMetadata }
  | { ok: false; status: number; message: string; path: string; sourceFailureKind: SourceFailureKind; contractMismatch?: boolean; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceContentLengthMalformed?: boolean; sourceContentRange?: string; sourceServer?: string; sourceContentEncoding?: string; sourceContentCharset?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean; sourceTextEncoding?: "malformed" }
> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SOURCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: SOURCE_FETCH_HEADERS,
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      const redirectDetail = isRedirectStatus(response.status) ? " Redirects are not followed for preview-safe source reads." : "";
      const diagnosticBody = await safeReadDiagnosticResponseText(response);
      return {
        ok: false,
        status: response.status,
        path,
        sourceFailureKind: isRedirectStatus(response.status) ? "redirect" : "http_error",
        message: `Read-only source ${path} returned HTTP ${response.status}.${redirectDetail}`,
        retryAfter: sanitizeRetryAfter(response.headers.get("retry-after")),
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), diagnosticBody.text, path, diagnosticBody.truncated, diagnosticBody.invalidTextEncoding ? "malformed" : undefined),
      };
    }
    if (!hasExpectedSourceStatus(response)) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "contract_mismatch",
        contractMismatch: true,
        message: `Read-only source ${path} returned HTTP ${response.status} instead of the expected 200 JSON contract.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path),
      };
    }
    if (hasSourceContentRange(response)) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "contract_mismatch",
        contractMismatch: true,
        message: `Read-only source ${path} returned a Content-Range header despite the complete-response JSON contract.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path, true),
      };
    }
    if (hasNonIdentitySourceContentEncoding(response)) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "encoded_body",
        contractMismatch: true,
        message: `Read-only source ${path} returned a content-encoded body despite the identity encoding requirement.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path, true),
      };
    }
    if (hasMalformedSourceContentLength(response)) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "contract_mismatch",
        contractMismatch: true,
        message: `Read-only source ${path} returned a malformed Content-Length header despite the complete-response JSON contract.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path, true),
      };
    }
    if (!hasJsonContentType(response)) {
      const diagnosticBody = await safeReadDiagnosticResponseText(response);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "non_json",
        contractMismatch: true,
        message: `Read-only source ${path} returned a non-JSON content type.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), diagnosticBody.text, path, diagnosticBody.truncated, diagnosticBody.invalidTextEncoding ? "malformed" : undefined),
      };
    }
    const charsetMismatch = sourceJsonCharsetContractMismatch(response);
    if (charsetMismatch) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "contract_mismatch",
        contractMismatch: true,
        message:
          charsetMismatch === "malformed"
            ? `Read-only source ${path} declared a malformed JSON charset despite the UTF-8 source contract.`
            : `Read-only source ${path} declared an unsupported JSON charset despite the UTF-8 source contract.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path, true),
      };
    }
    const declaredContentLength = declaredSourceContentLength(response);
    if (declaredContentLength !== undefined && declaredContentLength > SOURCE_JSON_BODY_LIMIT_BYTES) {
      response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "oversized_json",
        contractMismatch: true,
        message: `Read-only source ${path} declared a JSON body larger than the preview-safe limit.`,
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), undefined, path, true),
      };
    }

    const responseBody = await safeReadJsonResponseText(response);
    const metadata = upstreamResponseMetadata(response, sourceElapsedMs(startedAt), responseBody.text, path, responseBody.truncated, responseBody.invalidTextEncoding ? "malformed" : undefined);
    if (responseBody.truncated) {
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "oversized_json",
        contractMismatch: true,
        message: `Read-only source ${path} returned a JSON body larger than the preview-safe limit.`,
        ...metadata,
      };
    }
    if (responseBody.invalidTextEncoding) {
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "malformed_json",
        contractMismatch: true,
        message: `Read-only source ${path} returned JSON that was not valid UTF-8.`,
        ...metadata,
      };
    }
    if (declaredContentLength !== undefined && responseBody.bytes !== declaredContentLength) {
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "contract_mismatch",
        contractMismatch: true,
        message: `Read-only source ${path} returned a Content-Length header that did not match the JSON body length.`,
        ...metadata,
      };
    }
    if ((responseBody.text ?? "").trim().length === 0) {
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "malformed_json",
        contractMismatch: true,
        message: `Read-only source ${path} returned an empty JSON body.`,
        ...metadata,
      };
    }
    try {
      return { ok: true, value: JSON.parse(responseBody.text ?? "") as T, metadata };
    } catch {
      return {
        ok: false,
        status: 502,
        path,
        sourceFailureKind: "malformed_json",
        contractMismatch: true,
        message: `Read-only source ${path} returned malformed JSON.`,
        ...metadata,
      };
    }
  } catch {
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      path,
      sourceFailureKind: timedOut ? "timeout" : "network",
      message: timedOut
        ? `Read-only source ${path} timed out after ${SOURCE_FETCH_TIMEOUT_MS / 1000} seconds.`
        : `Read-only source ${path} could not be reached.`,
      sourcePath: sanitizeSourcePath(path),
      sourceElapsedMs: sourceElapsedMs(startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id) || !isOperationsPublicCampaignId(id)) {
    return sourceJson(
      sourceFailureBody("configuration", { error: "Operations source not found", detail: "This read-only preview source path only exposes the curated public operations campaigns.", sourceFailureKind: "configuration" }),
      404,
    );
  }

  const originResult = sourceOrigin();
  if (!originResult.ok) {
    return sourceJson(
      sourceFailureBody("configuration", { error: "Operations source origin unavailable", detail: "The configured read-only operations source origin is not allow-listed.", sourceFailureKind: "configuration" }),
      502,
    );
  }

  const origin = originResult.origin;
  const runPath = `/api/factory/runs/${encodeURIComponent(id)}`;
  let run = await fetchSourceJson<OperationsSourcePayload["run"]>(origin, runPath);
  if (!run.ok && run.sourceFailureKind === "http_error" && run.sourceHttpStatus === 500 && run.sourceBodyEmpty) {
    const headerOnlyRun = await fetchSourceJson<OperationsSourcePayload["run"]>(origin, `${runPath}?after=${SOURCE_RUN_HEADER_ONLY_AFTER_SEQUENCE}`);
    if (headerOnlyRun.ok) run = headerOnlyRun;
  }
  if (run.ok) {
    const runHeader = sourceRunHeaderOnly(run.value);
    if (!isOperationsRunReadModel(runHeader, id)) {
      return sourceJson(
        sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: "The public source did not return a run in the expected shape.", sourceOrigin: origin, ...upstreamFailureMetadata({ sourceFailureKind: "contract_mismatch", ...run.metadata }) }),
        502,
      );
    }

    if (runHeader.status !== "partial" && runHeader.status !== "completed") {
      return sourceJson(
        sourceFailureBody("run", {
          error: "Campaign source not ready",
          detail: `This campaign is ${runHeader.status}, so compiled operations source material is not available yet.`,
          runStatus: runHeader.status,
          sourceOrigin: origin,
          ...upstreamFailureMetadata({ sourceFailureKind: "not_ready", ...run.metadata }),
        }),
        409,
      );
    }

    if (!hasUnavailableOperationsRunHeaderProvenance(runHeader, false)) {
      return sourceJson(
        sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: "The public source returned an unavailable run header without unavailable provenance.", sourceOrigin: origin, ...upstreamFailureMetadata({ sourceFailureKind: "contract_mismatch", ...run.metadata }) }),
        502,
      );
    }
    run.value = runHeader;
  } else if (run.status === 404) {
    return sourceJson(sourceFailureBody("run", { error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin, ...upstreamFailureMetadata(run) }), 404, sourceFailureHeaders(run));
  } else if (isRedirectStatus(run.status)) {
    return sourceJson(
      sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: "The public source run redirected instead of returning the allow-listed read-only run contract.", sourceOrigin: origin, ...upstreamFailureMetadata(run) }),
      502,
      sourceFailureHeaders(run),
    );
  } else if (run.status === 504) {
    return sourceJson(sourceFailureBody("run", { error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin, ...upstreamFailureMetadata(run) }), 504, sourceFailureHeaders(run));
  } else if (run.contractMismatch) {
    return sourceJson(
      sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: run.message, sourceOrigin: origin, ...upstreamFailureMetadata(run) }),
      502,
    );
  } else {
    return sourceJson(
      sourceFailureBody("run", { error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin, ...upstreamFailureMetadata(run) }),
      run.status >= 400 && run.status < 600 ? run.status : 502,
      sourceFailureHeaders(run),
    );
  }

  const docs = await fetchSourceJson<Pick<OperationsSourcePayload, "documents" | "evidence">>(origin, `/api/factory/runs/${encodeURIComponent(id)}/documents`);
  if (!docs.ok) {
    if (isRedirectStatus(docs.status)) {
      return sourceJson(
        sourceFailureBody("documents", {
          error: "Campaign source contract mismatch",
          detail: "The public source documents redirected instead of returning the allow-listed read-only document contract.",
          runStatus: run.value.status,
          sourceOrigin: origin,
          ...upstreamFailureMetadata(docs),
        }),
        502,
        sourceFailureHeaders(docs),
      );
    }

    if (docs.contractMismatch) {
      return sourceJson(
        sourceFailureBody("documents", { error: "Campaign source contract mismatch", detail: docs.message, runStatus: run.value.status, sourceOrigin: origin, ...upstreamFailureMetadata(docs) }),
        502,
      );
    }

    return sourceJson(
      sourceFailureBody("documents", { error: "Campaign source documents unavailable", detail: docs.message, runStatus: run.value.status, sourceOrigin: origin, ...upstreamFailureMetadata(docs) }),
      unavailableSourceStatus(docs.status),
      sourceFailureHeaders(docs),
    );
  }

  const sourceEvidence = normalizeSourceEvidence(docs.value.evidence);
  const sourceDocuments = normalizeSourceDocumentEvidenceFlags(normalizeSourceDocuments(docs.value.documents), sourceEvidence);
  if (
    !isOperationsCompiledDocumentList(sourceDocuments) ||
    !isOperationsEvidenceAndNextChecks(sourceEvidence) ||
    !hasConsistentOperationsDocumentEvidence(sourceDocuments, sourceEvidence)
  ) {
    return sourceJson(
        sourceFailureBody("documents", { error: "Campaign source contract mismatch", detail: "The public source did not return compiled documents and evidence in the expected shape.", runStatus: run.value.status, sourceOrigin: origin, ...upstreamFailureMetadata({ sourceFailureKind: "contract_mismatch", ...docs.metadata }) }),
      502,
    );
  }

  return sourceJson(
    {
      sourceOrigin: origin,
      run: run.value,
      documents: sourceDocuments,
      evidence: sourceEvidence,
    } as OperationsSourcePayload,
  );
}
