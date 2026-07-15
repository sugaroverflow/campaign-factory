# Factory rewrite — 12-hour parallel build structure

**Status:** Execution addendum to [`factory-implementation-parameters.md`](factory-implementation-parameters.md), 15 July 2026

**Scope:** How the accepted factory rewrite is delivered in one 12-hour elapsed window using one coordinating agent (Fable 5, plan/contracts/integration) and parallel implementation agents (Opus 4.8, one per workstream, each instructed to consult a Fable 5 advisor for genuine design questions). This document is the coordination source of truth for the build; the parameters document remains the product/architecture source of truth.

## Envelope

The parameters document plans for 15 build days + 5 hardening days for one engineer. This build compresses the build phase into 12 elapsed hours by running seven workstreams in parallel against frozen shared contracts. The §1 scope guard applies in full, plus 12-hour-specific deferrals listed below. Hardening (evaluation suite completion, rehearsals, promotion) remains follow-up work and is explicitly **not** claimed inside the 12 hours.

### Scope-guard cuts applied (per parameters §1)

1. Rich targeted-rebuild diff UI **cut** — versioned state and a basic "rebuild affected sections" action retained.
2. Specialist escalation beyond the two intake-selected specialists **cut** — escalation requests are recorded as Factory Events but auto-declined with a visible reason.
3. Exports limited to HTML, copy, and the existing Word `.doc` download.
4. Historical Work Trace filtering **cut** — collapsed Step Build Receipt only.
5. Production promotion **cut** — conference runs from the `factory-dev` route; Current Production untouched.

### Additional 12-hour deferrals

- **Railway deployment deferred.** *(Superseded within the window: the user provided Railway access mid-build and the worker was deployed — service `worker`, Dockerfile at the repo root, `railway.toml` health checks — and passed the preview infrastructure batch. See the verification results.)* Original position: no Railway account access existed; the worker was built independently deployable and ran locally per ADR 0015's boundary.
- **`factory-dev` Vercel Custom Environment** created only if team plan allows during the window; otherwise preview deployments + local worker stand in. Environment Identity Check is built regardless and fails closed.
- **Evaluation suite** reduced to: one full live single-campaign run (Leicester school-street fixture), one worker-restart recovery test, one cancellation test, cost measurement, and one presenter-batch smoke run. The remaining four fixtures and the three-consecutive-rehearsal release thresholds are follow-up hardening.
- **Replay promotion**: mechanism + renderer + pinned route built; the actual conference replay batch is promoted from the first good rehearsal run, which may land after the window.
- **Live-key dependency:** `ANTHROPIC_API_KEY` is not present in the local environment (it exists only in Vercel Production/Preview as a sensitive value). Every runtime component therefore supports `FACTORY_MODEL_MODE=mock` — deterministic fixture-driven agent outputs with zero model calls — so the full graph, events, UI, recovery, and replay are exercisable without a key. Live runs begin the moment a key is placed in `web/.env.local`.

## Workstreams and directory ownership

One branch (`factory/multi-agent-build`, cut from the PR #9 docs branch), one working tree. Collision avoidance is by strict directory ownership, not worktrees. Implementation agents never run mutating git commands; the coordinator stages and commits per-directory at integration checkpoints.

| # | Workstream | Owner paths |
|---|---|---|
| C | Coordinator: contracts, deps, wiring, merges | `web/src/lib/factory/contracts/**`, root configs, `worker/package.json` deps |
| W1 | Schema + store + reducers + env identity | `db/factory/**` (versioned SQL migrations), `web/src/lib/factory/store/**`, `web/src/lib/factory/state/**`, `web/src/lib/factory/env-identity.ts` |
| W2 | Worker runtime: pg-boss, LangGraph shell, signed API, SSE, health | `worker/**` (except `worker/src/agents/**`), `web/src/app/api/factory/**` (thin gate/proxy routes) |
| W3 | Agent contracts, prompts, evidence gateway, model gate, cost guards | `web/src/lib/factory/agents/**` (prompts/schemas/roster data), `worker/src/agents/**` (invocation, gateway, gate) |
| W4 | Public Campaign Assembly View | `web/src/app/factory/c/**`, `web/src/components/factory/assembly/**` |
| W5 | Presenter route, Factory Gallery, Agent Work Cards | `web/src/app/factory/present/**`, `web/src/app/factory/gallery/**`, `web/src/components/factory/cards/**`, `web/src/components/factory/gallery/**`, presenter-session API |
| W6 | Nine-document compiler, receipts, judgements | `web/src/lib/factory/documents/**`, `web/src/lib/factory/judgements/**`, `web/src/components/factory/documents/**`, `web/src/components/factory/receipts/**`, `web/src/components/factory/judgement/**` |
| W7 | Replay + cost/latency ledger | `web/src/app/factory/replay/**`, `web/src/lib/factory/replay/**`, `web/src/lib/factory/ledger/**`, `web/scripts/promote-replay.mjs` |

Shared-file rule: an agent needing a change outside its paths (nav, globals.css tokens, layout) requests it from the coordinator rather than editing.

Cross-package imports: `worker/` imports pure domain code from `web/src/lib/**` via tsconfig paths (including reusing `web/src/lib/anthropic.ts` for model calls). Only runtime-neutral modules may be imported this way — nothing that imports `next/*`. LangGraph/pg-boss code lives exclusively under `worker/`.

## Sequence and integration checkpoints

| Window | Work |
|---|---|
| H0–H1 | Review, this plan, shared contracts frozen (`web/src/lib/factory/contracts/**`), worker package + deps scaffolded |
| H1–H4 | W1–W5 build in parallel; W5 delivers `AgentWorkCard` early so W4 unblocks |
| **IC1 ≈ H4–5** | Mock-mode end-to-end: start run → pg-boss → stub graph nodes → Factory Events in Postgres → SSE → cards render in Assembly View. Coordinator commits. |
| H5–H8 | W3 real agent graph completes; W6 + W7 build; contract drift fixed by coordinator |
| **IC2 ≈ H8** | Full 15-agent graph runs (live key if present, else mock), documents compile, receipts + judgements land. Coordinator commits. |
| H8–H11 | Leicester live run, restart/cancel/recovery tests, cost measurement, presenter batch smoke, gallery visual tuning |
| **IC3 ≈ H11** | Gates checked against parameters §8 (reduced set), replay captured. Final commits, PR opened. |
| H11–H12 | Docs updated with measured results; handoff notes; open items listed honestly |

## Build-process note

This repository documents its own construction (`HOW_IT_WAS_BUILT.md`, `EXECUTION_JOURNAL.md`). For the record: the plan and contracts for this phase were prepared by a Fable 5 coordinator; implementation ran as parallel Opus 4.8 agents with directory ownership; design questions escalated to a Fable 5 (xhigh) advisor rather than being guessed. The same honesty rules that govern the factory govern the build log: failed tests and unfinished work are recorded as such.
