# Factory rewrite — verification results

**Status:** Living record of the 12-hour build's verification phase, 15 July 2026. Companion to [`factory-12-hour-build-plan.md`](factory-12-hour-build-plan.md).

## Reduced mock evaluation (integration agent, dev DB, `FACTORY_MODEL_MODE=mock`)

| # | Item | Result |
|---|---|---|
| 1 | Whole-tree production build | PASS — exit 0, 17 pages, all factory routes |
| 2 | Public flow E2E | PASS — 174 events, strictly monotonic, SSE=poll parity, 9 documents served, SSR 200 |
| 3 | Run terminal status | Honest partial by design: mock pack fixtures carry verification placeholders, so packs are correctly `needs verification` and mock can never reach `completed` without weakening honesty. Receipt-tally bug found and fixed (tally now derived from the authoritative compiler) |
| 4 | Cancellation | PASS — terminal `run.cancelled` last, accepted sections readable; ≤1 in-flight node may finish (node-boundary race, characterized) |
| 5 | Crash recovery (SIGKILL) | FAIL then **PASS after fix** — pg-boss lease left runs stuck ~30 min; on-boot orphan-recovery scan added (plus two real bugs fixed: singleton dedupe was unenforced under the `standard` policy; queued-job cancel was dead code). Re-test: resume 227 ms after boot, sequence contiguous 1→180, zero duplicate documents/agents, single terminal + receipt |
| 6 | Presenter batch (3 campaigns) | PASS — concurrent fan-out within 430 ms, 23 cross-campaign interleavings, batch receipt persisted, gallery cookie gate correct |
| 7 | Replay promotion | PASS (mechanism) — immutable manifest, permanent label, renders 3 campaigns from stored events with zero worker references |
| 8 | Latency/metrics | PASS — mock milestones: first sourced ~2 s, first accepted ~17 s, usable ~67–81 s; admin costs page degrades cleanly with no key |
| 9 | Typechecks | PASS — web and worker `tsc` exit 0 |

Playwright: presenter-batch spec **passed twice** against local mock (~3 min/run): code gate, five campaigns + sixth rejected, 5 anchors/hues, expanded-card cap peaked at exactly 10, receipts → brief in new tab (11 sections + 9 doc cards), no `undefined`/`NaN` tells, all agent names from the roster. Public spec skips honestly on the local IP cap; runs on preview.

## Live run #1 (Leicester school street, public, local worker)

**Outcome: honest partial, 24.9 min, $1.97** (guards: $4 warn / $8 hard — never approached). 382 events, 15 agents, 2 sections accepted, 58 claims (45 load-bearing, 22 verified), 1 nonblocking Judgement Request correctly defaulted, 9 document statuses (1 ready), receipt emitted.

**Live-only defect found (the reason item 10 ran before batch tests):** every tool-using agent (research director, both specialists, evidence adjudicator, decision route) failed with a sanitized provider error after its visible retry, at 21–123 s — too fast for wall timeouts. `fetch_page` completed 20/20; searches started 48 / completed 19. Working hypothesis: the multi-turn continuation breaks when one turn mixes web-search server-tool blocks with client `fetch_page` tool_use. Under diagnosis by the agent-contracts workstream with an env-gated error tap. The degradation path behaved as designed throughout (visible retries/failures, reviewer returns, honest statuses).

**Discrepancies logged:**
- Five `agent.failed` events produced zero `gap.terminal` events — ADR 0011 expects failed responsibilities to surface as Terminal Gaps (state-level next-checks may cover this; needs confirmation).
- Run duration 24.9 min vs the 20-min hard execution limit — verify the limit stops new model nodes at 20 min as specified.

## Live run #2 — FINAL (Leicester, after the container fix)

