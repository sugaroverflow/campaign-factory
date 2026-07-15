"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "cf_operations_demo_v2";
const LEGACY_STORAGE_KEY = "cf_operations_demo_v1";

type SegmentId = "school_gates" | "ward_parents" | "local_allies";
type DraftStatus = "draft" | "review" | "approved" | "queued";
type Mode = "compose" | "preview";
type ViewId =
  | "overview"
  | "brief"
  | "objectives"
  | "power"
  | "strategy"
  | "evidence"
  | "audiences"
  | "contacts"
  | "drafts"
  | "reviews"
  | "outbox"
  | "responses";

type Activity = {
  id: string;
  label: string;
};

type DemoState = {
  selectedSegment: SegmentId;
  subject: string;
  body: string;
  status: DraftStatus;
  mode: Mode;
  activeView: ViewId;
  queuedAt: string | null;
  activity: Activity[];
};

type Segment = {
  id: SegmentId;
  name: string;
  role: string;
  contacts: number;
  ready: number;
  readiness: string;
  ask: string;
  caveat: string;
};

type NavItem = { id: ViewId; label: string; badge?: string; note: string };

const segments: Segment[] = [
  {
    id: "school_gates",
    name: "School-gate families",
    role: "Primary audience",
    contacts: 48,
    ready: 31,
    readiness: "31 fixture contacts have enough detail for a reviewed local email.",
    ask: "Ask families to back a permanent, enforced school street before the experimental order lapses.",
    caveat: "Contact details are demo fixtures; real import and consent checks are coming soon.",
  },
  {
    id: "ward_parents",
    name: "Nearby ward parents",
    role: "Pressure-building audience",
    contacts: 73,
    ready: 44,
    readiness: "44 fixture contacts include postcode-level relevance and school-run concern tags.",
    ask: "Invite parents nearby to show this is a neighbourhood safety issue, not only a school request.",
    caveat: "The workspace can draft for this segment, but live segmentation is not connected.",
  },
  {
    id: "local_allies",
    name: "Local allies and councillor watchers",
    role: "Review and escalation audience",
    contacts: 16,
    ready: 9,
    readiness: "9 fixture contacts are marked ready for careful, human-reviewed outreach.",
    ask: "Share the campaign ask with allies who can spot council process risks and amplify the decision route.",
    caveat: "No external contacts are messaged from this demo workspace.",
  },
];

const contacts = [
  { name: "A. Patel", segment: "School-gate families", readiness: "Ready fixture", check: "Consent source needs real import", owner: "Campaigner" },
  { name: "M. Davies", segment: "Nearby ward parents", readiness: "Ready fixture", check: "Postcode relevance is fixture-only", owner: "Campaigner" },
  { name: "Clean Air Leicester", segment: "Local allies", readiness: "Review first", check: "Confirm named contact before real use", owner: "Local organiser" },
  { name: "Ward casework watcher", segment: "Local allies", readiness: "Not ready", check: "Import and consent path coming soon", owner: "Campaigner" },
];

const draftLibrary = [
  { title: "Supporter email", state: "Editable", detail: "Working local draft for the selected audience." },
  { title: "Decision-maker letter", state: "Staged fixture", detail: "Outline only until the formal decision-route claims are checked." },
  { title: "Press pitch", state: "Staged fixture", detail: "Useful prompt for later media work; no newsroom contact is connected." },
];

const viewIds: ViewId[] = [
  "overview",
  "brief",
  "objectives",
  "power",
  "strategy",
  "evidence",
  "audiences",
  "contacts",
  "drafts",
  "reviews",
  "outbox",
  "responses",
];

const initialState: DemoState = {
  selectedSegment: "school_gates",
  subject: "Make the St John the Baptist school street permanent",
  body:
    "Hello,\n\nWe are asking Leicester City Council to make the school street outside St John the Baptist CofE Primary permanent, with clear enforcement before the experimental order lapses.\n\nThe campaign is focused on safer school-run streets, cleaner air at the gates, and a decision route parents can follow. If you support the permanent order, please add your name to the campaign update and share one local reason this matters to your family.\n\nBefore any provider connection is used, a campaigner should check the council timing, the wording of the order, and whether this message fits your contact consent records.\n\nThank you,\nCampaign Factory demo workspace",
  status: "draft",
  mode: "compose",
  activeView: "overview",
  queuedAt: null,
  activity: [{ id: "seed", label: "Demo workspace loaded with seeded campaign brief and local fixture contacts." }],
};

