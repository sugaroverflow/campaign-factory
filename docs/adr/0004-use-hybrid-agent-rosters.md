# ADR 0004: Use hybrid agent rosters

## Status

Accepted — 14 July 2026

## Context

Campaign Factory must produce the same ten-step Campaign Brief Page for campaigns whose substantive needs differ. A planning dispute may need planning documents and committee expertise; a transport campaign may need operator policy and public-realm evidence; a parliamentary issue may need legislative and committee procedure.

An identical agent roster would be reliable but visibly generic. Fully dynamic agent creation would appear more autonomous but would make tool permissions, output compatibility, cost, testing, and truthful visualisation unpredictable.

## Decision

Each Campaign Factory Run receives a hybrid Agent Roster targeting approximately fifteen to seventeen Runtime Agents. Fifteen is a soft recommended cap: the roster may exceed it when distinct campaign responsibilities or justified Campaign Specialists would otherwise be artificially merged. Twenty Runtime Agents is the hard per-campaign safety limit.

- A Fixed Backbone owns the responsibilities required to satisfy the Campaign Output Contract.
- The Fixed Backbone contains thirteen recurring responsibilities:
  1. Campaign Interpreter & Research Director;
  2. Evidence Adjudicator;
  3. Objective & Theory-of-Change Strategist;
  4. Decision Route Agent;
  5. Power & Stakeholder Agent;
  6. Pressure Analysis Agent;
  7. Campaign Strategy Architect;
  8. Tactics & Sequencing Planner;
  9. Organising Designer;
  10. Lobbying Producer;
  11. Media Producer;
  12. Digital Producer; and
  13. Campaign Synthesis Reviewer.
- Decision Route, Power and Stakeholder Mapping, and Pressure Analysis remain separate journey steps with separate primary Runtime Agents and visible hand-offs.
- The Fixed Backbone includes one recurring Campaign Synthesis Reviewer that retains campaign context across journey steps, independently reviews step work, writes Step Reports, and performs the final whole-campaign consistency pass.
- Two to four Campaign Specialists are selected from an approved catalogue according to the campaign's institutions, subject matter, evidence sources, and formal decision route.
- A scoping agent proposes the Campaign Specialists and records its reasons. Deterministic application logic validates the proposal against the registered catalogue, roster cap, and tool permissions, then starts the selected agents without waiting for human approval.
- Every selectable specialist has a defined responsibility, input contract, tool permissions, structured output, and Work Trace contract.
- The selection mechanism may choose among registered specialists but cannot invent arbitrary roles, tools, or agent capabilities.
- During execution, any Runtime Agent may make a visible Specialist Escalation request. Deterministic orchestration validates relevance, duplication, budget, permissions, and the hard safety cap before spawning another registered specialist as a separate Runtime Agent. Specialists may request help but cannot create arbitrary agents or tools directly.

## Consequences

- Campaigns visibly assemble different teams while retaining comparable final outputs.
- Specialist selection becomes a first-class, inspectable part of the run.
- Initial campaign builds do not stall for roster approval; a later rerun may allow a person to alter the roster deliberately.
- The specialist catalogue and selection quality require their own tests and fallback rules.
- The soft cap limits routine cost and visual overload while still allowing a campaign to retain politically meaningful specialisms. Five active campaigns will normally produce at least sixty to seventy-five genuine agent tasks, and may produce more when justified.
