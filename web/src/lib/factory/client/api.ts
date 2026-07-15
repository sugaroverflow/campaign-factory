// Browser → web API helpers for the public factory intake (W4). The web app's
// /api/factory/runs route (W2) is a thin signed gate/proxy to the worker; it
// fills environmentId server-side, so the client sends only the intake + mode.
// Built against contracts/api.ts StartRunResponse so it works the moment W2's
// route lands.

import type { CampaignIntake, StartRunResponse } from "@/lib/factory/contracts";

export interface StartFactoryResult {
  ok: boolean;
  data?: StartRunResponse;
  status?: number;
  error?: string;
}

export async function startFactoryRun(intake: CampaignIntake): Promise<StartFactoryResult> {
  try {
    const r = await fetch("/api/factory/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intake, mode: "public" }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 202 || r.ok) {
      // 202 Accepted is the contract's start response; tolerate 200 as well.
      if (data && typeof data.campaignId === "string") {
        return { ok: true, data: data as StartRunResponse, status: r.status };
      }
      return { ok: false, status: r.status, error: "The run started but returned no campaign id." };
    }
    return {
      ok: false,
      status: r.status,
      error: (data && (data.error as string)) || defaultError(r.status),
    };
  } catch {
    return { ok: false, error: "Couldn't reach the factory. Check your connection and try again." };
  }
}

function defaultError(status: number): string {
  if (status === 404) return "The factory isn't accepting runs yet.";
  if (status === 429 || status === 503) return "The factory is at capacity right now — try again shortly.";
  if (status >= 500) return "The factory hit an error starting your run. Please try again.";
  return "Something went wrong starting your run. Please try again.";
}
