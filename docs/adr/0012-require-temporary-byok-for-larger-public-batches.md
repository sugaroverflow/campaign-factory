# ADR 0012: Require temporary BYOK for larger public batches

## Status

Superseded by ADR 0013 — 15 July 2026

## Context

A five-campaign Campaign Batch is expected to cost materially more than the current single campaign, and removing access codes exposes the project account to repeated public batch spending. Many agent applications support bring-your-own-key access, but Campaign Factory runs durable server-side graphs rather than browser-only requests. A supplied key must remain available across parallel work, retries, and short human-intervention windows.

Anthropic API keys are static account secrets. Anthropic recommends secret-manager storage, short expiration, rotation, and caution when supplying a key to third-party tools.

## Decision

- Campaign Factory subsidises public batches of one or two campaigns through its project credential.
- Public batches of three to five campaigns require BYOK.
- The launch interface explains the estimated cost, provider, and that usage is billed to the supplied provider account before accepting the key.
- The interface recommends a newly created, short-lived, campaign-specific key; Anthropic currently allows expirations as short as three hours.
- The key is submitted only over TLS, encrypted immediately with authenticated encryption and batch-bound additional data, and stored only as ciphertext with an expiry.
- Plaintext keys are never written to application logs, analytics, graph checkpoints, Accepted Campaign State, Factory Events, error messages, browser storage, or replay data.
- Workers load and decrypt the credential just in time through a credential reference; agent inputs never carry the raw key.
- The ciphertext is deleted when the batch completes, fails, is stopped, or reaches the configured short retention limit.
- The user can choose **Delete key and stop batch** while it remains active.
- Authentication failure creates an explicit batch failure and deletes the stored credential; the system does not fall back to the project key.
- Run, concurrency, and abuse limits still apply to BYOK batches because provider cost is not the only operational risk.

## Consequences

- Larger public batches do not consume the project model budget.
- Campaign Factory assumes real secret-handling responsibility and requires focused security tests and log redaction.
- BYOK introduces provider-account setup friction, but only after the user requests more than two campaigns.
- Durable replay and Campaign Build Records remain safe to share because they contain credential references and usage metadata, never credentials.
