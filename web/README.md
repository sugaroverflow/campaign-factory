# Campaign Factory

A public, self-serve web app that turns a UK local or public-policy problem into a
complete campaign — researched live, with every claim labelled and unresolved facts
flagged. Built for a conference launch. Full product plan and decisions: [`../PLAN.md`](../PLAN.md).

**Integrity principle:** no synthetic data, ever. Research runs live against real
sources with 7 verification labels; drafts mark unresolved facts as `[VERIFY: …]`;
failed stages are shown as failed, never faked.

## Status

- **Repo:** [`sugaroverflow/campaign-factory`](https://github.com/sugaroverflow/campaign-factory) — GitHub-connected to Vercel; pushes to `main` **auto-deploy** (build root: `web/`).
- **Deployed:** Vercel project `campaign-factory` on the **Hobby** plan, with **Neon** Postgres.
- **Not yet publicly usable** — see [go-live requirements](#️-technical-requirements-before-going-live): deployment protection is on, and the Hobby 300s function cap can't fit a full run (durable execution tracked in [issue #1](https://github.com/sugaroverflow/campaign-factory/issues/1)).
- **Docs:** [`../PLAN.md`](../PLAN.md) (plan) · [`../HOW_IT_WAS_BUILT.md`](../HOW_IT_WAS_BUILT.md) (architecture) · [`../EXECUTION_JOURNAL.md`](../EXECUTION_JOURNAL.md) (build log) · [issues](https://github.com/sugaroverflow/campaign-factory/issues).

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
  so you can exercise the UI (`/c/<id>`, `/wall`) without a live run. Needs `DATABASE_URL`.
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

The project is already linked to **`sugaroverflow/campaign-factory`** with Neon
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

## ⚠️ Technical requirements before going live

The current deploy is on the **Hobby** plan and is **not yet publicly usable**. Address
these before the conference (the Vercel account will be switched later):

1. **Function duration vs. run length — the blocker.** A full run takes **6–15 min**,
   but Hobby caps serverless functions at **300s (5 min)** (`maxDuration` in
   `src/app/api/runs/route.ts`). On Hobby a run **cannot complete in one function**.
   To fix, do one (ideally both):
   - **Upgrade the plan** (Pro allows up to ~800s ≈ 13 min via Fluid Compute — raise
     `maxDuration` accordingly). Note the plan stage alone has hit ~10 min, so 800s is
     tight for the tail.
   - **Implement durable step execution with [Vercel Workflow (WDK)](https://vercel.com/docs/workflow)**
     — run each pipeline stage within limits and survive across invocations. This is the
     robust fix and is recommended regardless of plan. The pipeline is already written as
     discrete stage functions over a state mutator (`src/lib/pipeline/`), so wrapping it
     in a workflow is the intended next step.

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
