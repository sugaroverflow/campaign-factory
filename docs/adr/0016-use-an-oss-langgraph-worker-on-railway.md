# ADR 0016: Use an OSS LangGraph worker on Railway

## Status

Accepted default — 15 July 2026

## Context

ADR 0015 places long-running factory execution in a dedicated LangGraph worker rather than Vercel serverless functions. LangGraph's Agent Server provides a polished task queue, SSE, persistence and cancellation API, but the current self-hosted production path also requires PostgreSQL, Redis and a LangSmith licence. That is an additional commercial platform and runtime dependency for a conference prototype that already owns its campaign event and state contracts.

The open-source LangGraph JS library supports Postgres checkpointing without Agent Server. Campaign Factory still needs a durable job queue and a small authenticated service boundary around it.

## Decision

- Deploy one always-on Node 22 Factory Runtime Worker on Railway.
- Use open-source `@langchain/langgraph` with `@langchain/langgraph-checkpoint-postgres`.
- Use `pg-boss` as the Postgres-backed durable run queue, retry lease and dead-letter mechanism.
- Use the isolated Neon environment database, with separate schemas for application data, LangGraph checkpoints and queue tables.
- Give the worker a direct Neon connection. Vercel continues using the pooled connection.
- Implement Campaign Factory's own signed start/status/judgement/cancel boundary and reconnectable run-scoped SSE endpoint over the existing provider-neutral Factory Event schema.
- Begin with one worker replica, a database-backed campaign-aware model-call gate, and no autosleep.
- Use Railway Pro before dress rehearsal, with 2 vCPU and 2 GB RAM as initial resource ceilings, deployment health checks, external continuous uptime monitoring, and a compute-spend ceiling.
- Do not use LangGraph Agent Server, LangSmith Deployment, Redis, Vercel Workflow, or a second orchestration framework for the conference prototype.
- Revisit managed Agent Server only if later operating scale makes owning the queue, service API and recovery path more expensive than the commercial dependency.

## Consequences

- The factory retains explicit LangGraph dependencies, checkpoints and interrupts without adding a licensed deployment platform.
- PostgreSQL remains the durable source of truth, and the prototype avoids operating Redis solely for agent streaming.
- Campaign Factory must implement and test its own job API, SSE reconnection, cancellation, idempotency, drain and recovery behaviour.
- Railway becomes an additional vendor and billing surface, but its Docker/Node deployment and usage pricing suit one small always-on worker.
- The worker cannot use Neon's pooled connection for session-level features; queue/checkpoint work uses the direct connection while Vercel uses the pooled endpoint.

## References

- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph Agent Server](https://docs.langchain.com/langsmith/agent-server)
- [Self-host standalone server requirements](https://docs.langchain.com/langsmith/deploy-standalone-server)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Railway plans and usage pricing](https://docs.railway.com/pricing/plans)
- [Neon connection pooling limitations](https://neon.com/docs/connect/connection-pooling)
