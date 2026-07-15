// Public spectator view of the factory floor: renders the most recent
// presenter batch's live gallery, read-only (polling read model, no tokens,
// no presenter cookie). Used as the conference "watch it live" link; falls
// back honestly to the recorded replay when no batch has run yet.

import { getLatestPresenterBatch, listRunsByBatch } from "@/lib/factory/store/runs";
import { factoryReadSql } from "@/app/api/factory/_lib/worker";
import { LiveBoot } from "./LiveBoot";

export const dynamic = "force-dynamic"; // resolves the current batch per request

export default async function FactoryLivePage() {
  const environmentId = process.env.FACTORY_ENV_ID;
  const batch = environmentId
    ? await getLatestPresenterBatch(factoryReadSql(), environmentId)
    : null;

  if (!batch) {
    return (
      <main className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-2xl font-medium tracking-tight">The factory floor is quiet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No presenter batch has run in this environment yet. You can watch the recorded real run
          instead.
        </p>
        <a
          href="/factory/replay/conference"
          className="mt-6 inline-block rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background"
        >
          Watch the recorded run
        </a>
      </main>
    );
  }

  const runs = await listRunsByBatch(factoryReadSql(), batch.batchId);
  const connections = runs.map((r) => ({
    campaignId: r.campaignId,
    // no streamUrl/token for spectators — the gallery runtime polls
    intake: { problem: r.problem, place: r.place },
  }));

  return (
    <main className="min-h-dvh">
      <LiveBoot batchId={batch.batchId} connections={connections} />
    </main>
  );
}
