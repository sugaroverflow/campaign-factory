import { NextResponse } from "next/server";
import {
  OPERATIONS_DEFAULT_SOURCE_ORIGIN,
  hasConsistentOperationsDocumentEvidence,
  hasSyntheticUnavailableOperationsRunHeader,
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
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const READ_ONLY_ALLOW_HEADERS = { ...NO_STORE_HEADERS, Allow: "GET" };
const SOURCE_FETCH_TIMEOUT_MS = 10_000;

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

function hasJsonContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

async function fetchSourceJson<T>(
  origin: string,
  path: string,
): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string; path: string; contractMismatch?: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SOURCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${origin}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      const redirectDetail = isRedirectStatus(response.status) ? " Redirects are not followed for preview-safe source reads." : "";
      return { ok: false, status: response.status, path, message: `Read-only source ${path} returned HTTP ${response.status}.${redirectDetail}` };
    }
    if (!hasJsonContentType(response)) {
      return { ok: false, status: 502, path, contractMismatch: true, message: `Read-only source ${path} returned a non-JSON content type.` };
    }
    try {
      return { ok: true, value: (await response.json()) as T };
    } catch {
      return { ok: false, status: 502, path, contractMismatch: true, message: `Read-only source ${path} returned a non-JSON response.` };
    }
  } catch {
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      path,
      message: timedOut
        ? `Read-only source ${path} timed out after ${SOURCE_FETCH_TIMEOUT_MS / 1000} seconds.`
        : "The read-only source could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamFailureDetail(primary: { message: string }, secondary?: { status: number; path: string }) {
  return secondary ? `${primary.message} The run header also failed at ${secondary.path} with HTTP ${secondary.status}.` : primary.message;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id) || !isOperationsPublicCampaignId(id)) {
    return sourceJson(
      { error: "Operations source not found", detail: "This read-only preview source path only exposes the curated public operations campaigns." },
      404,
    );
  }

  const originResult = sourceOrigin();
  if (!originResult.ok) {
    return sourceJson(
      { error: "Operations source origin unavailable", detail: "The configured read-only operations source origin is not allow-listed." },
      502,
    );
  }

  const origin = originResult.origin;
  const run = await fetchSourceJson<OperationsSourcePayload["run"]>(origin, `/api/factory/runs/${encodeURIComponent(id)}`);
  if (run.ok) {
    if (!isOperationsRunReadModel(run.value, id)) {
      return sourceJson(
        { error: "Campaign source contract mismatch", detail: "The public source did not return a run in the expected shape.", sourceOrigin: origin },
        502,
      );
    }

    if (run.value.status !== "partial" && run.value.status !== "completed") {
      return sourceJson(
        {
          error: "Campaign source not ready",
          detail: `This campaign is ${run.value.status}, so compiled operations source material is not available yet.`,
          runStatus: run.value.status,
          sourceOrigin: origin,
        },
        409,
      );
    }

    if (!hasUnavailableOperationsRunHeaderProvenance(run.value, false)) {
      return sourceJson(
        { error: "Campaign source contract mismatch", detail: "The public source returned an unavailable run header without unavailable provenance.", sourceOrigin: origin },
        502,
      );
    }
  } else if (run.status === 404) {
    return sourceJson({ error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin }, 404);
  } else if (isRedirectStatus(run.status)) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: "The public source run redirected instead of returning the allow-listed read-only run contract.", sourceOrigin: origin },
      502,
    );
  } else if (run.contractMismatch) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: run.message, sourceOrigin: origin },
      502,
    );
  }

  const docs = await fetchSourceJson<Pick<OperationsSourcePayload, "documents" | "evidence">>(origin, `/api/factory/runs/${encodeURIComponent(id)}/documents`);
  if (!docs.ok) {
    if (isRedirectStatus(docs.status)) {
      return sourceJson(
        { error: "Campaign source contract mismatch", detail: "The public source documents redirected instead of returning the allow-listed read-only document contract.", sourceOrigin: origin },
        502,
      );
    }

    if (docs.contractMismatch) {
      return sourceJson(
        { error: "Campaign source contract mismatch", detail: docs.message, sourceOrigin: origin },
        502,
      );
    }

    return sourceJson(
      { error: "Campaign source documents unavailable", detail: upstreamFailureDetail(docs, run.ok ? undefined : run), sourceOrigin: origin },
      docs.status === 404 ? 404 : docs.status === 504 ? 504 : 502,
    );
  }

  if (
    !isOperationsCompiledDocumentList(docs.value.documents) ||
    !isOperationsEvidenceAndNextChecks(docs.value.evidence) ||
    !hasConsistentOperationsDocumentEvidence(docs.value.documents, docs.value.evidence)
  ) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: "The public source did not return compiled documents and evidence in the expected shape.", sourceOrigin: origin },
      502,
    );
  }

  const responseRun = run.ok ? run.value : ({ campaignId: id, status: "partial", stateVersion: 0, lastSequence: 0, events: [] } as OperationsSourcePayload["run"]);
  if (!run.ok && !hasSyntheticUnavailableOperationsRunHeader(responseRun)) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: "The public source adapter could not produce an honest unavailable run header.", sourceOrigin: origin },
      502,
    );
  }

  return sourceJson(
    {
      sourceOrigin: origin,
      run: responseRun,
      documents: docs.value.documents,
      evidence: docs.value.evidence,
      sourceRunUnavailable: run.ok ? undefined : true,
    } as OperationsSourcePayload,
  );
}
