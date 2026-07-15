// Presenter session (ADR 0013). The presenter CODE is compared server-side and
// NEVER leaves the server: it is not written to the cookie, localStorage, state,
// events, or analytics. Successful auth sets a Secure HttpOnly SameSite cookie
// carrying only a signed, expiring token (exp + HMAC), which the gallery route
// verifies. The HMAC key is FACTORY_SIGNING_SECRET (server-only) — NOT the code:
// keying with the code would let one observed cookie be brute-forced offline
// against candidate codes. The code is compared only at login.

import crypto from "node:crypto";

export const PRESENTER_COOKIE = "cf_presenter";

// Session lifetime. Configurable so it can be shortened for the event window.
function ttlMs(): number {
  const h = Number(process.env.CF_PRESENTER_SESSION_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 12) * 60 * 60 * 1000;
}

// Whether a code is required at all. When CF_PRESENTER_CODE is unset (local dev)
// the gate is open — mirroring how the public run route disables its access code
// in dev — but a signed cookie is still issued and verified.
export function presenterCodeRequired(): boolean {
  return !!(process.env.CF_PRESENTER_CODE || "").trim();
}

function hmacKey(): string {
  return (process.env.FACTORY_SIGNING_SECRET || "").trim() || "cf-dev-presenter-secret";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Constant-time comparison of a supplied code against the configured code. */
export function checkPresenterCode(supplied: string): boolean {
  if (!presenterCodeRequired()) return true; // dev: any code accepted
  const code = (process.env.CF_PRESENTER_CODE || "").trim();
  return timingSafeEqualStr(supplied.trim(), code);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", hmacKey()).update(payload).digest("hex");
}

/** token = `${exp}.${hmac(key, "presenter."+exp)}` — no code material inside. */
export function mintPresenterToken(now: number = Date.now()): string {
  const exp = now + ttlMs();
  return `${exp}.${sign(`presenter.${exp}`)}`;
}

export function verifyPresenterToken(token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(`presenter.${expStr}`);
  return sig.length === expected.length && timingSafeEqualStr(sig, expected);
}

export function presenterCookieMaxAgeSeconds(): number {
  return Math.floor(ttlMs() / 1000);
}
