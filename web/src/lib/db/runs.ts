import { sql, migrate } from "./client";
import { type RunState } from "@/lib/pipeline/types";

// Our typed objects are JSON-serialisable but don't structurally satisfy the
// driver's strict JSONValue index-signature type; cast to the exact param type.
const json = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

function rowToState(r: Record<string, unknown>): RunState {
  const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: r.id as string,
    status: r.status as RunState["status"],
    stages: r.stages as RunState["stages"],
    notes: r.notes as string[],
    campaign: r.campaign as RunState["campaign"],
    costUSD: Number(r.cost_usd),
    startedAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function saveRun(s: RunState): Promise<void> {
  await migrate();
  await sql`
    insert into runs (id, status, stages, notes, campaign, cost_usd, updated_at)
    values (${s.id}, ${s.status}, ${json(s.stages)}, ${json(s.notes)}, ${json(s.campaign)}, ${s.costUSD}, now())
    on conflict (id) do update set
      status = excluded.status,
      stages = excluded.stages,
      notes = excluded.notes,
      campaign = excluded.campaign,
      cost_usd = excluded.cost_usd,
      updated_at = now()
  `;
}

export async function setRunOwner(id: string, sid: string): Promise<void> {
  await migrate();
  await sql`update runs set owner_sid = ${sid} where id = ${id}`;
}

export async function getRunState(id: string): Promise<RunState | null> {
  await migrate();
  const rows = await sql`
    select id, status, stages, notes, campaign, cost_usd, created_at, updated_at
    from runs where id = ${id}
  `;
  return rows[0] ? rowToState(rows[0]) : null;
}
