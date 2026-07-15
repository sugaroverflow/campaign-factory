import { test, expect } from "@playwright/test";
import { PUBLIC_CAMPAIGN, FIRST_CARD_TIMEOUT_MS } from "./factory.helpers";

// Public single-campaign intake smoke test. Asserts liveness only (does NOT wait
// for a terminal state). If a cancel control exists it is used; otherwise the
// mock run is left to finish on its own (cheap).
//
// The public route rate-limits per client IP (CF_IP_RUN_CAP, default 3) and per
// session — an intentional anti-abuse control. Locally every request buckets
// under the shared "local" IP, so once the team has used the day's quota this
// test honestly SKIPS (see the 429/503 handling below) rather than pretending to
// pass. On a preview URL with real per-visitor IPs it runs normally.

test("public intake: single campaign starts and comes alive", async ({ page }) => {
  await page.goto("/factory");

  await page.locator("#problem").fill(PUBLIC_CAMPAIGN.problem);
  await page.locator("#place").fill(PUBLIC_CAMPAIGN.place);

  // Capture the start response so a shared per-IP cap (429/503) is reported
  // honestly rather than surfacing as a confusing UI failure.
  const startResponse = page.waitForResponse(
    (r) => r.url().includes("/api/factory/runs") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /Build the campaign|Starting/ }).click();

  const res = await startResponse;
  if (res.status() === 429 || res.status() === 503) {
    test.skip(
      true,
      `public run route returned ${res.status()} (shared per-IP/session cap or capacity) — not a UI defect`,
    );
    return;
  }
  expect(res.status(), "public start should be accepted").toBeLessThan(400);

  // Redirect to the assembly view.
  await page.waitForURL(/\/factory\/c\/.+/, { timeout: 30_000 });

  // First agent card within the first-card budget — the Step Workspace only
  // mounts once at least one agent is working, and it wraps the first W5 card.
  const workspace = page.locator(".fa-workspace").first();
  await expect(workspace).toBeVisible({ timeout: FIRST_CARD_TIMEOUT_MS });

  // The step workspace renders directly above a brief section (the assembly
  // lays active work over the section it builds).
  await expect(page.locator("section[data-stage]").first()).toBeVisible();
  expect(await page.locator("section[data-stage]").count()).toBeGreaterThanOrEqual(10);

  // Cancel via UI if a control exists; else leave the (cheap) mock run going.
  const cancel = page.getByRole("button", { name: /cancel/i }).first();
  if (await cancel.count()) {
    await cancel.click().catch(() => {});
  }
});
