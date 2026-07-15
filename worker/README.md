# Factory Runtime Worker

The always-on Node service that runs the multi-agent Campaign Factory (ADR
[0015](../docs/adr/0015-run-langgraph-in-dedicated-environment-workers.md) /
[0016](../docs/adr/0016-use-an-oss-langgraph-worker-on-railway.md)). Agent execution deliberately
does **not** run inside Vercel functions: this worker owns the durable queue, the LangGraph graph,
the Postgres checkpoints, and the event stream. The Next.js app ([`../web`](../web)) talks to it only
across a signed HTTP boundary and reads Factory Events back over SSE. Product plan and whole-repo
context: [`../README.md`](../README.md), [`../docs/product/factory-implementation-parameters.md`](../docs/product/factory-implementation-parameters.md).

**Node 22+.** Cross-package: the worker imports runtime-neutral domain code from `web/src/lib/**`
(contracts, store, agents, documents, the Anthropic client) via tsconfig paths — LangGraph/pg-boss
code lives only here, and nothing that imports `next/*` is pulled in.

## Architecture

```
web (signed HTTP)                                          browser (SSE)
      │ POST /runs, /batches, /cancel, /judgements               ▲
      ▼                                                           │
  http/server.ts ──► queue/boss.ts (pg-boss, durable Postgres queue)
                          │ deliver job (singletonKey per campaign)
                          ▼
                  graph/run.ts ──► graph/build.ts  (LangGraph JS)
                          │             nodes ► agents/executor.ts, reviewer.ts, qa.ts
                          │             checkpoint each node ► graph/checkpointer.ts (PostgresSaver)
                          ▼
                  store/index.ts appends Factory Events to Postgres
                          │
                          ▼
                  events/hub.ts (Postgres LISTEN, 2s poll fallback) ──► http/sse.ts ──► browser
```

- **Queue → graph.** A signed `POST /runs` (or `/batches`) creates the run row, emits `run.queued`,
  and enqueues a `pg-boss` job. The worker delivers it to the LangGraph graph, which runs the
  fifteen-agent campaign over one shared state (`graph/state.ts`).
- **Checkpoint / resume.** Every node boundary is written to a `PostgresSaver` checkpoint
  (`graph/checkpointer.ts`), so a re-delivered job resumes from its last node rather than restarting.
- **Orphan recovery.** pg-boss 11 leaves a crashed process's jobs leased for ~30 min. On boot —
  after queues exist but **before** workers start polling — `runtime/recover.ts` scans for
  `queued`/`running` runs, retires stale leases, and re-enqueues them (singletonKey collapses
  duplicates). Single replica per environment is assumed.
- **Events.** Nodes append Factory Events to Postgres; `events/hub.ts` wakes SSE via `LISTEN`
  (2 s polling fallback), and `http/sse.ts` streams them with `?after=` / `Last-Event-ID` resume.
- **Guards at node boundaries.** `cost.ts` and the concurrency `gate.ts` are checked before each
  model node; the graph `finalise.ts` node is the single writer of terminal status.

## Endpoints

All non-SSE endpoints require an HMAC signature over `${ts}.${METHOD}.${path}.${rawBody}`
(`x-factory-timestamp` + `x-factory-signature`, ≤60 s skew). SSE authenticates via a **run-scoped
stream token** only — the service secret is never accepted from a browser. `/health` and `/ready`
are unauthenticated probes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/runs` | HMAC | Start one public/presenter campaign → `202 { campaignId, streamToken, streamUrl }`. |
| `POST` | `/batches` | HMAC | Start a presenter batch of **1–5** campaigns (a 6th is rejected, not queued) → `202 { batchId, campaigns[] }`. |
| `POST` | `/runs/:id/cancel` | HMAC | Durable cancel signal + in-flight abort; the `finalise` node writes the terminal `run.cancelled`. |
| `POST` | `/runs/:id/judgements/:jid` | HMAC | Resolve a Judgement Request (`answer` / `accept_default` / `defer`). |
| `GET` | `/runs/:id/events` | stream token | SSE Factory Event stream. Token in `?token=`; resumable via `?after=` or `Last-Event-ID`. |
| `GET` | `/health` | none | Process + config snapshot (pid, uptime, model mode, event transport, gate) — no DB. |
| `GET` | `/ready` | none | Readiness: DB reachable + factory/checkpoint/queue schemas present + model config valid (no token spend). |

## Environment variables

Env file precedence: `worker/.env` wins, then `../web/.env.local` fills gaps; the real environment
(Railway service variables) wins over both. Copy [`​.env.example`](.env.example) to `worker/.env`
to start. Names only below — no values are committed.

| Variable | Default | Purpose |
|---|---|---|
| `FACTORY_DATABASE_URL` | — | Direct/unpooled Postgres for checkpoints, queue, migrations. Falls back to `DATABASE_URL_UNPOOLED` → `DATABASE_URL`. |
| `FACTORY_DB_POOL_MAX` | `5` | postgres.js pool ceiling for the worker's store/LISTEN connections. |
| `PGSSL` | auto | Set `require` to force SSL when the URL doesn't advertise it (Neon is auto-detected). |
| `FACTORY_ENV_ID` | `factory-dev` | Declared environment identity (ADR 0014). Must match the DB marker row or **boot fails closed**. |
| `FACTORY_SIGNING_SECRET` | — | Shared HMAC secret for signed endpoints. **Must match the web app.** |
| `FACTORY_WORKER_URL` | `http://localhost:8787` | Worker base URL as seen from the web server. |
| `NEXT_PUBLIC_FACTORY_WORKER_URL` | `http://localhost:8787` | Browser-facing base URL used to build the SSE stream URLs handed back to clients. |
| `PORT` | `8787` | HTTP listen port (Railway injects `PORT`). |
| `FACTORY_MODEL_MODE` | `mock` | `mock` = deterministic fixtures, zero model calls; `live` = real Anthropic. |
| `ANTHROPIC_API_KEY` | — | Required for `live` runs (usually inherited from `../web/.env.local`). `/ready` checks presence without spending. |
| `CF_PRESENTER_CODE` | — | Presenter-batch gate code (ADR 0013). |
| `CF_PRESENTER_SPEND_CEILING_USD` | `35` | Presenter-batch spend ceiling. |
| `FACTORY_AUTO_MIGRATE` | `1` | Apply `db/factory/migrations` on boot (idempotent). Set `0` in a managed deploy that runs `npm run migrate` in its release step. |
| `FACTORY_DIAG` | unset | `1` prints raw provider exceptions (executor / model-call). No-op unset; safe in prod. |
| `FACTORY_DIAG_STREAM` | unset | `1` dumps message-level wire events (Anthropic client). No-op unset; safe in prod. |

