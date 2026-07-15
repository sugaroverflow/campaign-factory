import Link from "next/link";
import { listWall } from "@/lib/db/wall";
import { listFinishedPresenterRuns } from "@/lib/factory/store/runs";
import { factoryReadSql } from "@/app/api/factory/_lib/worker";

export const dynamic = "force-dynamic";

interface GalleryCard {
  key: string;
  href: string;
  title: string;
  subtitle: string | null;
  legacy: boolean;
  partial: boolean;
  sortKey: string;
}

// Finished presenter-batch campaigns shown as individual cards. Factory config
// may be absent in a legacy-only environment — degrade to the shared list
// rather than failing the page.
async function factoryCards(): Promise<GalleryCard[]> {
  const environmentId = process.env.FACTORY_ENV_ID;
  if (!environmentId) return [];
  try {
    const runs = await listFinishedPresenterRuns(factoryReadSql(), environmentId);
    return runs.map((r) => ({
      key: r.campaignId,
      href: `/factory/c/${r.campaignId}`,
      title: r.problem,
      subtitle: r.place,
      legacy: false,
      partial: r.status === "partial",
      sortKey: r.completedAt ?? r.updatedAt,
    }));
  } catch {
    return [];
  }
}

// Opt-in campaigns from the single-agent builder, marked with a legacy pill.
async function legacyCards(): Promise<GalleryCard[]> {
  const items = await listWall().catch(() => []);
  return items.map((it) => ({
    key: it.id,
    href: `/c/${it.id}`,
    title: it.title || it.name,
    subtitle: it.title && it.title !== it.name ? it.name : null,
    legacy: true,
    partial: false,
    sortKey: it.updatedAt,
  }));
}

export default async function GalleryPage() {
  const [factory, legacy] = await Promise.all([factoryCards(), legacyCards()]);
  const cards = [...factory, ...legacy].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">Campaign Factory</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
            Campaign <span className="font-serif font-normal italic">Gallery</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Campaigns built on stage by the factory, and earlier ones people chose to share.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/factory" className="rounded-full bg-foreground px-4 py-1.5 text-background transition-colors hover:bg-foreground/85">
            Make your own
          </Link>
        </div>
      </header>

      {cards.length === 0 ? (
        <p className="text-muted-foreground">Nothing here yet — be the first.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="group rounded-[var(--r-2xl)] border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-colors hover:border-brand"
            >
              <div className="line-clamp-3 text-lg font-medium leading-snug transition-colors group-hover:text-brand">
                {c.title}
              </div>
              {c.subtitle ? <div className="mt-1 text-sm text-muted-foreground">{c.subtitle}</div> : null}
              {c.legacy || c.partial ? (
                <div className="mt-3 flex gap-2">
                  {c.legacy ? (
                    <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                      Legacy · single-agent
                    </span>
                  ) : null}
                  {c.partial ? (
                    <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                      Finished with gaps
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
