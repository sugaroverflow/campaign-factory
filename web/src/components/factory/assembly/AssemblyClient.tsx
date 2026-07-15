"use client";

// Live container for the Campaign Assembly View (W4). Recovers the stream
// coordinates + intake echo from localStorage (cf_factory_run) so a refresh
// drops straight back into the running campaign with its problem/place hero,
// then drives the pure AssemblyView via useFactoryRun. A shared link with no
// stored run still works: the hook bootstraps + polls the public event log.
//
// Completed-brief upgrade: once the run is terminal we try W2's durable read
// route (GET /runs/[id]/documents — coordinator ruling 15 Jul 2026) for W6's
// compiled document bodies + evidence ledger. If it isn't available the view
// simply keeps its honest status-only surfaces.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCompiledCampaign,
  getStoredFactoryRun,
  isTerminal,
  useFactoryRun,
  type CompiledCampaignBundle,
} from "@/lib/factory/client";
import { AssemblyView } from "./AssemblyView";

export function AssemblyClient({ campaignId }: { campaignId: string }) {
  const stored = useMemo(() => getStoredFactoryRun(campaignId), [campaignId]);

  const { run, connection, answerJudgement } = useFactoryRun({
    campaignId,
    streamUrl: stored?.streamUrl,
    streamToken: stored?.streamToken,
    seed: stored?.intake,
  });

  const [compiled, setCompiled] = useState<CompiledCampaignBundle | null>(null);
  const attempted = useRef(false);
  useEffect(() => {
    if (attempted.current || !isTerminal(run.status)) return;
    attempted.current = true;
    let cancelled = false;
    // W2 emits the terminal run.* event only AFTER finalisation persists the
    // compiled output, so the first attempt should succeed; a couple of spaced
    // retries cover propagation lag (route answers 409 while non-terminal).
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        const bundle = await fetchCompiledCampaign(campaignId);
        if (cancelled) return;
        if (bundle) {
          setCompiled(bundle);
          return;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run.status, campaignId]);

  return (
    <main className="min-h-dvh">
      <AssemblyView
        run={run}
        connection={connection}
        compiled={compiled}
        onAnswer={(jid, action, answer) => answerJudgement(jid, action, answer)}
      />
    </main>
  );
}