**Terminal: honest partial · ~70 min · $5.01 · 457 events · zero agent failures/retries** (run #1: five of five tool agents failed). Output: 138 claims (89 load-bearing, 58 verified, 31 honestly unresolved), 21 recorded conflicts, 38 next checks; documents — tactics_timeline and organising_plan **ready** (7k/8.7k chars), media/digital packs substantial but **needs verification** (15k each), campaign_brief 67k chars under review, unaccepted sections carry explicit "Nothing invented to fill it" placeholders. **Zero fabrication tells; 36 verification markers.** Latency misses (first finding 703 s vs 45 s target; first accepted section ~60 min vs 90 s) are roster/search-tuning work, recorded below.

## Live run #2 observations (during run)

**Container fix PROVEN in production shape:** zero tool-agent failures or retries across the entire run (run #1: five of five tool agents failed). All ten first-wave agents completed; both specialists spawned and delivered. Real evidence at depth: six `evidence.found` batches (claims mostly load-bearing), six honest `evidence.conflicted`, seven `evidence.gap`.

**Product highlight:** the research *challenged the campaign premise* — sources indicate the school street launched as a trial (experimental traffic order), so judgements recommended reframing from "stalled scheme" to "protect the live trial and make it permanent". Evidence-driven reframing, live, is the product's core claim demonstrated.

**New defects found (the purpose of a live E2E):**
1. **20-minute hard execution limit not enforced** — run #2 passed 45+ minutes (run #1's 24.9 min corroborates). Cost guard remains the effective backstop.
2. **Judgement Request cap not enforced** — six requests emitted against the contractual maximum of four per run (all defaulted correctly and non-blockingly).
3. **Stream-token TTL (15 min) shorter than a live run** — SSE reconnect fails mid-run and the UI silently degrades to polling. Fixed: TTL raised to 45 min in contracts.
4. `source.search.started` ≫ `completed` asymmetry persists (41/11) with zero failures — likely an event-accounting artifact of code-execution-filtered searches, cosmetic but misleading in the ledger.
5. Cost passed the $4 warning (~29 min); guard events fired correctly. $8 hard stop unexercised so far.

## Preview infrastructure batch (mock, $0)

Playwright presenter-batch spec **PASSED in 3.8 min against the Vercel preview** (`campaign-factory-git-factory-multi-agent-build-campaign-lab.vercel.app`) with the worker deployed on Railway: presenter code gate → five-campaign intake → gallery anchors + live Agent Work Cards over cross-origin SSE → five terminal receipts → brief with 11 sections + 9 document cards; all agent names roster-valid; no fabrication tells. Summary: `web/test-results/batch-summary-2026-07-15T12-28-49-700Z.json`. Also fixed en route: the presenter route failed OPEN when no code was configured on the public preview (now 503, fail-closed).

## Live batch test #1 (five campaigns via the Vercel preview + Railway worker)

**Terminal: batch `partial`, receipt `usable: 5/5` — every campaign produced a usable brief.** Per-campaign cost ~$3.35–3.41 (batch well under the $35 stop). Four campaigns ran genuinely concurrently (peak 9 simultaneous model calls through the gate, no starvation) and were **halted by the now-enforced 20-minute hard limit at 21.2–23.5 min**, recording honest Terminal Gaps (10/8/4/…) — the enforcement fix's first live demonstration. The full batch (1,432 events) is promoted as the pinned replay at `/factory/replay/conference`.

**Defects found by this batch (both fixed on the branch, deploy pending):**
1. **Fan-out defect** — the fifth campaign sat queued ~20 min: pg-boss 11 delivers one handler invocation per fetch and never fetches again until it resolves, so a single `batchSize: 5` subscription serialized the fifth job behind the first four. Fixed with five independent `batchSize: 1` subscriptions (verified against pg-boss source); also removed batch-coupled retry burning. Batch #2 verifies.
2. **Playwright harness crash** at minute 6.4 — brittle index assumption when the live gallery rendered more column nodes than the five intake campaigns; batch itself unaffected (verified server-side). Harness fixed.
3. Minor: `factory_batches.status` stayed `queued` while all five campaigns ran (jumps straight to the terminal roll-up) — cosmetic, logged.

## Pending (appended as they complete)

- Live run #2 after the tool-loop fix (clean gate measurement).
- Railway worker deployment + Vercel preview wiring.
- ≥2 live five-campaign Playwright batch tests against the Vercel preview (user-authorized; $35/batch hard stop) with JSON summaries in `web/test-results/`.
