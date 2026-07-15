// GET /api/factory/batches/[batchId] — presenter gallery recovery (backup
// laptop / cleared storage). Presenter-cookie gated like the gallery itself.
// Returns the batch's campaigns (id + intake echo) so GalleryBoot can rebuild
// its tiles, plus the persisted Batch Receipt once the batch is terminal.
// Read-only: pooled Postgres client, never touches the worker.

import { NextResponse } from "next/server";
import { getBatch, listRunsByBatch } from "@/lib/factory/store/runs";
import { PRESENTER_COOKIE, verifyPresenterToken } from "../../present/session";
import { factoryReadSql, readCookie } from "../../_lib/worker";

export const runtime = "nodejs";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

export async function GET(req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const token = readCookie(req.headers.get("cookie"), PRESENTER_COOKIE);
  if (!verifyPresenterToken(token)) {
    return NextResponse.json({ error: "Presenter session required." }, { status: 401 });
  }

  const { batchId } = await ctx.params;
  // Non-UUID ids must 404 per contract, not surface a Postgres 22P02 as a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  const sql = factoryReadSql();
  const batch = await getBatch(sql, batchId);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const runs = await listRunsByBatch(sql, batchId);
  const campaigns = runs.map((r) => ({
    campaignId: r.campaignId,
    problem: r.problem,
    place: r.place,
    status: r.status,
  }));

  const terminal = TERMINAL.has(batch.status);
  return NextResponse.json({
    batchId,
    status: batch.status,
    campaigns,
    ...(terminal && batch.receipt !== undefined ? { receipt: batch.receipt } : {}),
  });
}
