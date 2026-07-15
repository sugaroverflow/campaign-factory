#!/usr/bin/env node
// promote-replay.mjs — back-office replay promotion (ADR 0001 / parameters §7).
// There is NO in-product promotion path; this CLI is the only way to promote.
//
// Usage:
//   node scripts/promote-replay.mjs <batchId|campaignId> [--label-date ISO] [--no-pin]
//   node scripts/promote-replay.mjs --list
//   node scripts/promote-replay.mjs --pin <manifestId>
//
// Promotion snapshots ALL public factory_events for the run/batch (plus batch +
// campaign metadata and final receipts) into ONE immutable factory.replay_manifests
// row and repins the fixed route /factory/replay/conference to it. Manifests are
// never mutated after creation; re-promotion writes a NEW row and repins the
// pointer — the ROUTE never changes. Validates the run/batch is terminal first.

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const REPLAY_ROUTE = "/factory/replay/conference";
// Mirrors web/src/lib/factory/contracts/api.ts replayLabel() (kept in sync by hand;
// this script is .mjs and cannot import the .ts contract).
const replayLabel = (iso) => `Recorded real run · ${String(iso).slice(0, 10)}`;
const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

// ---- db ----

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
      const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local */
  }
  throw new Error("DATABASE_URL not set (env or web/.env.local)");
}

function connect() {
  const url = loadDbUrl();
  const needsSsl = /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
  return postgres(url, { ssl: needsSsl ? "require" : false, max: 4 });
}

// ---- mapping ----

const toIso = (v) => (v instanceof Date ? v.toISOString() : v == null ? undefined : String(v));
const numOr = (v) => (v == null ? undefined : Number(v));
const strOr = (v) => (v == null ? undefined : String(v));

function mapEvent(r) {
  return {
    eventId: String(r.event_id),
    sequence: Number(r.sequence),
    batchId: strOr(r.batch_id),
    campaignId: String(r.campaign_id),
    agentRunId: strOr(r.agent_run_id),
    parentAgentRunId: strOr(r.parent_agent_run_id),
    journeyStep: numOr(r.journey_step),
    type: String(r.type),
    at: toIso(r.at),
    stateVersion: numOr(r.state_version),
    visibility: String(r.visibility),
    payload: r.payload,
  };
}

function campaignMeta(run) {
  return {
    campaignId: String(run.campaign_id),
    batchId: strOr(run.batch_id),
    problem: String(run.problem ?? ""),
    place: String(run.place ?? ""),
    mode: String(run.mode ?? "presenter"),
    status: String(run.status),
    createdAt: toIso(run.created_at),
    startedAt: toIso(run.started_at),
    completedAt: toIso(run.completed_at),
    costUsd: numOr(run.cost_usd),
    lastSequence: numOr(run.last_sequence),
    stateVersion: numOr(run.state_version),
  };
}

// ---- reads ----

async function publicEvents(sql, campaignId) {
  const rows = await sql`
    select event_id, campaign_id, sequence, batch_id, agent_run_id, parent_agent_run_id,
           journey_step, type, at, state_version, visibility, payload
      from factory.factory_events
     where campaign_id = ${campaignId} and visibility = 'public'
     order by sequence asc`;
  return rows.map(mapEvent);
}

function lastReceiptDetail(events) {
  let detail;
  for (const e of events) if (e.type === "receipt.campaign") detail = e.payload?.detail ?? e.payload;
  return detail;
}

// ---- pin ----

async function pin(sql, id) {
  const rows = await sql`select route from factory.replay_manifests where id = ${id}`;
  if (rows.length === 0) throw new Error(`No manifest ${id}`);
  const route = rows[0].route ?? null;
  await sql.begin(async (tx) => {
    if (route != null) {
      await tx`
        update factory.replay_manifests set pinned = false, updated_at = now()
         where route = ${route} and id <> ${id} and pinned = true`;
    }
    await tx`update factory.replay_manifests set pinned = true, updated_at = now() where id = ${id}`;
  });
  return route;
}

// ---- modes ----

async function listManifests(sql) {
  const rows = await sql`
    select id, label, route, pinned, created_at,
           jsonb_array_length(campaign_ids) as campaigns,
           (manifest->'counts'->>'events') as events
      from factory.replay_manifests
     order by created_at desc`;
  if (rows.length === 0) {
    console.log("No replay manifests.");
    return;
  }
  console.log(`${rows.length} manifest(s):\n`);
  for (const r of rows) {
    console.log(
      `${r.pinned ? "★ PINNED" : "  ------"}  ${r.id}\n` +
        `           ${r.label}  ·  route ${r.route ?? "(none)"}  ·  ${r.campaigns ?? 0} campaigns  ·  ${r.events ?? "?"} events  ·  ${toIso(r.created_at)}\n`,
    );
  }
}

