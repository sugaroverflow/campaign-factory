# Over-engineering "Campaign Factory" as a multi-agent system

*Deep-research note · 13 July 2026 · deliberately explores the maximalist design so we can reject it on evidence rather than instinct.*

> **TL;DR.** Campaign Factory today is a **workflow**, not an agent: a fixed 3–4-call
> pipeline (Sonnet 5 research → Opus 4.8 plan → 3× Sonnet 5 drafts → Haiku 4.5 lint)
> whose integrity guarantees are enforced in *code*. You *could* rebuild it as a
> Coordinator delegating to eight-plus specialist agents over shared campaign state.
> It would cost 5–10× more per run, blow out latency and rate-limit headroom at ~45
> concurrent users, add nondeterminism, and — most importantly — move the
> no-synthetic-data spine from deterministic code into probabilistic agent judgement.
> The current altitude is correct. The one genuinely useful idea to steal from the
> multi-agent playbook is an *independent, fresh-context verifier* — which the Haiku
> lint pass already approximates.

---

## 1. What the current pipeline actually is

For grounding, the live pipeline in `web/src/lib/pipeline/`:

| Stage | Model | Shape | Integrity mechanism |
|---|---|---|---|
| Geo | *none* (postcodes.io) | Deterministic lookup | Keyless, no LLM — verifiable evidence string |
| A — Research | Sonnet 5, effort `high` | `web_search_20260209` (max 4), one structured `ResearchResult` | Every claim carries one of 7 `VerificationLabel`s; `coerceLabel()` forces off-enum labels to "Verification incomplete" |
| B — Plan | Opus 4.8, effort `high` | One structured JSON `Plan` (objective, power map, pressure, strategy, tactics, organising) | "Never downgrade — plan coherence is un-lintable" |
| C — Drafts | 3× Sonnet 5, effort `medium` (parallel) | lobbying / media / digital → nine documents | `[VERIFY:]` markers on unresolved facts |
| Lint | Haiku 4.5 | Consistency / label / invented-name check | Flags `block`/`warn`; surfaced, not auto-fixed |

Key properties: **stages fail independently** (`partial`/`failed` shown, never faked), **no synthetic fallback**, a **daily spend ledger + kill-switch**, ~**6–15 min** per run, **3–4 model calls**, for ~**45 concurrent** conference users. This is, by Anthropic's own taxonomy, a *workflow with code-controlled logic* — the deliberately simple tier.

---

## 2. "Hermes" and "OpenClaw" — what they actually are

The brief named these as example multi-agent frameworks. Here is an honest reading, including where the evidence is thin.

**Confidence caveat first.** Most coverage of both names sits on SEO/content-farm domains (`agentaibox.com`, `aisuccesslabjuliangoldie.com`, `zestlab.io`, etc.) with mutually inconsistent metrics — one source claims Hermes hit "188K stars in six weeks", another "668 referring domains"; OpenClaw is variously "247K stars / 190K milestone". Treat all such numbers as marketing, not measurement. The load-bearing facts below are corroborated by more authoritative sources (the `NousResearch` GitHub org; VentureBeat and Forbes on the OpenClaw acquisition).

- **Hermes (Hermes Agent, Nous Research).** A real open-source (MIT), self-hosted **agent runtime** at `github.com/NousResearch/hermes-agent` — "the agent that grows with you". Its identity is a *personal-assistant gateway*: a single process bridging an LLM to messaging surfaces (Telegram, Discord, Slack, WhatsApp, Signal, CLI), with persistent multi-level memory, a self-improving skill loop, and 200+ model backends. **Multi-agent orchestration arrived in v0.6.0** as an add-on: natural-language task decomposition spawning specialist sub-agents with agent-to-agent messaging and parallel execution. Note the name collision — "Hermes" is also Nous's well-known *model* family; the agent framework is a separate, newer thing.
- **OpenClaw (a.k.a. "open claw").** A real open-source agent framework that grew out of a late-2025 personal-assistant project (associated with developer Peter Steinberger) and was **acquired by OpenAI on ~15 Feb 2026** (reported by VentureBeat and Forbes; the project is said to be moving to an independent foundation with OpenAI as sponsor). Architecturally it is a **central Gateway process** multiplexing WebSocket/HTTP on one port — session lifecycle, tool dispatch, channel routing, plus "Agent Teams" (subagents, task queues, "LangGraph-style" orchestration) and the same messaging-surface integrations.

