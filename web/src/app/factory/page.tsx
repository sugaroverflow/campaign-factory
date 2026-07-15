"use client";

// Public factory intake (W4). Problem + Place, both required; the place must be
// a NAMED, specific place (parameters §8 input gate: no run accepts a blank or
// ambiguous place). Light Awake style, reusing the shared ui primitives and the
// .cta pill without editing shared files. On a successful start it stores the
// stream coordinates in localStorage (cf_factory_run) and redirects to
// /factory/c/[campaignId].

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { startFactoryRun } from "@/lib/factory/client/api";
import { rememberFactoryRun } from "@/lib/factory/client";

const PROBLEM_PLACEHOLDER =
  "I want [decision-maker or body, if known] to [specific change] by [timeframe, if known], because [problem]. This affects [people or community]. We already know [evidence, allies, or constraints].";

// A place that is too broad to research a local decision route against.
const AMBIGUOUS_PLACES = new Set([
  "uk",
  "u.k.",
  "united kingdom",
  "england",
  "scotland",
  "wales",
  "britain",
  "great britain",
  "gb",
  "online",
  "the internet",
  "everywhere",
  "anywhere",
  "nationwide",
  "national",
  "n/a",
  "na",
  "none",
  "tbd",
]);

function placeIsNamed(place: string): boolean {
  const p = place.trim();
  if (p.length < 2) return false;
  return !AMBIGUOUS_PLACES.has(p.toLowerCase());
}

const EXAMPLE = {
  problem:
    "Make the school street outside St John the Baptist CofE Primary permanent, with proper enforcement, before the experimental order lapses.",
  place: "Leicester (St John the Baptist CofE Primary School)",
};

export default function FactoryIntakePage() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedPlace, setTouchedPlace] = useState(false);

  const problemOk = problem.trim().length >= 8;
  const placeOk = placeIsNamed(place);
  const canSubmit = problemOk && placeOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedPlace(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = await startFactoryRun({ problem: problem.trim(), place: place.trim() });
    if (res.ok && res.data) {
      rememberFactoryRun({
        campaignId: res.data.campaignId,
        batchId: res.data.batchId,
        streamUrl: res.data.streamUrl,
        streamToken: res.data.streamToken,
        intake: { problem: problem.trim(), place: place.trim() },
      });
      router.push(`/factory/c/${res.data.campaignId}`);
      return; // keep the button busy through the navigation
    }
    setBusy(false);
    setError(res.error || "Something went wrong starting your campaign. Please try again.");
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-24">
      <header className="mb-12 text-center sm:mb-14">
        <div className="text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">
          A real multi-agent campaign build — live
        </div>
        <h1 className="mx-auto mt-4 max-w-[20ch] text-4xl font-medium tracking-tight sm:text-6xl">
          Build a whole campaign with a <span className="font-serif font-normal italic">team of agents</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-[58ch] text-lg text-muted-foreground sm:text-xl">
          Describe one local or public-policy problem and the place it affects. A team of research, evidence,
          strategy and production agents assembles a ten-step campaign brief in front of you — with every claim
          labelled and every decision left to you.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-7">
        <div className="space-y-2.5">
          <Label htmlFor="problem" className="text-base">
            What&apos;s the problem?
          </Label>
          <Textarea
            id="problem"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder={PROBLEM_PLACEHOLDER}
            rows={5}
            className="min-h-[9.5rem] rounded-[var(--r-2xl)] border-[1.5px] p-5 text-base leading-relaxed sm:text-lg"
            autoFocus
          />
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="place" className="text-base">
            Where? <span className="font-normal text-muted-foreground">(a specific, named place — required)</span>
          </Label>
          <Input
            id="place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => setTouchedPlace(true)}
            placeholder="e.g. Leicester · Stratford, London E20 · a named school, ward, or constituency"
            className="h-auto rounded-full border-[1.5px] px-4 py-2.5 text-base"
            aria-invalid={touchedPlace && !placeOk}
          />
          {touchedPlace && !placeOk ? (
            <p className="text-sm text-[var(--bad)]">
              Name a specific place — a town, ward, constituency, or institution. A country or &ldquo;online&rdquo;
              isn&apos;t specific enough to trace a local decision route.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The agent factory researches a real decision route, so it needs to know exactly where.
            </p>
          )}
        </div>

        {error ? <p className="text-sm text-[var(--bad)]">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button type="submit" className="cta" disabled={!canSubmit}>
            {busy ? "Starting…" : "Build the campaign"}
            <span className="chip">→</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setProblem(EXAMPLE.problem);
              setPlace(EXAMPLE.place);
              setTouchedPlace(false);
              setError(null);
            }}
            className="max-w-md flex-1 cursor-pointer rounded-[var(--r-xl)] border border-dashed border-[var(--ring)] bg-secondary px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <b className="mb-0.5 block text-foreground">Prepared example — Leicester school street</b>
            A permanent, enforced school street before the experimental order lapses.
          </button>
        </div>
      </form>

      <p className="mx-auto mt-10 max-w-[60ch] text-center text-sm text-muted-foreground">
        Optimised for UK local government, public bodies, transport, planning, environment, education, health,
        and consultations. Drafts, not decisions: everything produced needs human review and verification.
      </p>

      <p className="mx-auto mt-4 text-center text-sm">
        <a href="/factory/replay/conference" className="underline underline-offset-4 hover:text-foreground">
          Or watch the 15-minute agent factory session
        </a>
        <span className="text-muted-foreground"> — real campaigns built in parallel, replayed from the event log.</span>
      </p>
    </div>
  );
}
