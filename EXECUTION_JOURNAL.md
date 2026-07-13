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
