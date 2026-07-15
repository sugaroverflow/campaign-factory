# Campaign Factory

Campaign Factory's shared language for designing UK local and public-policy campaigns.

## Language

**Hyperlocal Campaign**:
A campaign focused on changing one concrete decision affecting one named place or community, even when several institutions or decision-makers influence it.
_Avoid_: Local variant, replicated campaign, borough rollout

**Verification Run**:
A human-triggered agent task that checks or re-checks selected campaign claims against current public evidence, recording a new dated result without overwriting the earlier finding.
_Avoid_: Fact refresh, automatic correction, silent update

**Decision-Route Watcher**:
A read-only agent assigned to a Hyperlocal Campaign that monitors the public sources governing its decision and surfaces candidate changes for verification and human review.
_Avoid_: Parliament watcher, autonomous monitor, automatic campaign updater

**Token Win**:
A concession that creates the appearance of campaign progress but does not materially advance the campaign's purpose, build useful power, or improve the route to the main objective.
_Avoid_: Minimum Viable Win, stepping-stone win, partial victory

**Formal Decision Route**:
The documented chain of authority, procedural stages, public bodies, and known dates through which a campaign's target decision can be made. It excludes informal influence unless that influence is separately labelled as strategic inference.
_Avoid_: Who really decides, power map, inferred influence

**Factory Gallery**:
The shared build view where several Hyperlocal Campaigns are shown as cards while their campaign runs progress concurrently. Campaigners remain in this view during generation; the cards are anchors for visible agent work rather than links that must be opened to understand the factory.
_Avoid_: Campaign dashboard, operations console, card navigation

**Campaign Progress Rail**:
The compact ten-step Campaign Brief sequence shown on every Factory Gallery campaign card. Steps illuminate only when their work has been accepted by the Campaign Synthesis Reviewer, making visible how concurrent agent work resolves into a structured campaign.
_Avoid_: Generic progress bar, simulated completion, agent-stage list

**Campaign Agent Cluster**:
The temporary, loose spatial group of translucent Agent Work Cards surrounding one fixed Factory Gallery campaign card in Factory Mode. Cards share the campaign colour and connect visibly to their campaign and parent agents; they may overlap one another but never obscure campaign anchors or Your Judgement Cards. The cluster dissolves when the campaign completes.
_Avoid_: Neat workflow lane, unrelated floating windows, unreadable unanchored swarm

**Factory Ledger**:
The live, batch-level strip of counts derived exclusively from Factory Events, such as campaigns running, agents spawned and working, source checks, proposals under review, conflicts, judgements waiting, and documents ready. It makes the scale of the swarm legible without estimating or simulating activity.
_Avoid_: Vanity metrics, invented work-equivalent claims, operations dashboard

**Batch Receipt**:
The frozen, event-derived proof of work shown when a Campaign Batch reaches its reveal point. It records elapsed time, campaign outcomes, agents spawned, source checks, journey sections, documents, proposal conflicts, revisions, and human decisions without converting them into invented staff hours or impact claims.
_Avoid_: Marketing estimate, simulated total, success-only summary

**Campaign Completion Receipt**:
The compact, event-derived summary that replaces a campaign's temporary Agent Cluster when its run completes in the Factory Gallery. It shows status, elapsed time, agents involved, sources checked, review and revision counts, ready documents, Provisional Defaults, and remaining Next Checks. Its Open Campaign Brief action opens a new tab for presenters so the live Factory Gallery remains undisturbed. It does not replay or reopen agent work in the gallery.
_Avoid_: Completed agent workspace, gallery work-trace replay, miniature Campaign Brief

**Factory Replay**:
A presenter backup that uses the normal Factory Mode renderer to play an immutable, previously completed Campaign Batch from its stored Factory Events and Accepted Campaign State versions. It makes no model calls and is persistently labelled as a replay of a real dated run even though its pacing and animation resemble live execution.
_Avoid_: Simulated agent activity, unlabeled prerecorded demo, regenerated fake event stream

**Replay Promotion**:
The manual back-office action that pins a reviewed live Campaign Batch as the source for a stable Factory Replay. It is performed from the chosen batch ID outside the public interface; campaigners are not asked to enter presenter or access codes and no in-product “save replay” control is required.
_Avoid_: Presenter login, public pin button, automatic selection of a successful-looking run

**Live Conference Batch**:
Five new Campaign Ideas typed from scratch by the presenter during the conference demonstration and launched together. It is not prefilled from the Factory Replay or a rehearsed campaign fixture.
_Avoid_: Preloaded live demo, disguised replay, campaigns started before batch launch

