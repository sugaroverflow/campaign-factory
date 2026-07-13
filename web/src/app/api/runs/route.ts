import { NextResponse } from "next/server";
import { startRun } from "@/lib/jobs/store";
import { config } from "@/lib/config";
import { overBudget } from "@/lib/db/spend";
import { runCount, incrRun } from "@/lib/db/sessions";
import { SID_COOKIE, parseSid, newSid } from "@/lib/session";
import { type RunInput } from "@/lib/pipeline/types";

// POST /api/runs — start a campaign run. Gate order (all pre-spend):
//   1. readonly (sunset)      → 503 { capacity, reason: "closed" }
//   2. access code            → 401 { error }
//   3. daily budget kill-sw   → 503 { capacity, reason: "budget" }
//   4. per-session run cap     → 429 { error, capReached }
// then start the run and return 202 { id }.
export async function POST(req: Request) {
  // 1. Sunset / maintenance
  if (config.readonly) {
    return NextResponse.json(
      { capacity: true, reason: "closed", error: "Campaign Factory is no longer accepting new runs. You can still open shared campaigns." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Partial<RunInput> & { code?: string };

  // 2. Access code (skipped when unset — local dev). Accept header or body.
  if (config.accessCode) {
    const supplied = (req.headers.get("x-cf-access-code") || b.code || "").trim();
    if (supplied !== config.accessCode) {
      return NextResponse.json({ error: "A valid conference access code is required.", codeRequired: true }, { status: 401 });
    }
  }

  if (typeof b.problem !== "string" || b.problem.trim().length < 8) {
    return NextResponse.json({ error: "A campaign problem (at least a sentence) is required." }, { status: 400 });
  }

  // 3. Global spend kill-switch
  if (await overBudget()) {
    return NextResponse.json(
      { capacity: true, reason: "budget", error: "We're at capacity right now. Explore the campaigns others have made while we catch up." },
      { status: 503 },
    );
  }

  // 4. Per-session run cap
  const cookie = req.headers.get("cookie");
  let sid = parseSid(cookie);
  const isNewSid = !sid;
  if (!sid) sid = newSid();
  if ((await runCount(sid)) >= config.runCap) {
    return NextResponse.json(
      { error: `You've reached the limit of ${config.runCap} runs for this session.`, capReached: true },
      { status: 429 },
    );
  }

  const input: RunInput = {
    problem: b.problem.trim(),
    org: str(b.org),
    location: str(b.location),
    outcome: str(b.outcome),
    dm: str(b.dm),
    timeframe: str(b.timeframe),
    affected: str(b.affected),
    evidence: str(b.evidence),
    resources: str(b.resources),
    // apiKey (BYOK) not accepted from the client yet — server key only for now.
  };

  try {
    await incrRun(sid);
    const state = await startRun(input, sid);
    const res = NextResponse.json({ id: state.id, status: state.status }, { status: 202 });
    if (isNewSid) {
      res.cookies.set(SID_COOKIE, sid, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to start run" }, { status: 500 });
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
