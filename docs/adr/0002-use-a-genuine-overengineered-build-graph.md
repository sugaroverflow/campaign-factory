# ADR 0002: Use a genuine overengineered campaign-build graph

## Status

Accepted — 14 July 2026

## Context

The existing pipeline uses a small number of model calls while the interface assigns several agent-like labels to each broad stage. That can produce a strong campaign, but it does not substantiate the conference claim that Campaign Factory coordinates many specialised agents or provide enough genuine concurrent activity for the Factory Gallery.

A smaller graph would be cheaper, faster, and easier to operate. The conference objective, however, explicitly includes making the breadth, parallelism, review loops, and institutional capacity of an agent factory feel overwhelming while retaining a useful campaign output.

## Decision

Refactor campaign generation into a genuinely coordinated multi-agent graph. Named Runtime Agents will own independently useful responsibilities, emit observable Work Traces, exchange structured artefacts, and participate in explicit synthesis or review steps.

The graph will be intentionally more specialised and visibly parallel than is strictly necessary to generate the campaign. This overengineering is confined to campaign analysis and production; deterministic orchestration, evidence labelling, state transitions, spending controls, retries, and human approval remain ordinary application logic.

The batch-level factory controller is deterministic infrastructure and is not presented as a Runtime Agent. It launches and limits one to five campaign graphs, rejects a sixth campaign in the conference prototype, validates specialist requests, persists events, and recovers failures. The first visible agents are the campaign-specific Campaign Interpreter & Research Directors.

## Consequences

- The Factory Gallery can truthfully display many simultaneous agent windows across several campaigns.
- The architecture gains more latency, model cost, partial-failure modes, and integration work.
- Agent boundaries must be justified by distinct inputs and outputs, not by persona names.
- Fan-out, fan-in, adjudication, and critique events become durable parts of each Campaign Factory Run.
- The existing campaign output must be protected by explicit compatibility and quality checks during the refactor.
