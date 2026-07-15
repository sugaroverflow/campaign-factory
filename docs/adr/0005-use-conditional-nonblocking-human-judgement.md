# ADR 0005: Use conditional, non-blocking human judgement

## Status

Accepted — 14 July 2026

## Context

Campaigns sometimes depend on political judgement or local knowledge that public evidence and model inference cannot legitimately settle. Mandatory approval after every agent or journey step would make five concurrent campaign runs unusably slow and would undermine the intended autonomous factory demonstration. Proceeding silently would conceal uncertainty and weaken accountability.

## Decision

A Campaign Factory Run may raise up to four conditional Judgement Requests, limited to:

1. material ambiguity in campaign scope;
2. conflict or a critical gap in evidence;
3. a consequential choice between campaign strategies; or
4. local knowledge unavailable from public sources.

Every Judgement Request must include a recommended Provisional Default, its rationale, the outputs it may affect, and a visible opportunity to answer, defer, or accept the recommendation.

The request does not pause other campaigns or unrelated branches. The affected branch waits only until its next dependent task is ready to start; it does not wait for an arbitrary countdown. If the campaigner has not answered at that point, the factory uses the Provisional Default, labels the resulting output accordingly, and exposes a Re-decision action. A later answer creates a new decision version and reruns only affected downstream nodes.

Final human review of the completed campaign remains separate and is required before publication, lobbying, outreach, or other external action.

## Consequences

- Most campaigns can run without interruption while difficult campaigns surface genuine limits.
- Silence is never represented as approval.
- Graph state needs dependency tracking, decision versions, selective invalidation, and partial replay.
- The Campaign Brief Page must distinguish accepted human judgement, Provisional Defaults, and verified facts.
- The demo can show human collaboration without waiting indefinitely or fabricating certainty.
