# Execution Journal — Campaign Factory production build

A chronological log of what was executed, decided, and verified while turning the
`app/` prototype into a production application. Product plan: [`PLAN.md`](PLAN.md).
App + technical requirements: [`web/README.md`](web/README.md).

> Note: created manually — the referenced "execution journal" skill wasn't available
> in the session. Format can be adjusted to match a specific skill later.

---

## Session — 13 Jul 2026

**Goal:** rewrite the localhost single-presenter prototype into a public, self-serve
Next.js app on Vercel for a ~45-person conference launch.

### Decisions locked (grilling)
Public self-serve · design for simultaneous load · durable background-job runs ·
conference access code + 3-runs/session cap + £150/day spend kill-switch · full
Next.js/TS rewrite (UX journey is the spec, not the pixels; awake-style scroll-reveal) ·
server-side persistence + shareable URLs + opt-in wall (opt-in + admin hide) ·
**no synthetic data, ever** · desktop-first (entry/progress phone-usable) · 4-week
sunset tail · BYOK later. Model routing (designed by Fable, adopted): Stage A research
= Sonnet 5 (web search, 7-label enum); Stage B plan = Opus 4.8 (never downgraded);
Stage C drafts = Sonnet 5 ×3 parallel groups; lint = Haiku 4.5. No Fable 5 in-pipeline.

### Milestones executed

| # | What | Verified | Commit |
|---|---|---|---|
| M1 | Scaffold (Next 16/React 19/Tailwind v4) + routed pipeline ported to `web/src/lib/pipeline/`; per-run API-key seam; no-synthetic failure model; `POST /api/runs`, `GET /api/runs/[id]` | Live run: 13 real sources w/ labels, researched decision-maker, 3 draft groups, 13 `[VERIFY:]`, Haiku lint ok | `d9deeaa` |
| M2 | Launch controls: access code, session cap, £150 spend kill-switch, readonly; spend ledger + usage cost threaded through all stages; `/api/status` | All 4 gate branches + status verified (free, no key) | `d9deeaa` |
| M3 | Journey UI: EntryForm, RunProgress (ticker + live feed), scroll-reveal Journey (labels, `[VERIFY:]`, 9 docs w/ copy+download, sources filter), CampaignApp phases + gate + capacity | SSR entry surface; full journey rendered from real data via `/dev/preview` | `e292350` |
| — | Interim `/c/[id]` shareable page + dev preview harness + real fixture | — | `5d03aa5` |
| M4 | Postgres persistence (portable driver): runs/spend/sessions/wall; write-through store; `/c/[id]` durable DB read; removed in-memory shims | Verified vs local Docker Postgres and (later) Neon | `37dea4d` |
| M5 | Conference wall + admin: `owner_sid`, share/unshare, owner delete, admin hide, `/wall`, `/wall/projector`, `/admin`, OwnerBar | Full flow vs Postgres: ownership 403s, share, wall page, admin hide (wrong/right key), delete→404 | `b02afc8` |
| — | Wire wall into UX (landing + capacity links) | build | `f03c795` |
| M4b | Serverless execution via `after()` + `maxDuration`; README (Vercel setup + go-live reqs); Neon connectivity check | `after()` refactor builds; Neon PostgreSQL 17 verified | `559050d`, `84a36ca` |

### Infrastructure
- **GitHub:** pushed to `sugaroverflow/campaign-factory` (public), `main`.
- **Vercel:** project `sugaroverflow/campaign-factory` linked; **git-connected** for
  auto-deploys; Root Directory set to `web`. Env vars set (production):
  `ANTHROPIC_API_KEY`, `CF_ACCESS_CODE=CAMPAIGN-LAB`, `CF_ADMIN_KEY`, plus Neon vars.
- **Database:** Neon (`neon-claret-kettle`) provisioned via Marketplace; pooled
  `DATABASE_URL` across all environments; DB layer verified against Neon.
- **First deploy:** `campaign-factory-*.vercel.app` (behind deployment protection).

### Constraints found (see `web/README.md` → go-live requirements)
1. **Hobby plan caps functions at 300s** — full runs are 6–15 min, so they can't
   complete in one function on Hobby. Needs Vercel Workflow (durable steps) and/or a
   higher plan. (Vercel account to be switched later.)
2. **Vercel Deployment Protection is ON** — app not publicly reachable until disabled;
   the app's own `CF_ACCESS_CODE` gate is the intended access control.
3. Timing: the Opus plan stage is the long pole and variable (~3–10 min).

### Spend
≈ $0.66 (two live pipeline runs for verification; the deployment has not run a live campaign).

### Outstanding
- Go-live hardening: durable execution (Vercel Workflow) + disable deployment
  protection + confirm real access code + plan/`maxDuration`.
- M6: Stage-A label-quality test (Sonnet vs Opus), ~45-run load rehearsal, per-run cost
  measurement, seed rehearsal campaigns.

