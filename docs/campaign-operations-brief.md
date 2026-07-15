# Campaign Operations build checkpoint

This branch implements the scoped Campaign Operations workspace from issue #11.

## Demo boundary

The planned `/operations` route is a client-side conference demo surface. Seeded audience, contact, draft, review, and outbox data must be labelled as fixture/local state. The route must not claim to send or deliver email.

Working-now states may include selecting a seeded audience segment, editing an email draft, previewing it, requesting review, approving it through an explicit human action, queueing it locally for demo, and resetting local state.

Coming-soon states include real contact import, provider connection, live sending, delivery analytics, production scheduling, database persistence, and any external outreach.

## Verification expectation

At minimum, run the relevant web checks before each reviewable slice, including `npm run build` from `web/` once implementation is in place, and inspect the route in a browser if tooling is available.
