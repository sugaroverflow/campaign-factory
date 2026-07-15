# Campaign Factory

A public, self-serve web app that turns a UK local or public-policy problem into a
complete campaign — researched live, with every claim labelled and unresolved facts
flagged. Built for a conference launch. Full product plan and decisions: [`../PLAN.md`](../PLAN.md).

**Integrity principle:** no synthetic data, ever. Research runs live against real
sources with 7 verification labels; drafts mark unresolved facts as `[VERIFY: …]`;
failed stages are shown as failed, never faked.

## Status

- **Repo:** [`CampaignLab/campaign-factory`](https://github.com/CampaignLab/campaign-factory) — GitHub-connected to Vercel; pushes to `main` **auto-deploy** (build root: `web/`).
- **Deployed:** Vercel project `campaign-factory` on the **Hobby** plan, with **Neon** Postgres.
- **Not yet publicly usable** — see [go-live requirements](#️-technical-requirements-before-going-live): deployment protection is on, and the Hobby 300s function cap can't fit a full run (durable execution tracked in [issue #1](https://github.com/CampaignLab/campaign-factory/issues/1)).
- **Docs:** [`../PLAN.md`](../PLAN.md) (current baseline) · [`../docs/product/factory-implementation-parameters.md`](../docs/product/factory-implementation-parameters.md) (factory rewrite) · [`../HOW_IT_WAS_BUILT.md`](../HOW_IT_WAS_BUILT.md) (architecture) · [`../EXECUTION_JOURNAL.md`](../EXECUTION_JOURNAL.md) (build log) · [issues](https://github.com/CampaignLab/campaign-factory/issues).

## Stack

- Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui
- Postgres (portable driver — local Docker in dev, Neon in prod) via `DATABASE_URL`
- Anthropic API — routed per stage (Sonnet 5 research + drafts, Opus 4.8 plan, Haiku 4.5 lint)

---

## Local development

Prerequisites: **Node 20+**, **npm**. A Postgres database (local Docker or a Neon URL).

```bash
# 1. Database — either local Docker Postgres…
docker run -d --name cf-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=campaign_factory -p 5433:5432 postgres:16

# …or pull the linked Vercel/Neon env vars instead of Docker:
#   vercel env pull        # writes .env.local with DATABASE_URL etc.

# 2. Configure web/.env.local
#   DATABASE_URL=postgres://postgres:postgres@localhost:5433/campaign_factory
#   ANTHROPIC_API_KEY=sk-ant-...        # optional locally; without it, runs fail cheap by design

# 3. Install + run
npm install
npm run dev            # http://localhost:3000
```

The DB schema is created automatically on first request (idempotent `migrate()`), so
there is no separate migration step.

### Handy scripts

- `node scripts/seed-fixture.mjs` — insert a real campaign fixture as a completed run,
  so you can exercise the UI (`/c/<id>`, `/gallery`) without a live run. Needs `DATABASE_URL`.
- `/dev/preview` — dev-only route that renders the journey from a bundled fixture (no DB, no run).
- `node scripts/check-neon.mjs` — verify connectivity + schema against the `DATABASE_URL` in `.env.local`.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string. Use the **pooled** endpoint on Neon. |
| `ANTHROPIC_API_KEY` | yes (for live runs) | — | Server-side key for the pipeline. Without it, runs fail fast (no spend). |
| `CF_ACCESS_CODE` | recommended | _(empty = gate off)_ | Conference access code required to start a run. |
| `CF_RUN_CAP` | no | `3` | Max runs per browser session (cookie). |
| `CF_IP_RUN_CAP` | no | `3` | Max runs per client IP (harder backstop; set to `1` for one-per-person). |
| `CF_DAILY_BUDGET_GBP` | no | `150` | Global daily spend kill-switch (GBP). Flips to "at capacity" when exceeded. |
| `CF_FX_GBP_USD` | no | `1.27` | GBP→USD rate for the ledger. |
| `CF_READONLY` | no | `false` | Sunset switch — disables new runs; existing URLs stay readable. |
| `CF_ADMIN_KEY` | recommended | _(empty = admin off)_ | Secret for `/admin` (hide items from the wall). |
| `PGSSL` | no | auto | Set `require` to force SSL if the URL isn't auto-detected (Neon is auto). |

---

## Vercel setup

The project is already linked to **`CampaignLab/campaign-factory`** with Neon
provisioned. To reproduce from scratch:

```bash
cd web
vercel link                         # link this dir as the project root

# Database (Neon via Marketplace) — auto-sets DATABASE_URL across all environments
vercel install neon                 # first time: accept terms in browser, or:
                                    #   vercel integration accept-terms neon --yes

# App secrets (per environment). NOTE: for `preview`, the CLI asks for a git branch —
# pass one, or add `--yes` to apply to all preview branches.
printf '%s' "sk-ant-..."     | vercel env add ANTHROPIC_API_KEY production
printf '%s' "your-code"      | vercel env add CF_ACCESS_CODE   production
printf '%s' "$(openssl rand -hex 12)" | vercel env add CF_ADMIN_KEY production

vercel env pull                     # sync them into .env.local for local dev
vercel deploy --prod                # build + deploy to production
```

---

## Multi-agent factory (this branch)

> Everything above describes **Current Production** (the routed `after()` pipeline), which is
> **unchanged**. This section covers the `factory/multi-agent-build` rewrite (PR #10): a
> fifteen-agent LangGraph graph running on a separate always-on **worker**, surfaced through the
> Next.js app. The worker itself is documented in [`../worker/README.md`](../worker/README.md);
> the whole-repo overview is in [`../README.md`](../README.md).

**Surfaces (routes in this app)** — the four screens; the full URL map is in the root [`../README.md`](../README.md):

1. `/` → `/factory` — **Factory, single campaign** is the front door (conference decision, 15 Jul 2026): the public multi-agent audience path (express profile, 15-min cap) → **Campaign Assembly View** at `/factory/c/[campaignId]`.
2. `/presenter` → `/factory/multi-campaign-demo` — **Multi-campaign demo** (presenter desk): fire a 1–5 campaign batch on stage (no access code; sessions auto-issue) → **Factory Gallery** at `/factory/gallery/[batchId]` (presenter cookie required). `/factory/present` redirects here.
3. `/live` → `/factory/replay/conference` — **Replay**: the pre-loaded 15-minute conference session (condensed playback of a pinned real recording). True real-time spectator mirror of the latest presenter batch: `/factory/live`.
4. `/legacy` — **Campaign Builder**: the single-agent legacy demo (the routed pipeline that is production on `main`), moved off the homepage and unlinked from the nav; starting a run stays gated by `CF_ACCESS_CODE`.

Supporting routes: `/gallery` (finished on-stage batch campaigns + legacy shared ones with a legacy pill; `/wall` redirects here) · `/how` (public explainer) · `/factory/admin/costs` (internal cost + latency ledger, gated by `CF_ADMIN_KEY`) · `/c/[id]`, `/admin` (legacy surfaces).

### Local run

The web app and the worker are two processes against the same Postgres:

```bash
# 1. Worker (from the repo root)
cd worker
cp .env.example .env          # then set FACTORY_SIGNING_SECRET and FACTORY_MODEL_MODE
npm install
npm run start                 # :8787 — applies factory migrations on boot, then serves

# 2. Web — the usual `npm run dev` on :3000, with the FACTORY_* vars in web/.env.local
```

The worker **auto-migrates on boot** (`FACTORY_AUTO_MIGRATE=1`), so there is no separate factory
migration step in dev. `web/.env.local` must carry the factory variables listed below (names only —
no values are committed to this repo). `FACTORY_SIGNING_SECRET`, `FACTORY_ENV_ID`, and
`FACTORY_MODEL_MODE` **must agree** across web and worker, or runs fail closed.

### Mock vs live

`FACTORY_MODEL_MODE=mock` runs the **full graph — events, SSE, recovery, and replay — with
deterministic fixtures and zero model calls**, so the entire system is exercisable without an API
key. Mock runs finalise as an honest `partial` (fixture claims are never labelled "Verified", so
documents legitimately need verification). `FACTORY_MODEL_MODE=live` calls the real Anthropic API
and additionally requires `ANTHROPIC_API_KEY` (usually inherited from `web/.env.local`).

### Factory environment variables

Shared web ↔ worker contract (names only, no values):

| Variable | Read by | Purpose |
|---|---|---|
| `FACTORY_SIGNING_SECRET` | web + worker | Shared HMAC secret for signed start/status/cancel/judgement requests. **Must match.** |
| `FACTORY_WORKER_URL` | web (server) | Worker base URL as seen from the web server. |
| `NEXT_PUBLIC_FACTORY_WORKER_URL` | web (browser) | Worker base URL as seen from the browser for the SSE stream; often the same as above. |
| `FACTORY_ENV_ID` | web + worker | Declared environment identity (ADR 0014). Must match the worker **and** the DB marker row, else runs fail closed. |
| `FACTORY_DATABASE_URL` | web + worker | Postgres URL for the factory schema (direct/unpooled). Falls back to `DATABASE_URL_UNPOOLED` then `DATABASE_URL`. |
| `FACTORY_MODEL_MODE` | worker | `mock` (zero model calls) or `live`. Owned by the worker; the web app defers to it. |
| `CF_PRESENTER_CODE` | web + worker | Optional since 15 Jul 2026 — presenter sessions auto-issue without a code. If set, a supplied wrong code is still rejected (the old coded flow keeps working). |
| `CF_ADMIN_KEY` | web | Secret for the admin surfaces, including the factory cost ledger at `/factory/admin/costs`. |
| `FACTORY_DIAG` / `FACTORY_DIAG_STREAM` | worker | Diagnostics: raw provider exceptions / message-level wire dumps from the model layer. No-ops when unset; safe in prod. |

The worker's own knobs (`PORT`, `FACTORY_AUTO_MIGRATE`, `FACTORY_DB_POOL_MAX`,
`CF_PRESENTER_SPEND_CEILING_USD`) are documented in [`../worker/README.md`](../worker/README.md)
and [`../worker/.env.example`](../worker/.env.example).

### Tests

- **Playwright end-to-end** (drives the real UI + worker + SSE/polling + read model): from `web/`,
  `npm run test:factory`. It **does not** start the servers — the dev server (`:3000`) and worker
  (`:8787`) must already be running. A full mock batch is ≈ 3 min. Per-suite assertions, env vars,
  and the JSON summary format are in [`tests/factory/README.md`](tests/factory/README.md).
- **Worker executable checks** (mock coverage of every agent, gateway SSRF guards, label coercion;
  zero model calls): from `worker/`,
  `FACTORY_MOCK_FAST=1 npx tsx src/agents/__checks__/gateway-and-labels.ts`. See
  [`../worker/README.md`](../worker/README.md).
- **Typecheck:** `npx tsc --noEmit` in both `web/` and `worker/`.

### Preview / Railway deployment (brief)

- The worker deploys to **Railway** from the **`Dockerfile` at the repo root** — it builds from the
  root because the worker imports runtime-neutral modules from `web/src` via tsconfig paths. Service
  name `worker`; config in [`../railway.toml`](../railway.toml) (`/health` health check). Full notes:
  [`../worker/README.md`](../worker/README.md).
- The Vercel **preview** for this branch needs the `FACTORY_*` and `CF_PRESENTER_CODE` vars set as
  **branch-scoped** preview env vars — including `NEXT_PUBLIC_FACTORY_WORKER_URL` pointing at the
  deployed Railway worker. The Playwright batch spec has passed against the preview + Railway worker;
  measured results and open items are in
  [`../docs/product/factory-verification-results.md`](../docs/product/factory-verification-results.md).

Latency tuning (first finding / first accepted section) is still ongoing; measured cost/latency and
honest defects are recorded in
[`../docs/product/factory-verification-results.md`](../docs/product/factory-verification-results.md).

---

## ⚠️ Technical requirements before going live

The current deploy is on the **Hobby** plan and is **not yet publicly usable**. Address
these before the conference (the Vercel account will be switched later):

1. **Function duration vs. run length — the current-production blocker.** A full run takes **6–15 min**,
   but Hobby caps serverless functions at **300s (5 min)** (`maxDuration` in
   `src/app/api/runs/route.ts`). On Hobby a run **cannot complete in one function**.
   To fix, do one (ideally both):
   - **Upgrade the plan** (Pro allows up to ~800s ≈ 13 min via Fluid Compute — raise
     `maxDuration` accordingly). Note the plan stage alone has hit ~10 min, so 800s is
     tight for the tail.
   - The factory rewrite replaces `after()` execution with an isolated,
     always-on Railway worker using open-source LangGraph JS, Postgres checkpoints, and a
     durable Postgres queue. It deliberately does not stack Vercel Workflow around
     LangGraph. See `../docs/product/factory-implementation-parameters.md` and ADRs 0015–0016.
     **This is now implemented on this branch — the factory rewrite addresses this blocker; see
     the [Multi-agent factory](#multi-agent-factory-this-branch) section above and
     `../docs/product/factory-verification-results.md`.** (Current Production still runs the
     `after()` pipeline and is unchanged.)

2. **Deployment Protection is ON.** Every request redirects to Vercel SSO, so the app
   isn't public. Disable it at **Project → Settings → Deployment Protection**
   (turn off Vercel Authentication for production). Access control is then handled by the
   app's own `CF_ACCESS_CODE` gate.

3. **Set the real access code.** Production currently has `CF_ACCESS_CODE=CHANGE-ME`.
   Set the actual conference code (`vercel env rm` + `vercel env add`).

4. **Use Neon's pooled `DATABASE_URL`** (the default) — the app opens DB connections per
   request and is designed for ~45 simultaneous runs; the pooled endpoint prevents
   connection exhaustion.

5. **Confirm the spend controls** for launch day: `CF_DAILY_BUDGET_GBP` (kill-switch),
   `CF_RUN_CAP`, and that `ANTHROPIC_API_KEY` is the intended billing key. Measure one
   real run's cost first and size the cap (see `../PLAN.md` §12).

---

## Architecture (key paths)

- `src/lib/pipeline/` — the routed pipeline: `stageA` research, `stageB` plan, `stageC`
  drafts (3 parallel groups), `lint`, `run` orchestration, `models`/`prompts`/`schemas`/`labels`.
- `src/lib/db/` — Postgres layer (runs, spend ledger, sessions, wall).
- `src/lib/jobs/store.ts` — run store with write-through persistence + `after()` execution.
- `src/lib/config.ts` — env-driven launch controls.
- `src/app/api/` — `runs` (start/poll/delete/share), `status`, `wall`, `admin/hide`.
- `src/app/c/[id]` — shareable read-only campaign page. `src/app/wall` — wall + projector.
- `src/components/` — `EntryForm`, `RunProgress`, `Journey`, `OwnerBar`, `ProjectorWall`, …
