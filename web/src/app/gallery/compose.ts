// Pure gallery composition pipeline — extracted from gallery/page.tsx
// (candidate S3, architecture review 2026-07-20). Zero React, zero DB: it takes
// the three already-fetched card arrays and folds them into the two rendered
// sections. page.tsx now only fetches rows, maps them to cards, calls
// composeGallery, and renders — this module is unit-testable in isolation.

export type PillTone = "complete" | "nearly" | "legacy";

export interface GalleryCard {
  key: string;
  href: string;
  title: string;
  subtitle: string | null;
  pill: { label: string; tone: PillTone };
  sortKey: string;
  // Identity + provenance for cross-section dedupe: present on factory/solo
  // cards, absent on legacy wall cards (which never dedupe across sections).
  campaignKey?: string;
  source?: "presenter" | "solo";
}

/** Normalize: lowercase, trim, collapse internal whitespace to single spaces. */
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Dedupe key: normalized problem+place, joined by a NUL byte.
 *
 * The NUL separator is preserved verbatim from the original page.tsx (it was an
 * invisible literal NUL in the source). It is load-bearing, not decorative: a
 * printable separator such as a space would let ("a b", "c") collide with
 * ("a", "b c"), silently merging two distinct campaigns. The key is only ever a
 * Map key for dedupe — never displayed — so the exact separator byte is what
 * keeps behaviour identical.
 */
export function campaignKey(problem: string, place: string): string {
  return `${norm(problem)}\0${norm(place)}`;
}

// Solo runs before this instant were the organizers' own pre-session testing
// (user decision, 16 Jul).
const TEST_SOLO_CUTOFF = "2026-07-16T11:20:00Z";

// ONE grade ladder for the whole gallery — unifies the two tables that used to
// live in page.tsx: the top-level MERGE_RANK over pill tones and the inner
// `rank` over campaignGrade tones inside factoryCards. campaignGrade only ever
// emits complete/nearly/neutral; pill tones are only complete/nearly/legacy.
// The union is ranked so that BOTH original orderings are preserved exactly:
//   • pill tones (was MERGE_RANK  2 > 1 > 0):        complete > nearly > legacy
//   • grade tones (was inner rank 3 > 2 > 1, else 0): complete > nearly > neutral > ungraded
// legacy shares the floor (0) with the ungraded/off-ladder fallback, so an
// ungraded run still ranks below every graded one, exactly as before.
const GRADE_RANK: Record<string, number> = { complete: 3, nearly: 2, neutral: 1, legacy: 0 };

/** Rank of a grade/pill tone; an absent or off-ladder tone ranks below all. */
export function gradeRank(tone: string | null | undefined): number {
  return GRADE_RANK[tone ?? ""] ?? 0;
}

// Cross-section dedupe comparator: a Complete card outranks a Nearly one; ties
// prefer the presenter run, then the newer finish (sortKey = completedAt ?? updatedAt).
function beats(a: GalleryCard, b: GalleryCard): boolean {
  const ra = gradeRank(a.pill.tone);
  const rb = gradeRank(b.pill.tone);
  if (ra !== rb) return ra > rb;
  const pa = a.source === "presenter" ? 1 : 0;
  const pb = b.source === "presenter" ? 1 : 0;
  if (pa !== pb) return pa > pb;
  return a.sortKey.localeCompare(b.sortKey) > 0;
}

const byRecency = (a: GalleryCard, b: GalleryCard) => b.sortKey.localeCompare(a.sortKey);

/**
 * Fold the three fetched card arrays into the two gallery sections.
 *
 * factory / solo cards carry a campaignKey + source and dedupe across sections;
 * legacy cards never dedupe and always land under the organizers.
 */
export function composeGallery(
  factory: GalleryCard[],
  solo: GalleryCard[],
  legacy: GalleryCard[],
): { organizerCards: GalleryCard[]; audienceCards: GalleryCard[] } {
  // Cross-section dedupe: presenter + solo runs of the SAME campaign (campaignKey)
  // collapse to one card. Best grade wins; ties prefer the presenter run, then
  // the newer finish (sortKey = completedAt ?? updatedAt).
  const merged = new Map<string, GalleryCard>();
  for (const c of [...factory, ...solo]) {
    const key = c.campaignKey;
    if (!key) continue; // factory/solo cards always carry a campaignKey
    const prev = merged.get(key);
    if (!prev || beats(c, prev)) merged.set(key, c);
  }
  // Second pass — fold same-NAME campaigns (user decision, 16 Jul): runs of the
  // same campaign entered with place variants ("Leicester" vs "Beaumont Leys,
  // Leicester") share a generated campaign name but not a campaignKey. Two
  // cards with an identical normalized title are the same campaign to a
  // gallery visitor; the best card wins by the same comparator.
  const byTitle = new Map<string, GalleryCard>();
  for (const c of merged.values()) {
    const t = norm(c.title);
    const prev = byTitle.get(t);
    if (!prev || beats(c, prev)) byTitle.set(t, c);
  }

  // Section split: presenter runs and pre-cutoff solo runs (organizer testing)
  // land under "From the organizers' agent factory"; solo runs at/after the
  // cutoff are real attendees under "From the audience". Legacy wall cards
  // always land under the organizers (appended below).
  const organizer: GalleryCard[] = [];
  const audience: GalleryCard[] = [];
  for (const c of byTitle.values()) {
    const organizerTestSolo = c.source === "solo" && c.sortKey < TEST_SOLO_CUTOFF;
    if (c.source === "presenter" || organizerTestSolo) organizer.push(c);
    else audience.push(c);
  }
  // Legacy single-agent cards are organizer demo content too (user, 16 Jul);
  // "From the audience" holds only real attendee runs from here on.
  const organizerCards = [...organizer, ...legacy].sort(byRecency);
  const audienceCards = audience.sort(byRecency);

  return { organizerCards, audienceCards };
}