**Agent Work Overlay**:
A deliberately busy, translucent layer shown over the Factory Gallery while campaigns are being built. Temporary agent windows appear, update, connect visually to the campaign card they serve, and disappear when their current work is complete.
_Avoid_: Modal dialog, chain-of-thought viewer, permanent agent console

**Work Trace**:
A human-readable, evidence-linked record of an agent's observable work: its assigned task, current step, tools or sources used, structured findings, uncertainties, hand-offs, and changes proposed or produced. It does not expose or claim to reproduce private model reasoning.
_Avoid_: Chain of thought, inner monologue, simulated terminal chatter

**Campaign Build Record**:
The durable, campaign-specific history derived from the temporary Agent Work Overlay and retained only with the completed Campaign Brief rather than reopened in the Factory Gallery. It preserves significant Work Trace events, evidence, reviews, and output changes without preserving every transient animation.
_Avoid_: Chat transcript, raw model log, replay of private reasoning

**Runtime Agent**:
An independently invoked model or software process with a named campaign responsibility, explicit input, observable Work Trace, and a structured finding, artefact, review, or hand-off. A label in the interface is not a Runtime Agent unless a corresponding unit of work actually runs.
_Avoid_: Agent-themed label, animated persona, prompt section presented as a separate worker

**Campaign Factory Run**:
The coordinated build process that turns one Campaign Idea into the existing campaign output through multiple Runtime Agents, parallel workstreams, evidence checks, synthesis, and review. Its internal complexity is intentionally made visible in the Factory Gallery.
_Avoid_: Single prompt, campaign card, post-build mission catalogue

**Campaign Batch**:
One to five Campaign Factory Runs launched together from separate Campaign Ideas and observed concurrently in the Factory Gallery. Each run remains campaign-specific even while the batch makes their combined scale visible; the conference prototype does not queue a sixth campaign.
_Avoid_: Unlimited queue, national campaign rollout, campaign replication, one shared campaign

**Subsidised Batch**:
A public Campaign Batch containing exactly one campaign whose model and research usage is charged to the Campaign Factory project account and remains subject to session, IP, concurrency, and global spending limits.
_Avoid_: Free unlimited usage, presenter batch, user-supplied credential

**Presenter Session**:
A reusable, time-limited browser session established by entering the presenter code on the dedicated demo route. It unlocks batches of up to five campaigns for rehearsals and the conference without granting destructive admin or replay-promotion permissions.
_Avoid_: Public access code, admin key, API key, permanent presenter account

**Factory Development Environment**:
The named Vercel Custom Environment within the existing Campaign Factory project used to build, rehearse, and review the multi-agent rewrite without changing the current production application. It tracks the factory rewrite branch and has its own stable URL, database or database branch, model credentials and spend limits, presenter authentication, replay data, and LangGraph worker configuration. Code and Vercel project settings may be shared, but runtime state and secrets never fall through to Production.
_Avoid_: Second application, alternate production URL, preview deployment connected to the production database

**Current Production**:
The functional Campaign Factory deployment that remains pinned to the existing production code and data while the factory rewrite is developed. It receives only explicitly approved production fixes until the rewrite passes its promotion checklist.
_Avoid_: Development fallback, shared test environment, automatic target for factory branches

**Factory Promotion**:
The deliberate release process that moves the reviewed factory rewrite into Current Production only after schema, replay, cost, failure, security, and conference run-through checks pass. Promotion is not triggered merely because a development branch is merged or a preview deployment builds successfully.
_Avoid_: Automatic preview promotion, database swap without rehearsal, conference-day first deployment

**Environment Identity Check**:
A fail-closed startup and run-creation check that confirms the declared Campaign Factory environment, Vercel deployment target, database identity, and LangGraph worker identity agree. A Factory Development Environment deployment refuses to run against production resources, and Production refuses development resources.
_Avoid_: Hostname-only guess, warning without blocking, secret fallback across environments

**Factory Runtime Worker**:
The dedicated, always-on Node service that uses open-source LangGraph JS to execute and resume Campaign Factory Runs, PostgresSaver for graph checkpoints, and pg-boss for durable queued work. The conference implementation runs on Railway. Each deployed Campaign Factory environment has an authenticated worker and database identity of its own; Vercel presents the interface and API boundary but does not execute the long-running graph.
_Avoid_: LangGraph Agent Server, Vercel background callback, browser process, second orchestration layer, shared development and production worker

