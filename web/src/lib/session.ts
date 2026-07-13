// Cookie helpers for the anonymous browser session. The run-count itself is now
// durable in Postgres — see @/lib/db/sessions.
import { randomUUID } from "node:crypto";

export const SID_COOKIE = "cf_sid";

export function parseSid(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)cf_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function newSid(): string {
  return randomUUID();
}

// Best-effort client IP for the per-IP run cap. On Vercel the real client IP is
// the first entry of x-forwarded-for.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "local";
}
