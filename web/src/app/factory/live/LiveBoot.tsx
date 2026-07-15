"use client";

// Client boot for the public spectator view. The server page resolved the
// batch and campaign list; we render the live gallery with no stream tokens,
// so every campaign runtime uses the public polling read model (GET
// /api/factory/runs/[id]). Read-only by construction: spectators hold no
// tokens and no presenter cookie, so nothing on this surface can mutate a run.

import { GalleryLive, type StoredBatchConnection } from "@/components/factory/gallery";

export function LiveBoot({
  batchId,
  connections,
}: {
  batchId: string;
  connections: StoredBatchConnection[];
}) {
  return <GalleryLive batchId={batchId} connections={connections} presenter={false} />;
}
