# Campaign Factory

Campaign Factory is a public, self-serve web app that turns a UK local or public-policy problem — *"I want the council to keep the library open in Highfields"* — into a complete campaign: objective, power map, pressure strategy, tactics, organising plan, and drafted materials, all **researched live** while you watch.

Its soul is a **no-synthetic-data integrity principle**: research runs against real sources, every claim carries one of **7 verification labels**, drafts mark unresolved facts with **`[VERIFY: …]`** markers, and when a stage fails it is **shown as failed — never faked**. The prototype's fake-campaign generator was deliberately not ported.

This repo contains two implementations of that idea:

- **Current Production** (`main`, unchanged) — a routed pipeline of four model calls, deployed on Vercel + Neon.
- **The multi-agent factory** (this branch, `factory/multi-agent-build`, PR #10) — a real fifteen-agent LangGraph campaign graph on a dedicated always-on worker. Same product, same integrity principle, different runtime. No production cutover happens without an explicit Factory Promotion.

## How it works

- **You enter a problem and a named place** at `/factory`. The place must be specific — the input gate rejects "UK" or "online" because research needs a real decision route to run against.
- **A campaign graph assembles the campaign live.** Thirteen fixed agent responsibilities plus up to two campaign-selected specialists (20 hard cap) run as a LangGraph over one shared campaign state. The public path uses an **express profile** (~8 agents, 15-minute hard cap); the presenter desk can fire full-profile runs.
- **Agent execution runs on a separate worker, not in Vercel functions.** An always-on Node worker (`worker/`) owns the durable `pg-boss` queue, the graph, and `PostgresSaver` checkpoints, so a crashed run resumes from its last node. The web app talks to it only across a signed HMAC boundary (ADR 0015/0016).
- **You watch it happen.** The worker appends Factory Events to Postgres; the browser streams them over SSE (run-scoped token) into the **Campaign Assembly View** — Agent Work Cards, evidence states, the progressive ten-step Campaign Brief, then nine canonical documents and a Campaign Completion Receipt.
- **Limits are enforced, honestly.** Cost guards and hard time limits are checked at node boundaries; crossing one finalises deterministically and records remaining work as **Terminal Gaps** — it never fabricates completion.
- **Everything runs without an API key in mock mode.** `FACTORY_MODEL_MODE=mock` exercises the full graph, events, UI, recovery, and replay with deterministic fixtures and zero model calls. Live runs start the moment `ANTHROPIC_API_KEY` is present.
- **Current Production (`main`) works differently:** a routed pipeline — Sonnet 5 research → Opus 4.8 plan → Sonnet 5 ×3 drafts → Haiku 4.5 lint — run as a background job with a polling, progressively-revealing journey UI.

## Repository layout

| Path | What it is |
|---|---|
| [`web/`](web/) | The **Next.js** app: current-production surfaces plus all factory surfaces. See [`web/README.md`](web/README.md) to run it. |
| [`worker/`](worker/) | The **Factory Runtime Worker** — LangGraph JS + pg-boss + Postgres checkpoints. See [`worker/README.md`](worker/README.md). |
| [`db/factory/`](db/factory/) | Factory database migrations (applied automatically by the worker on boot). |
| [`Dockerfile`](Dockerfile) / [`railway.toml`](railway.toml) | Worker deployment to Railway (ADR 0016); built from the repo root because the worker imports shared modules from `web/src`. |
| [`docs/adr/`](docs/adr/) | Architecture decision records 0001–0016. |
| [`docs/product/`](docs/product/) | The [implementation parameters](docs/product/factory-implementation-parameters.md), the [12-hour build plan](docs/product/factory-12-hour-build-plan.md), and the [verification results](docs/product/factory-verification-results.md) (measured cost/latency, honest defects). |
| [`docs/research/`](docs/research/) | Deep-research notes (e.g. why this is a workflow, not a multi-agent system). |
| [`PLAN.md`](PLAN.md) | Full product plan and locked decisions. |
| [`HOW_IT_WAS_BUILT.md`](HOW_IT_WAS_BUILT.md) | Architecture-and-story companion. |
| [`EXECUTION_JOURNAL.md`](EXECUTION_JOURNAL.md) | Chronological build log (summarised at the end of this README). |
| [`CONTEXT.md`](CONTEXT.md) | The shared campaign-design language the product uses. |
| [`app/`](app/) | The original localhost prototype — reference only, not deployed. |
| [`archive/`](archive/) | Earlier HTML prototypes, preserved and inspectable. |

## Quick start

The web app and the worker are two processes against the same Postgres.

```bash
# 1. Worker (from the repo root)
cd worker
cp .env.example .env      # set FACTORY_SIGNING_SECRET and FACTORY_MODEL_MODE
npm install
npm run start             # :8787 — applies factory migrations on boot

# 2. Web
cd ../web
npm install
npm run dev               # :3000 — needs DATABASE_URL + FACTORY_* vars in .env.local
```

Key points (full detail in [`web/README.md`](web/README.md) and [`worker/README.md`](worker/README.md)):

- `FACTORY_SIGNING_SECRET`, `FACTORY_ENV_ID`, and `FACTORY_MODEL_MODE` **must agree** across web and worker, or runs fail closed.
- `FACTORY_MODEL_MODE=mock` needs no API key; `live` requires `ANTHROPIC_API_KEY`.
- A Postgres `DATABASE_URL` is required (local Docker or Neon); both apps migrate themselves — there is no separate migration step.

## The URLs

### Public product (the factory)

| URL | What it does |
|---|---|
| `/` | Redirects to `/factory` — the factory is the front door (conference decision, 15 Jul 2026). |
| [`/factory`](web/src/app/factory/page.tsx) | Public intake: problem + named place. Starts an express-profile run and redirects to the assembly view. |
| [`/factory/c/[campaignId]`](web/src/app/factory/c/%5BcampaignId%5D/page.tsx) | The **Campaign Assembly View** — the live per-campaign page. The brief opens immediately; the client attaches the SSE/polling event stream. |
| [`/gallery`](web/src/app/gallery/page.tsx) | The **Campaign Gallery**: finished on-stage batch campaigns as individual cards, alongside shared campaigns from the legacy builder (marked with a legacy pill). `/wall` redirects here. |
| [`/how`](web/src/app/how/page.tsx) | Standalone "how it works" explainer, linked from the footer. |

### Conference / session surfaces

| URL | What it does |
|---|---|
| [`/live`](web/src/app/live/page.tsx) | **Audience link for the session** — redirects to `/factory/replay/conference`. |
| [`/factory/replay/conference`](web/src/app/factory/replay/conference/page.tsx) | The pinned, immutable **recorded run**, condensed to exactly 15:00 (honestly labelled, real-time toggle). Rendered entirely from stored Factory Events through the same renderer as a live run — zero model calls, zero writes. The route never changes; promotion is a back-office CLI step (`scripts/promote-replay.mjs`). Shows an honest empty state if nothing is pinned. |
| [`/factory/live`](web/src/app/factory/live/page.tsx) | The **true real-time spectator view**: read-only mirror of the most recent presenter batch's gallery (polling, no tokens). Falls back to the recorded replay when no batch has run. |
| [`/presenter`](web/src/app/presenter/page.tsx) | Alias — redirects to `/factory/multi-campaign-demo`. |
| [`/factory/multi-campaign-demo`](web/src/app/factory/multi-campaign-demo/page.tsx) | The **multi-campaign demo** (presenter desk): fire a batch of 1–5 campaigns on stage (full or express profile). A presenter session auto-issues as an HttpOnly cookie (verified server-side, ADR 0013); a valid one skips straight to batch intake. `/factory/present` redirects here. |
| [`/factory/gallery/[batchId]`](web/src/app/factory/gallery/%5BbatchId%5D/page.tsx) | The presenter's live **Factory Gallery** for a batch — every agent workspace open at once over the assembling brief, plus a Batch Receipt. Requires the presenter cookie; otherwise redirects to `/factory/multi-campaign-demo`. |

### Legacy (single-agent builder)

| URL | What it does |
|---|---|
| [`/legacy`](web/src/app/legacy/page.tsx) | The original single-agent Campaign Builder (the routed pipeline that is production on `main`), moved off the homepage and unlinked from the nav. Kept as the tested fallback and comparison point. |
| [`/c/[id]`](web/src/app/c/%5Bid%5D/page.tsx) | Shareable, read-only campaign page from the legacy builder (private-by-default URL, durable Postgres read). |
| `/wall` | Old gallery path — redirects to `/gallery`. |

### Admin & dev

| URL | What it does |
|---|---|
| [`/admin`](web/src/app/admin/page.tsx) | The fire extinguisher: enter the admin key, see the wall, hide anything. |
| [`/factory/admin/costs`](web/src/app/factory/admin/costs/page.tsx) | Internal cost + latency ledger: per-campaign spend vs the $4/$8 guards, per-batch vs $20/$35, and the latency milestone table. Gated by `CF_ADMIN_KEY` (`?key=` or header). Deliberately plain — not product UI. |
| `/dev/preview`, `/factory/dev/*` | Dev-only component previews (journey, gallery, documents) rendered from bundled fixtures — no DB, no run. |

## Components & how it was built

A summary of [`EXECUTION_JOURNAL.md`](EXECUTION_JOURNAL.md) and the branch history; the narrative version is [`HOW_IT_WAS_BUILT.md`](HOW_IT_WAS_BUILT.md).

**13 Jul 2026 — Current Production built and deployed (M1–M5).** The localhost prototype (`app/`) was rewritten as a public Next.js app after a decision-locking grilling session: public self-serve, durable background runs, access code + session cap + £150/day kill-switch, server-side persistence with shareable URLs and an opt-in wall, and **no synthetic data, ever**. Milestones: M1 scaffold + routed pipeline (Sonnet 5 research / Opus 4.8 plan / Sonnet 5 ×3 drafts / Haiku 4.5 lint), M2 launch controls and spend ledger, M3 the scroll-reveal journey UI, M4 Postgres persistence + serverless execution via `after()`, M5 the wall and admin surfaces. Deployed on Vercel (root `web/`) + Neon Postgres, auto-deploying from `main`. Known constraint: function-duration limits mean full runs can't complete in one function on the current plan — one driver of the worker architecture below.

**13–15 Jul 2026 — the multi-agent factory rewrite (this branch, PR #10).** The four-call pipeline was re-expressed as a genuine fifteen-agent LangGraph campaign graph, designed through ADRs [0001](docs/adr/0001-visible-agents-correspond-to-runtime-work.md)–[0016](docs/adr/0016-use-an-oss-langgraph-worker-on-railway.md) and an accepted [implementation-parameters envelope](docs/product/factory-implementation-parameters.md), then built as a compressed parallel effort per the [12-hour build plan](docs/product/factory-12-hour-build-plan.md). The main components:

- **The worker** (`worker/`) — always-on Node service on Railway: `pg-boss` durable queue → LangGraph graph over one shared campaign state → `PostgresSaver` checkpoints at every node boundary, with boot-time orphan recovery, cost/time guards at node boundaries, and Terminal Gaps instead of fabricated completion.
- **The signed boundary** — web ↔ worker over HMAC-signed HTTP; browsers stream Factory Events over SSE with run-scoped tokens (Postgres `LISTEN` with a polling fallback).
- **The four screens** — public intake + Campaign Assembly View, the presenter desk + Factory Gallery for on-stage batches, the pinned 15-minute conference replay, and the legacy builder kept for comparison.
- **Mock mode** — the whole system runs on deterministic fixtures with zero model calls, so everything was exercisable before (and independently of) live keys.
- **Conference decisions (15 Jul):** the factory became the front door (`/` → `/factory`, legacy to `/legacy`), the presenter access-code lock was removed in favour of spend guards, express profile became the default everywhere, and the replay opens at 4× condensed playback.

It runs end to end in mock mode and has completed live single-campaign and presenter-batch runs — cost inside guardrails, latency tuning still open ([verification results](docs/product/factory-verification-results.md)).

**15 Jul 2026 — OpenClaw build reveal.** A separate, bounded coding agent ("Pip", outside the factory runtime) was provisioned to build a Campaign Operations workspace in public view for the conference: [issue #11](https://github.com/CampaignLab/campaign-factory/issues/11) and draft [PR #12](https://github.com/CampaignLab/campaign-factory/pull/12), demo-safe (browser-local fixture state, no real delivery), with visible commit-and-comment checkpoints. It demonstrates bounded build-time autonomy — it cannot merge, deploy, or touch production.

**Status.** Current production on `main` is live and unchanged. The factory rewrite is complete on this branch and gated behind an explicit Factory Promotion; open work is tracked in the [issues](https://github.com/CampaignLab/campaign-factory/issues).
