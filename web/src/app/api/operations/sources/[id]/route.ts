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
  "cache-control": "no-cache",
  pragma: "no-cache",
};
const SOURCE_FETCH_TIMEOUT_MS = 10_000;
const SOURCE_DIAGNOSTIC_BODY_LIMIT_BYTES = 64 * 1024;

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

function hasJsonContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

const RETRY_AFTER_HTTP_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function sanitizeRetryAfter(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,5}$/.test(trimmed)) return trimmed;
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

function sanitizeSourceMatchedPath(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\/[A-Za-z0-9/_.\[\]-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeSourcePath(value: string | null | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\/api\/factory\/runs\/[0-9a-f-]{36}(\/documents)?$/i.test(trimmed) ? trimmed : undefined;
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

async function safeReadFullResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

async function safeReadDiagnosticResponseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return { text: undefined, truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = SOURCE_DIAGNOSTIC_BODY_LIMIT_BYTES - bytes;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      if (value.byteLength > remaining) {
        text += decoder.decode(value.slice(0, remaining), { stream: true });
        bytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
    }
  } catch {
    return { text: undefined, truncated };
  }

  return { text: text + decoder.decode(), truncated };
}

function upstreamResponseMetadata(response: Response, elapsedMs: number | undefined, bodyText?: string, sourcePath?: string, bodyTruncated = false) {
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
    sourceServer: sanitizeSourceServer(response.headers.get("server")),
    sourceBodyEmpty: !bodyTruncated && hasEmptyObservedBody(response, bodyText),
    ...(bodyTruncated ? { sourceBodyTruncated: true } : {}),
    ...("value" in contentType ? { sourceContentType: contentType.value } : {}),
    ...("missing" in contentType ? { sourceContentTypeMissing: true } : {}),
  };
}

type UpstreamMetadata = ReturnType<typeof upstreamResponseMetadata>;

function sourceFailureHeaders(result: { retryAfter?: string }) {
  return result.retryAfter ? { ...NO_STORE_HEADERS, "Retry-After": result.retryAfter } : NO_STORE_HEADERS;
}

type SourceStep = "run" | "documents" | "configuration";
type SourceFailureKind = "configuration" | "http_error" | "redirect" | "non_json" | "malformed_json" | "contract_mismatch" | "not_ready" | "timeout" | "network";

function sourceFailureBody(step: SourceStep, body: Record<string, unknown>) {
  return { ...body, sourceStep: step };
}

function hasExplicitEmptyBody(response: Response) {
  return response.headers.get("content-length")?.trim() === "0";
}

function upstreamFailureMetadata(result: { sourceFailureKind?: SourceFailureKind; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceServer?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean }) {
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
    ...(result.sourceServer ? { sourceServer: result.sourceServer } : {}),
    ...(result.sourceBodyEmpty ? { sourceBodyEmpty: true } : {}),
    ...(result.sourceBodyTruncated ? { sourceBodyTruncated: true } : {}),
    ...(result.sourceContentType ? { sourceContentType: result.sourceContentType } : {}),
    ...(result.sourceContentTypeMissing ? { sourceContentTypeMissing: true } : {}),
  };
}

async function fetchSourceJson<T>(
  origin: string,
  path: string,
): Promise<
  | { ok: true; value: T; metadata: UpstreamMetadata }
  | { ok: false; status: number; message: string; path: string; sourceFailureKind: SourceFailureKind; contractMismatch?: boolean; retryAfter?: string; sourcePath?: string; sourceHttpStatus?: number; sourceElapsedMs?: number; sourceRequestId?: string; sourceMatchedPath?: string; sourceCacheStatus?: string; sourceCacheControl?: string; sourceAgeSeconds?: number; sourceResponseDate?: string; sourceContentLength?: number; sourceServer?: string; sourceBodyEmpty?: boolean; sourceBodyTruncated?: boolean; sourceContentType?: string; sourceContentTypeMissing?: boolean }
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
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), diagnosticBody.text, path, diagnosticBody.truncated),
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
        ...upstreamResponseMetadata(response, sourceElapsedMs(startedAt), diagnosticBody.text, path, diagnosticBody.truncated),
      };
    }
    const responseText = await safeReadFullResponseText(response);
    const metadata = upstreamResponseMetadata(response, sourceElapsedMs(startedAt), responseText, path);
    try {
      return { ok: true, value: JSON.parse(responseText ?? "") as T, metadata };
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
  const run = await fetchSourceJson<OperationsSourcePayload["run"]>(origin, `/api/factory/runs/${encodeURIComponent(id)}`);
  if (run.ok) {
    if (!isOperationsRunReadModel(run.value, id)) {
      return sourceJson(
        sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: "The public source did not return a run in the expected shape.", sourceOrigin: origin, ...upstreamFailureMetadata({ sourceFailureKind: "contract_mismatch", ...run.metadata }) }),
        502,
      );
    }

    if (run.value.status !== "partial" && run.value.status !== "completed") {
      return sourceJson(
        sourceFailureBody("run", {
          error: "Campaign source not ready",
          detail: `This campaign is ${run.value.status}, so compiled operations source material is not available yet.`,
          runStatus: run.value.status,
          sourceOrigin: origin,
          ...upstreamFailureMetadata({ sourceFailureKind: "not_ready", ...run.metadata }),
        }),
        409,
      );
    }

    if (!hasUnavailableOperationsRunHeaderProvenance(run.value, false)) {
      return sourceJson(
        sourceFailureBody("run", { error: "Campaign source contract mismatch", detail: "The public source returned an unavailable run header without unavailable provenance.", sourceOrigin: origin, ...upstreamFailureMetadata({ sourceFailureKind: "contract_mismatch", ...run.metadata }) }),
        502,
      );
    }
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

  if (
    !isOperationsCompiledDocumentList(docs.value.documents) ||
    !isOperationsEvidenceAndNextChecks(docs.value.evidence) ||
    !hasConsistentOperationsDocumentEvidence(docs.value.documents, docs.value.evidence)
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
      documents: docs.value.documents,
      evidence: docs.value.evidence,
    } as OperationsSourcePayload,
  );
}
