// Presenter auth route (ADR 0013). POST { code } → compares against
// CF_PRESENTER_CODE server-side with per-IP attempt throttling, and on success
// sets a Secure HttpOnly SameSite cookie holding only a signed expiring token.
// DELETE clears the session. The code is never logged, echoed, or stored.

import { NextResponse } from "next/server";
import { clientIp } from "@/lib/session";
import {
  PRESENTER_COOKIE,
  checkPresenterCode,
  mintPresenterToken,
  presenterCodeRequired,
  presenterCookieMaxAgeSeconds,
} from "./session";

export const runtime = "nodejs";

// --- Simple in-memory per-IP attempt throttle ---
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
type Bucket = { count: number; resetAt: number };
const attempts = new Map<string, Bucket>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const b = attempts.get(ip);
  if (!b || b.resetAt < now) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return b.count >= MAX_ATTEMPTS;
}
function recordFailure(ip: string): void {
  const now = Date.now();
  const b = attempts.get(ip);
  if (!b || b.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else b.count += 1;
}
function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  if (throttled(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  // Access-code lock removed for the conference (user decision, 15 Jul 2026):
  // any visitor may open a presenter session and fire a batch. Spend remains
  // bounded by the per-batch stop and the daily kill-switch. If a code IS
  // configured and supplied, a wrong code still fails (so the old flow keeps
  // working); an absent code simply proceeds.
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — sessions no longer require a code
  }
  const code = typeof (body as { code?: unknown })?.code === "string" ? (body as { code: string }).code : "";

  if (code.trim() && presenterCodeRequired() && !checkPresenterCode(code)) {
    recordFailure(ip);
    return NextResponse.json({ error: "That presenter code was not recognised." }, { status: 401 });
  }

  clearAttempts(ip);
  const res = NextResponse.json({ ok: true, codeRequired: false }, { status: 200 });
  res.cookies.set(PRESENTER_COOKIE, mintPresenterToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: presenterCookieMaxAgeSeconds(),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(PRESENTER_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
