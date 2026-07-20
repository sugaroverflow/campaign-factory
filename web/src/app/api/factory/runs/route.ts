// POST /api/factory/runs — public single-campaign intake. Thin gate: validate
// problem+place, apply the SAME launch controls as /api/runs (readonly,
// kill-switch, per-IP + per-session caps), then sign + forward to the worker
// and return its StartRunResponse. No business logic beyond gates + signing.

import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { overBudget } from "@/lib/db/spend";
import { claimRun, refundRun, claimIpRun, refundIpRun } from "@/lib/db/sessions";
import { SID_COOKIE, parseSid, newSid, clientIp } from "@/lib/session";
import { forwardSigned, factoryEnvId, type ForwardResult } from "../_lib/worker";

export const runtime = "nodejs";

// Zero-cost key check: /v1/models lists models without spending tokens. Only
// a definite 401/403 counts as "rejected"; network trouble or 5xx must not
// bounce a valid key, so it maps to "unverifiable" (caller returns 502).
async function validateAnthropicKey(key: string): Promise<"ok" | "rejected" | "unverifiable"> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return "ok";
    if (r.status === 401 || r.status === 403) return "rejected";
    return "unverifiable";
  } catch {
    return "unverifiable";
  }
}

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
    anthropicApiKey?: unknown;
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

  // BYOK gate (user decision, 20 Jul 2026): public runs ALWAYS run on the
  // visitor's own Anthropic key — the house key never funds a public run.
  // Admin callers may omit the key (organizer testing on the house key).
  const byokKey = typeof b.anthropicApiKey === "string" ? b.anthropicApiKey.trim() : "";
  if (!byokKey && !isAdmin) {
    return NextResponse.json(
      {
        byokRequired: true,
        error:
          "An Anthropic API key is required — your campaign's agents run on your key, so its cost (typically $1.50–$3, hard-capped at $20) goes to your account.",
      },
      { status: 400 },
    );
  }
  if (byokKey) {
    if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(byokKey)) {
      return NextResponse.json(
        { error: "That doesn't look like an Anthropic API key — they start with sk-ant-. Check for missing characters." },
        { status: 400 },
      );
    }
    const check = await validateAnthropicKey(byokKey);
    if (check !== "ok") {
      return NextResponse.json(
        {
          error:
            check === "rejected"
              ? "Anthropic rejected that API key. Check it in console.anthropic.com → API keys and try again."
              : "We couldn't verify your API key with Anthropic just now — please try again in a moment.",
        },
        { status: check === "rejected" ? 400 : 502 },
      );
    }
  }

  // Global spend kill-switch — house-key runs only. BYOK runs spend the
  // visitor's own budget, so they never trip (or count toward) ours.
  if (!byokKey && (await overBudget())) {
    return NextResponse.json(
      { capacity: true, reason: "budget", error: "We're at capacity right now. Explore existing campaigns while we catch up." },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  let sid = parseSid(req.headers.get("cookie"));
  const isNewSid = !sid;
  if (!sid) sid = newSid();

  // Claim BOTH counters atomically BEFORE forwarding — a parallel burst must not
  // slip past a check-then-act gap. Order: session then IP; if the IP claim loses
  // its race after the session claim already succeeded, refund the session slot.
  if (!isAdmin) {
    if (!(await claimRun(sid, config.runCap))) {
      return NextResponse.json(
        { error: `You've reached the limit of ${config.runCap} runs for this session.`, capReached: true },
        { status: 429 },
      );
    }
    if (!(await claimIpRun(ip, config.ipRunCap))) {
      await refundRun(sid);
      return NextResponse.json(
        { error: `This network has reached its run limit (${config.ipRunCap}).`, capReached: true },
        { status: 429 },
      );
    }
  }

  // Sign + forward (environmentId + profile injected server-side — never
  // trusted from the client). Public solo runs use the cheaper express profile;
  // presenter batches stay on "full" (worker default). If the run is NOT created
  // (throw or non-2xx from the worker), refund both claimed slots.
  let forwarded: ForwardResult;
  try {
    forwarded = await forwardSigned("POST", "/runs", {
      intake: { problem: problem.trim(), place: place.trim() },
      mode: "public",
      profile: "express",
      environmentId: factoryEnvId(),
      ...(byokKey ? { byokAnthropicKey: byokKey } : {}),
    });
  } catch (err) {
    if (!isAdmin) {
      await refundRun(sid);
      await refundIpRun(ip);
    }
    throw err;
  }
  if (forwarded.status >= 400) {
    if (!isAdmin) {
      await refundRun(sid);
      await refundIpRun(ip);
    }
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
