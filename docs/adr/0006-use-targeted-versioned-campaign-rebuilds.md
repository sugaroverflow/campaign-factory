# ADR 0006: Use targeted, versioned campaign rebuilds

## Status

Accepted — 14 July 2026

## Context

Public research will leave gaps, especially in hyperlocal campaigns where current institutional arrangements or lived local knowledge may not be documented online. The completed campaign therefore needs a useful route for campaigners to supply missing context and improve the plan.

Regenerating the entire campaign after every new fact would be slow, expensive, difficult to compare, and likely to introduce unrelated changes. Editing final text in place would disconnect the campaign from its evidence, agent work, and review history.

## Decision

Replace the passive Sources ending with Evidence and Next Checks while retaining the complete source ledger.

Campaigners may resolve a Next Check by supplying a Context Patch or sending an agent to verify it. The default action is **Rebuild affected sections with this context**:

1. store the Context Patch and its provenance without presuming it is verified;
2. calculate and preview the affected agents, decisions, and Campaign Brief sections;
3. invalidate and rerun only affected graph branches;
4. have the recurring Campaign Synthesis Reviewer review the changed work and whole-campaign consistency;
5. present before-and-after diffs; and
6. save a new Campaign Brief version while preserving the earlier version and Work Trace.

A full Campaign Factory rerun remains available as an explicit secondary action when new context changes the campaign's foundations.

## Consequences

- Evidence gaps become an actionable improvement queue rather than a dead end.
- Campaign Briefs require versioning, dependency tracking, selective graph replay, and diff generation.
- Human-supplied local knowledge remains distinguishable from verified public evidence.
- The product demonstrates an ongoing agent loop without becoming an operations dashboard or silently rewriting campaign strategy.
