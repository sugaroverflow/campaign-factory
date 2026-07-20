"use client";

// Public factory intake (W4). Problem + Place, both required; the place must be
// a NAMED, specific place (parameters §8 input gate: no run accepts a blank or
// ambiguous place). Styled in the legacy brief-page language (journey.css /
// awake): calm left-aligned hero with a small serif flourish, a brand-tinted
// frame around the form, a brand-coloured .cta pill, and the prepared example
// as an ink-bordered framed card. On a successful start it stores the stream
// coordinates in localStorage (cf_factory_run) and redirects to
// /factory/c/[campaignId].

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { startFactoryRun } from "@/lib/factory/client/api";
import { rememberFactoryRun } from "@/lib/factory/client";
import styles from "./factory-intake.module.css";

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

function keyLooksValid(key: string): boolean {
  const k = key.trim();
  return /^sk-ant-[A-Za-z0-9_-]{10,}$/.test(k) || /^sk-or-[A-Za-z0-9_-]{10,}$/.test(k);
}

export default function FactoryIntakePage() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [place, setPlace] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedPlace, setTouchedPlace] = useState(false);
  const [touchedKey, setTouchedKey] = useState(false);

  const problemOk = problem.trim().length >= 8;
  const placeOk = placeIsNamed(place);
  const keyOk = keyLooksValid(apiKey);
  const canSubmit = problemOk && placeOk && keyOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedPlace(true);
    setTouchedKey(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = await startFactoryRun(
      { problem: problem.trim(), place: place.trim() },
      { apiKey: apiKey.trim() },
    );
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
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-20">
      <header className={styles.hero}>
        <div className={styles.eyebrow}>
          The agent factory · researched live · every output requires human review
        </div>
        <h1 className={styles.title}>
          Start with a problem, and a <span className={styles.serif}>place</span>.
        </h1>
        <p className={styles.lede}>
          A team of research, evidence, strategy and production agents assembles a ten-step campaign brief in
          front of you — built on real sources, with every claim labelled and every decision left to you.
        </p>
      </header>

      <form onSubmit={submit} className={styles.formFrame}>
        <div className={styles.frameLabel}>Tell the factory</div>

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
            className={`${styles.field} min-h-[9.5rem] rounded-[var(--r-2xl)] p-5 text-base leading-relaxed sm:text-lg`}
            autoFocus
          />
        </div>

        <div className="mt-6 space-y-2.5">
          <Label htmlFor="place" className="flex-wrap text-base">
            Where?{" "}
            <span className="font-normal text-muted-foreground">
              (a specific, named place — <span className="font-medium text-[var(--brand)]">required</span>)
            </span>
          </Label>
          <Input
            id="place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => setTouchedPlace(true)}
            placeholder="e.g. Leicester · Stratford, London E20 · a named school, ward, or constituency"
            className={`${styles.field} h-auto rounded-full px-4 py-2.5 text-base`}
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

        <div className="mt-6 space-y-2.5">
          <Label htmlFor="apiKey" className="flex-wrap text-base">
            Your Anthropic or OpenRouter API key{" "}
            <span className="font-normal text-muted-foreground">
              (the agents run on your key — <span className="font-medium text-[var(--brand)]">required</span>)
            </span>
          </Label>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => setTouchedKey(true)}
            placeholder="sk-ant-… or sk-or-…"
            autoComplete="off"
            spellCheck={false}
            className={`${styles.field} h-auto rounded-full px-4 py-2.5 text-base`}
            aria-invalid={touchedKey && !keyOk}
          />
          {touchedKey && !keyOk ? (
            <p className="text-sm text-[var(--bad)]">
              Keys start with <code>sk-ant-</code> (Anthropic) or <code>sk-or-</code> (OpenRouter) — paste the
              whole key. Create one at{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                console.anthropic.com
              </a>{" "}
              or{" "}
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                openrouter.ai
              </a>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              A campaign typically costs $1.50–$3 of your credit, hard-capped at $20. Your key is encrypted,
              used only for this campaign&apos;s agents, and deleted when the run finishes — get one at{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                console.anthropic.com
              </a>{" "}
              or{" "}
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                openrouter.ai
              </a>
              .
            </p>
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-[var(--bad)]">{error}</p> : null}

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <button type="submit" className={`cta ${styles.ctaBrand}`} disabled={!canSubmit}>
            {busy ? "Starting…" : "Build the campaign"}
            <span className="chip">→</span>
          </button>
          <span className="text-sm text-muted-foreground">Takes a few minutes — you watch it assemble.</span>
        </div>
      </form>

      <button
        type="button"
        onClick={() => {
          setProblem(EXAMPLE.problem);
          setPlace(EXAMPLE.place);
          setTouchedPlace(false);
          setError(null);
        }}
        className={styles.exampleCard}
      >
        <span className={styles.exampleBar}>
          <span className="dots"><i /><i /><i /></span>
          prepared example · Leicester
          <span className="fill">Use this →</span>
        </span>
        <span className={styles.exampleBody}>
          <b>Leicester school street</b>
          A permanent, enforced school street outside St John the Baptist CofE Primary, before the experimental
          order lapses.
        </span>
      </button>

      <p className="mt-8 text-center text-sm">
        <a href="/factory/replay/conference" className="underline underline-offset-4 hover:text-foreground">
          Or watch the 15-minute agent factory session
        </a>
        <span className="text-muted-foreground"> — real campaigns built in parallel, replayed from the event log.</span>
      </p>
    </div>
  );
}
