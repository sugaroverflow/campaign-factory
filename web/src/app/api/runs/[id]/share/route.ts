import { NextResponse } from "next/server";
import { shareToWall, unshare } from "@/lib/db/wall";
import { parseSid } from "@/lib/session";

// POST /api/runs/[id]/share — owner opts their campaign into the wall.
// Body: { title?: string, unshare?: boolean }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sid = parseSid(req.headers.get("cookie"));
  if (!sid) return NextResponse.json({ error: "Not the owner of this campaign." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { title?: string; unshare?: boolean };
  const ok = body.unshare
    ? await unshare(id, sid)
    : await shareToWall(id, sid, typeof body.title === "string" ? body.title.trim().slice(0, 120) : undefined);

  if (!ok) return NextResponse.json({ error: "Not found, or you don't own this campaign." }, { status: 403 });
  return NextResponse.json({ ok: true, shared: !body.unshare });
}