const statusCopy: Record<DraftStatus, { label: string; text: string }> = {
  draft: {
    label: "Draft",
    text: "Editable local draft. It has not been reviewed or queued.",
  },
  review: {
    label: "Needs human review",
    text: "A campaigner has marked this draft ready for checking. External action is still blocked.",
  },
  approved: {
    label: "Approved by human",
    text: "Approved for the demo queue only. Provider connection is not active.",
  },
  queued: {
    label: "Queued for demo",
    text: "Stored in this browser as a local demo queue item. Provider connection is off.",
  },
};

function normaliseState(parsed: Partial<DemoState>): DemoState {
  return {
    ...initialState,
    ...parsed,
    selectedSegment: segments.some((segment) => segment.id === parsed.selectedSegment)
      ? (parsed.selectedSegment as SegmentId)
      : initialState.selectedSegment,
    status: ["draft", "review", "approved", "queued"].includes(parsed.status || "")
      ? (parsed.status as DraftStatus)
      : initialState.status,
    activeView: viewIds.includes(parsed.activeView as ViewId) ? (parsed.activeView as ViewId) : "overview",
    activity: parsed.activity?.length ? parsed.activity : initialState.activity,
    mode: parsed.mode === "preview" ? "preview" : "compose",
  };
}

function loadState(): DemoState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed.subject || !parsed.body || !parsed.selectedSegment) return initialState;
    return normaliseState(parsed);
  } catch {
    return initialState;
  }
}

function record(label: string): Activity {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label };
}