## Commands

```bash
npm install                 # once
npm run start               # production start (tsx src/index.ts); auto-migrates on boot if FACTORY_AUTO_MIGRATE=1
npm run dev                 # same, with tsx watch (auto-restart on change)
npm run migrate             # apply db/factory migrations explicitly (managed deploys with FACTORY_AUTO_MIGRATE=0)
npm run typecheck           # tsc --noEmit

# Executable checks (from worker/)
FACTORY_MOCK_FAST=1 npx tsx src/agents/__checks__/gateway-and-labels.ts   # mock coverage of every agent, gateway SSRF guards, label coercion — zero model calls
FACTORY_DIAG=1      npx tsx src/agents/__checks__/live-probe.ts           # temporary live diagnostic — needs ANTHROPIC_API_KEY, budget-capped
```

## Railway deployment

Config lives in [`../railway.toml`](../railway.toml); the image is the **`Dockerfile` at the repo
root** (built from the root because the worker imports `web/src` domain code via tsconfig paths).

- **Service name:** `worker`. Builder: `dockerfile`. Health check: `GET /health` (60 s timeout);
  restart `ON_FAILURE`, max 3 retries.
- **Config comes from Railway service variables** — there are no `.env` files in the image. Set the
  factory variables above plus `ANTHROPIC_API_KEY` for live mode.
- In a managed deploy set `FACTORY_AUTO_MIGRATE=0` and run `npm run migrate` as a release step, so
  boot does not race migrations across restarts.
- Point the web app's `FACTORY_WORKER_URL` / `NEXT_PUBLIC_FACTORY_WORKER_URL` at the Railway URL.

Railway placement is per ADR 0016; the worker also runs on any Node 22+ host (and locally) with no
code change.

## Operational notes

**Boot log lines to expect** (in order):

```
[worker] starting · env=<id> · modelMode=<mock|live>
[worker] applying factory migrations…            # only when FACTORY_AUTO_MIGRATE=1
[worker] environment identity ok (<id>)
[worker] crash recovery: reclaimed N orphaned run(s)   # only when N > 0
[worker] agent runtime: <source>                 # real w3 runtime, or local mock
[worker] listening on :<port>
```

On shutdown (SIGTERM/SIGINT): `[worker] <signal> — draining…` then `[worker] stopped`. A
`FACTORY_ENV_ID` mismatch against the DB marker row aborts boot with a fatal error — this is
intentional fail-closed behaviour (ADR 0014).

**Diagnostics taps.** `FACTORY_DIAG=1` surfaces the raw provider exception that the product path
sanitizes (model-call/executor); `FACTORY_DIAG_STREAM=1` dumps message-level wire events from the
Anthropic client. Both are no-ops when unset.

**Hard limits + cost guards** (enforced at node boundaries; contract in
[`../web/src/lib/factory/contracts/limits.ts`](../web/src/lib/factory/contracts/limits.ts)):

- **Cost:** per campaign $4 warning / **$8 hard stop**; presenter batch $20 warning / **$35 hard
  stop**. Crossing a hard stop stops new model nodes, runs deterministic finalisation, and records
  remaining work as **Terminal Gaps** — it never fabricates completion.
- **Concurrency:** 25 global active model calls; 5 per presenter campaign / 8 per public campaign;
  10 concurrent research calls.
- **Roster / research:** 15 agents target, 20 hard cap; 20 web searches per campaign.
- **Time:** 12-min soft target, 20-min hard limit.

**Honest caveats.** The 20-minute hard limit and the four-per-run Judgement Request cap were found
unenforced by the first live runs and have since been **fixed and proven live** (batch campaigns halt
at ~21 min — the cap plus bounded in-flight overrun — recording Terminal Gaps). The latency targets
(first sourced finding 45 s, first accepted section 90 s) are not yet met — roster/search tuning is
ongoing. Current, measured cost/latency and the running defect list are in
[`../docs/product/factory-verification-results.md`](../docs/product/factory-verification-results.md).
Current Production is untouched by this worker.
