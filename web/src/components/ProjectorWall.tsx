"use client";

import { useEffect, useState } from "react";
import { getWall, type WallItem } from "@/lib/client/api";

// Auto-refreshing, big-type wall for the venue projector.
export function ProjectorWall() {
  const [items, setItems] = useState<WallItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const it = await getWall();
      if (alive) setItems(it);
    };
    void load();
    const iv = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-background p-10">
      <h1 className="text-5xl font-semibold tracking-tight">Campaign Factory — live wall</h1>
      <p className="mt-3 text-2xl text-muted-foreground">
        {items.length} campaign{items.length === 1 ? "" : "s"} and counting
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.id} className="rounded-2xl border bg-card/50 p-8">
            <div className="text-3xl font-medium leading-tight">{it.title || it.name}</div>
            {it.title && it.title !== it.name ? (
              <div className="mt-2 text-xl text-muted-foreground">{it.name}</div>
            ) : null}
          </div>
        ))}
      </div>
      {items.length === 0 ? <p className="mt-16 text-3xl text-muted-foreground">Waiting for the first campaign…</p> : null}
    </div>
  );
}
