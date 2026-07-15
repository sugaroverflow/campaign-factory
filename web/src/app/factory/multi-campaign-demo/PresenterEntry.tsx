"use client";

// Presenter entry (ADR 0013). Two steps on one route:
//  1. Code gate — the code is read from an UNCONTROLLED input on submit and
//     never held in React state, localStorage, or analytics. It goes straight to
//     POST /api/factory/present, which sets the HttpOnly session cookie.
//  2. Batch intake — 1 to 5 campaign ideas (problem + place each). A sixth is not
//     enterable. "Build campaigns" → POST /api/factory/batches (W2), stash the
//     stream coordinates, redirect to the gallery.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RUNTIME_LIMITS, type StartBatchResponse } from "@/lib/factory/contracts";
import { rememberBatch, type StoredBatchConnection } from "@/components/factory/gallery";

const MAX = RUNTIME_LIMITS.campaignsPerPresenterBatch; // 5

interface Idea {
  problem: string;
  place: string;
}

export function PresenterEntry({ initiallyAuthed }: { initiallyAuthed: boolean }) {
  // Access-code lock removed (15 Jul 2026): a session is issued automatically
  // so anyone can fire an on-stage batch. Spend stays bounded server-side.
  const [authed, setAuthed] = useState(initiallyAuthed);
  return authed ? <BatchIntake /> : <AutoSession onAuthed={() => setAuthed(true)} />;
}

function AutoSession({ onAuthed }: { onAuthed: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/factory/present", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) onAuthed();
        else setError("Could not open a presenter session. Retry below.");
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server. Retry below.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = codeRef.current?.value ?? "";
    setBusy(true);
    try {
      const r = await fetch("/api/factory/present", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(code.trim() ? { code } : {}),
      });
      if (codeRef.current) codeRef.current.value = "";
      if (r.ok) {
        onAuthed();
        return;
      }
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Could not open a presenter session.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Multi-campaign demo</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">
        {error ? "Open the multi-campaign demo" : "Opening the multi-campaign demo…"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The multi-campaign demo runs batches of up to five campaigns at once. The public site runs
        one campaign at a time.
      </p>
      {error ? (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <input ref={codeRef} type="hidden" name="presenter-code" autoComplete="off" />
          <p className="text-sm text-[var(--bad)]">{error}</p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function BatchIntake() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[]>([{ problem: "", place: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  function update(i: number, patch: Partial<Idea>) {
    setIdeas((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function add() {
    setIdeas((prev) => (prev.length >= MAX ? prev : [...prev, { problem: "", place: "" }]));
  }
  function remove(i: number) {
    setIdeas((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function build() {
    setError(null);
    const intakes = ideas.map((v) => ({ problem: v.problem.trim(), place: v.place.trim() }));
    if (intakes.some((v) => v.problem.length < 8)) {
      setError("Each campaign needs a problem (at least a sentence).");
      return;
    }
    if (intakes.some((v) => !v.place)) {
      setError("Each campaign needs a specific place — no blank or ambiguous place is accepted.");
      return;
    }
    setBuilding(true);
    try {
      const r = await fetch("/api/factory/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intakes,
          environmentId: process.env.NEXT_PUBLIC_FACTORY_ENV_ID ?? "",
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error || `Could not start the batch (${r.status}).`);
        setBuilding(false);
        return;
      }
      const data = (await r.json()) as StartBatchResponse;
      const connections: StoredBatchConnection[] = data.campaigns.map((c, i) => ({
        campaignId: c.campaignId,
        streamUrl: c.streamUrl,
        streamToken: c.streamToken,
        intake: intakes[i],
      }));
      rememberBatch(data.batchId, connections);
      router.push(`/factory/gallery/${encodeURIComponent(data.batchId)}`);
    } catch {
      setError("Could not reach the factory. Try again.");
      setBuilding(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Presenter batch</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">
        Enter up to five <span className="font-serif italic">campaign ideas</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Each idea is one local campaign: a problem and the specific place it happens. They run
        concurrently as five real multi-agent campaigns.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {ideas.map((idea, i) => (
          <div key={i} className="rounded-2xl border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Campaign {i + 1}</span>
              {ideas.length > 1 ? (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <textarea
              value={idea.problem}
              onChange={(e) => update(i, { problem: e.target.value })}
              placeholder="What's the problem? e.g. The council plans to remove the school street outside…"
              rows={2}
              className="mt-3 w-full resize-y rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-foreground"
            />
            <input
              value={idea.place}
              onChange={(e) => update(i, { place: e.target.value })}
              placeholder="Place (specific) — e.g. Leicester, or Stratford, London"
              className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={ideas.length >= MAX}
          className="rounded-full border border-border px-4 py-2 text-sm hover:border-foreground disabled:opacity-40"
        >
          {ideas.length >= MAX ? `Maximum ${MAX} campaigns` : "Add another campaign"}
        </button>
        <span className="text-xs text-muted-foreground">
          {ideas.length}/{MAX}
        </span>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--bad)]">{error}</p> : null}

      <div className="mt-6">
        <button
          type="button"
          onClick={build}
          disabled={building}
          className="rounded-full bg-foreground px-7 py-3 text-base font-medium text-background disabled:opacity-50"
        >
          {building ? "Building campaigns…" : "Build campaigns"}
        </button>
      </div>
    </div>
  );
}
