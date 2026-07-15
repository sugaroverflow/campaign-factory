// Factory Runtime Worker entrypoint (ADR 0015/0016). Always-on Node service:
// applies migrations (dev), fails closed on environment identity, provisions
// the checkpoint + queue schemas, wires the durable queue to the campaign
// graph, starts the Postgres LISTEN event transport, and serves the signed
// HTTP + SSE API. Graceful drain on SIGTERM/SIGINT.

import { config, requireDatabaseUrl } from "./config.js";
import { sql, closeSql } from "./db/pool.js";
import { runMigrations } from "./migrate.js";
import { assertEnvironmentIdentity, seedEnvironmentIdentity } from "./store/index.js";
import { setupCheckpointer, closeCheckpointer } from "./graph/checkpointer.js";
import { startQueue, ensureQueues, startWorkers, stopQueue } from "./queue/boss.js";
import { recoverOrphanedRuns } from "./runtime/recover.js";
import { startEventTransport, stopEventTransport } from "./events/hub.js";
import { loadRuntimeAgents } from "./graph/executor-loader.js";
import { makeRunner, deadHandler } from "./graph/run.js";
import { createHttpServer } from "./http/server.js";

async function main(): Promise<void> {
  requireDatabaseUrl();
  console.log(`[worker] starting · env=${config.environmentId} · modelMode=${config.modelMode}`);

  if (config.autoMigrate) {
    console.log("[worker] applying factory migrations…");
    await runMigrations();
  }

  const db = sql();

  // Environment Identity Check (ADR 0014) — seed on first boot, then fail closed.
  await seedEnvironmentIdentity(db, config.environmentId);
  await assertEnvironmentIdentity(db);
  console.log(`[worker] environment identity ok (${config.environmentId})`);

  // Checkpoint schema (lg) + durable queue (pgboss).
  await setupCheckpointer();
  await startQueue();
  await ensureQueues();

  // Crash recovery BEFORE any worker starts polling: pg-boss 11 leaves a
  // crashed process's jobs `active` until lease expiry, so retire stale leases
  // and re-enqueue every still-queued/running run (graph resumes from its
  // checkpoint; singletonKey collapses duplicates).
  const recovered = await recoverOrphanedRuns(db);
  if (recovered > 0) console.log(`[worker] crash recovery: reclaimed ${recovered} orphaned run(s)`);

  // Delegate agent execution to w3 when present; local mock otherwise.
  const agents = await loadRuntimeAgents();
  console.log(`[worker] agent runtime: ${agents.source}`);
  await startWorkers(makeRunner(agents), deadHandler);

  // Wake SSE via Postgres LISTEN; 2s polling fallback.
  await startEventTransport(db);

  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(`[worker] listening on :${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} — draining…`);
    // Stop accepting new HTTP work first.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopEventTransport();
    await stopQueue(); // in-flight runs checkpoint at node boundaries; the boot-time orphan scan reclaims them immediately on restart
    await closeCheckpointer();
    await closeSql();
    console.log("[worker] stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
