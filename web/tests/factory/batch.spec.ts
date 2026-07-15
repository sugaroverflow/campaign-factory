import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BATCH_CAMPAIGNS,
  PRESENTER_CODE,
  TERMINAL_TIMEOUT_MS,
  FIRST_CARD_TIMEOUT_MS,
  ROSTER_NAMES,
  UI_LIMITS,
  snapshotGallery,
  totalCards,
  totalExpanded,
  totalBackscrollRows,
  isCampaignTerminal,
  visibleTextHasFabricationTell,
  type CampaignSnapshot,
} from "./factory.helpers";

// Full presenter batch through the real UI: code gate → intake → launch →
// live-run observation → terminal receipts → brief page. Writes a JSON summary
// to test-results/ that is the documentation source for the batch-test report.

interface CampaignTiming {
  index: number;
  shortName: string;
  firstCardMs: number | null;
  receiptMs: number | null;
  terminalMs: number | null;
  receiptTitle: string | null;
  receiptTag: string | null;
}

test("presenter batch: five campaigns from intake to receipts", async ({ page, context }) => {
  // -- a. Code gate → cookie-gated intake ------------------------------------
  await test.step("presenter code gate reveals the cookie-gated intake", async () => {
    await page.goto("/factory/multi-campaign-demo");
    await page.getByLabel("Presenter code").fill(PRESENTER_CODE);
    await page.getByRole("button", { name: /Continue|Checking/ }).click();

    // Intake heading is only reachable once the HttpOnly presenter cookie is set.
    await expect(page.getByRole("heading", { name: /campaign ideas/i })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === "cf_presenter");
    expect(cookie, "cf_presenter HttpOnly session cookie should be set").toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
  });

  // -- b. Enter five campaigns; a sixth is not enterable ---------------------
  await test.step("enter five campaigns and confirm a sixth is not enterable", async () => {
    const addBtn = page.getByRole("button", { name: "Add another campaign" });
    for (let i = 1; i < BATCH_CAMPAIGNS.length; i++) {
      await addBtn.click();
      await expect(page.locator("textarea")).toHaveCount(i + 1);
    }

    const problems = page.getByPlaceholder(/What.s the problem/);
    const places = page.getByPlaceholder(/^Place/);
    for (let i = 0; i < BATCH_CAMPAIGNS.length; i++) {
      await problems.nth(i).fill(BATCH_CAMPAIGNS[i].problem);
      await places.nth(i).fill(BATCH_CAMPAIGNS[i].place);
    }

    // Sixth campaign: the add control is disabled and states the cap.
    await expect(page.getByRole("button", { name: /Maximum 5 campaigns/ })).toBeDisabled();
    await expect(page.locator("textarea")).toHaveCount(BATCH_CAMPAIGNS.length);
  });

  // -- c. Launch → gallery, 5 anchors, ledger ≤44px --------------------------
  const batchStart = Date.now();
  let batchId = "";
  await test.step("launch batch, redirect to gallery, anchors + ledger render", async () => {
    await page.getByRole("button", { name: /Build campaigns|Building campaigns/ }).click();
    await page.waitForURL(/\/factory\/gallery\/.+/, { timeout: 60_000 });
    batchId = decodeURIComponent(page.url().split("/factory/gallery/")[1] ?? "");
    expect(batchId.length).toBeGreaterThan(0);

    // Five opaque campaign anchors.
    await expect
      .poll(async () => (await snapshotGallery(page)).length, { timeout: 30_000 })
      .toBe(BATCH_CAMPAIGNS.length);
    const anchors = await snapshotGallery(page);
    for (const a of anchors) {
      // hex tints resolve to fully-opaque rgb(...) (no rgba alpha) → "opaque".
      expect(a.anchorBg, `anchor "${a.shortName}" should be opaque`).toMatch(/^rgb\(/);
    }
    // Anchors are labelled from each campaign's place.
    const labels = anchors.map((a) => a.shortName);
    for (const place of ["Leicester", "Stratford", "Tooting", "Barnes", "Ham"]) {
      expect(labels, `an anchor should be labelled "${place}"`).toContain(place);
    }

    // Factory Ledger visible and ≤44px tall.
    const ledger = page.getByRole("status", { name: "Factory Ledger" });
    await expect(ledger).toBeVisible();
    const box = await ledger.boundingBox();
    expect(box, "ledger should have a bounding box").not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(UI_LIMITS.factoryLedgerMaxHeightPx);
  });

  // -- d. Live-run observation -----------------------------------------------
  await test.step("agent cards appear; expanded cap holds; hues are distinct", async () => {
    // ≥5 agent cards within the first-card budget.
    await expect
      .poll(async () => totalCards(await snapshotGallery(page)), { timeout: FIRST_CARD_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(5);

    // Five distinct campaign hues (distinct anchor background colours).
    const hues = new Set((await snapshotGallery(page)).map((c) => c.anchorBg));
    expect(hues.size, "five campaigns should render five distinct hues").toBe(5);

    // Expanded-card count never exceeds the global cap.
    const first = await snapshotGallery(page);
    expect(totalExpanded(first)).toBeLessThanOrEqual(UI_LIMITS.maxExpandedCards);

    // Work Backscroll rows update over time (live progress, not a static paint).
    const baseRows = totalBackscrollRows(first);
    await expect
      .poll(async () => totalBackscrollRows(await snapshotGallery(page)), { timeout: 60_000 })
      .toBeGreaterThan(baseRows);
  });

  // -- e. Terminal: sample to completion, capturing timings + invariants ------
  const timings: CampaignTiming[] = BATCH_CAMPAIGNS.map((_, i) => ({
    index: i,
    shortName: "",
    firstCardMs: null,
    receiptMs: null,
    terminalMs: null,
    receiptTitle: null,
    receiptTag: null,
  }));
  const namesSeen = new Set<string>();
  let maxExpandedObserved = 0;
  let maxBackscrollObserved = 0;
  let unknownCardText: string | null = null;

  await test.step("all five campaigns reach a terminal receipt / honest end state", async () => {
    const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
    let snap: CampaignSnapshot[] = [];
    let allTerminal = false;
    // Active sampling of the live run: enforce invariants continuously and
    // record per-campaign timings until every campaign is terminal.
    // (This is DOM observation of a live process, not a fixed sleep.)
    while (!allTerminal && Date.now() <= deadline) {
      snap = await snapshotGallery(page);

      const exp = totalExpanded(snap);
      maxExpandedObserved = Math.max(maxExpandedObserved, exp);
      maxBackscrollObserved = Math.max(maxBackscrollObserved, totalBackscrollRows(snap));
      expect(exp, "expanded-card count must never exceed the global cap").toBeLessThanOrEqual(
        UI_LIMITS.maxExpandedCards,
      );

      snap.forEach((c, i) => {
        // The live gallery can render more column-like nodes than the five
        // intake campaigns (observed in live batch #1); grow the timing table
        // rather than crash mid-observation.
        if (!timings[i]) {
          timings[i] = { index: i, shortName: "", firstCardMs: null, receiptMs: null, receiptTitle: "", receiptTag: "", terminalMs: null };
        }
        const t = timings[i];
        t.shortName = c.shortName || t.shortName;
        const elapsed = Date.now() - batchStart;
        if (c.cardCount > 0 && t.firstCardMs === null) t.firstCardMs = elapsed;
        if (c.hasReceipt && t.receiptMs === null) {
          t.receiptMs = elapsed;
          t.receiptTitle = c.receiptTitle;
          t.receiptTag = c.receiptTag;
        }
        if (isCampaignTerminal(c) && t.terminalMs === null) t.terminalMs = elapsed;

        // Every rendered agent card must show a name from the known roster.
        for (const text of c.cardTexts) {
          const match = ROSTER_NAMES.find((n) => text.includes(n));
          if (match) namesSeen.add(match);
          else if (text.length > 0 && unknownCardText === null) unknownCardText = text;
        }
      });

      allTerminal = snap.every(isCampaignTerminal);
      if (!allTerminal) await page.waitForTimeout(1500);
    }

    // Assert the terminal outcome.
    const terminalCount = snap.filter(isCampaignTerminal).length;
    expect(terminalCount, "all five campaigns should reach a terminal state").toBe(
      BATCH_CAMPAIGNS.length,
    );
    // No card ever showed a fabricated / unknown agent name.
    expect(unknownCardText, "every agent card should show a known roster name").toBeNull();
  });

  // -- f. No fabrication tells -----------------------------------------------
  await test.step("gallery shows no undefined / null / NaN tells", async () => {
    const tell = await visibleTextHasFabricationTell(page);
    expect(tell, `gallery should contain no fabrication tell (found: ${tell})`).toBeNull();
  });

  // -- e/f cont. Receipts link out to the brief in a NEW tab -----------------
  let sectionsSeen = 0;
  let docCards = 0;
  await test.step("receipts link to /factory/c/[id] and open the brief in a new tab", async () => {
    const links = page.locator("a.fa-rcpt__open");
    const linkCount = await links.count();
    expect(linkCount, "at least one completion receipt should render a brief link").toBeGreaterThan(
      0,
    );
    for (let i = 0; i < linkCount; i++) {
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
      await expect(links.nth(i)).toHaveAttribute("href", /\/factory\/c\//);
    }

    // Follow one receipt into its new tab and assert the brief renders.
    const [brief] = await Promise.all([
      context.waitForEvent("page"),
      links.first().click(),
    ]);
    await brief.waitForLoadState("domcontentloaded");
    expect(brief.url()).toMatch(/\/factory\/c\//);

    await expect(brief.locator("nav.rail")).toBeVisible({ timeout: 30_000 });
    await expect(brief.locator("section[data-stage]").first()).toBeVisible();
    sectionsSeen = await brief.locator("section[data-stage]").count();
    expect(sectionsSeen, "brief should render the ten campaign sections").toBeGreaterThanOrEqual(10);

    // Document library (either the compiled library or the status grid).
    await expect(brief.locator(".docgrid")).toBeVisible({ timeout: 30_000 });
    docCards = await brief.locator(".doccard").count();
    expect(docCards, "document library should list documents").toBeGreaterThanOrEqual(1);

    const briefTell = await visibleTextHasFabricationTell(brief);
    expect(briefTell, `brief should contain no fabrication tell (found: ${briefTell})`).toBeNull();
    await brief.close();
  });

  // -- settle: let receipt headlines stabilise past the run.* handoff --------
  // A receipt can first paint on the receipt.campaign event ~1s before the
  // run.completed event folds, briefly showing "Campaign in progress" under a
  // "complete" tag. Await the settled headline so the summary is accurate.
  const UNSETTLED = ["Campaign queued", "Campaign in progress"];
  await test.step("receipt headlines settle to a final state", async () => {
    await expect
      .poll(
        async () => {
          const s = await snapshotGallery(page);
          return s.every((c) => c.hasReceipt && !UNSETTLED.includes(c.receiptTitle ?? ""));
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    // Fold the settled titles/tags back into the per-campaign record.
    const settled = await snapshotGallery(page);
    settled.forEach((c, i) => {
      timings[i].receiptTitle = c.receiptTitle;
      timings[i].receiptTag = c.receiptTag;
    });
  });

  // -- g. Write the JSON summary (the batch-test report source) --------------
  await test.step("write batch summary JSON", async () => {
    const finalSnap = await snapshotGallery(page);
    const summary = {
      generatedAt: new Date().toISOString(),
      baseURL: test.info().project.use.baseURL,
      batchId,
      campaignCount: BATCH_CAMPAIGNS.length,
      terminalTimeoutMs: TERMINAL_TIMEOUT_MS,
      firstCardTimeoutMs: FIRST_CARD_TIMEOUT_MS,
      batch: {
        firstCardMs: Math.min(...timings.map((t) => t.firstCardMs ?? Infinity)),
        allTerminalMs: Math.max(...timings.map((t) => t.terminalMs ?? 0)),
        maxExpandedObserved,
        expandedCap: UI_LIMITS.maxExpandedCards,
        maxBackscrollRowsObserved: maxBackscrollObserved,
        receiptsRendered: finalSnap.filter((c) => c.hasReceipt).length,
        distinctHues: new Set(finalSnap.map((c) => c.anchorBg)).size,
        agentNamesSeen: Array.from(namesSeen).sort(),
        briefSectionsSeen: sectionsSeen,
        briefDocCards: docCards,
      },
      campaigns: timings.map((t, i) => ({
        ...t,
        intake: BATCH_CAMPAIGNS[i],
        firstCardToReceiptMs:
          t.firstCardMs != null && t.receiptMs != null ? t.receiptMs - t.firstCardMs : null,
      })),
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    mkdirSync("test-results", { recursive: true });
    const file = `test-results/batch-summary-${stamp}.json`;
    writeFileSync(file, JSON.stringify(summary, null, 2));
    // Surface the path + key numbers in the run log.
    test.info().annotations.push({ type: "batch-summary", description: file });
    console.log(`\n[batch-summary] ${file}\n${JSON.stringify(summary.batch, null, 2)}`);
  });
});
