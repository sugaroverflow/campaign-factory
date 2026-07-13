import { NextResponse } from "next/server";
import { listWall } from "@/lib/db/wall";

// GET /api/wall — the opt-in, non-hidden campaigns for the wall / projector.
export async function GET() {
  const items = await listWall();
  return NextResponse.json({ items });
}
