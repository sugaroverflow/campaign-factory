# ADR 0015: Run LangGraph in dedicated environment workers

## Status

Accepted — 15 July 2026

## Context

Campaign Factory Runs are long-running, stateful graphs with parallel model calls, retries, conditional human judgement, dynamic specialist spawning, checkpoint recovery, and live event streaming. The current Next.js application starts work through Vercel `after()`, which is not a durable runtime for this graph. LangGraph's standalone Agent Server is designed around persistent execution and advises against deployment in serverless environments.

Vercel Workflow could provide durable execution, but stacking it around LangGraph would create two orchestration and recovery models for the same run.

## Decision

- Keep the Next.js interface, public and presenter access, run intake, read APIs, and presentation layer on Vercel.
- Execute Campaign Factory Runs in a dedicated, always-on LangGraph Factory Runtime Worker.
- Give the Factory Development Environment its own authenticated worker endpoint and isolated Postgres persistence.
- Create the corresponding Production worker and persistence configuration only as part of Factory Promotion.
- Persist LangGraph checkpoints, Factory Events, accepted campaign state, and resumable run identity in the environment's database.
- Stream only sanitised Factory Events and accepted state to the interface; never stream private model reasoning.
- Do not run the LangGraph Agent Server inside Vercel serverless functions.
- Do not add Vercel Workflow as a second graph orchestrator. Revisit that choice only if LangGraph is removed or reduced to a non-orchestrating library.
- Include worker and database identity in the Environment Identity Check so development and production cannot cross-connect.
- ADR 0016 specifies the conference implementation as an open-source LangGraph JS worker on Railway rather than LangGraph Agent Server.

## Consequences

- Runs can survive frontend deployments, request timeouts, browser closure, and worker restarts when checkpoints are healthy.
- The frontend and factory runtime can scale and fail independently.
- The system gains a second deployed service, authenticated service-to-service traffic, worker health monitoring, and a deployment runbook.
- Development rehearsals exercise the actual runtime topology intended for production rather than a Vercel-only substitute.
- The selected conference worker topology is documented in ADR 0016; managed Agent Server remains a future operational trade-off rather than a prototype dependency.

## References

- [LangGraph Agent Server](https://docs.langchain.com/langsmith/agent-server)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Vercel Workflow durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution)
