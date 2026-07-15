// HMAC signing (contracts/api.ts). The web app signs every non-SSE request with
// the shared service secret; the worker verifies. The browser NEVER sees the
// service secret — it gets a short-lived run-scoped stream token instead.
//
//   signature      = hex(HMAC_SHA256(secret, `${timestamp}.${method}.${path}.${body}`))
//   reject if |now - timestamp| > 60_000 ms
//   stream token   = `${runId}.${exp}.${hex(HMAC_SHA256(secret, `${runId}.${exp}`))}`
//
// `timestamp` and `exp` are millisecond epochs (Date.now()). Both sides of this
// boundary are owned by W2, so the convention is internally consistent.

import { createHmac, timingSafeEqual } from "node:crypto";
import { STREAM_TOKEN_TTL_MS } from "@web/lib/factory/contracts/api.js";

const SKEW_MS = 60_000;

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp = Date.now(),
): { signature: string; timestamp: number } {
  const signature = hmacHex(secret, `${timestamp}.${method.toUpperCase()}.${path}.${body}`);
  return { signature, timestamp };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export function verifyRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: "missing signature" };
  if (!timestampHeader) return { ok: false, reason: "missing timestamp" };
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(Date.now() - ts) > SKEW_MS) return { ok: false, reason: "timestamp skew" };
  const expected = hmacHex(secret, `${ts}.${method.toUpperCase()}.${path}.${body}`);
  if (!safeEqualHex(expected, signatureHeader)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

export function mintStreamToken(secret: string, runId: string, ttlMs = STREAM_TOKEN_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const sig = hmacHex(secret, `${runId}.${exp}`);
  return `${runId}.${exp}.${sig}`;
}

export function verifyStreamToken(secret: string, token: string, runId: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [tokenRunId, expStr, sig] = parts;
  if (tokenRunId !== runId) return { ok: false, reason: "run mismatch" };
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "bad exp" };
  if (Date.now() > exp) return { ok: false, reason: "token expired" };
  const expected = hmacHex(secret, `${tokenRunId}.${exp}`);
  if (!safeEqualHex(expected, sig)) return { ok: false, reason: "bad token signature" };
  return { ok: true };
}
