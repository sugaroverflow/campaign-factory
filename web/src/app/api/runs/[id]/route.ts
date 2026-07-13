import { NextResponse } from "next/server";
import { getRun } from "@/lib/jobs/store";
import { deleteRun } from "@/lib/db/wall";
import { parseSid } from "@/lib/session";

// GET /api/runs/[id] — poll run progress + the partial campaign.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = await getRun(id);
  if (!state) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(state);
}

// DELETE /api/runs/[id] — owner (browser session) deletes their campaign.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sid = parseSid(req.headers.get("cookie"));
  if (!sid) return NextResponse.json({ error: "Not the owner of this campaign." }, { status: 403 });
  const ok = await deleteRun(id, sid);
  if (!ok) return NextResponse.json({ error: "Not found, or you don't own this campaign." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
