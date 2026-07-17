// GET /api/factory/runs/[id]?after=<seq> — polling fallback for the live view.
// Returns RunReadModel (run header + PUBLIC events since `after`) straight from
// Postgres (pooled). Polling never touches the worker, so it cannot affect run
// execution. after absent ⇒ 0 ⇒ full public history (late-joiner / refresh).

import { NextResponse } from "next/server";
import { getRunReadModel } from "@/lib/factory/store/runs";
import { factoryReadSql } from "../../_lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_READ_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function factoryJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_READ_HEADERS });
}

function factoryReadUnavailable() {
  return factoryJson(
    { error: "Factory read store unavailable", detail: "The public campaign read model could not be reached. Try again later." },
    503,
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Non-UUID ids must 404 per contract, not surface a Postgres 22P02 as a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return factoryJson({ error: "Run not found" }, 404);
  }
  const afterRaw = Number(new URL(req.url).searchParams.get("after") ?? "0");
  const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
  let model: Awaited<ReturnType<typeof getRunReadModel>>;
  try {
    model = await getRunReadModel(factoryReadSql(), id, after);
  } catch (error) {
    console.error("Factory run read failed", error);
    return factoryReadUnavailable();
  }
  if (!model) return factoryJson({ error: "Run not found" }, 404);
  return factoryJson(model);
}
