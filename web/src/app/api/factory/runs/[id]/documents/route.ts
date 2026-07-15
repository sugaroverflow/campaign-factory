// GET /api/factory/runs/[id]/documents — durable server read path for a
// FINISHED campaign's full compiled documents + Evidence and Next Checks. The
// live view is events-only (document.status carries inline content <32KB); this
// route is the durable path for the big bodies. Terminal runs only. Pooled
// client, public data only.

import { NextResponse } from "next/server";
import { getRun } from "@/lib/factory/store/runs";
import { getAcceptedState } from "@/lib/factory/store/state-versions";
import { getClaims } from "@/lib/factory/store/evidence";
import { compileDocuments, buildEvidenceAndNextChecks } from "@/lib/factory/documents";
import { factoryReadSql } from "../../../_lib/worker";

export const runtime = "nodejs";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Non-UUID ids must 404 per contract, not surface a Postgres 22P02 as a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const sql = factoryReadSql();

  const run = await getRun(sql, id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!TERMINAL.has(run.status)) {
    return NextResponse.json(
      { error: "Documents are available once the campaign has finished.", status: run.status },
      { status: 409 },
    );
  }

  const state = await getAcceptedState(sql, id);
  const claims = await getClaims(sql, id);
  const documents = compileDocuments(state, claims);
  const evidence = buildEvidenceAndNextChecks(state, claims);
  return NextResponse.json({ documents, evidence });
}
