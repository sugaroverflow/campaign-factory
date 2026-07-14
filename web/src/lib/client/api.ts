import { type RunState } from "@/lib/pipeline/types";

export interface StatusResp {
  accessRequired: boolean;
  readonly: boolean;
  capacity: boolean;
  reason: "closed" | "budget" | null;
  runCap: number;
  runsUsed: number;
  runsRemaining: number;
}

export interface StartResult {
  ok: boolean;
  id?: string;
  status?: number;
  error?: string;
  codeRequired?: boolean;
  capReached?: boolean;
  capacity?: boolean;
  reason?: "closed" | "budget";
}

export async function getStatus(): Promise<StatusResp> {
  const r = await fetch("/api/status", { cache: "no-store" });
  return r.json();
}

export interface StartInput {
  problem: string;
  org?: string;
  location?: string;
  outcome?: string;
  dm?: string;
  timeframe?: string;
  affected?: string;
  evidence?: string;
  resources?: string;
}

export async function startRun(input: StartInput, code?: string): Promise<StartResult> {
  const r = await fetch("/api/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(code ? { "x-cf-access-code": code } : {}),
    },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 202) return { ok: true, id: data.id, status: r.status };
  return {
    ok: false,
    status: r.status,
    error: data.error,
    codeRequired: data.codeRequired,
    capReached: data.capReached,
    capacity: data.capacity,
    reason: data.reason,
  };
}

export async function pollRun(id: string): Promise<RunState | null> {
  const r = await fetch(`/api/runs/${id}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

// localStorage key for the conference access code (entered once, reused).
export const ACCESS_CODE_KEY = "cf_access_code";

// localStorage key for the in-flight/most-recent run, so an accidental refresh
// can drop the user back into their running (or just-finished) campaign instead
// of the empty form. Stored as JSON { id, ts } — see CampaignApp for the
// freshness window that prevents restoring stale runs on later visits.
export const RUN_ID_KEY = "cf_run";

export interface WallItem {
  id: string;
  name: string;
  title: string | null;
  updatedAt: string;
}

export async function getWall(): Promise<WallItem[]> {
  const r = await fetch("/api/wall", { cache: "no-store" });
  if (!r.ok) return [];
  const d = await r.json();
  return d.items ?? [];
}

export async function shareCampaign(id: string, title?: string): Promise<boolean> {
  const r = await fetch(`/api/runs/${id}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return r.ok;
}

export async function unshareCampaign(id: string): Promise<boolean> {
  const r = await fetch(`/api/runs/${id}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unshare: true }),
  });
  return r.ok;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const r = await fetch(`/api/runs/${id}`, { method: "DELETE" });
  return r.ok;
}
