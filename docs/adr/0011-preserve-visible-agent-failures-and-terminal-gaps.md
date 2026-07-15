# ADR 0011: Preserve visible agent failures and terminal gaps

## Status

Accepted — 15 July 2026

## Context

A five-campaign batch with many model calls, tools, public websites, and graph branches will experience intermittent failures. Hiding those failures or filling missing work with generic content would violate the product's no-synthetic-data principle and make the factory visualisation misleading.

Failing the entire batch because one specialist or source fails would discard useful parallel work and make the conference demonstration unnecessarily brittle.

## Decision

- An agent failure becomes a visible Factory Event and state on its Agent Work Card.
- The same Runtime Agent retries once; the retry remains visible inside the same card.
- After a second failure, deterministic orchestration may spawn a separate registered replacement specialist only when its responsibility and tools genuinely match the task.
- A replacement appears as a new connected Agent Work Card and never impersonates the failed agent.
- If no justified replacement succeeds, the task becomes a Terminal Gap.
- The Campaign Synthesis Reviewer records the gap in the affected Step Report and Evidence and Next Checks.
- Unaffected branches, other campaigns, accepted sections, and ready documents continue and remain available.
- No synthetic baseline or generic fallback is inserted to create the appearance of completion.

## Consequences

- Partial campaigns are useful and honest rather than discarded.
- Failure and retry increase visible factory activity without becoming theatre.
- Step, document, campaign, and batch status models must support partial terminal states.
- The Batch Receipt includes partial and failed work instead of reporting success alone.
