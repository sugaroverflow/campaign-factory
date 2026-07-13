import { NextResponse } from "next/server";
import { getRun } from "@/lib/jobs/store";

// GET /api/runs/[id] — poll run progress + the partial campaign.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = getRun(id);
  if (!state) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(state);
}