function formatQueuedTime(value: string | null) {
  if (!value) return "Not queued";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[var(--r-2xl)] border border-border bg-background p-5 ${className}`}>{children}</section>;
}

function SmallLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</p>;
}

export function OperationsWorkspace() {
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setState(loadState());
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [hydrated, state]);

  const selected = useMemo(
    () => segments.find((segment) => segment.id === state.selectedSegment) ?? segments[0],
    [state.selectedSegment],
  );

  const status = statusCopy[state.status];
  const canRequestReview = state.subject.trim().length > 8 && state.body.trim().length > 80;
  const reviewBlocked = !canRequestReview;
  const queuedCount = state.status === "queued" ? "1" : undefined;
  const reviewBadge = state.status === "review" ? "1" : undefined;

  const navGroups: { title: string; items: NavItem[] }[] = [
    {
      title: "Campaign",
      items: [
        { id: "overview", label: "Overview", note: "Today’s work and next decision" },
        { id: "brief", label: "Campaign brief", note: "Outcome, place, provenance" },
        { id: "objectives", label: "Objective & targets", note: "Decision-maker and influences" },
        { id: "power", label: "Power map", note: "Allies, blockers, persuadables" },
        { id: "strategy", label: "Strategy & tactics", note: "Pressure sequence and owners" },
        { id: "evidence", label: "Evidence & checks", note: "Claims needing verification" },
      ],
    },
    {
      title: "People",
      items: [
        { id: "audiences", label: "Audiences", note: "Segments and readiness" },
        { id: "contacts", label: "Contacts", note: "Fixture contact list" },
      ],
    },
    {
      title: "Communications",
      items: [
        { id: "drafts", label: "Drafts", note: "Library, editor, preview" },
        { id: "reviews", label: "Reviews & approvals", note: "Human approval gate", badge: reviewBadge },
        { id: "outbox", label: "Outbox & schedule", note: "Local queue boundary", badge: queuedCount },
        { id: "responses", label: "Responses & results", note: "Coming soon boundary" },
      ],
    },
  ];

  const setView = (activeView: ViewId) => {
    setState((current) => ({ ...current, activeView }));
  };

  const updateDraft = (patch: Partial<Pick<DemoState, "subject" | "body">>) => {
    setState((current) => ({
      ...current,
      ...patch,
      status: current.status === "approved" || current.status === "queued" ? "draft" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
      activity:
        current.status === "approved" || current.status === "queued"
          ? [record("Edited communication copy; approval and local queue state were cleared for re-review."), ...current.activity].slice(0, 7)
          : current.activity,
    }));
  };

  const selectSegment = (segment: Segment) => {
    setState((current) => ({
      ...current,
      selectedSegment: segment.id,
      status: current.status === "approved" || current.status === "queued" ? "draft" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
      activity: [record(`Selected audience segment: ${segment.name}.`), ...current.activity].slice(0, 7),
    }));
  };

  const requestReview = () => {
    setState((current) => ({
      ...current,
      status: "review",
      activeView: "reviews",
      activity: [record("Marked the draft ready for human review."), ...current.activity].slice(0, 7),
    }));
  };

  const approve = () => {
    setState((current) => ({
      ...current,
      status: "approved",
      activity: [record("Human approval recorded for this local demo draft."), ...current.activity].slice(0, 7),
    }));
  };

  const queue = () => {
    setState((current) => ({
      ...current,
      status: "queued",
      activeView: "outbox",
      queuedAt: new Date().toISOString(),
      activity: [record("Placed approved draft into the local demo queue. No provider connection used."), ...current.activity].slice(0, 7),
    }));
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setState({
      ...initialState,
      activity: [record("Demo state reset to the seeded campaign workspace."), ...initialState.activity],
    });
  };

  const renderNav = (compact = false) => (
    <nav aria-label="Campaign operations views" className="space-y-6">
      {navGroups.map((group) => (
        <div key={group.title}>
          <div className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {group.title}
          </div>
          <div className={compact ? "grid gap-2 sm:grid-cols-2" : "space-y-1"}>
            {group.items.map((item) => {
              const active = state.activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`w-full rounded-[var(--r-xl)] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    active ? "border-foreground bg-foreground text-background" : "border-transparent text-foreground hover:border-border hover:bg-secondary"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {item.label}
                    {item.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-background text-foreground" : "bg-tint-yellow text-foreground"}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className={`mt-0.5 block text-xs ${active ? "text-background/75" : "text-muted-foreground"}`}>{item.note}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const goButton = (view: ViewId, label: string) => (
    <Button type="button" variant="outline" onClick={() => setView(view)}>
      {label}
    </Button>
  );

  const renderAudienceView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
      <Panel>
        <SmallLabel>Audiences</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Choose the contact set</h2>
        <p className="mt-3 text-muted-foreground">
          The selected segment follows the draft, review, and queue views. Counts are fixture contacts for this browser demo.
        </p>
        <p className="mt-4 rounded-[var(--r-xl)] bg-tint-yellow px-4 py-3 text-sm">
          Real import and consent matching are <span className="font-semibold">Coming soon</span>; this view does not contact people.
        </p>
      </Panel>
      <div className="space-y-3" role="list" aria-label="Audience segments">
        {segments.map((segment) => {
          const active = segment.id === selected.id;
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => selectSegment(segment)}
              className={`w-full rounded-[var(--r-2xl)] border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                active ? "border-foreground bg-tint-blue" : "border-border bg-background hover:bg-secondary"
              }`}
              aria-pressed={active}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-medium">{segment.name}</span>
                  <span className="block text-sm text-muted-foreground">{segment.role}</span>
                </span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs">
                  {segment.contacts} fixture contacts
                </span>
              </span>
              <span className="mt-3 block text-sm text-muted-foreground">{segment.readiness}</span>
              <span className="mt-2 block text-sm">{segment.ask}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderDraftsView = () => (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <Panel>
        <SmallLabel>Draft library</SmallLabel>
        <h2 className="mt-2 text-2xl font-medium tracking-tight">Communications</h2>
        <div className="mt-5 space-y-3">
          {draftLibrary.map((draft) => (
            <div key={draft.title} className="rounded-[var(--r-xl)] border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{draft.title}</p>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{draft.state}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{draft.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel className="shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SmallLabel>Supporter email</SmallLabel>
            <h2 className="mt-1 text-3xl font-medium tracking-tight">Parent update for {selected.name.toLowerCase()}</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">{selected.ask}</p>
          </div>
          <div className="flex rounded-full bg-secondary p-1" aria-label="Draft mode">
            {(["compose", "preview"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setState((current) => ({ ...current, mode }))}
                className={`rounded-full px-4 py-1.5 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  state.mode === mode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={state.mode === mode}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-secondary/70 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Review warning:</span> Check the council timing, the exact legal order wording, and contact consent before any real outreach. {selected.caveat}
        </div>

        {state.mode === "compose" ? (
          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="operations-subject">Subject</Label>
              <Input
                id="operations-subject"
                value={state.subject}
                onChange={(event) => updateDraft({ subject: event.target.value })}
                className="h-auto rounded-full border-[1.5px] px-4 py-2.5 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operations-body">Message</Label>
              <Textarea
                id="operations-body"
                value={state.body}
                onChange={(event) => updateDraft({ body: event.target.value })}
                rows={13}
                className="min-h-[22rem] rounded-[var(--r-2xl)] border-[1.5px] p-4 text-base leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <article className="mt-6 rounded-[var(--r-2xl)] border border-border bg-white p-5">
            <div className="border-b border-border pb-4 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">To:</span> {selected.name} · {selected.ready} ready fixture contacts</p>
              <p><span className="font-medium text-foreground">Status:</span> {status.label}</p>
            </div>
            <h3 className="mt-5 text-2xl font-medium">{state.subject || "Untitled campaign email"}</h3>
            <div className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{state.body}</div>
          </article>
        )}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!canRequestReview || state.status === "review" || state.status === "approved" || state.status === "queued"}>
            Mark ready for review
          </Button>
          {goButton("reviews", "Open review gate")}
        </div>
      </Panel>
    </div>
  );

  const renderReviewView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Reviews & approvals</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Human approval gate</h2>
        <p className="mt-3 text-muted-foreground">
          A draft cannot enter the local queue until a person explicitly approves it. Blockers are shown in text, not just colour.
        </p>
        <div className="mt-6 space-y-3">
          {[
            { label: "Message has enough substance to review", ok: canRequestReview, detail: canRequestReview ? "Subject and body are long enough for a meaningful check." : "Add a clear subject and message before requesting review." },
            { label: "Audience readiness understood", ok: selected.ready > 0, detail: `${selected.ready}/${selected.contacts} selected fixture contacts are marked ready.` },
            { label: "Evidence checks still visible", ok: true, detail: "Council timing, legal-order wording, and consent remain called out before any real provider use." },
            { label: "External action blocked", ok: true, detail: "Provider connection is not active; approval only unlocks the local demo queue." },
          ].map((item) => (
            <div key={item.label} className="rounded-[var(--r-xl)] border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.label}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs ${item.ok ? "bg-tint-blue" : "bg-tint-yellow"}`}>
                  {item.ok ? "Clear" : "Blocked"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!canRequestReview || state.status === "review" || state.status === "approved" || state.status === "queued"}>
            Mark ready for review
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={approve} disabled={state.status !== "review"}>
            Approve as human reviewer
          </Button>
          <Button type="button" size="lg" variant="secondary" onClick={queue} disabled={state.status !== "approved"}>
            Queue locally for demo
          </Button>
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Current review item</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">{status.label}</h3>
        <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>
        {reviewBlocked ? (
          <p className="mt-4 rounded-[var(--r-xl)] bg-tint-yellow px-4 py-3 text-sm">
            Blocked: the supporter email needs enough copy before it can be checked.
          </p>
        ) : null}
        <div className="mt-5 rounded-[var(--r-xl)] border border-border p-3 text-sm">
          <p className="font-medium">{state.subject || "Untitled campaign email"}</p>
          <p className="mt-1 text-muted-foreground">Audience: {selected.name}</p>
        </div>
      </Panel>
    </div>
  );

  const renderOutboxView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Outbox & schedule</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{state.status === "queued" ? "One local queue item" : "Nothing queued yet"}</h2>
        <p id="operations-provider-note" className="mt-3 text-muted-foreground">
          {state.status === "queued"
            ? "The approved draft is stored in this browser for the conference demo. It is not connected to an email provider."
            : "Approve the draft before it can enter the local demo queue. Provider outreach stays disabled."}
        </p>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Communication</span><span>Audience</span><span>State</span><span>Local timing</span>
          </div>
          {state.status === "queued" ? (
            <div className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr]">
              <div><span className="md:hidden font-medium">Communication: </span>{state.subject}</div>
              <div><span className="md:hidden font-medium">Audience: </span>{selected.name}</div>
              <div><span className="md:hidden font-medium">State: </span>Queued for demo</div>
              <div><span className="md:hidden font-medium">Local timing: </span>{formatQueuedTime(state.queuedAt)}</div>
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No local queue rows yet. Use the Reviews & approvals view to record human approval first.
            </div>
          )}
        </div>
        <button
          type="button"
          disabled
          aria-describedby="operations-provider-note"
          className="mt-5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground opacity-70"
          title="Provider connection is coming soon; this demo does not use email outreach."
        >
          Email provider · Coming soon
        </button>
      </Panel>
      <Panel>
        <SmallLabel>Scheduling boundary</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Local intent only</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Production scheduling is not connected. This workbench can show what a campaigner intends to prepare, but it cannot place work onto a live provider calendar.
        </p>
        <Button type="button" variant="ghost" className="mt-5" onClick={reset}>
          Reset demo state
        </Button>
      </Panel>
    </div>
  );

  const renderOverview = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Panel className="bg-tint-yellow/70">
          <SmallLabel>Today</SmallLabel>
          <h1 className="mt-2 max-w-3xl text-4xl font-medium tracking-tight sm:text-5xl">
            Make the St John the Baptist school street <span className="font-serif font-normal italic">permanent</span> before the order lapses.
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            The workbench keeps the campaign brief, audience choice, draft copy, review gate, and local queue in one place. Fixture data is labelled; real provider and import steps remain off.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              { label: "1. Confirm audience", detail: selected.name, view: "audiences" as ViewId },
              { label: "2. Prepare supporter email", detail: status.label, view: "drafts" as ViewId },
              { label: "3. Complete human review", detail: state.status === "review" ? "Waiting for approval" : "Approval gate visible", view: "reviews" as ViewId },
              { label: "4. Inspect local queue", detail: state.status === "queued" ? "One queued demo item" : "Nothing queued yet", view: "outbox" as ViewId },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setView(item.view)}
                className="rounded-[var(--r-xl)] border border-border bg-background/75 p-4 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{item.detail}</span>
              </button>
            ))}
          </div>
        </Panel>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <SmallLabel>Next human decision</SmallLabel>
            <h2 className="mt-2 text-2xl font-medium">Approve only after the claim checks are understood.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Council timing, legal-order wording, and contact consent are the key checks before any real provider connection is considered.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">{goButton("reviews", "Open reviews")}{goButton("evidence", "See evidence checks")}</div>
          </Panel>
          <Panel>
            <SmallLabel>Current communications</SmallLabel>
            <h2 className="mt-2 text-2xl font-medium">{status.label}</h2>
            <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>
            <div className="mt-5 flex flex-wrap gap-3">{goButton("drafts", "Edit draft")}{goButton("outbox", "Open outbox")}</div>
          </Panel>
        </div>
      </div>
      <Panel>
        <SmallLabel>Activity from this browser</SmallLabel>
        <ul className="mt-4 space-y-3 text-sm">
          {state.activity.map((item) => (
            <li key={item.id} className="border-l-2 border-foreground/20 pl-3 text-muted-foreground">
              {item.label}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );

  const renderLightCampaignView = (title: string, intro: string, rows: { label: string; detail: string }[]) => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Campaign context</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{title}</h2>
        <p className="mt-3 text-muted-foreground">{intro}</p>
        <div className="mt-6 divide-y divide-border rounded-[var(--r-2xl)] border border-border">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-2 p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <p className="font-medium">{row.label}</p>
              <p className="text-muted-foreground">{row.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Operational link</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Feeds the email workflow</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          This context is fixture-backed and deliberately visible so campaigners know what still needs checking before using real tools.
        </p>
        <div className="mt-5 flex flex-col gap-3">{goButton("drafts", "Open Drafts")}{goButton("reviews", "Open Reviews")}</div>
      </Panel>
    </div>
  );

  const renderContacts = () => (
    <Panel>
      <SmallLabel>Contacts</SmallLabel>
      <h2 className="mt-2 text-3xl font-medium tracking-tight">Fixture-backed contact readiness</h2>
      <p className="mt-3 text-muted-foreground">
        This table is a designed local state for review. Real import, consent reconciliation, deduplication, and provider sync are Coming soon.
      </p>
      <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
        <div className="hidden grid-cols-[0.8fr_1fr_0.7fr_1fr_0.7fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
          <span>Name</span><span>Segment</span><span>Readiness</span><span>Check</span><span>Owner</span>
        </div>
        {contacts.map((contact) => (
          <div key={contact.name} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.8fr_1fr_0.7fr_1fr_0.7fr]">
            <div><span className="md:hidden font-medium">Name: </span>{contact.name}</div>
            <div><span className="md:hidden font-medium">Segment: </span>{contact.segment}</div>
            <div><span className="md:hidden font-medium">Readiness: </span>{contact.readiness}</div>
            <div><span className="md:hidden font-medium">Check: </span>{contact.check}</div>
            <div><span className="md:hidden font-medium">Owner: </span>{contact.owner}</div>
          </div>
        ))}
      </div>
    </Panel>
  );

  const renderResponses = () => (
    <Panel>
      <SmallLabel>Responses & results</SmallLabel>
      <h2 className="mt-2 text-3xl font-medium tracking-tight">Coming soon: response handling after a real provider exists</h2>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        There are no fabricated analytics here. A future connected version could show replies, bounce checks, and results after a provider integration and consent-safe import exist.
      </p>
      <div className="mt-6 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-secondary p-5">
        <p className="font-medium">Not connected</p>
        <p className="mt-2 text-sm text-muted-foreground">No live provider, no response stream, and no external measurement is used in this demo workspace.</p>
      </div>
    </Panel>
  );

  const viewContent: Record<ViewId, React.ReactNode> = {
    overview: renderOverview(),
    brief: renderLightCampaignView("Campaign brief", "Seeded school-street campaign brief, shown as fixture context rather than verified current research.", [
      { label: "Outcome", detail: "Make the school street outside St John the Baptist CofE Primary permanent and enforced." },
      { label: "Place", detail: "Leicester; school-run streets around St John the Baptist CofE Primary." },
      { label: "Narrative", detail: "Safer routes, cleaner air, and a council decision route parents can understand before the order lapses." },
      { label: "Provenance", detail: "Local fixture state for the OpenClaw Build Reveal; campaigners must verify current council process before real use." },
    ]),
    objectives: renderLightCampaignView("Objective & targets", "The target map keeps political decisions human-readable before drafting.", [
      { label: "Primary objective", detail: "Secure a permanent, enforced school-street decision before the experimental order lapses." },
      { label: "Decision-maker", detail: "Leicester City Council transport decision route; exact committee/officer path needs verification." },
      { label: "Influence targets", detail: "School leadership, ward councillors, nearby parents, clean-air allies, and local media only after review." },
    ]),
    power: renderLightCampaignView("Power map", "A plain map of who can help, block, or be persuaded without pretending fixture contacts are live campaign intelligence.", [
      { label: "Allies", detail: "School-gate families, clean-air supporters, and councillor watchers who can validate local concerns." },
      { label: "Persuadables", detail: "Nearby parents and ward residents affected by traffic but not yet involved." },
      { label: "Potential blockers", detail: "Implementation cost concerns, enforcement doubts, and objections from through-traffic users." },
    ]),
    strategy: renderLightCampaignView("Strategy & tactics", "The campaign sequence connects the brief to reviewable communications work.", [
      { label: "Sequence", detail: "Confirm decision timing, gather parent support, brief allies, then prepare careful decision-maker contact." },
      { label: "Owners", detail: "Campaigner owns approval; local organiser owns contact readiness; future provider setup remains out of scope." },
      { label: "Timing", detail: "Work is organised around the experimental order lapse, which requires a fresh verification check." },
    ]),
    evidence: renderLightCampaignView("Evidence & checks", "Claims stay visible until a person is comfortable with them.", [
      { label: "Council timing", detail: "Verify current order status and the deadline before using the draft externally." },
      { label: "Legal wording", detail: "Confirm the exact school-street order language and enforcement route." },
      { label: "Contact consent", detail: "Fixture contacts are not a live consent record; import and reconciliation are Coming soon." },
    ]),
    audiences: renderAudienceView(),
    contacts: renderContacts(),
    drafts: renderDraftsView(),
    reviews: renderReviewView(),
    outbox: renderOutboxView(),
    responses: renderResponses(),
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">
              Campaign Factory
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="rounded-full bg-foreground px-3 py-1 text-sm font-medium text-background">Campaign Operations</span>
            <span className="rounded-full bg-tint-yellow px-3 py-1 text-xs font-semibold uppercase tracking-[0.09em]">Demo workspace</span>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Local fixture state</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">St John the Baptist school street · Leicester</span>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              {hydrated ? "Saved in this browser" : "Loading local state"}
            </span>
            <Link href="/factory" className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Back to Factory
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-[5.25rem] max-h-[calc(100vh-6rem)] overflow-auto rounded-[var(--r-2xl)] border border-border bg-secondary/45 p-3">
            {renderNav()}
          </div>
        </aside>

        <details className="rounded-[var(--r-2xl)] border border-border bg-secondary/45 p-3 lg:hidden">
          <summary className="cursor-pointer rounded-[var(--r-xl)] px-2 py-1 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Operations navigation · {navGroups.flatMap((group) => group.items).find((item) => item.id === state.activeView)?.label}
          </summary>
          <div className="mt-4">{renderNav(true)}</div>
        </details>

        <main className="min-w-0" aria-live="polite">
          {viewContent[state.activeView]}
        </main>
      </div>

      <footer className="border-t border-border bg-secondary/55">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <p>
            Local demo storage · Email provider not connected · Human approval required before local queueing.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/how" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">How it works</Link>
            <Link href="/" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">New campaign</Link>
            <button type="button" onClick={reset} className="rounded-full border border-border px-3 py-1.5 hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Reset demo state
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
