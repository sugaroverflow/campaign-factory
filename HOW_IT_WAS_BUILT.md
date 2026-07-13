# How Campaign Factory was built

A short architecture-and-story companion to [`PLAN.md`](PLAN.md) (the plan) and
[`web/README.md`](web/README.md) (setup). This is the "how this was built" narrative —
the same beat the app closes on: *input → live research → shared plan → drafted
materials → human review.*

## What it is

Enter a UK local or public-policy problem ("I want the council to keep the library
open in Highfields"). Campaign Factory researches it live, applies a campaign-planning
framework, drafts the materials, and presents the whole thing as one scrollable journey —
labelling what it could verify and flagging what it couldn't.

## The one non-negotiable: no synthetic data

Everything hangs off this. Research runs against real sources; every claim carries one
of seven verification labels; drafts mark unresolved facts as `[VERIFY: …]`; the system
never invents officeholder names, quotes, contacts, or dates. When a stage fails it is
shown as failed — there is **no synthetic fallback**. The prototype's scenario-engine
(fake-campaign generator) was deliberately **not** ported.

## The pipeline (routed models)

Four model calls over one shared campaign state (`web/src/lib/pipeline/`):

| Stage | Model | Why |
|---|---|---|
| A · Research | Claude **Sonnet 5** + web search | Establishes verified claims with labels; failure mode is mechanically auditable |
| B · Plan | Claude **Opus 4.8** | Objective, power map, pressure, strategy, tactics, organising — coherence is un-lintable, so never downgraded |
| C · Drafts | Claude **Sonnet 5** ×3 parallel | Nine documents in three audience packs (decision-maker / press / supporter) |
| Lint | Claude **Haiku 4.5** | Cheap consistency check: labels present, `[VERIFY:]` markers, no invented specifics |

Model routing keeps coherence-critical work on Opus and uses cheaper models where
quality is auditable. Research runs at **high** effort — quality is prioritised over
cost. Measured in rehearsal: a full run is **~$1.15 and ~15–18 min** (Stage A research
is the long pole at high effort). Cost is controlled by **usage caps** (per-IP,
per-session, and the £150/day kill-switch), not by degrading research. No Fable 5 in the
pipeline.

## How a run flows

1. `POST /api/runs` — gated by a conference access code, a per-session run cap (3), and a
   global daily spend kill-switch (£150). Returns immediately with a run id.
2. The pipeline runs as a background job; run state is written through to **Postgres** so
   any instance can serve progress.
3. The client polls `GET /api/runs/[id]`; the UI shows a stage ticker plus a live research
   feed, then reveals the plan and documents as they land (progressive reveal).
4. Failed stages surface a banner; whatever completed is kept.
5. The finished campaign lives at a durable, shareable `/c/[id]`; the owner can opt it into
   the conference **wall** (with a projector mode), or delete it. An admin can hide wall items.

## UI

A full Next.js rewrite (App Router, React 19, Tailwind v4, shadcn/ui). The **UX journey**
is the spec — the scroll-reveal choreography (rebuilt from the "awake" prototype with an
IntersectionObserver), the verification-label chips, and the nine downloadable documents.
Desktop-first, with the entry form and progress screen kept usable on a phone.

## Infrastructure

Vercel (Next.js) + Neon Postgres (portable driver — local Docker in dev). GitHub-connected
for auto-deploys from `main`, building from the `web/` root directory.

## Build story

Built milestone by milestone in one session (M1 pipeline → M2 launch controls → M3 journey
UI → M4 persistence → M5 wall → deploy), each verified before moving on — including two live
pipeline runs against the real API to confirm the routing, web search, label discipline, and
`[VERIFY:]` markers all hold on real data. See [`EXECUTION_JOURNAL.md`](EXECUTION_JOURNAL.md)
for the chronological log and the [open issues](https://github.com/sugaroverflow/campaign-factory/issues)
for what's next (durable execution via Vercel Workflow; the execution-journal convention).
