# ADR 0008: Agents propose, reviewers decide, deterministic code applies

## Status

Accepted — 14 July 2026

## Context

Many Runtime Agents may work concurrently on overlapping parts of a campaign. Direct shared-state mutation would create race conditions, silent overwrites, irreproducible Campaign Briefs, and no trustworthy way to show proposed versus accepted changes.

The product also requires visible diffs, reviewer loops, targeted rebuilds, document versioning, and a durable explanation of how each conclusion entered the campaign.

## Decision

Runtime Agents never mutate Accepted Campaign State directly. They submit Campaign Change Proposals against an explicit base version.

Each proposal includes:

- the agent and campaign responsible;
- affected journey sections, structured fields, and documents;
- proposed values or operations;
- supporting evidence and verification labels;
- assumptions, uncertainty, and dependencies; and
- the base campaign-state version.

The recurring Campaign Synthesis Reviewer accepts, rejects, or returns proposals for one bounded revision loop. Deterministic application logic validates the accepted patch, rejects stale or schema-invalid writes, creates a new Accepted Campaign State version, and emits the corresponding Factory Events and user-visible diff.

The Campaign Brief Page and Canonical Campaign Documents render only from Accepted Campaign State. Agent scratchpads and unfinished proposals never masquerade as campaign output.

Proposal Conflicts never use last-write-wins resolution. The initial policy routes evidence conflicts to the Evidence Adjudicator, keeps strategic alternatives visible to the Campaign Synthesis Reviewer, records the rationale for automated resolutions, and turns conflicts that materially change the campaign objective, target, or escalation strategy into Judgement Requests. Rejected proposals remain in the Campaign Build Record. The routing and adjudication policy is explicitly versioned and may evolve after evaluation; preservation, visibility, and non-silent resolution remain invariant.

## Consequences

- Parallel agents cannot silently overwrite one another.
- The interface can truthfully animate proposals, review decisions, diffs, and accepted updates.
- Campaign state requires versioned schemas, patch validation, conflict detection, and an append-only decision history.
- Agents may finish work before their output appears in the Campaign Brief because review and deterministic application remain separate states.
