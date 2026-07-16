import { NextResponse } from "next/server";
import { OPERATIONS_DEFAULT_SOURCE_ORIGIN, isOperationsPublicCampaignId, normaliseOperationsSourceOrigin, type OperationsSourcePayload } from "@/lib/operations/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const READ_ONLY_ALLOW_HEADERS = { ...NO_STORE_HEADERS, Allow: "GET" };

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

async function fetchSourceJson<T>(origin: string, path: string): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string }> {
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, status: response.status, message: `Read-only source returned HTTP ${response.status}.` };
    }
    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof Error ? error.message : "The read-only source could not be reached.",
    };
  }
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
  if (!run.ok) {
    return sourceJson({ error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin }, run.status === 404 ? 404 : 502);
  }
  if (
    run.value.campaignId !== id ||
    !["queued", "running", "partial", "completed", "failed", "cancelled"].includes(run.value.status) ||
    !Array.isArray(run.value.events)
  ) {
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

  const docs = await fetchSourceJson<Pick<OperationsSourcePayload, "documents" | "evidence">>(origin, `/api/factory/runs/${encodeURIComponent(id)}/documents`);
  if (!docs.ok) {
    return sourceJson({ error: "Campaign source documents unavailable", detail: docs.message, sourceOrigin: origin }, docs.status === 404 ? 404 : 502);
  }

  if (!Array.isArray(docs.value.documents) || !docs.value.evidence?.totals || !Array.isArray(docs.value.evidence.nextChecks)) {
    return sourceJson(
      { error: "Campaign source contract mismatch", detail: "The public source did not return compiled documents and evidence in the expected shape.", sourceOrigin: origin },
      502,
    );
  }

  return sourceJson(
    { sourceOrigin: origin, run: run.value, documents: docs.value.documents, evidence: docs.value.evidence } satisfies OperationsSourcePayload,
  );
}
