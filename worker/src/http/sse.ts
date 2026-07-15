// Run-scoped SSE stream (contracts/api.ts). Event name "factory", id = sequence,
// data = FactoryEvent JSON (PUBLIC visibility only). Heartbeat comment every 15s.
// Reconnect via Last-Event-ID or ?after=<sequence>.
//
// Ordering guarantee: subscribe to the hub, then drain from `after` — a serial
// drain keyed on lastSent sequence means backfill history is flushed before
// live tailing with no gap and no duplicate at the seam. `after` absent ⇒ 0 ⇒
// full public log from the start (late joiners fold the whole history).

import type { ServerResponse } from "node:http";
import type { Sql } from "../db/pool.js";
import { readEvents } from "../store/index.js";
import { hub } from "../events/hub.js";
import { SSE_EVENT_NAME, SSE_HEARTBEAT_MS } from "@web/lib/factory/contracts/api.js";
import type { FactoryEvent } from "@web/lib/factory/contracts/core.js";

export function handleSse(
  res: ServerResponse,
  opts: { sql: Sql; campaignId: string; afterSequence: number },
): void {
  const { sql, campaignId } = opts;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  // Kick the stream open + advise reconnect backoff.
  res.write(`retry: 3000\n`);
  res.write(`: connected campaign=${campaignId}\n\n`);

  let lastSent = opts.afterSequence;
  let draining = false;
  let pending = false;
  let closed = false;

  const writeEvent = (e: FactoryEvent) => {
    res.write(`id: ${e.sequence}\n`);
    res.write(`event: ${SSE_EVENT_NAME}\n`);
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  const drain = async () => {
    if (draining) {
      pending = true;
      return;
    }
    draining = true;
    try {
      do {
        pending = false;
        const events = await readEvents(sql, campaignId, lastSent, "public");
        for (const e of events) {
          if (closed) return;
          writeEvent(e);
          lastSent = e.sequence;
        }
      } while (pending && !closed);
    } catch (err) {
      if (!closed) console.error(`[sse] drain error campaign=${campaignId}:`, err);
    } finally {
      draining = false;
    }
  };

  const unsubscribe = hub.subscribe(campaignId, () => {
    void drain();
  });

  const heartbeat = setInterval(() => {
    if (!closed) res.write(`: ping\n\n`);
  }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.on("close", cleanup);
  res.on("error", cleanup);

  // Backfill history from `after`, then live tailing takes over via the hub.
  void drain();
}
