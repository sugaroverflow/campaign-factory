import Link from "next/link";
import { listWall } from "@/lib/db/wall";

export const dynamic = "force-dynamic";

export default async function WallPage() {
  const items = await listWall();
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">Campaign Factory</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
            Campaign <span className="font-serif font-normal italic">Gallery</span>
          </h1>
          <p className="mt-2 text-muted-foreground">Campaigns people made here and chose to share.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/" className="rounded-full bg-foreground px-4 py-1.5 text-background transition-colors hover:bg-foreground/85">
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
              className="group rounded-[var(--r-2xl)] border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-colors hover:border-brand"
            >
              <div className="text-lg font-medium leading-snug transition-colors group-hover:text-brand">{it.title || it.name}</div>
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
