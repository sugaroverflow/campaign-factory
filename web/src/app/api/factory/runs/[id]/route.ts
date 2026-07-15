// GET /api/factory/runs/[id]?after=<seq> — polling fallback for the live view.
// Returns RunReadModel (run header + PUBLIC events since `after`) straight from
// Postgres (pooled). Polling never touches the worker, so it cannot affect run
// execution. after absent ⇒ 0 ⇒ full public history (late-joiner / refresh).

import { NextResponse } from "next/server";
import { getRunReadModel } from "@/lib/factory/store/runs";
import { factoryReadSql } from "../../_lib/worker";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Non-UUID ids must 404 per contract, not surface a Postgres 22P02 as a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const afterRaw = Number(new URL(req.url).searchParams.get("after") ?? "0");
  const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
  const model = await getRunReadModel(factoryReadSql(), id, after);
  if (!model) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(model);
}
