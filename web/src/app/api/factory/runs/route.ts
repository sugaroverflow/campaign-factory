// POST /api/factory/runs — public single-campaign intake. Thin gate: validate
// problem+place, resolve the visitor's BYOK key (required for non-admin runs;
// lib/byok.ts owns that whole decision), apply the budget kill-switch to
// house-key runs, claim the session+IP slots around a signed forward to the
// worker, and return its StartRunResponse. No business logic beyond gates.

import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { overBudget } from "@/lib/db/spend";
import { withRunSlots } from "@/lib/db/sessions";
import { resolveByok } from "@/lib/byok";
import { SID_COOKIE, parseSid, newSid, clientIp } from "@/lib/session";
import { forwardSigned, factoryEnvId, type ForwardResult } from "../_lib/worker";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (config.readonly) {
    return NextResponse.json(
      { capacity: true, reason: "closed", error: "The Campaign Factory is not accepting new runs right now." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as {
    intake?: { problem?: unknown; place?: unknown };
    problem?: unknown;
    place?: unknown;
    apiKey?: unknown;
    anthropicApiKey?: unknown; // legacy client field name
  };
  const problem = typeof b.intake?.problem === "string" ? b.intake.problem : (b.problem as string);
  const place = typeof b.intake?.place === "string" ? b.intake.place : (b.place as string);
  if (typeof problem !== "string" || problem.trim().length < 3) {
    return NextResponse.json({ error: "A campaign problem is required." }, { status: 400 });
  }
  if (problem.trim().length > 2000) {
    return NextResponse.json({ error: "That campaign problem is too long — please keep it under 2000 characters." }, { status: 400 });
  }
  if (typeof place !== "string" || place.trim().length < 1) {
    return NextResponse.json({ error: "A named place is required — no run accepts a blank place." }, { status: 400 });
  }
  if (place.trim().length > 200) {
    return NextResponse.json({ error: "That place name is too long — please keep it under 200 characters." }, { status: 400 });
  }

  const isAdmin = !!config.adminKey && (req.headers.get("x-cf-admin-key") || "").trim() === config.adminKey;

  const byok = await resolveByok(b.apiKey ?? b.anthropicApiKey, isAdmin);
  if (!byok.ok) return NextResponse.json(byok.body, { status: byok.status });

  // Global spend kill-switch — house-key runs only. BYOK runs spend the
  // visitor's own budget, so they never trip (or count toward) ours.
  if (!byok.key && (await overBudget())) {
    return NextResponse.json(
      { capacity: true, reason: "budget", error: "We're at capacity right now. Explore existing campaigns while we catch up." },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  let sid = parseSid(req.headers.get("cookie"));
  const isNewSid = !sid;
  if (!sid) sid = newSid();

  // Sign + forward (environmentId + profile injected server-side — never
  // trusted from the client). Public solo runs use the cheaper express
  // profile. Non-admin callers pass through the slot choreography, which
  // refunds both counters when the run is NOT created.
  const forward = () =>
    forwardSigned("POST", "/runs", {
      intake: { problem: problem.trim(), place: place.trim() },
      mode: "public",
      profile: "express",
      environmentId: factoryEnvId(),
      ...(byok.key ? { byokKey: byok.key, byokProvider: byok.provider } : {}),
    });

  let forwarded: ForwardResult;
  if (isAdmin) {
    forwarded = await forward();
  } else {
    const outcome = await withRunSlots(
      sid,
      ip,
      { runCap: config.runCap, ipRunCap: config.ipRunCap },
      forward,
      (r) => r.status >= 400,
    );
    if (outcome.kind === "session_cap") {
      return NextResponse.json(
        { error: `You've reached the limit of ${config.runCap} runs for this session.`, capReached: true },
        { status: 429 },
      );
    }
    if (outcome.kind === "ip_cap") {
      return NextResponse.json(
        { error: `This network has reached its run limit (${config.ipRunCap}).`, capReached: true },
        { status: 429 },
      );
    }
    forwarded = outcome.result;
  }
  if (forwarded.status >= 400) {
    return NextResponse.json(forwarded.body, { status: forwarded.status });
  }

  const res = NextResponse.json(forwarded.body, { status: forwarded.status });
  if (isNewSid) {
    res.cookies.set(SID_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return res;
}
