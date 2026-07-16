import { NextResponse } from "next/server";
import { OPERATIONS_DEFAULT_SOURCE_ORIGIN, isOperationsPublicCampaignId, type OperationsSourcePayload } from "@/lib/operations/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sourceOrigin() {
  const raw = process.env.OPERATIONS_SOURCE_ORIGIN?.trim() || OPERATIONS_DEFAULT_SOURCE_ORIGIN;
  return raw.replace(/\/+$/, "");
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
    return NextResponse.json(
      { error: "Operations source not found", detail: "This read-only preview source path only exposes the curated public operations campaigns." },
      { status: 404 },
    );
  }

  const origin = sourceOrigin();
  const run = await fetchSourceJson<OperationsSourcePayload["run"]>(origin, `/api/factory/runs/${encodeURIComponent(id)}`);
  if (!run.ok) {
    return NextResponse.json({ error: "Campaign source run unavailable", detail: run.message, sourceOrigin: origin }, { status: run.status === 404 ? 404 : 502 });
  }
  if (
    run.value.campaignId !== id ||
    !["queued", "running", "partial", "completed", "failed", "cancelled"].includes(run.value.status) ||
    !Array.isArray(run.value.events)
  ) {
    return NextResponse.json(
      { error: "Campaign source contract mismatch", detail: "The public source did not return a run in the expected shape.", sourceOrigin: origin },
      { status: 502 },
    );
  }

  const docs = await fetchSourceJson<Pick<OperationsSourcePayload, "documents" | "evidence">>(origin, `/api/factory/runs/${encodeURIComponent(id)}/documents`);
  if (!docs.ok) {
    return NextResponse.json({ error: "Campaign source documents unavailable", detail: docs.message, sourceOrigin: origin }, { status: docs.status === 404 ? 404 : 502 });
  }

  if (!Array.isArray(docs.value.documents) || !docs.value.evidence?.totals || !Array.isArray(docs.value.evidence.nextChecks)) {
    return NextResponse.json(
      { error: "Campaign source contract mismatch", detail: "The public source did not return compiled documents and evidence in the expected shape.", sourceOrigin: origin },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { sourceOrigin: origin, run: run.value, documents: docs.value.documents, evidence: docs.value.evidence } satisfies OperationsSourcePayload,
    { headers: { "Cache-Control": "no-store" } },
  );
}
