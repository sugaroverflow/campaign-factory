"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "cf_operations_demo_v1";

type SegmentId = "school_gates" | "ward_parents" | "local_allies";
type DraftStatus = "draft" | "review" | "approved" | "queued";
type Mode = "compose" | "preview";

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

const initialState: DemoState = {
  selectedSegment: "school_gates",
  subject: "Make the St John the Baptist school street permanent",
  body:
    "Hello,\n\nWe are asking Leicester City Council to make the school street outside St John the Baptist CofE Primary permanent, with clear enforcement before the experimental order lapses.\n\nThe campaign is focused on safer school-run streets, cleaner air at the gates, and a decision route parents can follow. If you support the permanent order, please add your name to the campaign update and share one local reason this matters to your family.\n\nBefore any provider connection is used, a campaigner should check the council timing, the wording of the order, and whether this message fits your contact consent records.\n\nThank you,\nCampaign Factory demo workspace",
  status: "draft",
  mode: "compose",
  queuedAt: null,
  activity: [{ id: "seed", label: "Demo workspace opened with seeded campaign brief and local fixture contacts." }],
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
    text: "Approved for the demo queue only. Provider sending is not connected.",
  },
  queued: {
    label: "Queued for demo",
    text: "Stored in this browser as a local demo queue item. Provider connection is off.",
  },
};

function loadState(): DemoState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed.subject || !parsed.body || !parsed.selectedSegment) return initialState;
    return {
      ...initialState,
      ...parsed,
      activity: parsed.activity?.length ? parsed.activity : initialState.activity,
      mode: parsed.mode === "preview" ? "preview" : "compose",
    };
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
  }, [hydrated, state]);

  const selected = useMemo(
    () => segments.find((segment) => segment.id === state.selectedSegment) ?? segments[0],
    [state.selectedSegment],
  );

  const updateDraft = (patch: Partial<Pick<DemoState, "subject" | "body">>) => {
    setState((current) => ({
      ...current,
      ...patch,
      status: current.status === "queued" ? "approved" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
    }));
  };

  const selectSegment = (segment: Segment) => {
    setState((current) => ({
      ...current,
      selectedSegment: segment.id,
      status: current.status === "queued" ? "approved" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
      activity: [record(`Selected audience segment: ${segment.name}.`), ...current.activity].slice(0, 7),
    }));
  };

  const requestReview = () => {
    setState((current) => ({
      ...current,
      status: "review",
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
      queuedAt: new Date().toISOString(),
      activity: [record("Placed approved draft into the local demo queue. No provider connection used."), ...current.activity].slice(0, 7),
    }));
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      ...initialState,
      activity: [record("Demo state reset to the seeded campaign workspace."), ...initialState.activity],
    });
  };

  const canRequestReview = state.subject.trim().length > 8 && state.body.trim().length > 80;
  const status = statusCopy[state.status];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-7 sm:py-16">
      <header className="grid gap-8 border-b border-border pb-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-end">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.09em]">
            <span className="rounded-full bg-tint-yellow px-3 py-1 text-foreground">Demo workspace</span>
            <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">Local fixture state</span>
          </div>
          <h1 className="max-w-[15ch] text-4xl font-medium tracking-tight sm:text-6xl">
            Turn a brief into <span className="font-serif font-normal italic">campaign operations</span>.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            A seeded school-street campaign becomes audience selection, an editable email, human review, and a truthful demo queue — with provider outreach kept off.
          </p>
        </div>
        <aside className="rounded-[var(--r-2xl)] border border-border bg-secondary/60 p-5">
          <div className="text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">Next action</div>
          <p className="mt-2 text-xl font-medium">Review the parent email and approve it only if the claim checks pass.</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Place</dt>
              <dd className="font-medium">Leicester · St John the Baptist CofE Primary</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stage</dt>
              <dd className="font-medium">Drafting and review</dd>
            </div>
          </dl>
        </aside>
      </header>

      <section className="grid gap-8 py-9 lg:grid-cols-[minmax(250px,0.85fr)_minmax(0,1.4fr)]">
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.09em] text-muted-foreground">Campaign brief</p>
            <h2 className="mt-2 text-2xl font-medium tracking-tight">Permanent, enforced school street before the order lapses.</h2>
            <p className="mt-3 text-muted-foreground">
              Fixture brief: safer school-run streets, cleaner air near the gates, and a council decision route campaigners can understand before the experimental order expires.
            </p>
          </div>

          <div className="rounded-[var(--r-2xl)] border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Draft state</p>
                <h3 className="text-xl font-medium">{status.label}</h3>
              </div>
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">{selected.ready}/{selected.contacts} ready</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>
            <p className="mt-3 text-sm"><span className="font-medium">Queue:</span> {formatQueuedTime(state.queuedAt)}</p>
          </div>

          <div>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.09em] text-muted-foreground">Audience</p>
                <h2 className="text-2xl font-medium tracking-tight">Choose the contact set</h2>
              </div>
            </div>
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
                      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs">{segment.contacts} fixture contacts</span>
                    </span>
                    <span className="mt-3 block text-sm text-muted-foreground">{segment.readiness}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[var(--r-3xl)] border border-border bg-background p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.09em] text-muted-foreground">Email drafting</p>
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
              <Button type="button" size="lg" variant="outline" onClick={approve} disabled={state.status !== "review"}>
                Approve as human reviewer
              </Button>
              <Button type="button" size="lg" variant="secondary" onClick={queue} disabled={state.status !== "approved"}>
                Queue locally for demo
              </Button>
              <Button type="button" size="lg" variant="ghost" onClick={reset}>
                Reset demo state
              </Button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[var(--r-2xl)] border border-border p-5">
              <p className="text-sm font-medium uppercase tracking-[0.09em] text-muted-foreground">Demo-safe outbox</p>
              <h2 className="mt-1 text-2xl font-medium tracking-tight">{state.status === "queued" ? "One local queue item" : "Nothing queued yet"}</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {state.status === "queued"
                  ? "The approved draft is stored in this browser for the conference demo. It is not connected to an email provider."
                  : "Approve the draft before it can enter the local demo queue. Provider outreach stays disabled."}
              </p>
              <button
                type="button"
                disabled
                className="mt-4 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground opacity-70"
                title="Provider connection is coming soon; this demo does not use email outreach."
              >
                Provider dispatch · Coming soon
              </button>
            </div>
            <div className="rounded-[var(--r-2xl)] border border-border p-5">
              <p className="text-sm font-medium uppercase tracking-[0.09em] text-muted-foreground">Activity</p>
              <ul className="mt-3 space-y-3 text-sm">
                {state.activity.map((item) => (
                  <li key={item.id} className="border-l-2 border-foreground/20 pl-3 text-muted-foreground">
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
