"use client";

// Live container for the Campaign Assembly View (W4). Recovers the stream
// coordinates + intake echo from localStorage (cf_factory_run) so a refresh
// drops straight back into the running campaign with its problem/place hero,
// then drives the pure AssemblyView via useFactoryRun. A shared link with no
// stored run still works: the hook bootstraps + polls the public event log.

import { useMemo } from "react";
import { getStoredFactoryRun, useFactoryRun } from "@/lib/factory/client";
import { AssemblyView } from "./AssemblyView";

export function AssemblyClient({ campaignId }: { campaignId: string }) {
  const stored = useMemo(() => getStoredFactoryRun(campaignId), [campaignId]);

  const { run, connection, answerJudgement } = useFactoryRun({
    campaignId,
    streamUrl: stored?.streamUrl,
    streamToken: stored?.streamToken,
    seed: stored?.intake,
  });

  return (
    <main className="min-h-dvh">
      <AssemblyView
        run={run}
        connection={connection}
        onAnswer={(jid, action, answer) => answerJudgement(jid, action, answer)}
      />
    </main>
  );
}
