# Campaign Factory — Production Build Plan

Turning the `app/` prototype into a public self-serve production application on Vercel,
launching at a ~45-person conference. Decisions locked in the grilling session of 13 Jul 2026.

---

## 1. Product shape

- **Public self-serve** web app at `campaign-factory.vercel.app`.
- **Launch moment:** conference panel → live on-stage run seeded by the discussion → the room
  gets the URL + a shared access code and runs it themselves.
- Design for ~45 **simultaneous** runs; expect the real pattern to be staggered.
- A user enters a UK local-campaign problem ("I want [councillor] to [stop X] in [place]");
  the system researches it live and returns a complete campaign plan + drafted materials.

## 2. Integrity principle — NO SYNTHETIC DATA, EVER

The product's soul is verification discipline. This principle is load-bearing:

- The prototype's scenario engine (`app/js/engine.js` fake-campaign generation) is **NOT ported**.
- Every claim carries one of 7 verification labels (strict enum): `Verified public information`,
  `Supported inference`, `Generated campaign recommendation`, `Campaign assumption`,
  `Conflicting evidence`, `Verification incomplete`, `External information unavailable`.
- Drafts mark unresolved facts as `[VERIFY: …]`.
- The system never invents officeholder names, quotes, contact details, or dates.
- **Failure model:** partial results stay on screen + a visible failed-stage banner + per-stage
  retry. There is no synthetic fallback for a failed stage.
- **Kill-switch / overload:** honest "We're at capacity" page offering real past campaigns.
- **Stage-demo insurance:** replay a *real* rehearsal campaign from the server-side library
  (never a simulation).

## 3. Architecture

- **Durable background-job runs** — kick off a run, return immediately, work survives function
  timeouts (the ~6–8 min synchronous stream of the prototype cannot survive Vercel serverless).
- Client polls / subscribes for progress. **Progressive reveal:** research is readable while
  plan + drafts still generate.
- Pipeline stages callable with **explicit state + API key per run** (not a global env read) —
  this is the seam that enables both BYOK (post-launch) and downstream regeneration (backlog).

## 4. Model routing (Fable-designed, adopted as-is)

| Stage | Model | Effort | Parallelism | Notes |
|---|---|---|---|---|
| A — Research | `claude-sonnet-5` | high | 1 call | `web_search_20260209`; 7 labels as strict enum in structured output; + keyless postcodes.io geography lookup (deterministic) |
| B — Campaign plan | `claude-opus-4-8` | high | 1 call | **never split, never downgrade** — plan coherence is un-lintable |
| C — Drafts | `claude-sonnet-5` | medium | **3 grouped parallel calls** | groups by audience: decision-maker / public / supporter packs; fire group 1, await first streamed token, then groups 2–3 (prompt-cache hits) |
| C-check — lint | `claude-haiku-4-5` | — | 1 call, overlaps C | labels present, `[VERIFY:]` markers present, no invented names/dates/contacts absent from Stage A |

- **No Fable 5 in the pipeline** (2× price, longer turns, refusal classifiers on a public
  surface, 30-day retention requirement).
- Est. **~$0.33/run**, wall time **~4.5–5.5 min**. Launch worst case (~135 runs) ≈ **$45**.
- **Build-time verification:** test Stage A label quality on Sonnet 5. Fallback = move A to
  Opus 4.8 (+$0.07/run).

## 5. Cost & abuse controls

- Shared **conference access code**, gating the *run only* (see §8).
- **Per-session cap: 3 runs.**
- **Global daily spend kill-switch: £150** (tunable config value; measure one real run's cost
  the week before and size caps around it). When tripped → "We're at capacity" page.

## 6. Persistence & sharing

- Server-side DB (recommended: **Neon Postgres** via Vercel Marketplace) — campaigns, wall,
  spend ledger. Also required by the background-job architecture (results must live server-side
  for the client to poll).
- **Private-by-default shareable URLs** (`/c/<id>`).
- **Opt-in conference wall** — one-click "Share to the wall"; wall has an auto-refreshing
  **projector mode** (big type) for the venue screen.