**Honest bottom line:** both are self-hosted **agent runtimes / gateways** from the 2025–26 "vibe-coding" wave that *bolted on* multi-agent features — not purpose-built backend orchestration libraries in the sense the brief implies. Their sweet spot is a long-lived personal assistant wired to your chat apps, not a stateless, auditable, batch content pipeline behind a web form. For Campaign Factory's server-side, integrity-first use case, neither is a natural fit; if the team ever wanted this class of tool, the closer-to-home managed option is Anthropic's own Managed Agents (below). I could not find primary documentation establishing either as production-grade for our specific pattern, and I'd flag any decision that leaned on their headline adoption numbers.

---

## 3. Survey of established orchestration approaches

Three orchestration models recur across all of these:

- **Supervisor / hierarchical** — a coordinator decides who does what and merges results.
- **Swarm / handoff** — peers pass control to one another; no central boss.
- **Graph / state-machine** — an explicit graph of nodes and conditional edges; control flow is data.

| Framework | What it is | Orchestration model | Maturity (mid-2026) | Fit for Campaign Factory |
|---|---|---|---|---|
| **Claude Agent SDK + subagents** | Claude Code packaged as a library; built-in tools + subagents, you host & deploy | Supervisor / hierarchical | GA, actively developed | Overkill — designed for open-ended coding/filesystem agents, not a fixed content DAG |
| **Anthropic Managed Agents** | Server-hosted agents; Anthropic runs the loop + per-session sandbox. `multiagent: {type:"coordinator", agents:[…]}`, per-subagent **threads**, **Outcomes** (rubric-graded iterate loop), permission policies, vaults | Supervisor / hierarchical (coordinator + roster; one level deep) | Beta | Closest managed match; **Outcomes** rubric loop is the one feature worth eyeing for a single stage |
| **LangGraph** | Graph runtime for stateful agents; typed shared state, conditional edges, checkpoints, human-in-the-loop | Graph / state-machine (supervisor pattern available) | Mature (v0.4, Apr 2026) | The natural home for a coordinator-over-shared-state design; heaviest concept load |
| **CrewAI** | Role-based "crews"; agents = role + goal + task, with sequential/hierarchical processes | Supervisor / hierarchical | Mature; enterprise observability + scheduling | Fastest to prototype the "team of specialists" framing; weaker on strict typed state |
| **Microsoft AutoGen / Agent Framework** | Conversational multi-agent; GroupChat, handoff (Swarm), GraphFlow; AG2 lineage | Conversational group chat + swarm + graph | AutoGen 1.0 GA (2026) | Research-grade flexibility; conversational looping is the wrong shape for auditable output |
| **OpenAI Agents SDK / Swarm** | Lightweight agents with **handoffs** and agents-as-tools; Swarm is its educational predecessor | Swarm / handoff (manager pattern optional) | Production maturity (2026), OpenAI-native | Ties us to OpenAI models; our stack is Claude-native |
| **Hermes Agent** | Self-hosted personal-agent runtime; v0.6.0 sub-agents | Supervisor-ish task decomposition | OSS, fast-moving, unverified metrics | Runtime/gateway, not a pipeline orchestrator — poor fit |
| **OpenClaw** | Gateway-based agent runtime; "Agent Teams" | Supervisor + queue ("LangGraph-style") | OSS, OpenAI-acquired Feb 2026 | Same — personal-assistant lineage, poor fit for our batch/auditable case |

The pattern: the *purpose-built orchestration libraries* (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK) and the *managed platform* (Anthropic Managed Agents) are the serious candidates for a deliberate rebuild; Hermes/OpenClaw are adjacent-category tools.

---

## 4. The over-engineered reference architecture

Here is the maximalist design mapped onto Campaign Factory: a **Coordinator** agent that decomposes the brief and delegates to specialists, each reading and writing a **shared campaign state**, with a **Verifier/Critic loop** gating progression.

```mermaid
flowchart TD
    U[User brief + postcode] --> CO{{Coordinator agent<br/>Opus 4.8 · plans, delegates, merges}}

    subgraph SS[Shared campaign state<br/>claims · plan · drafts · verification ledger]
      direction LR
      ST[(RunState / campaign object)]
    end

    CO -->|delegate| R[Researcher<br/>Sonnet 5 + web_search]
    R --> FV[Fact-Verifier / Critic<br/>independent, fresh context]
    FV -->|re-search on gap| R
    FV -->|claims verified| PM[Power-Mapper<br/>stakeholders + tiers]
    PM --> STR[Strategist<br/>objective · pressure · phases]
    STR --> CO

    CO -->|fan-out| D1[Drafter · Lobbying]
    CO -->|fan-out| D2[Drafter · Media]
    CO -->|fan-out| D3[Drafter · Digital]
    CO --> ORG[Organiser<br/>roles · ladder · asks]

    D1 --> VC[Verifier / Critic loop<br/>labels · [VERIFY:] · invented-name check]
    D2 --> VC
    D3 --> VC
    ORG --> VC
    VC -->|revise| D1
    VC -->|pass| OUT[Assembled campaign]

    R <--> ST
    FV <--> ST
    PM <--> ST
    STR <--> ST
    D1 <--> ST
    D2 <--> ST
    D3 <--> ST
    ORG <--> ST
    VC <--> ST
    CO <--> ST
```

