// Factory Event append/read. appendEvent assigns the next per-campaign sequence
// atomically and fires pg_notify in the SAME transaction so the worker's SSE
// LISTEN wakes with the new (campaignId, sequence). readEvents is the SSE
// resume / polling-fallback / late-joiner path.

import type {
  BatchId,
  CampaignId,
  EventVisibility,
  FactoryEvent,
  FactoryEventPayload,
  FactoryEventType,
} from "../contracts/core";
import type { Db, JsonInput, Row } from "./types";
import { numOrUndef, strOrUndef, toIso } from "./types";

// Everything a FactoryEvent needs except the store-assigned sequence; eventId
// and `at` are filled in when absent.
export type AppendEventInput = Omit<FactoryEvent, "eventId" | "sequence" | "at"> & {
  eventId?: string;
  at?: string;
};

// NOTIFY channel + payload shape consumed by the worker SSE listener.
export const NOTIFY_CHANNEL = "factory_events";
export const notifyPayload = (campaignId: CampaignId, sequence: number): string =>
  `${campaignId}:${sequence}`;

function mapEvent(r: Row): FactoryEvent {
  return {
    eventId: String(r.event_id),
    sequence: Number(r.sequence),
    batchId: strOrUndef(r.batch_id) as BatchId | undefined,
    campaignId: String(r.campaign_id),
    agentRunId: strOrUndef(r.agent_run_id),
    parentAgentRunId: strOrUndef(r.parent_agent_run_id),
    journeyStep: numOrUndef(r.journey_step),
    type: String(r.type) as FactoryEventType,
    at: toIso(r.at),
    stateVersion: numOrUndef(r.state_version),
    visibility: String(r.visibility) as EventVisibility,
    payload: r.payload as FactoryEventPayload,
  };
}

/**
 * Append one Factory Event. Allocates sequence via
 * `UPDATE factory_runs SET last_sequence = last_sequence + 1 RETURNING` (the
 * row lock serialises allocation per campaign), inserts the event, then
 * `pg_notify('factory_events', '<campaignId>:<sequence>')` — all in one
 * transaction. The campaign's run row must already exist.
 */
export async function appendEvent(sql: Db, input: AppendEventInput): Promise<FactoryEvent> {
  const eventId = input.eventId ?? crypto.randomUUID();
  const at = input.at ?? new Date().toISOString();

  return sql.begin(async (tx) => {
    const runRows = await tx<{ last_sequence: string }[]>`
      update factory.factory_runs
         set last_sequence = last_sequence + 1,
             updated_at = now()
       where campaign_id = ${input.campaignId}
      returning last_sequence`;
    if (runRows.length === 0) {
      throw new Error(
        `appendEvent: no factory_runs row for campaign ${input.campaignId} — create the run before appending events`,
      );
    }
    const sequence = Number(runRows[0].last_sequence);

    const rows = await tx<Row[]>`
      insert into factory.factory_events
        (event_id, campaign_id, sequence, batch_id, agent_run_id, parent_agent_run_id,
         journey_step, type, at, state_version, visibility, payload)
      values
        (${eventId}, ${input.campaignId}, ${sequence}, ${input.batchId ?? null},
         ${input.agentRunId ?? null}, ${input.parentAgentRunId ?? null},
         ${input.journeyStep ?? null}, ${input.type}, ${at}, ${input.stateVersion ?? null},
         ${input.visibility}, ${tx.json(input.payload as unknown as JsonInput)})
      returning *`;

    await tx`select pg_notify(${NOTIFY_CHANNEL}, ${notifyPayload(input.campaignId, sequence)})`;

    return mapEvent(rows[0]);
  });
}

/**
 * Read a campaign's events in sequence order after `afterSeq` (exclusive).
 * `visibility` filters to public/internal, or "all" (default). Passing
 * afterSeq=0 with "public" returns the full public history — the late-joiner
 * and replay path.
 */
export async function readEvents(
  sql: Db,
  campaignId: CampaignId,
  afterSeq = 0,
  visibility: EventVisibility | "all" = "all",
): Promise<FactoryEvent[]> {
  const rows =
    visibility === "all"
      ? await sql<Row[]>`
          select * from factory.factory_events
           where campaign_id = ${campaignId} and sequence > ${afterSeq}
           order by sequence asc`
      : await sql<Row[]>`
          select * from factory.factory_events
           where campaign_id = ${campaignId} and sequence > ${afterSeq}
             and visibility = ${visibility}
           order by sequence asc`;
  return rows.map(mapEvent);
}

/** Highest assigned sequence for a campaign (0 if none). */
export async function latestSequence(sql: Db, campaignId: CampaignId): Promise<number> {
  const rows = await sql<{ last_sequence: string }[]>`
    select last_sequence from factory.factory_runs where campaign_id = ${campaignId}`;
  return rows.length ? Number(rows[0].last_sequence) : 0;
}
