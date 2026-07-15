// In-process fan-out of "campaign X has new events" wakeups to SSE connections.
// Fed by Postgres LISTEN 'factory_events' (payload `${campaignId}:${sequence}`),
// with a 2s polling fallback if LISTEN is unavailable. On a wakeup the SSE
// handler re-reads events > lastSent from the DB, so a missed NOTIFY is
// self-correcting on the next wakeup.

import type { Sql } from "../db/pool.js";
import { NOTIFY_CHANNEL } from "../store/index.js";

type Listener = (campaignId: string, latestSequence?: number) => void;

class EventHub {
  private readonly subs = new Map<string, Set<Listener>>();

  subscribe(campaignId: string, listener: Listener): () => void {
    let set = this.subs.get(campaignId);
    if (!set) {
      set = new Set();
      this.subs.set(campaignId, set);
    }
    set.add(listener);
    return () => {
      const s = this.subs.get(campaignId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.subs.delete(campaignId);
    };
  }

  notify(campaignId: string, latestSequence?: number): void {
    const set = this.subs.get(campaignId);
    if (!set) return;
    for (const l of set) {
      try {
        l(campaignId, latestSequence);
      } catch {
        /* one bad listener must not break the others */
      }
    }
  }

  subscribedCampaigns(): string[] {
    return [...this.subs.keys()];
  }
}

export const hub = new EventHub();

let unlisten: (() => Promise<void>) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let mode: "listen" | "poll" | "off" = "off";

export function transportMode(): "listen" | "poll" | "off" {
  return mode;
}

function startPolling(): void {
  if (pollTimer) return;
  mode = "poll";
  pollTimer = setInterval(() => {
    for (const campaignId of hub.subscribedCampaigns()) hub.notify(campaignId);
  }, 2000);
}

// Try LISTEN; on any failure, degrade to polling. Never throws.
export async function startEventTransport(sql: Sql): Promise<void> {
  try {
    const meta = await sql.listen(
      NOTIFY_CHANNEL,
      (payload: string) => {
        const idx = payload.lastIndexOf(":");
        const campaignId = idx > 0 ? payload.slice(0, idx) : payload;
        const seq = idx > 0 ? Number(payload.slice(idx + 1)) : undefined;
        hub.notify(campaignId, Number.isFinite(seq) ? seq : undefined);
      },
      () => {
        // (re)subscribed — postgres.js reconnects and re-listens automatically
      },
    );
    unlisten = meta.unlisten;
    mode = "listen";
  } catch (err) {
    console.warn("[events] LISTEN unavailable, falling back to 2s polling:", err);
    startPolling();
  }
}

export async function stopEventTransport(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unlisten) {
    try {
      await unlisten();
    } catch {
      /* ignore */
    }
    unlisten = null;
  }
  mode = "off";
}