---

## 2026-07-15T15:52:04Z - OpenClaw Campaign Operations Build Reveal

### Goal

Provision a persistent external OpenClaw coding agent that opens an issue and draft PR, builds a visually native Campaign Operations workspace, and increases its heartbeat cadence for the conference demo.

### Changes

- Added the isolated OpenClaw agent `campaign-ops` (identity: Pip 🍬 of the Bon Bon Bureau of Agents, model: `openai/gpt-5.5`) on `openclawserver`, with its own workspace and clone of `CampaignLab/campaign-factory`.
- Installed a durable task contract covering issue-first planning, branch isolation, demo-safe email operations, visual/accessibility standards, verification, and progress continuity.
- Configured the agent heartbeat at `1h` with light isolated context, a 45-minute turn ceiling, no delivery channel, and `skipWhenBusy` overlap protection.
- Added and enabled a user-level systemd timer for `2026-07-16 13:00:00 UTC` (`14:00 Europe/London`) that verifies the agent ID before changing only its heartbeat to `5m`.
- Repaired the stale OpenClaw gateway service definition from 2026.6.8 to the installed 2026.6.10 service and started it.
- Required every heartbeat to update `PROGRESS.md`, commit and push a truthful checkpoint, then post a bullet-form PR comment identifying Pip and the Bureau, separating current updates from next work, and signing as Pip.
- Rewrote the three existing agent-authored PR comments into the same signed bullet format so the visible history is consistent.
- The agent opened [issue #11](https://github.com/CampaignLab/campaign-factory/issues/11) and [draft PR #12](https://github.com/CampaignLab/campaign-factory/pull/12), then pushed the initial `/operations` implementation and follow-up verification/polish checkpoints through `de3611a`.

### Decisions

- Kept Pip explicitly outside the Campaign Factory LangGraph runtime and Agent Roster. Pip is a build-time coding agent for the separately described OpenClaw Build Reveal.
- Based the feature branch on `factory/multi-agent-build`; the agent may push and update its issue/PR but may not mark ready, merge, deploy, or change production data.
- Limited the working operations slice to labelled browser-local fixture state. Audience selection, drafting, preview, human approval, local demo queueing, reset, and activity are functional; provider connection, delivery, import, analytics, and production scheduling remain explicitly unavailable or coming soon.
- Required a progress-file change with fresh verification or blocker evidence when a heartbeat has no responsible code change, avoiding meaningless empty commits while preserving the requested one-commit-per-heartbeat trail.

### Tradeoffs

- No live email provider, database migration, background job, contact import, or production deployment was added for the demo.
- Native OpenClaw heartbeats are periodic rather than wall-clock exact. The exact cadence transition is therefore handled by systemd, while individual turns may still drift or be skipped when the previous turn is busy.
- The first slice favors a cohesive demonstrable workflow over complete campaign-operations breadth.

### Risks

- A five-minute `gpt-5.5` cadence can consume meaningful model budget. `skipWhenBusy` prevents overlapping runs, but usage should be observed during the demo window and the cadence should be reduced or disabled afterward.
- The cadence-switch timer is installed and validated but cannot be end-to-end proven until its future trigger occurs.
- Heartbeats depend on the gateway service, provider availability, GitHub authentication, and the remote host remaining healthy.
- PR #12 includes shared navigation and existing lint-blocker fixes in addition to the operations route; these changes need normal review before any merge.
- Existing unrelated local changes (`.gitignore` and `web/test-results/`) were preserved and were not included in this setup.

### Verification

- Confirmed the gateway is reachable and admin-capable on loopback with OpenClaw 2026.6.10.
- Confirmed `campaign-ops` reports a `1h` heartbeat and the systemd timer is active for `2026-07-16 13:00:00 UTC`.
- Confirmed remote branch `openclaw/issue-11-campaign-operations` is clean and pushed at `de3611a`; PR #12 remains open and draft against `factory/multi-agent-build`.
- Confirmed the required PR progress-comment format is in use after pushed checkpoints.
- Agent verification reports `npm run lint` passing, a `DATABASE_URL`-backed production build passing, and Playwright checks of the full local operations flow at desktop and 390px widths. A navigation overlap found in the first screenshots was fixed and rechecked.
- Future hourly heartbeats and the scheduled five-minute transition have not yet elapsed, so their runtime history remains to be observed.

### Demo Impact

The Build Reveal now has both visible GitHub work history and a functioning Campaign Operations surface: a campaign brief becomes audience selection, an editable email, explicit human review, and a truthful local-only queue. During the conference window, five-minute checkpoints will make ongoing coding progress visible without overlapping active turns.

### Customer-Facing Context

This setup demonstrates bounded build-time autonomy, not an autonomous campaigning system. The coding agent can change and review a feature branch, while real outreach, production data, approval, merge, and deployment remain outside its authority. The product UI similarly distinguishes local demo state from genuine provider delivery.

### Next Recommended Step

Observe the next scheduled hourly heartbeat for its commit/push/PR-comment sequence, confirm the 14:00 London cadence transition, and review PR #12 plus its Vercel preview before any merge decision. After the conference, return the heartbeat to a low cadence or disable it explicitly.

---

## 2026-07-15T22:05:51Z - Campaign Operations workbench Phase 2

### Goal

Expand Pip's working but simple Campaign Operations page into a complete campaign workbench, and authorize Pip to implement the full scoped expansion without waiting for interim human approval.

### Changes

- Added a Phase 2 task contract covering a route-specific operations header/footer, grouped sidebar, twelve campaign-work destinations, responsive navigation, local state migration, and cross-view workflow verification.
- Granted Pip standing authority to design, implement, refactor, test, document, commit, push, and update issue #11 / draft PR #12 until every Phase 2 criterion was met.
- Built a dedicated Operations shell that replaces global site chrome only on `/operations`; other routes retain the Campaign Factory navigation/footer.
- Added Overview, Campaign brief, Objective & targets, Power map, Strategy & tactics, Evidence & checks, Audiences, Contacts, Drafts, Reviews & approvals, Outbox & schedule, and Responses & results views.
- Added a three-item fixture draft library, substantive Contacts filtering/readiness/consent states, a dedicated review/approval flow, local schedule intent, an honest local-only outbox, and explicit coming-soon provider/import/response boundaries.
- Migrated browser-local state through `cf_operations_demo_v3` with safe fallback from the earlier v1/v2 demo state.
- Expanded Operations Playwright coverage to four tests spanning all twelve destinations and the complete audience → draft → review → explicit human approval → schedule intent → local queue → reload → reset path.
- Rebased onto the moving `factory/multi-agent-build` base, resolved its navigation conflict, reverified the rebased tree, and reconciled the owned feature branch with `--force-with-lease`.

### Decisions

- “Without human approval” applies to scoped implementation work, not external campaign actions. Pip still may not merge, mark the PR ready, deploy, change production data/secrets, connect real providers, import real contacts, or perform outreach.
- Human approval remains a required product-state transition before a communication can enter the local demo outbox.
- Campaign-planning views are operationally useful fixture-backed states; no interface implies that new research, real contact work, delivery, responses, or analytics occurred.
- The workbench uses restrained product density, grouped navigation, rows/split panes, and campaign-first hierarchy rather than generic metric tiles or a decorative monitoring dashboard.

### Tradeoffs

- The expanded demo is browser-local and production-shaped but not production-integrated.
- Supporter email is the fully editable draft; the decision-maker letter and press pitch are honest staged fixtures with outlines/checks rather than falsely complete delivery workflows.
- Phase 2 favors a complete navigable conference workbench in the existing component architecture over introducing a new backend or a larger route/data-model rewrite.

### Risks

- The feature branch was rebased while its base branch was changing quickly. The guarded recovery was verified, but future base changes may require another conflict-aware rebase.
- High-frequency heartbeats after the conference cadence switch can still consume substantial model budget even when only review work remains.
- No live provider, contact import, response collection, production schedule, or database persistence exists; these states must remain visibly disabled.
- The breadth of the single Operations surface may merit later component extraction after the demo.

### Verification

- Final local HEAD, `origin/openclaw/issue-11-campaign-operations`, and PR #12 head all match at `9699112ef44601dcaaab657e7c44a538c982303b`.
- The remote worktree is clean with no rebase/sequencer state; PR #12 remains open, draft, and targeted at `factory/multi-agent-build`.
- `git diff --check`, `npm run lint`, the `DATABASE_URL`-backed production build, and `npm run test:factory -- operations.spec.ts` all pass; Operations tests pass 4/4.
- Browser checks pass at 1440×1000, 1024×768, and 390×844 with no horizontal overflow, accessible active navigation/focus, no double chrome, and a non-operations regression check.
- Safety-copy checks find no claims that communications were sent, delivered, opened, or answered.
- Pip's hourly heartbeat, signed PR updates, gateway service, and the timer switching to five minutes at 14:00 Europe/London remain active.

### Demo Impact

The Build Reveal now demonstrates a complete brief-to-operations story: campaign context becomes targets, evidence checks, audiences, contacts, multiple communications, human review, schedule intent, and a truthful local outbox inside a dedicated workbench.

### Customer-Facing Context

The workbench demonstrates bounded autonomy and explicit side-effect control. Pip autonomously built and verified the feature branch, while the product and build process both keep real political outreach, production integration, merge, and deployment outside the agent's authority.

### Next Recommended Step

Review the Vercel preview and draft PR #12 for demo narrative and visual preference; keep provider/import/response controls disabled, and disable or reduce Pip's heartbeat after the conference window.