async function promote(sql, ref, { labelDate, doPin }) {
  const batchRows = await sql`select * from factory.factory_batches where batch_id = ${ref}`;
  let source;
  let runs;
  let batch = null;

  if (batchRows.length) {
    batch = batchRows[0];
    runs = await sql`select * from factory.factory_runs where batch_id = ${ref} order by created_at asc`;
    if (runs.length === 0) throw new Error(`Batch ${ref} has no campaign runs`);
    source = { kind: "batch", batchId: ref };
  } else {
    const runRows = await sql`select * from factory.factory_runs where campaign_id = ${ref}`;
    if (runRows.length === 0) throw new Error(`No batch or campaign matches id ${ref}`);
    runs = runRows;
    source = { kind: "campaign", batchId: strOr(runRows[0].batch_id) };
  }

  // Validate terminal.
  const nonTerminal = runs.filter((r) => !TERMINAL.has(String(r.status)));
  if (nonTerminal.length) {
    throw new Error(
      `Refusing to promote: ${nonTerminal.length} campaign run(s) are not terminal ` +
        `(${nonTerminal.map((r) => `${r.campaign_id}:${r.status}`).join(", ")}). ` +
        `A replay must be a real completed run.`,
    );
  }
  if (batch && !TERMINAL.has(String(batch.status))) {
    console.warn(`Warning: batch status is "${batch.status}" though all runs are terminal — proceeding.`);
  }

  const campaignIds = runs.map((r) => String(r.campaign_id));
  source.campaignIds = campaignIds;
  source.runIds = campaignIds; // campaign_id == run id in this schema

  // Collect public events per campaign, then a single global time-ordered log.
  const perCampaign = await Promise.all(campaignIds.map((id) => publicEvents(sql, id)));
  const events = perCampaign
    .flat()
    .sort((a, b) => {
      const at = Date.parse(a.at) || 0;
      const bt = Date.parse(b.at) || 0;
      if (at !== bt) return at - bt;
      if (a.campaignId !== b.campaignId) return a.campaignId < b.campaignId ? -1 : 1;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
  if (events.length === 0) throw new Error("Refusing to promote: no public events found for this run/batch.");

  const receipts = { campaigns: {} };
  if (batch && batch.receipt != null) receipts.batch = batch.receipt;
  campaignIds.forEach((id, i) => {
    const d = lastReceiptDetail(perCampaign[i]);
    if (d != null) receipts.campaigns[id] = d;
  });

  const environmentId = String(
    (batch && batch.environment_id) || runs[0].environment_id || process.env.FACTORY_ENV_ID || "unknown",
  );

  // Label date: explicit flag, else the completion timestamp, else now.
  const completionIso =
    labelDate ||
    toIso(batch?.completed_at) ||
    runs.map((r) => toIso(r.completed_at)).filter(Boolean).sort().pop() ||
    new Date().toISOString();
  const label = replayLabel(completionIso);
  const promotedAt = new Date().toISOString();

  const body = {
    version: 1,
    label,
    labelDate: completionIso,
    promotedAt,
    environmentId,
    route: REPLAY_ROUTE,
    source,
    batch: batch
      ? {
          batchId: String(batch.batch_id),
          environmentId: String(batch.environment_id),
          mode: String(batch.mode),
          status: String(batch.status),
          size: Number(batch.size),
          createdAt: toIso(batch.created_at),
          completedAt: toIso(batch.completed_at),
          receipt: batch.receipt ?? undefined,
        }
      : undefined,
    campaigns: runs.map(campaignMeta),
    events,
    receipts,
    counts: {
      campaigns: campaignIds.length,
      events: events.length,
      firstEventAt: events[0].at,
      lastEventAt: events[events.length - 1].at,
    },
  };

  const id = randomUUID();
  await sql`
    insert into factory.replay_manifests
      (id, label, environment_id, route, batch_id, campaign_ids, manifest, pinned)
    values
      (${id}, ${label}, ${environmentId}, ${REPLAY_ROUTE},
       ${source.kind === "batch" ? source.batchId : null},
       ${sql.json(campaignIds)}, ${sql.json(body)}, false)`;

  let pinnedNote = "created (not pinned; use --pin to activate)";
  if (doPin) {
    await pin(sql, id);
    pinnedNote = `PINNED to ${REPLAY_ROUTE}`;
  }

  console.log(
    `Promoted ${source.kind} ${ref}\n` +
      `  manifest id : ${id}\n` +
      `  label       : ${label}\n` +
      `  campaigns   : ${campaignIds.length}\n` +
      `  events      : ${events.length}\n` +
      `  environment : ${environmentId}\n` +
      `  ${pinnedNote}`,
  );
}

// ---- main ----

async function main() {
  const args = process.argv.slice(2);
  const sql = connect();
  try {
    if (args.includes("--list")) {
      await listManifests(sql);
      return;
    }
    const pinIdx = args.indexOf("--pin");
    if (pinIdx !== -1) {
      const id = args[pinIdx + 1];
      if (!id) throw new Error("--pin requires a manifestId");
      const route = await pin(sql, id);
      console.log(`Pinned manifest ${id} to route ${route ?? REPLAY_ROUTE}`);
      return;
    }

    const positional = args.filter((a) => !a.startsWith("--"));
    const ref = positional[0];
    if (!ref) {
      console.log(
        "Usage:\n" +
          "  node scripts/promote-replay.mjs <batchId|campaignId> [--label-date ISO] [--no-pin]\n" +
          "  node scripts/promote-replay.mjs --list\n" +
          "  node scripts/promote-replay.mjs --pin <manifestId>",
      );
      process.exitCode = 1;
      return;
    }
    const ldIdx = args.indexOf("--label-date");
    const labelDate = ldIdx !== -1 ? args[ldIdx + 1] : undefined;
    if (ldIdx !== -1 && (!labelDate || Number.isNaN(Date.parse(labelDate)))) {
      throw new Error("--label-date requires a valid ISO date");
    }
    const doPin = !args.includes("--no-pin");
    await promote(sql, ref, { labelDate, doPin });
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(`promote-replay: ${e.message}`);
  process.exitCode = 1;
});
