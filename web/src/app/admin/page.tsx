"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getWall, type WallItem } from "@/lib/client/api";

const ADMIN_KEY = "cf_admin_key";

// Minimal admin surface: the fire extinguisher. Enter the admin key, see the
// wall, hide anything. The key is verified server-side on each hide.
export default function AdminPage() {
  const [key, setKey] = useState("");
  const [items, setItems] = useState<WallItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => setItems(await getWall());
  useEffect(() => {
    const k = typeof window !== "undefined" ? localStorage.getItem(ADMIN_KEY) : null;
    if (k) setKey(k);
    void load();
  }, []);

  const hide = async (id: string) => {
    const r = await fetch("/api/admin/hide", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cf-admin-key": key },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      localStorage.setItem(ADMIN_KEY, key);
      setMsg("Hidden.");
      await load();
    } else {
      setMsg("Failed — check the admin key.");
    }
    setTimeout(() => setMsg(null), 2000);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Wall admin</h1>
      <div className="mt-4 max-w-xs space-y-1.5">
        <Label htmlFor="k" className="text-sm">
          Admin key
        </Label>
        <Input id="k" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="CF_ADMIN_KEY" />
      </div>
      {msg ? <p className="mt-3 text-sm text-muted-foreground">{msg}</p> : null}

      <div className="mt-8 space-y-2">
        {items.length === 0 ? <p className="text-muted-foreground">Nothing on the wall.</p> : null}
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Link href={`/c/${it.id}`} className="min-w-0 truncate hover:underline">
              {it.title || it.name}
            </Link>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => hide(it.id)} disabled={!key}>
              Hide
            </Button>
          </div>
        ))}
      </div>
    </main>
  );
}
