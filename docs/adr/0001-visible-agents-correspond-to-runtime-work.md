# ADR 0001: Visible agents correspond to runtime work

## Status

Accepted — 14 July 2026

## Context

The Factory Gallery is intended to make simultaneous multi-agent campaign production visible during a live conference demonstration. Artificially multiplying windows or replaying invented activity would make the screen more spectacular, but it would undermine the central claim that an agent factory is actually doing the displayed work.

The interface also needs controlled pacing and a reliable fallback when live research or model calls fail.

## Decision

Every agent window presented as live must correspond to a real Runtime Agent working on the campaign card to which it is connected. Its Work Trace must be derived from observable runtime events such as assignment, tool use, source retrieval, structured findings, hand-offs, reviews, and output changes.

The interface may delay, group, animate, or progressively reveal genuine events for legibility. A previously completed run may be replayed for demonstration recovery only when clearly labelled as a replay. The product must not invent live agents, sources, work, or progress to increase visual activity.

The conference prototype includes a Factory Replay URL for a pinned, pre-existing Campaign Batch in the database. It uses the same renderer as live Factory Mode, reconstructs the experience from immutable stored Factory Events and campaign-state versions, makes no model calls, and retains a persistent “Replay of a real run” label and capture date.

Replay selection is a manual Replay Promotion performed outside the public interface after the product owner identifies a suitable gallery batch by URL or ID. The prototype does not need presenter detection, a presenter login, or an in-product “save replay” control.

The public backup route remains stable at `/factory/replay/conference`. Replay Promotion changes the pinned batch behind that route; it does not change the presentation URL.

## Consequences

- The generation pipeline must emit durable, campaign-addressed agent events rather than only stage-level status.
- Existing interface labels cannot be visualised as separate agents unless the implementation contains corresponding independently invoked work.
- Demo choreography can control presentation timing, but not the factual content or existence of agent activity.
- A replay mode becomes an explicit resilience feature rather than an undisclosed simulation.
- The replay batch must be captured, validated, pinned against deletion, and rehearsed before the event.
- The number of visible windows may vary between runs and failures will remain visible.
