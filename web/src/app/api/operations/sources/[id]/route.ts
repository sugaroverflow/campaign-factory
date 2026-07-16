import { NextResponse } from "next/server";
import {
  OPERATIONS_DEFAULT_SOURCE_ORIGIN,
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
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
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

function sourceOrigin() {
  return normaliseOperationsSourceOrigin(process.env.OPERATIONS_SOURCE_ORIGIN) ?? OPERATIONS_DEFAULT_SOURCE_ORIGIN;
}

async function fetchSourceJson<T>(origin: string, path: string): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string; path: string }> {
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
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, path, message: `Read-only source ${path} returned HTTP ${response.status}.` };
    }
    try {
      return { ok: true, value: (await response.json()) as T };
    } catch {
      return { ok: false, status: 502, path, message: `Read-only source ${path} returned a non-JSON response.` };
    }
  } catch (error) {
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      path,
      message: timedOut
        ? `Read-only source ${path} timed out after ${SOURCE_FETCH_TIMEOUT_MS / 1000} seconds.`
        : error instanceof Error ? error.message : "The read-only source could not be reached.",
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

  const origin = sourceOrigin();
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
  } else if (run.status === 404) {
    return sourceJson({ error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin }, 404);
  }

  const docs = await fetchSourceJson<Pick<OperationsSourcePayload, "documents" | "evidence">>(origin, `/api/factory/runs/${encodeURIComponent(id)}/documents`);
  if (!docs.ok) {
    return sourceJson(
      { error: "Campaign source documents unavailable", detail: upstreamFailureDetail(docs, run.ok ? undefined : run), sourceOrigin: origin },
      docs.status === 404 ? 404 : docs.status === 504 ? 504 : 502,
    );
  }

  if (!isOperationsCompiledDocumentList(docs.value.documents) || !isOperationsEvidenceAndNextChecks(docs.value.evidence)) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: "The public source did not return compiled documents and evidence in the expected shape.", sourceOrigin: origin },
      502,
    );
  }

  return sourceJson(
    {
      sourceOrigin: origin,
      run: run.ok ? run.value : { campaignId: id, status: "partial", stateVersion: 0, lastSequence: 0, events: [] },
      documents: docs.value.documents,
      evidence: docs.value.evidence,
      sourceRunUnavailable: run.ok ? undefined : true,
    } as OperationsSourcePayload & { sourceRunUnavailable?: boolean },
  );
}