**Live-to-Replay Switch**:
A manual presenter recovery action that leaves the live Campaign Batch intact and opens the immutable, permanently labelled Factory Replay for the output reveal. It is offered only after explicit health or time thresholds and never splices replay events or results into the live batch.
_Avoid_: Automatic silent failover, mixed live/replay batch, simulated completion

**Public Single-Campaign Flow**:
The ordinary Campaign Factory experience in which one Campaign Idea launches directly into its Campaign Assembly View. It uses the same Runtime Agents and campaign graph as presenter batches but does not show the multi-campaign Factory Gallery or Batch Receipt.
_Avoid_: Reduced-quality pipeline, one-card batch gallery, public multi-campaign launch

**Campaign Idea**:
The initial input submitted for one Campaign Factory Run. It requires a campaign problem and a named place or community; desired change, affected people, evidence, decision-maker, timeframe, organisation, and resources remain optional context that the Intake Agent may infer only when evidence supports it or request from the campaigner.
_Avoid_: Fully scoped campaign brief, mandatory long form, placeless campaign, location invented by the system

**Campaign Idea Card**:
One entry in the batch-launch form. It shows required Campaign problem and Place fields first, keeps optional campaign context behind Add context, and may be added or removed until the batch reaches its five-campaign maximum.
_Avoid_: Repeated full intake form, prefilled live-demo campaign, sixth queued campaign

**Factory Launch**:
The transition triggered by Build campaigns in which the submitted Campaign Idea Cards become fixed Factory Gallery anchors, their Campaign Progress Rails appear, the Factory Ledger starts, and each campaign's first real Runtime Agent spawns.
_Avoid_: Generic loading page, unrelated gallery navigation, simulated agent entrance

**Campaign Output Contract**:
The completed, campaigner-facing result a Campaign Factory Run must preserve: the current ten-step campaign journey, its inline campaign detail, the nine Canonical Campaign Documents, Evidence and Next Checks, and verification state. Agent orchestration may change how this result is produced but must not replace it with an agent transcript or architecture display.
_Avoid_: Campaign Brief document only, raw agent bundle, factory log as campaign plan

**Canonical Campaign Documents**:
The nine versioned campaign outputs compiled from reviewer-accepted shared campaign state: Campaign Brief; Objective and Theory of Change; Power and Stakeholder Map; Campaign Strategy; Tactics and Timeline; Organising Plan; Lobbying Pack; Media Pack; and Digital Campaign Pack.
_Avoid_: Individual resource fragment presented as a document, independently regenerated factual narrative, arbitrary document count

**Campaign Brief Page**:
The campaign-specific page containing the ten-step campaign journey, inline campaign detail, documents, sources, and verification state. “Campaign Brief” in product discussion refers to this whole page unless a particular exported document is named explicitly.
_Avoid_: Campaign Brief document, generation progress screen, agent transcript

**Campaign Assembly View**:
The focused build view for one manually selected campaign. It shows that campaign's Campaign Brief Page materialising alongside the Runtime Agents, hand-offs, reviews, human interventions, and output changes producing it. It is driven by the same run events as the Factory Gallery and does not start a separate build.
_Avoid_: Automatically selected campaign, separate campaign run, finished brief only

**Pinned Campaign**:
The campaign a person has explicitly chosen to inspect in Campaign Assembly View. The interface never changes the Pinned Campaign automatically; unpinned campaigns continue running in the Factory Gallery.
_Avoid_: Currently active campaign, automatically followed campaign, next completed campaign

**Factory Event**:
A durable, structured account of observable work within a Campaign Factory Run. It identifies the campaign, Runtime Agent, parent task, journey step, event type, time, and any evidence, artefact, hand-off, uncertainty, or output change involved. Factory Events drive both live visualisation and the Campaign Build Record without exposing private model reasoning.
_Avoid_: Token stream, framework debug log, chain of thought, invented progress message

**Agent Roster**:
The Runtime Agents assigned to one Campaign Factory Run. It combines a Fixed Backbone needed to produce the Campaign Output Contract with a small number of Campaign Specialists selected for that campaign's institutions, subject matter, evidence sources, and decision route. Fifteen agents is a recommended operating target, not a reason to merge distinct campaign responsibilities; justified campaigns may exceed it up to a hard limit of twenty Runtime Agents.
_Avoid_: Identical team for every campaign, unbounded swarm, artificial role merging, list of interface personas

**Fixed Backbone**:
The Runtime Agent responsibilities every Campaign Factory Run needs to interpret, research, verify, strategise, produce, review, and assemble the ten-step Campaign Brief Page.
_Avoid_: Fixed complete roster, generic one-agent pipeline, campaign-specific expert

