# ADR 0014: Isolate the factory development environment

## Status

Accepted — 15 July 2026

## Context

The existing `campaign-factory` Vercel project deploys `main` to the current production application. Its Neon integration has historically supplied `DATABASE_URL` across Vercel environments, and the application runs an idempotent schema creator on first database use. The multi-agent rewrite changes orchestration, event storage, campaign state, presenter access, replay, and likely the database schema. A preview URL alone would therefore not protect the functional production application or its data.

The rewrite needs a stable online environment for implementation review, full live-agent tests, five-campaign rehearsals, and conference preparation without turning incomplete factory work into the public site. Vercel Pro supports a named Custom Environment with its own branch tracking, domain, and environment variables, so this isolation does not require a second Vercel project.

## Decision

- Keep one Vercel project and its Production environment pinned to `main` and the current production application while the rewrite is under development.
- Upgrade the project to Vercel Pro and create a named `factory-dev` Custom Environment that tracks the factory rewrite branch and has its own stable URL.
- Isolate its database or Neon database branch, model credentials, presenter code, spend ceilings, replay records, observability, and LangGraph worker configuration from production.
- Never allow a missing development environment variable to fall back to a production secret or endpoint.
- Add a fail-closed Environment Identity Check covering the declared application environment, Vercel deployment target, database identity, and LangGraph worker identity before live runs can start.
- Run schema changes and factory-event migrations against the development database first. Production schema changes occur only during an explicit Factory Promotion.
- Use the development environment for live single-campaign tests, repeated presenter batches, chosen replay creation, and the full conference run-through.
- Keep the eventual production cutover deliberate and reversible. A successful branch build or preview deployment is not itself authorisation to promote.
- Permit narrowly scoped fixes to Current Production while the rewrite proceeds; do not require the functional site to track the development branch.

## Consequences

- The team can share and test the substantial rewrite on Vercel without destabilising the existing demonstration.
- Development incurs separate database and model usage, which makes rehearsal spending measurable instead of contaminating production accounting.
- Environment-specific resources and secrets add setup work and must be represented in the deployment runbook.
- Shared project-level settings and integrations require an explicit audit because they are not necessarily isolated by Custom Environment.
- The project must be on Vercel Pro before the named Custom Environment is created; a branch-specific Preview deployment may be used only as a temporary setup step.
- The eventual promotion needs a checklist covering data migration, environment variables, worker routing, presenter access, replay integrity, rollback, and smoke tests.
