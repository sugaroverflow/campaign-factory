"use client";

// Client boot for the gallery.
//
// Primary path: the per-campaign stream coordinates were stashed in localStorage
// by the presenter intake step on THIS device — read them synchronously via a
// mount snapshot (no server/client mismatch, no setState-in-effect) and stream.
//
// Recovery path (backup laptop, second tab, or cleared localStorage): fall back
// to W2's batch read endpoint GET /api/factory/batches/[batchId], which returns
// the campaign ids (+ problem/place). We reconnect WITHOUT stream tokens — the
// gallery's per-campaign runtime then simply polls the read model. If the batch
// can't be recovered we say so honestly rather than showing a blank screen.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { GalleryLive, getBatch, type StoredBatchConnection } from "@/components/factory/gallery";

const noopSubscribe = () => () => {};

interface BatchReadModel {
  batchId: string;
  campaigns: Array<{ campaignId: string; problem?: string; place?: string }>;
}

export function GalleryBoot({ batchId, presenter }: { batchId: string; presenter: boolean }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const local = useMemo(
    () => (mounted ? (getBatch(batchId)?.connections ?? null) : null),
    [mounted, batchId],
  );

  if (!mounted) return null;
  if (local && local.length > 0) {
    return <GalleryLive batchId={batchId} connections={local} presenter={presenter} />;
  }
  return <BatchRecovery batchId={batchId} presenter={presenter} />;
}

// No local stream coordinates → try to recover the batch by id from the server.
function BatchRecovery({ batchId, presenter }: { batchId: string; presenter: boolean }) {
  const [result, setResult] = useState<"loading" | "missing" | StoredBatchConnection[]>("loading");

  useEffect(() => {
    let cancelled = false;
    // setState runs only inside the async callbacks below (not synchronously in
    // the effect body), so this stays a genuine external subscription.
    fetch(`/api/factory/batches/${encodeURIComponent(batchId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<BatchReadModel>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const conns: StoredBatchConnection[] = (data.campaigns ?? []).map((c) => ({
          campaignId: c.campaignId,
          // no streamUrl/token on a recovered device → the runtime polls
          intake: c.problem || c.place ? { problem: c.problem ?? "", place: c.place ?? "" } : undefined,
        }));
        setResult(conns.length > 0 ? conns : "missing");
      })
      .catch(() => {
        if (!cancelled) setResult("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  if (result === "loading") {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center text-sm text-muted-foreground">
        Recovering batch…
      </div>
    );
  }

  if (result === "missing") {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-2xl font-medium tracking-tight">This batch isn&apos;t open on this device</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The live stream for this batch couldn&apos;t be recovered here — start a new batch to run
          the factory again.
        </p>
        <a
          href="/factory/multi-campaign-demo"
          className="mt-6 inline-block rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background"
        >
          Start a new batch
        </a>
      </div>
    );
  }

  return <GalleryLive batchId={batchId} connections={result} presenter={presenter} />;
}
