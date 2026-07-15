# ADR 0010: Retire Mission Bay

## Status

Accepted — 15 July 2026

## Context

Mission Bay was designed as a campaign-specific post-build page containing a catalogue of agent missions. Its implementation PR was reverted. The redesigned Campaign Factory now makes genuine multi-agent orchestration the core campaign-generation experience: several campaigns run concurrently, real agents spawn and collaborate visibly, Campaign Briefs assemble progressively, evidence gaps create Next Checks, and new context triggers targeted rebuilds.

Keeping Mission Bay would create a second agent metaphor after the primary factory, duplicate verification and review concepts, and weaken the conference narrative.

## Decision

Retire Mission Bay entirely.

- Remove Mission Bay, Agent Mission, Mission Purpose, Mission Catalogue, and Factory Pattern from the active product language.
- Remove the Mission Bay concept and implementation-plan documents.
- Do not add a Mission Bay route, campaign CTA, catalogue, or “How it works” explanation.
- Keep agent orchestration inside Campaign Factory Runs, Factory Mode, Step Workspaces, Evidence and Next Checks, Judgement Requests, and Targeted Rebuilds.
- Treat future monitoring or ongoing campaign-operation features as separate product proposals, not as a resurrection of Mission Bay.

## Consequences

- The conference story has one agent factory rather than a campaign generator followed by a second agent showcase.
- Previously proposed post-build missions are not implementation commitments.
- Verification remains actionable through Evidence and Next Checks and targeted agent reruns.
- Historical research may mention Mission Bay, but active product and implementation documentation must not.
