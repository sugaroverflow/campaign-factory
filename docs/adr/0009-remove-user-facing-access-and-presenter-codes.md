# ADR 0009: Remove user-facing access and presenter codes

## Status

Superseded in part by ADR 0013 — 15 July 2026. Public access-code removal remains accepted; presenter-code removal does not.

## Context

The current application can prompt for a conference access code and exposes an admin page that sends an entered admin key with browser requests. A proposed presenter session would add another code solely to protect replay-promotion controls.

For the conference prototype, these code prompts are unintuitive and replay promotion will be an infrequent, coordinated back-office action. Removing a public access gate increases exposure to model spend, but the application already has session and IP run caps, a global daily budget kill switch, concurrency limits, and a read-only switch.

## Decision

Remove user-facing access-code and presenter-code flows from the product.

- Campaigners do not enter a code to create campaigns.
- There is no public presenter replay-promotion UI. ADR 0013 adds a narrowly scoped presenter code for five-campaign demo batches.
- The product owner selects a suitable live Campaign Batch from the gallery and supplies its URL or ID for manual Replay Promotion.
- Replay promotion pins the immutable batch and assigns it to the stable Factory Replay route through back-office database or deployment configuration.
- The stable conference backup route is `/factory/replay/conference`; manually promoting a different reviewed batch updates the route's backing mapping.
- Operational secrets may remain server-side for maintenance, but are never presented as ordinary product inputs.
- Existing run caps, spend limits, concurrency controls, and the read-only switch remain mandatory.

## Consequences

- The public campaign experience has no access-code prompt. The separate presenter route intentionally requires a presenter code.
- Replay promotion requires a manual operational step and cannot be performed spontaneously from the stage without prior coordination.
- Abuse and spend protection depend on rate, concurrency, budget, and shutdown controls rather than shared secrets.