Component responsibilities:

- **Coordinator** — decomposes the brief, sequences specialists, decides when a stage is "done enough", merges outputs. In Managed Agents terms this is the `coordinator` with a roster of eight-plus agents, each running in its own **thread**; in LangGraph it is the supervisor node over typed state.
- **Researcher + Fact-Verifier/Critic** — the Researcher does web search; a *separate, fresh-context* Verifier re-checks each claim and either sends it back for more searching or admits it with a label. (Fresh-context critics genuinely outperform self-critique — this is the one part with real merit.)
- **Power-Mapper / Strategist** — split Stage B's single structured plan into two cooperating agents.
- **Drafters (fan-out) + Organiser** — the current three parallel Stage C calls, re-cast as autonomous agents, plus a dedicated Organiser.
- **Verifier/Critic loop** — a gate that re-runs drafts until labels, `[VERIFY:]` markers, and invented-name checks pass.
- **Shared campaign state** — every agent reads/writes one `RunState`/campaign object (the same shape as today), which is where the concurrency and integrity risks concentrate.

This is a faithful, competent multi-agent design. It is also far more machinery than the problem needs — which is the point of the exercise.

---

## 5. Trade-offs versus the current pipeline

### 5.1 Quality / depth

| Dimension | Realistic effect |
|---|---|
| Research depth | **Some upside.** A Researcher↔Verifier loop can chase multi-hop gaps the single Stage A call gives up on. |
| Plan coherence | **Likely downside.** Splitting one Opus plan into Power-Mapper + Strategist re-introduces the seam the current single structured call deliberately avoids ("plan coherence is un-lintable"). |
| Draft consistency | **Marginal.** A critic loop can catch more than the Haiku lint pass, but at high cost for small gains on already-good drafts. |
| Overall | Depth gains are real but concentrated in *one* place (research verification); everywhere else the added agents mostly add variance. |

### 5.2 Cost and latency at ~45 concurrent users

Rough order-of-magnitude per run (Opus 4.8 $5/$25; Sonnet 5 intro $2/$10 through 31 Aug 2026; Haiku $1/$5 per MTok):

| | Current pipeline | Over-engineered multi-agent |
|---|---|---|
| Model calls / run | 3–4 | ~30–60 (coordinator turns + specialist turns + critic loops) |
| Est. cost / run | ~**$0.80–$1.50** | ~**$5–$12** (5–10×; coordinator re-reads growing shared state each turn) |
| Wall-clock / run | ~6–15 min | ~20–40+ min, high variance |
| Concurrent model requests at 45 users | ~180 spread across stages | up to ~450+ *simultaneous* (each run fans to ~10 agents) |

The dollar figures alone are not catastrophic (hundreds of dollars across a conference day). The binding constraints are **latency variance** (coordinator/critic loops are nondeterministic — some runs finish in 20 min, some in 45) and **rate-limit contention**: 45 runs each fanning to ~10 mostly-Opus-tier agents can saturate org ITPM/OTPM, triggering 429s → retries → longer tails → worse UX under exactly the load the conference produces. The current pipeline's small, staged call count is far gentler on both.

### 5.3 Failure modes

