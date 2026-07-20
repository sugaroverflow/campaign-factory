import { sql, migrate } from "./client";

// Durable per-session run counter (replaces the in-memory shim). Keyed by the
// anonymous cf_sid cookie.
export async function runCount(sid: string): Promise<number> {
  await migrate();
  const rows = await sql`select run_count from sessions where sid = ${sid}`;
  return rows[0] ? Number(rows[0].run_count) : 0;
}

export async function incrRun(sid: string): Promise<void> {
  await migrate();
  await sql`
    insert into sessions (sid, run_count, updated_at) values (${sid}, 1, now())
    on conflict (sid) do update set run_count = sessions.run_count + 1, updated_at = now()
  `;
}

// Per-IP counter — a harder backstop than the cookie session cap.
export async function runCountByIp(ip: string): Promise<number> {
  await migrate();
  const rows = await sql`select run_count from ip_usage where ip = ${ip}`;
  return rows[0] ? Number(rows[0].run_count) : 0;
}

export async function incrIpRun(ip: string): Promise<void> {
  await migrate();
  await sql`
    insert into ip_usage (ip, run_count, updated_at) values (${ip}, 1, now())
    on conflict (ip) do update set run_count = ip_usage.run_count + 1, updated_at = now()
  `;
}

// Atomic "increment-if-below-cap". A single statement claims a run slot: the
// conditional ON CONFLICT ... WHERE means a parallel burst can't slip past a
// read-then-increment gap. Returns true if a slot was claimed, false (empty
// result — no row inserted or updated) if the cap is already reached.
export async function claimRun(sid: string, cap: number): Promise<boolean> {
  await migrate();
  const rows = await sql`
    insert into sessions (sid, run_count, updated_at) values (${sid}, 1, now())
    on conflict (sid) do update set run_count = sessions.run_count + 1, updated_at = now()
    where sessions.run_count < ${cap}
    returning run_count
  `;
  return rows.length > 0;
}

// Give a claimed session slot back when a downstream step fails (floor at 0).
export async function refundRun(sid: string): Promise<void> {
  await migrate();
  await sql`
    update sessions set run_count = greatest(run_count - 1, 0), updated_at = now()
    where sid = ${sid}
  `;
}

// Per-IP atomic claim — same pattern as claimRun, harder backstop.
export async function claimIpRun(ip: string, cap: number): Promise<boolean> {
  await migrate();
  const rows = await sql`
    insert into ip_usage (ip, run_count, updated_at) values (${ip}, 1, now())
    on conflict (ip) do update set run_count = ip_usage.run_count + 1, updated_at = now()
    where ip_usage.run_count < ${cap}
    returning run_count
  `;
  return rows.length > 0;
}

// Give a claimed IP slot back when a downstream step fails (floor at 0).
export async function refundIpRun(ip: string): Promise<void> {
  await migrate();
  await sql`
    update ip_usage set run_count = greatest(run_count - 1, 0), updated_at = now()
    where ip = ${ip}
  `;
}

export type SlotOutcome<T> = { kind: "session_cap" } | { kind: "ip_cap" } | { kind: "done"; result: T };

/** Claim BOTH run counters atomically, run the guarded step, refund on
 * failure — the whole choreography behind one call so a route can't forget a
 * refund leg. Order is load-bearing (commit 7fb2411): session first, then
 * IP; if the IP claim loses after the session claim won, the session slot is
 * refunded. If `fn` throws or `failed(result)` is true, both slots are
 * refunded (throws are rethrown after the refund). */
export async function withRunSlots<T>(
  sid: string,
  ip: string,
  caps: { runCap: number; ipRunCap: number },
  fn: () => Promise<T>,
  failed: (result: T) => boolean,
): Promise<SlotOutcome<T>> {
  if (!(await claimRun(sid, caps.runCap))) return { kind: "session_cap" };
  if (!(await claimIpRun(ip, caps.ipRunCap))) {
    await refundRun(sid);
    return { kind: "ip_cap" };
  }
  try {
    const result = await fn();
    if (failed(result)) {
      await refundRun(sid);
      await refundIpRun(ip);
    }
    return { kind: "done", result };
  } catch (err) {
    await refundRun(sid);
    await refundIpRun(ip);
    throw err;
  }
}