**Campaign Specialist**:
A Runtime Agent selected from an approved capability catalogue because a particular campaign requires its domain, institutional, procedural, or evidence expertise. Selection changes the Agent Roster without changing the Campaign Output Contract.
_Avoid_: Invented expert persona, unrestricted subagent, permanent member of every campaign

**Specialist Escalation**:
A visible request made by a Runtime Agent during a Campaign Factory Run for an additional registered Campaign Specialist. Deterministic orchestration checks relevance, duplication, budget, permissions, and the hard safety cap before spawning a separate connected Agent Work Card.
_Avoid_: Unrestricted recursive delegation, invented specialist, hidden extra model call

**Agent Collaboration Toolkit**:
The common set of structured actions available to every Runtime Agent: report visible work, request a registered specialist, hand off an artefact, submit a Campaign Change Proposal, raise a conflict, request human judgement, and complete a task with remaining gaps. Each action emits a Factory Event; campaign-specific research and production tools remain separately permissioned.
_Avoid_: Free-form status theatre, direct state mutation, identical unrestricted tool access

**Judgement Request**:
A conditional request for campaigner input raised when a Campaign Factory Run encounters material scope ambiguity, conflicting or critically incomplete evidence, a consequential strategy choice, or missing local knowledge. It includes the responsible agent's recommended default, rationale, affected outputs, and the point at which the factory will proceed provisionally.
_Avoid_: Mandatory approval at every stage, open-ended chat, silent assumption

**Provisional Default**:
The explicit, reversible answer a Runtime Agent recommends for a Judgement Request and the factory uses when the campaigner has not answered before the dependent work must continue. It remains visibly labelled as an assumption rather than human approval.
_Avoid_: Inferred user consent, final decision, hidden fallback

**Re-decision**:
A later human answer that replaces a Provisional Default, creates a new version of the campaign decision, and reruns only the downstream agent work affected by that change. Earlier outputs and reasoning provenance remain in the Campaign Build Record.
_Avoid_: Editing generated text in place, restarting the entire campaign, silent overwrite

**Step Workspace**:
A temporary, inline view immediately above a Campaign Brief section that shows the Runtime Agents, tasks, hand-offs, reviews, Judgement Requests, evidence, and proposed changes currently producing that section. A Step Workspace may contain one agent or a coordinated team and is driven by the same Factory Events as the Factory Gallery.
_Avoid_: Permanent split screen, one agent per journey step, duplicated simulation

**Step Build Receipt**:
The compact, expandable summary left above a Campaign Brief section after its Step Workspace completes. It records the contributing agents, sources, reviews, provisional decisions, and replayable Work Trace while allowing the finished campaign content to remain primary.
_Avoid_: Raw transcript, permanently open workspace, decorative agent credit

**Agent Work Card**:
The translucent, read-only, nontechnical rendering of one Runtime Agent's current Work Trace in the Factory Gallery or a Step Workspace. It explains the campaign task, public evidence being checked, useful finding, uncertainty, hand-off, and proposed output change in plain campaign language. Campaigners inspect Agent Work Cards but never type into them.
_Avoid_: Embedded terminal, chat window, raw JSON, token stream, stack trace, private reasoning transcript

**Expanded Agent Work Card**:
The full approximately 300×190px Agent Work Card used for the most recently spawned, failing, handing-off, reviewing, or otherwise narratively important active Runtime Agents. No more than ten are expanded simultaneously in a five-campaign Factory Gallery; all prioritisation is derived from real Factory Events.
_Avoid_: Permanent modal, manually scripted spotlight, all active agents expanded

**Compact Agent Work Card**:
The distinct approximately 180×96px card used for an active Runtime Agent when the Factory Gallery has reached its expanded-card limit. It still shows agent identity, campaign, assignment, current real state, and latest meaningful event; it is not an aggregated agent count and may expand when its work becomes significant.
_Avoid_: Hidden agent, decorative pill, combined team card

**Your Judgement Card**:
The visually distinct campaigner-input card connected to a Runtime Agent that has raised a Judgement Request. It presents the decision, evidence, disagreement, recommended Provisional Default, affected Campaign Brief sections, and actions to use the recommendation, choose another option, add bounded context or evidence, or decide later.
_Avoid_: Agent chat, blocking modal, hidden approval, translucent agent card

**Factory Mode**:
The default desktop presentation of a Campaign Batch, showing the full spatial Agent Work Overlay, Work Backscroll, hand-off connectors, agent spawning, artefact movement, and live campaign changes. It changes presentation only; the underlying agents and orchestration are identical in every view.
_Avoid_: Optional build mode, additional agent execution, simulated demo layer

