import { NextResponse } from "next/server";
import {
  OPERATIONS_DEFAULT_SOURCE_ORIGIN,
  hasConsistentOperationsDocumentEvidence,
  hasUnavailableOperationsRunHeaderProvenance,
  isOperationsCompiledDocumentList,
  isOperationsEvidenceAndNextChecks,
  isOperationsPublicCampaignId,
  isOperationsRunReadModel,
  normaliseOperationsSourceOrigin,
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
const SOURCE_VERIFICATION_LABELS = new Set<string>(VERIFICATION_LABELS);
const SOURCE_UNRESOLVED_LABELS = new Set(["Conflicting evidence", "Verification incomplete", "External information unavailable"]);
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
  return typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>), events: [] } : value;
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

function normalizeSourceDocuments(value: unknown) {
  return Array.isArray(value)
    ? value.map((document) => (typeof document === "object" && document !== null ? { ...(document as Record<string, unknown>), flags: uniqueStrings((document as Record<string, unknown>).flags) } : document))
    : value;
}

function normalizeSourceEvidenceClaim(value: unknown, claimIds: Set<string>) {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const affectedOutputs = Array.isArray(record.affectedOutputs) ? (uniqueStrings(record.affectedOutputs) as string[]) : record.affectedOutputs;
  const contradictsClaimIds = Array.isArray(record.contradictsClaimIds) ? (uniqueStrings(record.contradictsClaimIds) as string[]) : record.contradictsClaimIds;
  return {
    ...record,
    affectedOutputs,
    contradictsClaimIds: Array.isArray(contradictsClaimIds) && claimIds.size > 0 ? contradictsClaimIds.filter((claimId) => claimId !== record.id && claimIds.has(claimId)) : contradictsClaimIds,
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
    if (typeof groupRecord.label !== "string") {
      passthroughGroups.push(group);
      continue;
    }

    const claims: unknown[] = [];
    for (const claim of groupRecord.claims as unknown[]) {
      const normalizedClaim = normalizeSourceEvidenceClaim(claim, claimIds);
      if (typeof normalizedClaim === "object" && normalizedClaim !== null && typeof (normalizedClaim as Record<string, unknown>).id === "string") {
        const claimId = (normalizedClaim as Record<string, unknown>).id as string;
        if (seenClaimIds.has(claimId)) continue;
        seenClaimIds.add(claimId);
      }
      claims.push(normalizedClaim);
    }

    const existingGroup = groupedByLabel.get(groupRecord.label);
    if (existingGroup) {
      existingGroup.claims.push(...claims);
    } else {
      groupedByLabel.set(groupRecord.label, { label: groupRecord.label, claims });
    }
  }

  const orderedGroups = VERIFICATION_LABELS.flatMap((label) => {
    const group = groupedByLabel.get(label);
    return group && group.claims.length > 0 ? [{ label: group.label, count: group.claims.length, claims: group.claims }] : [];
  });
  const unknownLabelGroups = Array.from(groupedByLabel.values()).flatMap((group) => (SOURCE_VERIFICATION_LABELS.has(group.label) || group.claims.length === 0 ? [] : [{ label: group.label, count: group.claims.length, claims: group.claims }]));
  return [...orderedGroups, ...unknownLabelGroups, ...passthroughGroups];
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

function normalizeSourceEvidence(value: unknown) {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const claimIds = new Set<string>();
  if (Array.isArray(record.groups)) {
    for (const group of record.groups) {
      if (typeof group !== "object" || group === null || !Array.isArray((group as Record<string, unknown>).claims)) continue;
      for (const claim of (group as Record<string, unknown>).claims as unknown[]) {
        if (typeof claim === "object" && claim !== null && typeof (claim as Record<string, unknown>).id === "string") claimIds.add((claim as Record<string, unknown>).id as string);
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
  const seenTerminalGapIds = new Set<string>();
  return {
    ...record,
    groups,
    totals,
    conflicts: currentClaims.filter((claim) => claim.label === "Conflicting evidence" || (Array.isArray(claim.contradictsClaimIds) && claim.contradictsClaimIds.length > 0)),
    nextChecks: Array.isArray(record.nextChecks)
      ? record.nextChecks.flatMap((check) => {
          if (typeof check !== "object" || check === null) return [check];
          const checkRecord = check as Record<string, unknown>;
          if (typeof checkRecord.id === "string") {
            if (seenNextCheckIds.has(checkRecord.id)) return [];
            seenNextCheckIds.add(checkRecord.id);
          }
          const checkClaimIds = Array.isArray(checkRecord.claimIds) ? (uniqueStrings(checkRecord.claimIds) as string[]) : checkRecord.claimIds;
          const affectedSections = Array.isArray(checkRecord.affectedSections) ? (uniqueStrings(checkRecord.affectedSections) as string[]) : checkRecord.affectedSections;
          return [{
            ...checkRecord,
            claimIds: Array.isArray(checkClaimIds) && claimIds.size > 0 ? checkClaimIds.filter((claimId) => claimIds.has(claimId)) : checkClaimIds,
            affectedSections: Array.isArray(affectedSections) ? affectedSections.filter((section) => SOURCE_AFFECTED_SECTION_KEYS.has(section)) : affectedSections,
          }];
        })
      : record.nextChecks,
    terminalGaps: Array.isArray(record.terminalGaps)
      ? record.terminalGaps.flatMap((gap) => {
          if (typeof gap !== "object" || gap === null) return [gap];
          const gapRecord = gap as Record<string, unknown>;
          if (typeof gapRecord.id !== "string") return [gap];
          if (seenTerminalGapIds.has(gapRecord.id)) return [];
          seenTerminalGapIds.add(gapRecord.id);
          return [gapRecord];
        })
      : record.terminalGaps,
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

  const sourceDocuments = normalizeSourceDocuments(docs.value.documents);
  const sourceEvidence = normalizeSourceEvidence(docs.value.evidence);
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
