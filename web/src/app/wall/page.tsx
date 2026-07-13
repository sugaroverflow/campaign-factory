import Link from "next/link";
import { listWall } from "@/lib/db/wall";

export const dynamic = "force-dynamic";

export default async function WallPage() {
  const items = await listWall();
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-wide text-muted-foreground">Campaign Factory</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">The wall</h1>
          <p className="mt-2 text-muted-foreground">Campaigns people made here and chose to share.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/wall/projector" className="rounded border px-3 py-1.5 hover:bg-muted">
            Projector mode
          </Link>
          <Link href="/" className="rounded bg-foreground px-3 py-1.5 text-background">
            Make your own
          </Link>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="text-muted-foreground">Nothing shared yet — be the first.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/c/${it.id}`}
              className="group rounded-xl border bg-card/40 p-5 transition-colors hover:border-foreground/30 hover:bg-card"
            >
              <div className="text-lg font-medium leading-snug group-hover:underline">{it.title || it.name}</div>
              {it.title && it.title !== it.name ? (
                <div className="mt-1 text-sm text-muted-foreground">{it.name}</div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
