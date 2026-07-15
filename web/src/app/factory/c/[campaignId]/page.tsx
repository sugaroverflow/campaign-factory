// Public Campaign Brief route (W4). Server component: unwrap the async params
// (Next 16 — params is a Promise), then hand off to the live client container.
// The brief opens immediately and the client attaches the SSE/polling stream;
// there is no server data fetch for the page body (the read model is
// events-only and the client folds it). generateMetadata does ONE small run
// lookup so the tab is titled with the campaign's name.

import type { Metadata } from "next";
import { AssemblyClient } from "@/components/factory/assembly/AssemblyClient";
import { factorySql } from "@/lib/factory/store/client";
import { getRun } from "@/lib/factory/store/runs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same derivation as the gallery cards' short name (deriveShortName in
// components/factory/gallery/viewModel.ts — replicated locally because that
// module is frozen for this build and takes a folded RunVM, which a server
// component doesn't have): first comma-segment of the place, falling back to
// the first three words of the problem.
function deriveCampaignName(place?: string, problem?: string): string | undefined {
  const p = (place || "").split(",")[0]?.trim();
  if (p) return p.length > 18 ? `${p.slice(0, 17)}…` : p;
  const prob = (problem || "").trim();
  if (prob) {
    const words = prob.split(/\s+/).slice(0, 3).join(" ");
    return words.length > 18 ? `${words.slice(0, 17)}…` : words;
  }
  return undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}): Promise<Metadata> {
  const { campaignId } = await params;
  if (UUID_RE.test(campaignId)) {
    try {
      const run = await getRun(factorySql(), campaignId);
      const name = run ? deriveCampaignName(run.place, run.problem) : undefined;
      if (name) {
        return {
          title: `${name} · Campaign brief`,
          description: run?.problem || undefined,
        };
      }
    } catch {
      // metadata must never break the page (db unreachable, etc.)
    }
  }
  return { title: "Campaign brief" };
}

export default async function CampaignAssemblyPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  // One small header read so a SHARED link renders an honest problem/place
  // hero even when the stored event log carries no run.started detail. The
  // body stays events-only and client-folded; failures fall back cleanly.
  let problem: string | undefined;
  let place: string | undefined;
  if (UUID_RE.test(campaignId)) {
    try {
      const run = await getRun(factorySql(), campaignId);
      problem = run?.problem || undefined;
      place = run?.place || undefined;
    } catch {
      // db unreachable — the client still renders from events/seedless
    }
  }
  return <AssemblyClient campaignId={campaignId} problem={problem} place={place} />;
}
