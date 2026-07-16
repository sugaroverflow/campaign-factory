# Campaign Operations build checkpoint

This branch implements the scoped Campaign Operations workspace from issue #11.

## Demo boundary

The planned `/operations` route is a client-side conference demo surface. Seeded audience, contact, draft, review, and outbox data must be labelled as fixture/local state. The route must not claim to send or deliver email.

Working-now states may include selecting a seeded audience segment, editing an email draft, previewing it, requesting review, approving it through an explicit human action, queueing it locally for demo, and resetting local state.

Coming-soon states include real contact import, provider connection, live sending, delivery analytics, production scheduling, database persistence, and any external outreach.

## Verification expectation

At minimum, run the relevant web checks before each reviewable slice, including `npm run build` from `web/` once implementation is in place, and inspect the route in a browser if tooling is available.

## 2026-07-15 rebase checkpoint

The Campaign Operations feature branch was replayed onto `origin/factory/multi-agent-build` at `f2941db` after the base navigation and runtime work landed. The SiteNav conflict was resolved by preserving the base branch's labelled Campaign Builder, Campaign Gallery, and Factory destinations while keeping Operations as a discoverable peer link before Factory.

Fresh verification after the rebase: `npm run lint` passed, `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`, the safety copy grep found no `sent`, `delivered`, `delivery`, or `dispatch` wording in the operations route/component/nav, and a Playwright desktop plus narrow viewport smoke test completed the local queue flow without horizontal overflow.

## 2026-07-15 second rebase checkpoint

`origin/factory/multi-agent-build` advanced again to `f59b5a9`, moving the legacy single-agent builder under `/legacy` and simplifying the primary navigation to the Factory Builder and Campaign Gallery. The Campaign Operations branch was replayed onto that base and the SiteNav conflict was resolved by preserving the new base labels while keeping `/operations` discoverable as a peer route.

Fresh verification after this second rebase: `npm run lint` passed, `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`, the safety copy grep found no `sent`, `delivered`, `delivery`, or `dispatch` wording in the operations route/component/nav, and Playwright completed the full local queue flow at `1440x1000` and `390x1000` with no horizontal overflow. Initial layout metrics remained in flow: desktop header/main top `65px`, narrow header/main top `97px`, and nav scroll width equalled client width at both sizes.

## 2026-07-15 third rebase checkpoint

`origin/factory/multi-agent-build` advanced to `3344b92`, adding express-review defaults and accept-with-dissent return behavior. The Campaign Operations branch was replayed onto that base without conflicts; `/operations` remains a discoverable peer beside Factory Builder and Campaign Gallery in the primary navigation.

Fresh verification after this third rebase: `npm run lint` passed, `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`, the safety copy grep found no `sent`, `delivered`, `delivery`, or `dispatch` wording in the operations route/component/nav, and Playwright completed the full local queue flow plus reset at `1440x1000` and `390x1000` with no horizontal overflow. Initial layout metrics remained in flow: desktop header/main top `65px`, narrow header/main top `97px`, and nav scroll width equalled client width at both sizes.

## 2026-07-15 Operations Playwright coverage checkpoint

Added `web/tests/factory/operations.spec.ts` so the local-only Operations demo path is now covered by repeatable Playwright smoke tests rather than only ad hoc browser inspection. The test selects a seeded audience, edits the subject and body, switches to preview, marks the draft ready for human review, approves it through the explicit human-review action, queues it locally for demo, verifies the disabled provider boundary and `aria-describedby` link, confirms localStorage persistence after reload, and resets to the seeded draft/outbox state.

The same spec also checks desktop `1440x1000` and narrow `390x1000` layouts for page and primary-nav horizontal overflow. Fresh verification: `npm run lint` passed, `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`, and `npm run test:factory -- operations.spec.ts` passed 2/2 against the existing local Next server on `localhost:3000`.

## 2026-07-15 final base-refresh checkpoint

`origin/factory/multi-agent-build` advanced to `9f5d0c7`; the Campaign Operations branch is now based on that commit while keeping the completed Phase 2 dashboard expansion intact. The only rebase conflict was in `web/src/components/SiteNav.tsx`; it was resolved by preserving the base branch's `/gallery` primary navigation path and keeping `/operations` discoverable as a peer link for non-operations routes. The `/operations` route itself still uses its dedicated route-aware shell, so it does not double-render the global Primary nav or footer.

Fresh verification after the base refresh: `git diff --check` passed, `npm run lint` passed, `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`, `npm run test:factory -- operations.spec.ts` passed 4/4, and the safety copy grep found no `sent`, `delivered`, `opened`, or `answered` wording in the Operations route/component/test sources checked. Playwright inspection at `1440x1000`, `1024x768`, and `390x844` found no horizontal overflow, no global Primary nav on `/operations`, a disabled `Import contacts · Coming soon` control in Contacts, and the global Primary nav/footer still present on `/factory`.

## 2026-07-16 rebase and verification checkpoint

`origin/factory/multi-agent-build` advanced to `c4a1b06`, adding original-design brief page, graded gallery, and factory-floor polish work. The Campaign Operations branch was replayed onto that base without conflicts, preserving the completed Phase 3 wow pass and the dedicated `/operations` shell.

Fresh verification after the rebase: `git diff --check` passed; `npm run lint` passed with the pre-existing `_flagged` warning in `web/src/lib/factory/documents/language.ts`; `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run build` passed and prerendered `/operations`; `npm run test:factory -- operations.spec.ts` passed 5/5; and the safety copy grep found no forbidden `sent`, `delivered`, `opened`, or `answered` wording in the Operations route/component/test sources checked. Production-browser Overview screenshots were refreshed at `/tmp/ops-heartbeat-rebase-overview-1440x900.png`, `/tmp/ops-heartbeat-rebase-overview-1024x768.png`, and `/tmp/ops-heartbeat-rebase-overview-390x844.png`; metric inspection found body width equalled viewport width at all three sizes and the Campaign Runway, next human decision, human approval stage, and provider boundary text were present.
