import { sql, migrate } from "./client";

export interface WallItem {
  id: string;
  name: string;
  title: string | null;
  updatedAt: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

// Opt-in, non-hidden campaigns, newest first.
export async function listWall(limit = 60): Promise<WallItem[]> {
  await migrate();
  const rows = await sql`
    select id,
           campaign->>'name' as name,
           wall_title as title,
           updated_at
    from runs
    where shared = true and hidden = false
    order by updated_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({ id: r.id as string, name: (r.name as string) || "Untitled campaign", title: (r.title as string) ?? null, updatedAt: iso(r.updated_at) }));
}

// Owner-gated (browser session): only the session that created the run may act.
export async function shareToWall(id: string, sid: string, title?: string): Promise<boolean> {
  await migrate();
  const res = await sql`update runs set shared = true, wall_title = ${title ?? null} where id = ${id} and owner_sid = ${sid}`;
  return res.count > 0;
}

export async function unshare(id: string, sid: string): Promise<boolean> {
  await migrate();
  const res = await sql`update runs set shared = false where id = ${id} and owner_sid = ${sid}`;
  return res.count > 0;
}

export async function deleteRun(id: string, sid: string): Promise<boolean> {
  await migrate();
  const res = await sql`delete from runs where id = ${id} and owner_sid = ${sid}`;
  return res.count > 0;
}

export async function isOwner(id: string, sid: string): Promise<boolean> {
  await migrate();
  const rows = await sql`select 1 from runs where id = ${id} and owner_sid = ${sid}`;
  return rows.length > 0;
}

// Admin fire-extinguisher: hide any item from the wall (not owner-gated).
export async function hideRun(id: string): Promise<boolean> {
  await migrate();
  const res = await sql`update runs set hidden = true where id = ${id}`;
  return res.count > 0;
}
