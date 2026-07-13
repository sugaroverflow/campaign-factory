import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// DEV SESSION COUNTER — in-memory, keyed by an anonymous browser session id
// (cookie). No accounts. Enforces the per-session run cap. Shim: replaced by a
// Postgres-backed counter in M4 so the cap holds across instances.
// ---------------------------------------------------------------------------

export const SID_COOKIE = "cf_sid";

const counts = new Map<string, number>();

export function parseSid(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)cf_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function newSid(): string {
  return randomUUID();
}

export function runCount(sid: string): number {
  return counts.get(sid) || 0;
}

export function incrRun(sid: string): void {
  counts.set(sid, (counts.get(sid) || 0) + 1);
}
