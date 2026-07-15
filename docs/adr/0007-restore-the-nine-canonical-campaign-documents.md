# ADR 0007: Restore the nine canonical campaign documents

## Status

Accepted — 14 July 2026

## Context

The intended Campaign Factory output contains nine campaign documents. The current implementation instead presents seven to nine individual resource fragments—such as a meeting email, agenda, briefing, press release, pitch email, supporter email, petition page, social posts, and FAQ—as separate downloadable documents.

The multi-agent redesign needs stable output ownership and must not allow several agents to rewrite shared campaign facts independently.

## Decision

Restore the Canonical Campaign Documents:

1. Campaign Brief;
2. Objective and Theory of Change;
3. Power and Stakeholder Map;
4. Campaign Strategy;
5. Tactics and Timeline;
6. Organising Plan;
7. Lobbying Pack;
8. Media Pack; and
9. Digital Campaign Pack.

Documents one through six are compiled from Campaign Synthesis Reviewer-accepted Campaign Brief sections. The Lobbying, Media, and Digital Producers own the structured resource content for packs seven through nine, but all three consume the same accepted campaign state and evidence labels.

A deterministic document compiler renders and exports the versioned documents. Agents produce structured content; they do not independently rewrite shared factual foundations during export.

Documents assemble progressively during a Campaign Factory Run:

- documents one through six appear as their required Campaign Brief sections are accepted;
- the Lobbying, Media, and Digital packs begin in parallel once their strategy, tactics, and organising dependencies are sufficiently stable;
- each document is explicitly `assembling`, `under review`, `ready`, or `needs verification`;
- the Factory Gallery campaign card shows the real number of ready documents; and
- export remains unavailable until the relevant reviewer pass completes.

## Consequences

- The implementation returns to the promised nine-document product contract.
- Resource fragments remain available inside their appropriate pack rather than inflating the document count.
- Campaign Brief versions and document versions must remain linked.
- Targeted Rebuilds regenerate only documents whose accepted source sections or owned resource content changed.
