// Durable run queue (ADR 0016): pg-boss in its own `pgboss` schema. One job per
// campaign run. Retry lease + dead-letter configured. TWO pg-boss 11 gotchas
// are handled explicitly here — do not regress them:
//  1. No crash reclaim: a crashed worker's `active` jobs stay leased until
//     expireInSeconds passes; runtime/recover.ts retires stale leases at boot
//     and re-enqueues (graph resumes from checkpoint).
//  2. No intra-subscription concurrency: work() delivers a fetch's jobs to ONE
//     handler call and fetches nothing more until it returns — concurrency
//     requires N separate work() slots of batchSize=1 (see startWorkers).
// Dead-lettered work becomes a VISIBLE Terminal Gap event, never a hidden item.

import PgBoss from "pg-boss";
import { QUEUE_SCHEMA } from "@web/lib/factory/contracts/tables.js";
import { RUNTIME_LIMITS } from "@web/lib/factory/contracts/limits.js";
import { config, needsSsl, requireDatabaseUrl } from "../config.js";
import { sql } from "../db/pool.js";

export const RUN_QUEUE = "campaign-run";
export const RUN_DEAD_QUEUE = "campaign-run-dead";

export interface RunJobData {
  campaignId: string;
  batchId?: string;
}

// Long enough that a full campaign (hard limit 20 min) finishes inside one
// lease, so a healthy long run is never re-delivered as a duplicate.
const JOB_EXPIRE_SECONDS = Math.ceil(RUNTIME_LIMITS.hardCampaignLimitMs / 1000) + 600;

export type RunFn = (data: RunJobData) => Promise<void>;
export type DeadFn = (data: RunJobData, reason: string) => Promise<void>;

let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not started");
  return boss;
}

export async function startQueue(): Promise<PgBoss> {
  const url = requireDatabaseUrl();
  boss = new PgBoss({
    connectionString: url,
    schema: QUEUE_SCHEMA,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    application_name: "campaign-factory-worker-queue",
  });
  boss.on("error", (err) => console.error("[pg-boss] error:", err));
  await boss.start();
  return boss;
}

// Queue provisioning only — split from worker subscription so the boot-time
// orphan-recovery scan can run in between (before anything starts polling).
export async function ensureQueues(): Promise<void> {
  const b = getBoss();
  // The dead-letter queue must exist before it is referenced as a deadLetter.
  await b.createQueue(RUN_DEAD_QUEUE, { policy: "standard" });

  // Policy "stately", NOT "standard": pg-boss only enforces singletonKey
  // uniqueness via partial indexes scoped to non-standard policies (see
  // plans.js job_i1/i3/i6) — on a standard queue singletonKey deduplicates
  // NOTHING. Stately allows at most one created + one retry + one active job
  // per singleton key, which is the "one live job per campaign" we need.
  //
  // createQueue is ON CONFLICT DO NOTHING and updateQueue forbids policy
  // changes, so an existing queue with the old policy must be dropped and
  // recreated. Safe here: this runs before any worker polls, job rows are
  // transport (factory_runs is the durable truth), and the boot orphan scan
  // immediately re-enqueues every still-live run.
  const existing = await b.getQueue(RUN_QUEUE);
  if (existing && existing.policy !== "stately") {
    console.warn(
      `[queue] migrating ${RUN_QUEUE} policy '${existing.policy}' -> 'stately' (drops transport job rows; orphan scan re-enqueues live runs)`,
    );
    await b.deleteQueue(RUN_QUEUE);
  }
  await b.createQueue(RUN_QUEUE, {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: JOB_EXPIRE_SECONDS,
    deadLetter: RUN_DEAD_QUEUE,
  });
}

export async function startWorkers(run: RunFn, dead: DeadFn): Promise<void> {
  const b = getBoss();

  // Main workers: N INDEPENDENT single-job slots, not one batchSize=N handler.
  // REGRESSION NOTE (live batch defect, 15 Jul 2026): pg-boss 11's work() loop
  // is fetch(batchSize) → await handler(jobs) → fetch again — a single
  // subscription with batchSize=5 hands up to 5 jobs to ONE handler call and
  // fetches NOTHING further until that call returns. A 5th campaign enqueued
  // just after a 4-job fetch therefore sat queued for the whole first wave
  // (~20 min), violating ADR 0003's five-concurrent-graphs requirement. v11 has
  // no teamSize/concurrency option, but each work() call registers its own
  // worker with an independent polling loop — so N slots of batchSize=1 keep
  // delivery continuous. Per-model-call fairness stays in the gate; a slot that
  // throws fails only ITS job (per-job retry/dead-letter, no batch coupling).
  const slots = RUNTIME_LIMITS.campaignsPerPresenterBatch;
  for (let i = 0; i < slots; i++) {
    await b.work<RunJobData>(RUN_QUEUE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await run(job.data);
    });
  }

  // Dead-letter drain: turn a give-up into a visible Terminal Gap, not silence.
  await b.work<RunJobData>(RUN_DEAD_QUEUE, { batchSize: 5 }, async (jobs) => {
    for (const j of jobs) {
      try {
        await dead(j.data, "Run dead-lettered after exhausting retries");
      } catch (err) {
        console.error("[pg-boss] dead-letter handler error:", err);
      }
    }
  });
}

export async function enqueueRun(data: RunJobData): Promise<string | null> {
  return getBoss().send(RUN_QUEUE, data, {
    // One live job per campaign: with the stately policy a second created job
    // for the same key conflicts (ON CONFLICT DO NOTHING) and send returns null.
    singletonKey: data.campaignId,
    expireInSeconds: JOB_EXPIRE_SECONDS,
  });
}

export interface RunJobRef {
  id: string;
  state: string;
}

// Find this campaign's live queue jobs by singletonKey. pg-boss job ids are
// its own UUIDs (NOT the campaignId), so lookup goes through singleton_key.
export async function findRunJobs(campaignId: string): Promise<RunJobRef[]> {
  const s = sql();
  const rows = await s<RunJobRef[]>`
    select id::text as id, state::text as state
      from ${s(QUEUE_SCHEMA)}.job
     where name = ${RUN_QUEUE}
       and singleton_key = ${campaignId}
       and state in ('created', 'retry', 'active')`;
  return rows;
}

// Cancel a still-queued (not yet active) job. A running job is stopped in-process
// via the abort controller + DB status; this just avoids a wasted pickup.
export async function cancelQueuedRun(campaignId: string): Promise<void> {
  const b = getBoss();
  try {
    for (const job of await findRunJobs(campaignId)) {
      if (job.state === "created" || job.state === "retry") {
        await b.cancel(RUN_QUEUE, job.id);
      }
    }
  } catch {
    /* best-effort; graph-level cancellation is authoritative */
  }
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, wait: false });
    boss = null;
  }
  void config;
}