- **Secret admin hide button** per wall item (fire extinguisher, not moderation infra).
- **Owner deletion** — browser-session-keyed (no accounts); deleting also removes from the wall.

## 7. Design & UX

- **Full TypeScript / Next.js rewrite.** Prototype was vibe-selection only; nothing preserved
  as code. The **UX journey is the spec** (not the pixels):
  - scroll narrative: problem → research → objective → decision-maker → power → pressure →
    strategy → tactics → organising → drafts → document library → sources → how this was built
  - one-way scroll-reveal choreography from `archive/prototypes/awake.{js,css}` (rebuilt
    idiomatically in React — IntersectionObserver or a motion lib)
  - labelled-claim card interactions
- Pixels rebuilt fresh on **Tailwind + shadcn/ui**.
- **Desktop-first, mobile bearable** (sections are content-dense) — EXCEPT the **entry form**
  and **progress screen**, which must be properly phone-usable (the QR-code launch moment).
- **Progress UX (option C):** stage **ticker primary** for all runs (interpreting → researching
  → verifying → decision-maker → objective → power → pressure → strategy → tactics → organising
  → drafting → checking); Stage A research **streams live** as a secondary feed (only stage a
  human can read in flight). B/C land on completion. Presenter narrates over the ticker on stage.

## 8. Flow / UI decisions

- **Gate placement:** access code gates the **run only** — landing, example campaigns, wall, and
  shared campaign URLs are all public (shared links must work for colleagues; public wall = free
  marketing).
- **Input form:** full structured form ported from the prototype — conversational field
  ("I want [who] to [what] in [where]…") + optional structured fields (organisation, location,
  desired outcome, known decision-maker, timeframe, people affected, evidence, resources).
  On mobile: conversational field on top, structured fields stacked below.
- **Documents are READ-ONLY in v1** — copy + download only. No edit UI, no server-side edit
  persistence. Shared URLs always show as-generated output.
- **Regeneration in backlog** — architect stages B+C to re-enter from an edited shared state
  (same seam as BYOK), but ship v1 with full re-runs only (counting against the 3-run cap).

## 9. Lifecycle

- **4-week sunset tail** after the conference (config flag — same read-only flip the kill-switch
  uses): runs disable, campaign URLs stay readable.
- **BYOK ("bring your own API key") = post-launch backlog.** Pipeline takes its key per-run from
  day one so BYOK is later a UI task, not a refactor. Key stays client-side, never stored.

## 10. Proposed stack

- Next.js App Router + TypeScript on Vercel.
- **Neon Postgres** (Vercel Marketplace) — campaigns / wall / spend ledger.
- **Vercel Workflow (WDK)** for the durable, crash-safe, step-based run with streaming.
- Anthropic calls via **AI Gateway** for unified spend tracking feeding the kill-switch —
  build-time check that the `web_search` server tool passes through cleanly; if not, Stage A goes
  direct via the Anthropic SDK and we count spend ourselves.
- Model IDs: `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5`.

## 11. Build order (milestones)

1. **Scaffold + pipeline** — Next.js/TS/Tailwind/shadcn scaffold; routed pipeline (A/B/C + Haiku
   lint) as server-side modules taking an explicit per-run key; run it as a durable background job.
2. **Gate + kill-switch** — access code on the run endpoint; per-session cap; spend ledger +
   £150 kill-switch → "at capacity".
3. **Journey UI + progress UX** — scroll-reveal journey; ticker + live research stream.
4. **Persistence + share URLs** — DB; private shareable `/c/<id>` pages.
5. **Wall + admin** — opt-in wall, projector mode, secret admin hide, owner delete.
6. **Testing + rehearsal** — Stage A label-quality test; ~45-run load rehearsal; seed real
   rehearsal campaigns into the library.
7. **Launch collateral** — QR, access code, on-stage run-of-show.

## 12. Open build-time verifications (not decisions)

- Does AI Gateway pass the `web_search` server tool through cleanly? (fallback: direct SDK for A)
- Actual measured per-run cost → size the kill-switch and session cap.
- Stage A verification-label quality on Sonnet 5 (fallback: Opus 4.8 for A).