- **Partial-failure semantics get harder.** Today a stage fails cleanly and is shown as `failed`. A coordinator that delegates and merges can partially complete in ways that are hard to render honestly — half a plan, a draft citing claims a critic later rejected.
- **Loop non-termination.** Verifier↔Researcher and Verifier↔Drafter loops need hard iteration caps or they burn budget against the kill-switch. (Managed Agents' Outcomes caps this at `max_iterations`; a hand-rolled loop must add it explicitly.)
- **Coordinator drift.** An LLM coordinator can re-plan, skip a specialist, or spawn extra work — the opposite of a deterministic DAG.
- **Debuggability.** 3–4 typed stage outputs are trivially inspectable; 30–60 interleaved agent turns over shared state are not.

### 5.4 The integrity question (the decisive one)

Campaign Factory's no-synthetic-data principle is currently enforced by **code**: `coerceLabel()` forces any off-enum label to "Verification incomplete"; `[VERIFY:]` markers are literal; failed stages are shown, not faked; geography is a deterministic postcodes.io lookup. These are invariants a model cannot talk its way around.

A multi-agent system **relocates that spine into agent judgement**. A Fact-Verifier *agent* is itself an LLM that can hallucinate a "verified" verdict; a Coordinator can report "all claims audited" without having done so. This is not hypothetical — Anthropic's own model guidance explicitly warns that agents fabricate progress claims on long runs and recommends grounding every claim against a tool result. The more autonomy you add, the more the integrity guarantee degrades from *enforced* to *asserted*.

There is a real nuance in the other direction: an **independent, fresh-context critic** is a legitimate integrity *booster* — separate verifier subagents catch things self-review misses. But you capture ~90% of that value with a bounded critic pass over structured output — which is exactly what the Haiku lint stage already is. The remaining autonomy buys risk, not integrity.

---

## 6. Recommendation

**Keep the current pipeline. It is at the right altitude.** Campaign generation is a well-specified, fixed-shape task with a hard auditability requirement — the textbook case for a *workflow with code-controlled logic*, and the explicit "don't build an agent unless the task needs open-ended, model-driven exploration" case. The four criteria for escalating to agents (complexity that can't be specified in advance; value that justifies cost/latency; task viability; recoverable errors) mostly point *away* from a rebuild here: the pipeline shape is fully specifiable, and the cost/latency/integrity price of autonomy is high.

Concretely:

1. **Do not** rebuild the pipeline as a Coordinator-over-specialists swarm. The integrity spine must stay in deterministic code (`coerceLabel`, `[VERIFY:]`, shown-not-faked, keyless geo).
2. **Keep the Haiku critic** — it is the valuable, bounded, cheap slice of the multi-agent idea.
3. If you want *more* verification rigour, the smallest justified step is a **single bounded Researcher→Verifier loop on Stage A only** (fresh-context critic, hard iteration cap), leaving Stages B/C/lint untouched. Anthropic **Managed Agents Outcomes** (rubric-graded, `max_iterations`-capped) is the cleanest managed way to prototype exactly that one loop without hand-rolling termination.

**What would justify escalating** (revisit if any becomes true):

- Research genuinely requires **open-ended, multi-hop investigation** that cannot be captured in a single structured Stage A call — then agentify *research only*.
- The product moves to **long-running, interactive per-user sessions** (chat-style campaign refinement) rather than one-shot batch generation.
- A stage develops a **checkable rubric** where iterate-until-it-passes measurably beats one-shot generation — a per-stage Outcomes loop, not a whole-pipeline coordinator.

Even in those cases, escalate **one stage**, keep the code-enforced integrity invariants, and never let an autonomous agent become the sole arbiter of whether a claim is verified.

---

## Sources

Framework taxonomy and comparisons:
- LangGraph / CrewAI / AutoGen / OpenAI Agents SDK comparison — https://pecollective.com/blog/ai-agent-frameworks-compared/
- Open-source agent frameworks compared (2026) — https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared
- Best multi-agent frameworks 2026 — https://gurusup.com/blog/best-multi-agent-frameworks-2026
- Best open-source agent frameworks (Firecrawl) — https://www.firecrawl.dev/blog/best-open-source-agent-frameworks
- LangGraph vs CrewAI vs OpenAI Agents (ship test) — https://techsy.io/en/blog/langgraph-vs-crewai-vs-openai-agents-sdk

Hermes (Nous Research):
- github.com/NousResearch/hermes-agent — https://github.com/nousresearch/hermes-agent
- Hermes Agent (Nous Research) — https://hermes-agent.nousresearch.com/
- Hermes multi-agent orchestration v0.6.0 — https://hermes-agent.ai/features/multi-agent

OpenClaw / OpenAI acquisition:
- VentureBeat — https://venturebeat.com/technology/openais-acquisition-of-openclaw-signals-the-beginning-of-the-end-of-the
- Forbes — https://www.forbes.com/sites/terdawn-deboe/2026/02/25/why-the-openclaw-acquisition-is-a-surprising-win-for-small-business-roi/
- OpenClaw multi-agent docs (community) — https://clawdocs.org/guides/multi-agent
- Acquisition analysis (workflow infrastructure) — https://goodai.substack.com/p/openai-acquired-openclaw-why-workflow

Anthropic orchestration surfaces (Managed Agents multiagent/coordinator/threads/Outcomes, Claude Agent SDK subagents):
- Managed Agents multi-agent — https://platform.claude.com/docs/en/managed-agents/multi-agent.md
- Managed Agents outcomes (rubric loop) — https://platform.claude.com/docs/en/managed-agents/define-outcomes.md
- Claude Agent SDK — https://code.claude.com/docs/en/agent-sdk

*Source-reliability note: Hermes/OpenClaw adoption metrics originate largely on SEO/content-farm domains and are inconsistent between sources; only the corroborated facts (NousResearch GitHub org; VentureBeat/Forbes acquisition coverage) are relied on above.*