**Compact Build View**:
The automatic mobile presentation of the same Campaign Factory Run, using progressive Campaign Brief sections, compact active-agent counts, current work, Judgement Requests, Step Reports, and Build Receipts without overlapping cards or connector animation.
_Avoid_: Static loading page, reduced agent runtime, separate mobile campaign

**OpenClaw Build Reveal**:
A separately built and operated conference demonstration in which an external coding agent works on a Campaign Operations dashboard. It may follow the Campaign Factory demonstration narratively, but it is not part of Campaign Factory's LangGraph runtime, Agent Roster, or Campaign Factory Run.
_Avoid_: Campaign Factory agent, self-upgrading campaign runtime, dependency of the campaign build

**Agentic Identity**:
The stable visual identity of a Runtime Agent role across campaigns, expressed through a distinctive icon, colour, title, and capability label. Individual invocations remain tied to a campaign but do not receive invented human names, faces, or biographies.
_Avoid_: Human persona, generated portrait, anonymous identical robot icon

**Work Backscroll**:
The dense, append-only stream inside an active Agent Work Card that shows real assignments, task decomposition, tool activity, public sources opened, evidence extracted, conflicts raised, agents requested or spawned, artefacts transferred, reviews, and proposed output changes. It may resemble active CLI backscroll visually, but its language is campaigner-readable and contains no private model reasoning.
_Avoid_: Chain of thought, fabricated busywork, raw framework log, sparse status ticker

**Step Report**:
The substantive summary produced when all Runtime Agents contributing to a Step Workspace have completed or reached a terminal partial state. It records what the team concluded, evidence used, disagreements resolved, human answers or Provisional Defaults, changes made to the Campaign Brief, and remaining gaps. It appears inside the collapsed Step Build Receipt.
_Avoid_: Agent transcript, completion counter only, generic generated summary

**Campaign Synthesis Reviewer**:
The recurring Runtime Agent assigned to one campaign for the duration of its Campaign Factory Run. It retains campaign context across all ten journey steps, independently reviews contributing agent work, writes each Step Report, detects contradictions between sections, and performs the final whole-campaign consistency review.
_Avoid_: New reviewer for every step, campaign author, deterministic metadata compiler

**Evidence and Next Checks**:
The final Campaign Brief section combining an actionable queue of unresolved evidence, local-knowledge needs, reviewer findings, and Provisional Defaults with the complete dated source ledger. Each check states why it matters, affected sections, who can resolve it, and whether an agent can be sent to verify it.
_Avoid_: Passive Sources list, hidden bibliography, undifferentiated reviewer report

**Context Patch**:
New campaigner-provided context attached to one or more Next Checks, with its provenance and verification status. A Context Patch may contain local knowledge or a public source but is never silently treated as verified fact.
_Avoid_: Prompt edit, verified evidence by assertion, silent campaign overwrite

**Targeted Rebuild**:
A new version of the Campaign Brief created by applying a Context Patch or Re-decision, rerunning only the affected agent branches, and passing their changes through the recurring Campaign Synthesis Reviewer. The earlier brief and Work Trace remain available.
_Avoid_: Blind full regeneration, in-place edit, complete factory rerun

**Campaign Change Proposal**:
A structured, evidence-linked patch submitted by a Runtime Agent against a named version of shared campaign state. It identifies affected Campaign Brief sections and documents but does not change them until the Campaign Synthesis Reviewer accepts it and deterministic application logic applies it.
_Avoid_: Direct agent mutation, unreviewed generated text, last-write-wins update

**Accepted Campaign State**:
The current versioned campaign data produced only by deterministic application of reviewer-accepted Campaign Change Proposals and recorded human decisions. The Campaign Brief Page and Canonical Campaign Documents render from this state.
_Avoid_: Agent scratchpad, prompt context, merged raw outputs

**Proposal Conflict**:
Two or more incompatible Campaign Change Proposals affecting the same campaign decision or state. Evidence conflicts are adjudicated, strategic alternatives remain visible, and any resolution records its rationale; materially consequential unresolved choices become Judgement Requests.
_Avoid_: Last-write-wins, silent reviewer preference, erased dissent

**Terminal Gap**:
A campaign task or evidence need that remains unresolved after its Runtime Agent fails, one visible retry fails, and no justified registered replacement succeeds. The gap is preserved in the Step Report and Evidence and Next Checks rather than filled with synthetic content.
_Avoid_: Generic fallback copy, hidden failure, invented completion
