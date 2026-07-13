"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { type StartInput } from "@/lib/client/api";

const EXAMPLE: StartInput = {
  problem:
    "I want the council to reverse the planned closure of our local branch library and keep it open with its current staffed opening hours.",
  org: "Save Our Library",
  location: "Leicester LE2 1TH",
  outcome: "Keep the library open, staffed, at current hours",
  timeframe: "Before the budget is set",
  affected: "Local families, older residents, students",
};

const STRUCTURED: { key: keyof StartInput; label: string; placeholder: string }[] = [
  { key: "org", label: "Your organisation (optional)", placeholder: "e.g. Save Our Library" },
  { key: "location", label: "Location (a postcode helps)", placeholder: "e.g. Leicester LE2 1TH" },
  { key: "outcome", label: "Desired outcome", placeholder: "What does winning look like?" },
  { key: "dm", label: "Known decision-maker", placeholder: "If you already know who decides" },
  { key: "timeframe", label: "Timeframe", placeholder: "e.g. before the March budget" },
  { key: "affected", label: "Who is affected", placeholder: "e.g. families, older residents" },
  { key: "evidence", label: "Evidence you have", placeholder: "Consultations, figures, reports" },
  { key: "resources", label: "Resources you have", placeholder: "People, budget, contacts" },
];

export function EntryForm({
  onStart,
  busy,
  error,
  accessRequired = false,
  initialCode = "",
}: {
  onStart: (input: StartInput, code: string) => void;
  busy?: boolean;
  error?: string | null;
  accessRequired?: boolean;
  initialCode?: string;
}) {
  const [form, setForm] = useState<StartInput>({ problem: "" });
  const [code, setCode] = useState(initialCode);
  const set = (k: keyof StartInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const codeOk = !accessRequired || code.trim().length > 0;
  const canSubmit = (form.problem || "").trim().length >= 8 && codeOk && !busy;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium tracking-wide text-muted-foreground">Campaign Factory</p>
          <a href="/wall" className="text-sm text-brand underline-offset-4 hover:underline">
            Campaign Gallery →
          </a>
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          Turn a local problem into a <span className="font-serif font-normal italic">whole campaign</span>.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Describe a UK local or public-policy problem. Campaign Factory researches it live, builds the
          plan, and drafts the materials — labelling what it can verify and flagging what it can&apos;t.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onStart(normalise(form), code.trim());
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="problem" className="text-base">
            What&apos;s the problem?
          </Label>
          <Textarea
            id="problem"
            value={form.problem}
            onChange={(e) => set("problem", e.target.value)}
            placeholder="I want [who] to [do what] in [where]…"
            rows={4}
            className="text-base"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            One sentence is enough — research fills the gaps and tells you what it couldn&apos;t establish.
          </p>
        </div>

        <details className="rounded-lg border bg-card/50 p-4">
          <summary className="cursor-pointer select-none text-sm font-medium">
            Add more detail (optional)
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {STRUCTURED.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key} className="text-xs text-muted-foreground">
                  {f.label}
                </Label>
                <Input
                  id={f.key}
                  value={(form[f.key] as string) || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>
        </details>

        {accessRequired ? (
          <div className="space-y-1.5">
            <Label htmlFor="code" className="text-sm">
              Conference access code
            </Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter the code shown on screen"
              className="max-w-xs"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!canSubmit}>
            {busy ? "Starting…" : "Build the campaign"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setForm(EXAMPLE)} disabled={busy}>
            Use a prepared example
          </Button>
        </div>
      </form>
    </div>
  );
}

function normalise(f: StartInput): StartInput {
  const out: StartInput = { problem: f.problem.trim() };
  for (const k of ["org", "location", "outcome", "dm", "timeframe", "affected", "evidence", "resources"] as const) {
    const v = (f[k] as string | undefined)?.trim();
    if (v) out[k] = v;
  }
  return out;
}
