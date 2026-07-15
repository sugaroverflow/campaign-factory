// POST /api/factory/batches — presenter batch intake (1–5 campaigns). Requires
// a valid presenter session cookie (w5). Presenter batches BYPASS the per-IP and
// per-session caps but NOT the global spend kill-switch. environmentId is
// injected + validated SERVER-side (never trusted from the client). Thin: sign +
// forward to the worker and return its StartBatchResponse.

import { NextResponse } from "next/server";
import { overBudget } from "@/lib/db/spend";
import { PRESENTER_COOKIE, verifyPresenterToken } from "../present/session";
import { forwardSigned, factoryEnvId, readCookie } from "../_lib/worker";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = readCookie(req.headers.get("cookie"), PRESENTER_COOKIE);
  if (!verifyPresenterToken(token)) {
    return NextResponse.json({ error: "Presenter session required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as { intakes?: unknown };
  const intakes = Array.isArray(b.intakes) ? b.intakes : [];
  if (intakes.length < 1 || intakes.length > 5) {
    return NextResponse.json(
      { error: `A presenter batch accepts 1–5 campaigns; received ${intakes.length}.` },
      { status: 400 },
    );
  }
  for (const [i, raw] of intakes.entries()) {
    const it = (raw ?? {}) as { problem?: unknown; place?: unknown };
    if (typeof it.problem !== "string" || it.problem.trim().length < 3) {
      return NextResponse.json({ error: `Campaign ${i + 1}: a problem is required.` }, { status: 400 });
    }
    if (typeof it.place !== "string" || it.place.trim().length < 1) {
      return NextResponse.json({ error: `Campaign ${i + 1}: a named place is required.` }, { status: 400 });
    }
  }

  // Global kill-switch still applies to presenter batches.
  if (await overBudget()) {
    return NextResponse.json(
      { capacity: true, reason: "budget", error: "The daily spend ceiling has been reached." },
      { status: 503 },
    );
  }

  const cleaned = intakes.map((raw) => {
    const it = raw as { problem: string; place: string };
    return { problem: it.problem.trim(), place: it.place.trim() };
  });

  // Presenter demo batches run EXPRESS by default (user decision, 15 Jul):
  // spectacle with completing briefs. Send profile:"full" explicitly for the
  // long-form graph.
  const profileRaw = (b as { profile?: unknown }).profile;
  const profile = profileRaw === "full" ? "full" : "express";

  const forwarded = await forwardSigned("POST", "/batches", {
    intakes: cleaned,
    environmentId: factoryEnvId(),
    profile,
  });
  return NextResponse.json(forwarded.body, { status: forwarded.status });
}
