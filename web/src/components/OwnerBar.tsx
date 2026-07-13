"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shareCampaign, unshareCampaign, deleteCampaign } from "@/lib/client/api";

// Owner controls for the campaign you just created (this browser session owns it):
// copy the shareable link, opt in/out of the conference wall, or delete.
export function OwnerBar({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [title, setTitle] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== "undefined" ? `${location.origin}/c/${id}` : `/c/${id}`;

  const doShare = async () => {
    setBusy(true);
    const ok = await shareCampaign(id, title || undefined);
    setBusy(false);
    if (ok) setShared(true);
  };
  const doUnshare = async () => {
    setBusy(true);
    const ok = await unshareCampaign(id);
    setBusy(false);
    if (ok) setShared(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const doDelete = async () => {
    if (!confirm("Delete this campaign? This can't be undone.")) return;
    setBusy(true);
    const ok = await deleteCampaign(id);
    setBusy(false);
    if (ok) onDeleted();
  };

  return (
    <div className="border-b bg-muted/30">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-5 py-3 text-sm">
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Link copied" : "Copy link"}
        </Button>
        {shared ? (
          <>
            <span className="text-emerald-700">On the wall ✓</span>
            <Button size="sm" variant="ghost" onClick={doUnshare} disabled={busy}>
              Remove from wall
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title for the wall (optional)"
              className="h-8 w-56"
            />
            <Button size="sm" onClick={doShare} disabled={busy}>
              Share to the wall
            </Button>
          </div>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-red-600 hover:text-red-700" onClick={doDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}
