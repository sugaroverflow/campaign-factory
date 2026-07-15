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
