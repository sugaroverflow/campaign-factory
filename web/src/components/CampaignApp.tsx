"use client";

import { useEffect, useState, useCallback } from "react";
import { EntryForm } from "@/components/EntryForm";
import { RunProgress } from "@/components/RunProgress";
import { Journey } from "@/components/Journey";
import { OwnerBar } from "@/components/OwnerBar";
import { Button } from "@/components/ui/button";
import {
  getStatus,
  startRun,
  ACCESS_CODE_KEY,
  type StatusResp,
  type StartInput,
} from "@/lib/client/api";
import { type Campaign } from "@/lib/pipeline/types";

type Phase = "form" | "running" | "done" | "failed";

export function CampaignApp() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [runId, setRunId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [lastInput, setLastInput] = useState<StartInput | null>(null);

  useEffect(() => {
    void getStatus().then(setStatus);
    const saved = typeof window !== "undefined" ? localStorage.getItem(ACCESS_CODE_KEY) : null;
    if (saved) setCode(saved);
  }, []);

  const begin = useCallback(
    async (input: StartInput, submittedCode: string) => {
      setBusy(true);
      setError(null);
      setLastInput(input);
      setCode(submittedCode);
      const res = await startRun(input, submittedCode || undefined);
      setBusy(false);
      if (res.ok && res.id) {
        if (submittedCode) localStorage.setItem(ACCESS_CODE_KEY, submittedCode);
        setRunId(res.id);
        setPhase("running");
        return;
      }
      if (res.capacity) {
        setStatus((s) => (s ? { ...s, capacity: true, reason: res.reason ?? "budget" } : s));
        return;
      }
      setError(res.error || "Something went wrong. Please try again.");
    },
    [],
  );

  const retry = useCallback(() => {
    setPhase("form");
    setRunId(null);
    setCampaign(null);
    // re-run immediately with the same input + code
    if (lastInput) void begin(lastInput, code);
  }, [lastInput, begin, code]);

  const reset = useCallback(() => {
    setPhase("form");
    setRunId(null);
    setCampaign(null);
    setError(null);
    void getStatus().then(setStatus);
  }, []);

  const onComplete = useCallback((s: { campaign: Campaign }) => {
    const c = s.campaign;
    const hasContent = c.completed.research || c.completed.plan || c.completed.drafts;
    if (hasContent) {
      setCampaign(c);
      setPhase("done");
    } else {
      setPhase("failed");
    }
  }, []);

  // At-capacity takes precedence over everything.
  if (status?.capacity) return <Capacity reason={status.reason} />;

  if (phase === "running" && runId) {
    return <RunProgress runId={runId} onComplete={onComplete} onRetry={retry} />;
  }

  if (phase === "done" && campaign) {
    return (
      <>
        <OwnerBar id={campaign.id} onDeleted={reset} />
        <Journey campaign={campaign} onReset={reset} />
      </>
    );
  }

  if (phase === "failed") {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-16 text-center">
        <h2 className="text-2xl font-semibold">That run didn&apos;t complete</h2>
        <p className="mt-2 text-muted-foreground">
          Nothing usable was produced, and we don&apos;t invent a campaign to fill the gap. Please try again.
        </p>
        <Button className="mt-6" onClick={retry}>
          Try again
        </Button>
        <Button variant="ghost" className="mt-6 ml-2" onClick={reset}>
          Start over
        </Button>
      </div>
    );
  }

  return (
    <EntryForm
      onStart={begin}
      busy={busy}
      error={error}
      accessRequired={status?.accessRequired}
      initialCode={code}
    />
  );
}

function Capacity({ reason }: { reason: "closed" | "budget" | null }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        {reason === "closed" ? "Campaign Factory has wrapped up" : "We're at capacity right now"}
      </h1>
      <p className="mt-4 text-muted-foreground">
        {reason === "closed"
          ? "New campaigns aren't being generated anymore, but the campaigns made here are still readable."
          : "A lot of campaigns are being built at once. Explore the ones others have made while we catch up, and try again shortly."}
      </p>
      <a href="/wall" className="mt-6 inline-block rounded-full bg-foreground px-5 py-2 text-sm text-background transition-colors hover:bg-foreground/85">
        Explore the Campaign Gallery
      </a>
    </div>
  );
}
