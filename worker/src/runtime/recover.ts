// P0 crash recovery (boot-time orphan scan). pg-boss 11 does NOT reclaim a
// crashed worker's `active` jobs on restart: after an ungraceful kill
// (SIGKILL/OOM) the job stays leased until expireInSeconds (~30 min) passes,
// leaving the run un-resumable for the whole lease. So on boot — after the
// queues exist but BEFORE startWorkers() begins polling, and with a single
// worker replica per environment (any `active` job seen here is necessarily a
// dead process's) — every factory_runs row still 'queued'/'running' is
// reclaimed:
//   1. cancel its stale `active` job (retires the lease; cancelled jobs do not
//      dead-letter and no longer hold the singletonKey),
//   2. re-enqueue via enqueueRun — singletonKey collapses onto any surviving
//      created/retry job, so this never creates duplicates.
// The re-delivered job resumes the graph from its checkpoint (run.ts isResume
// path); already-finalised runs no-op via the alreadyFinalised guard.

import type { Sql } from "../db/pool.js";
import { getBoss, enqueueRun, findRunJobs, RUN_QUEUE } from "../queue/boss.js";

interface OrphanRow {
  campaign_id: string;
  batch_id: string | null;
  status: string;
}

export async function recoverOrphanedRuns(s: Sql): Promise<number> {
  const orphans = await s<OrphanRow[]>`
    select campaign_id, batch_id, status
      from factory.factory_runs
     where status in ('queued', 'running')`;
  if (orphans.length === 0) return 0;

  const boss = getBoss();
  let recovered = 0;
  for (const o of orphans) {
    try {
      const jobs = await findRunJobs(o.campaign_id);
      let retired = 0;
      for (const job of jobs) {
        if (job.state === "active") {
          await boss.cancel(RUN_QUEUE, job.id); // retire the dead lease
          retired++;
        }
      }
      // Only enqueue when NO deliverable job survives: the stately policy
      // permits one created AND one retry job per key, so enqueueing alongside
      // a surviving retry job would create a concurrent duplicate.
      const survivor = jobs.some((j) => j.state === "created" || j.state === "retry");
      const jobId = survivor
        ? null
        : await enqueueRun({ campaignId: o.campaign_id, batchId: o.batch_id ?? undefined });
      recovered++;
      console.log(
        `[recover] ${o.campaign_id} (${o.status}): retired ${retired} stale lease(s), ` +
          (survivor ? "deliverable job retained" : jobId ? `re-enqueued as ${jobId}` : "enqueue collapsed (already queued)"),
      );
    } catch (err) {
      // Never block boot on one bad row; the run stays visible in the DB.
      console.error(`[recover] failed to recover ${o.campaign_id}:`, err);
    }
  }
  return recovered;
}
