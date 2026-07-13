import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hideRun } from "@/lib/db/wall";

// POST /api/admin/hide — the fire extinguisher. Hide any item from the wall.
// Guarded by the admin key (header x-cf-admin-key). Body: { id }.
export async function POST(req: Request) {
  if (!config.adminKey) return NextResponse.json({ error: "Admin actions are disabled." }, { status: 403 });
  const supplied = (req.headers.get("x-cf-admin-key") || "").trim();
  if (supplied !== config.adminKey) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await hideRun(body.id);
  return NextResponse.json({ ok });
}
