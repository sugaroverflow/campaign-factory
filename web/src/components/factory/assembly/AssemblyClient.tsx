"use client";

// Live container for the Campaign Brief (W4). Recovers the stream coordinates
// + intake echo from localStorage (cf_factory_run) so a refresh drops straight
// back into the running campaign with its problem/place hero, then drives the
// pure AssemblyView via useFactoryRun. A shared link with no stored run still
// works: the hook bootstraps + polls the public event log.
//
// Two upgrades over the raw event fold:
//  - Brief Register: the server component ships the source register + claim
//    rows on first paint; while the run is live we refresh it through the
//    fetchBriefRegister Server Function (and once more on terminal) so the
//    Sources rung and the evidence card grow with the research.
//  - Completed brief: once the run is terminal we try W2's durable read route
//    (GET /runs/[id]/documents — coordinator ruling 15 Jul 2026) for W6's
//    compiled document bodies + evidence ledger. If it isn't available the
//    view simply keeps its honest status-only surfaces.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCompiledCampaign,
  getStoredFactoryRun,
  isTerminal,
  useFactoryRun,
  type CompiledCampaignBundle,
} from "@/lib/factory/client";
import { fetchBriefRegister } from "@/app/factory/c/[campaignId]/actions";
import { EMPTY_BRIEF_REGISTER, type BriefRegister } from "./briefData";
import { AssemblyView } from "./AssemblyView";

const REGISTER_POLL_MS = 45_000;

export function AssemblyClient({
  campaignId,
  problem,
  place,
  register,
}: {
  campaignId: string;
  /** Server-fetched run header echo (page.tsx) so a SHARED link still gets an
   *  honest hero — the recorded event log may not carry problem/place. */
  problem?: string;
  place?: string;
  /** Server-built Brief Register (sources + claim rows + campaign name). */
  register?: BriefRegister;
}) {
  const stored = useMemo(() => getStoredFactoryRun(campaignId), [campaignId]);
  const seed = useMemo(
    () => stored?.intake ?? (problem || place ? { problem, place } : undefined),
    [stored, problem, place],
  );

  const { run, connection, answerJudgement } = useFactoryRun({
    campaignId,
    streamUrl: stored?.streamUrl,
    streamToken: stored?.streamToken,
    seed,
  });

  const terminal = isTerminal(run.status);

  // ---- Brief Register: live growth + one final refresh on terminal ----
  const [reg, setReg] = useState<BriefRegister>(register ?? EMPTY_BRIEF_REGISTER);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await fetchBriefRegister(campaignId).catch(() => null);
      if (!cancelled && next) setReg(next);
    };
    if (terminal) {
      // one final refresh so a viewer who watched the run live gets the
      // complete register without reloading
      void refresh();
      return () => {
        cancelled = true;
      };
    }
    const iv = setInterval(refresh, REGISTER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [campaignId, terminal]);

  // ---- compiled documents + evidence ledger (terminal runs) ----
  const [compiled, setCompiled] = useState<CompiledCampaignBundle | null>(null);
  const attempted = useRef(false);
  useEffect(() => {
    if (!terminal || compiled) return;
    let cancelled = false;
    // W2 emits the terminal run.* event only AFTER finalisation persists the
    // compiled output, so the first attempt should succeed; a couple of spaced
    // retries cover propagation lag (route answers 409 while non-terminal).
    const runBurst = async () => {
      if (attempted.current || cancelled) return;
      attempted.current = true;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        const bundle = await fetchCompiledCampaign(campaignId);
        if (cancelled) return;
        if (bundle) {
          setCompiled(bundle);
          return;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      }
    };
    void runBurst();

    // The three-try burst gives up after ~7.5s. If it failed because the tab was
    // backgrounded or offline during finalisation, re-attempt when the page is
    // shown again or the network returns — reset the guard so a fresh burst runs.
    const retry = () => {
      if (cancelled || compiled) return;
      attempted.current = false;
      void runBurst();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", retry);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", retry);
    };
  }, [terminal, campaignId, compiled]);

  return (
    <main className="min-h-dvh">
      <AssemblyView
        run={run}
        connection={connection}
        compiled={compiled}
        register={reg}
        // Only the run's starter holds the stream token; a shared-link viewer
        // has none, so decision cards stay honest rather than 401 on submit.
        canDecide={Boolean(stored?.streamToken)}
        onAnswer={(jid, action, answer) => answerJudgement(jid, action, answer)}
      />
    </main>
  );
}
