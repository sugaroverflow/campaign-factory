# Campaign Factory — Playwright suite

End-to-end tests that drive the **real UI** (presenter batch + public intake) through
the real web app, worker, events, SSE/polling, and read model. The suite is
parameterised entirely by environment variables so the *same* specs run against
localhost (mock worker) now and a Vercel preview URL later.

Owned by the PLAYWRIGHT workstream. Files live under `web/tests/factory/**` and
`web/playwright.config.ts` only.

## Prerequisites

- The **dev server** on `:3000` and a **factory worker** on `:8787` must already be
  running. This suite never starts or stops them.
- Locally the worker runs in **mock mode** (`FACTORY_MODEL_MODE=mock`): deterministic,
  Leicester-flavoured agent output, zero model calls. A full mock batch finishes in
  roughly **3 minutes**.
- `@playwright/test` + Chromium are installed as devDependencies in `web/`.

## How to run

From `web/`:

```bash
# Whole suite (localhost, mock worker)
npm run test:factory

# Just the presenter batch journey
npx playwright test tests/factory/batch.spec.ts

# Just the public intake smoke test
npx playwright test tests/factory/public.spec.ts

# Against a Vercel preview (real worker, live models) — long waits:
PW_BASE_URL=https://<preview>.vercel.app \
PW_PRESENTER_CODE=<the presenter code for that env> \
PW_TERMINAL_TIMEOUT_MS=1500000 \
PW_FIRST_CARD_TIMEOUT_MS=120000 \
npx playwright test tests/factory/batch.spec.ts
```

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PW_BASE_URL` | `http://localhost:3000` | Origin under test. |
| `PW_PRESENTER_CODE` | `factory-rehearsal-2026` | Presenter code entered at the gate. |
| `PW_TERMINAL_TIMEOUT_MS` | `300000` (5 min) | Max wait for all batch campaigns to reach a terminal state. Use ~`1500000` (25 min) live. |
| `PW_FIRST_CARD_TIMEOUT_MS` | `60000` (60 s) | Max wait for the first agent cards. Use ~`120000` live. |
| `PW_TEST_TIMEOUT_MS` | terminal + 10 min | Per-test hard cap. |
| `PW_RETRIES` | `0` | Playwright retries. |

The long live waits are attached **per-assertion**, not as one global timeout, so a
genuine hang fails on the exact step rather than after the whole budget.

## What each spec asserts

### `batch.spec.ts` — full presenter batch (the primary journey)

1. **Code gate → intake.** Enters the presenter code; asserts the cookie-gated intake
   heading appears and the `cf_presenter` HttpOnly cookie is set.
2. **Five campaigns; sixth not enterable.** Enters the five fixture campaigns
   (Leicester / Stratford / Tooting / Barnes / Ham); asserts the "Add another campaign"
   control is disabled and shows "Maximum 5 campaigns".
3. **Launch → gallery.** Asserts redirect to `/factory/gallery/[batchId]`, five **opaque**
   campaign anchors labelled by place, and the **Factory Ledger** visible at ≤44px
   (`UI_LIMITS.factoryLedgerMaxHeightPx`).
4. **Live-run observation.** ≥5 agent cards within the first-card budget; five **distinct
   campaign hues**; expanded-card count **never exceeds 10** (`UI_LIMITS.maxExpandedCards`,
   asserted on every sample); **Work Backscroll rows update** over time.
5. **Terminal.** Samples the live gallery until all five campaigns show a Campaign
   Completion Receipt **or** an honest partial/failed anchor state; asserts every rendered
   agent card shows a name from the known roster (`ALL_AGENT_DEFS`); asserts receipts link
   to `/factory/c/[id]` with `target="_blank"`, follows one into a **new tab**, and asserts
   the brief renders its ten sections (+ evidence panel) and the nine-document library.
6. **No fabrication tells.** Asserts neither the gallery nor the brief contains bare
   `undefined` / `null` / `NaN` text.
7. **Summary.** Writes `test-results/batch-summary-<timestamp>.json` (see below).

### `public.spec.ts` — public single-campaign intake (smoke)

Enters one campaign at `/factory` (problem + place), asserts redirect to the assembly
view, the first agent card (Step Workspace) within the first-card budget, and that the
step workspace renders above the brief sections. It **does not** wait for a terminal state
(liveness only) and cancels via the UI if a cancel control exists, otherwise leaves the
cheap mock run going.

> **Per-IP rate limit.** The public route enforces `CF_IP_RUN_CAP` (default 3) **and** a
> per-session cap — an intentional anti-abuse control. Locally every request buckets under
> the shared `local` IP, so once the team's daily quota is spent the POST returns `429`/`503`
> and this spec **skips honestly** (annotated with the status) rather than faking a pass.
> On a preview URL with real per-visitor IPs it runs normally.

## Reading the JSON summary

`test-results/batch-summary-<timestamp>.json` is the documentation source for the
batch-test report.

- `batch.firstCardMs` — ms from launch to the first agent card anywhere.
- `batch.allTerminalMs` — ms until the last campaign reached a terminal state.
- `batch.maxExpandedObserved` / `expandedCap` — peak simultaneous expanded cards vs the
  contract cap (peak should touch but never exceed the cap).
- `batch.maxBackscrollRowsObserved` — peak Work Backscroll rows (liveness).
- `batch.receiptsRendered` / `distinctHues` — should be 5 / 5.
- `batch.agentNamesSeen` — the distinct roster short names observed on cards.
- `batch.briefSectionsSeen` / `briefDocCards` — sections (10 steps + evidence = 11) and
  the nine canonical documents on the followed brief page.
- `campaigns[]` — per campaign: `shortName`, `firstCardMs`, `receiptMs`, `terminalMs`,
  settled `receiptTitle`/`receiptTag`, `intake`, and `firstCardToReceiptMs`.

## Reports & artifacts

- HTML report: `test-results/html/` (`npx playwright show-report test-results/html`).
- JSON run report: `test-results/results.json`.
- Traces/screenshots on failure: `test-results/artifacts/`.

## Notes / honest caveats

- **Mock campaigns finalise as `partial`.** Mock claims are always labelled "Generated
  campaign recommendation" / "Campaign assumption" (never "Verified"), so documents need
  verification and the run ends in the honest **partial** state — a valid terminal outcome.
- Selectors are structural / inline-style based (roles, aria-labels, `data-agent-run-id`,
  the frozen 300px expanded-card width, the global `.fa-rcpt` receipt class) because the
  components ship no `data-testid`s and CSS-module class names are hashed. If the UI adds
  test ids, prefer them in `factory.helpers.ts`.
- The task specified `import shortNames from contracts/roster.ts`; roster.ts exports the
  agent **definitions**, so `factory.helpers.ts` derives the name set from
  `ALL_AGENT_DEFS` (both `shortName` and `displayName` accepted).
