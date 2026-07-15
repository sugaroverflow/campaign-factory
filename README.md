# Campaign Factory

A public, self-serve web app that turns a UK local or public-policy problem — *"I want the council to keep the library open in Highfields"* — into a complete campaign: objective, power map, pressure strategy, tactics, organising plan, and drafted materials, all **researched live**. Its soul is a **no-synthetic-data integrity principle**: research runs against real sources, every claim carries one of **7 verification labels**, drafts mark unresolved facts with **`[VERIFY: …]`** markers, and when a stage fails it is **shown as failed — never faked**. The prototype's fake-campaign generator was deliberately not ported.

## Two worlds in this repository

This repo now contains two implementations of that idea:

- **Current Production** (`main`, **unchanged**) — the routed four-model-call pipeline described below, deployed on Vercel + Neon. This is what is live today and it is not touched by the rewrite.
- **The multi-agent factory** (this branch, `factory/multi-agent-build`, PR #10) — a real fifteen-agent LangGraph campaign graph on a dedicated always-on worker. Same integrity principle, different runtime. Built as an isolated `factory-dev` surface; **no production cutover** happens without an explicit Factory Promotion. See [The multi-agent factory](#the-multi-agent-factory-this-branch) below.

## Current Production — the routed pipeline (`main`)

A routed pipeline of four model calls over one shared campaign state:

- **Stage A · Research** — Claude Sonnet 5 + web search, high effort → verified claims, each carrying one of the 7 labels.
- **Stage B · Plan** — Claude Opus 4.8 → the coherent campaign plan (never split, never downgraded — plan coherence is un-lintable).
- **Stage C · Drafts** — Claude Sonnet 5 ×3 parallel → nine documents in three audience packs (decision-maker / press / supporter).
- **Lint** — Claude Haiku 4.5 → cheap consistency check: labels present, `[VERIFY:]` markers present, no invented names, dates, or contacts.

The run happens as a background job; the client polls for progress and the **journey UI reveals progressively** — research is readable while the plan and drafts still generate. Finished campaigns live at a shareable URL and can be opted into a **conference wall** with a projector mode.

## The multi-agent factory (this branch)

The rewrite replaces the four-call pipeline with a real **fifteen-agent campaign graph** (13 fixed responsibilities plus 2 campaign-selected specialists; 20 hard cap). It is the same product idea and the same integrity principle, expressed as a durable multi-agent runtime rather than a routed pipeline.

### The four screens

| # | Screen | Route | What it is |
|---|--------|-------|------------|
| 1 | **Campaign Builder** | [`/`](web/src/app/page.tsx) | The single-agent legacy demo — the original routed pipeline on `main`, kept as a comparison point. Gated by `CF_ACCESS_CODE`. |
| 2 | **Factory** (single campaign) | [`/factory`](web/src/app/factory/page.tsx) | Multi-agent, one campaign: the public, self-serve audience path. Enter a problem + place; an **express-profile** run (~8-agent graph, 15-minute hard cap) assembles a campaign live in the **Campaign Assembly View** — Agent Work Cards, evidence states, the progressive ten-step Campaign Brief, nine canonical documents, a Campaign Completion Receipt. |
| 3 | **Presenter desk** | [`/presenter`](web/src/app/presenter/page.tsx) → [`/factory/present`](web/src/app/factory/present/page.tsx) | Multi-agent, multi-campaign: fire a **batch of 1–5 campaigns on stage** (full or express profile) that fan out concurrently into the **Factory Gallery** (`/factory/gallery/[batchId]`) — every agent workspace open at once over the assembling brief substrate, plus a Batch Receipt. The access-code lock is removed (conference decision, 15 Jul 2026); spend stays bounded by the per-batch stop and the daily kill-switch. |
| 4 | **Replay** (the 15-minute session) | [`/live`](web/src/app/live/page.tsx) → [`/factory/replay/conference`](web/src/app/factory/replay/conference/page.tsx) | The pre-loaded conference session: an immutable recording of a real batch, played back **condensed to exactly 15:00** (honestly labelled, with a real-time toggle). Deterministic — no live risk on stage. The true real-time spectator mirror of the latest batch remains at [`/factory/live`](web/src/app/factory/live/page.tsx). |

**Worker architecture (ADR 0015/0016).** Agent execution does not run in Vercel functions. A separate always-on **Node worker** (`worker/`) runs open-source **LangGraph JS** over one shared campaign state, driven by a durable **`pg-boss`** Postgres queue, with **`PostgresSaver` checkpoints** so a run resumes from its last node after a crash (a boot-time orphan scan reclaims leases the queue would otherwise hold ~30 min). The web app talks to it only across a **signed HMAC HTTP boundary**, and the browser streams progress over **SSE** authenticated by a run-scoped token. Hard limits and cost guards are enforced at node boundaries; crossing a hard stop finalises deterministically and records remaining work as Terminal Gaps — it never fabricates completion. Deploys to **Railway** per ADR 0016; runs against an isolated Neon branch. Latency tuning (roster + search) is ongoing — see [`docs/product/factory-verification-results.md`](docs/product/factory-verification-results.md).

It also runs in **mock mode** (`FACTORY_MODEL_MODE=mock`): the full graph, events, UI, recovery, and replay run with deterministic fixtures and **zero model calls**, so everything is exercisable without an API key. Live runs begin the moment `ANTHROPIC_API_KEY` is present.

Run it with **[`web/README.md`](web/README.md)** (web) + **[`worker/README.md`](worker/README.md)** (worker).

## Repository layout

| Path | What it is |
|---|---|
| [`web/`](web/) | The production **Next.js** app + the factory surfaces (`/factory`). **See [`web/README.md`](web/README.md) to run it.** |
| [`worker/`](worker/) | The **Factory Runtime Worker** — LangGraph + pg-boss + Postgres checkpoints (ADR 0015/0016). **See [`worker/README.md`](worker/README.md).** |
| [`app/`](app/) | The original localhost prototype — **reference only** (not deployed). |
| [`PLAN.md`](PLAN.md) | Full product plan and locked decisions. |
| [`HOW_IT_WAS_BUILT.md`](HOW_IT_WAS_BUILT.md) | Architecture-and-story companion. |
| [`EXECUTION_JOURNAL.md`](EXECUTION_JOURNAL.md) | Chronological build log. |
| [`docs/research/`](docs/research/) | Deep-research notes (e.g. why this is a workflow, not a multi-agent system). |
| [`docs/product/factory-implementation-parameters.md`](docs/product/factory-implementation-parameters.md) | Accepted implementation envelope for the multi-agent factory rewrite. |
| [`docs/product/factory-12-hour-build-plan.md`](docs/product/factory-12-hour-build-plan.md) | Execution structure for the compressed parallel build. |
| [`docs/product/factory-verification-results.md`](docs/product/factory-verification-results.md) | Living record of the factory's verification runs (measured cost/latency, honest defects). |

## Quickstart

**Current Production:** see **[`web/README.md`](web/README.md)** for prerequisites, local database setup, environment variables, and Vercel configuration.

**Multi-agent factory:** run the worker per **[`worker/README.md`](worker/README.md)** and the web surfaces per the *Multi-agent factory* section of **[`web/README.md`](web/README.md)**.

## Status

Built end to end across milestones M1–M5 (pipeline → launch controls → journey UI → persistence → wall) and **deployed on Vercel + Neon Postgres**, GitHub-connected for auto-deploys from `main` (build root: `web/`).

**Current production remains unchanged while the factory rewrite is built.** The next architecture is now implemented on this branch (`factory/multi-agent-build`, PR #10): the fifteen-agent LangGraph graph, the isolated Railway worker, the signed boundary, checkpoint recovery, the two surfaces, documents/receipts, and replay. It runs end to end in mock mode and has completed live single-campaign and presenter-batch runs — with cost inside guardrails and latency tuning still open. The existing `after()` pipeline and its function-duration limit remain current-production constraints until an explicit Factory Promotion; production is not cut over. See [`docs/product/factory-verification-results.md`](docs/product/factory-verification-results.md), [`docs/product/factory-implementation-parameters.md`](docs/product/factory-implementation-parameters.md), and the [open issues](https://github.com/CampaignLab/campaign-factory/issues).
