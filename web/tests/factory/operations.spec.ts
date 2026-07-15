import { test, expect } from "@playwright/test";

test("operations workbench: cross-view local review and demo queue flow", async ({ page }) => {
  await page.goto("/operations");

  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toBeVisible();
  await expect(page.getByText("Demo workspace", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Local fixture state", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

  await page.getByRole("button", { name: /Audiences/ }).first().click();
  await page.getByRole("button", { name: /Nearby ward parents/ }).click();
  await expect(page.getByText(/44 fixture contacts include postcode-level relevance/)).toBeVisible();

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await expect(page.getByRole("heading", { name: /Parent update for nearby ward parents/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Supporter email/ })).toBeVisible();
  await page.getByRole("button", { name: /Decision-maker letter/ }).click();
  await expect(page.getByRole("heading", { name: "Decision-maker letter" }).first()).toBeVisible();
  await expect(page.getByText(/formal decision path is checked/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark ready for review" })).toBeDisabled();
  await page.getByRole("button", { name: /Press pitch/ }).click();
  await expect(page.getByRole("heading", { name: "Press pitch", level: 2 })).toBeVisible();
  await expect(page.getByText(/Media prompt for later escalation/i).nth(1)).toBeVisible();
  await page.getByRole("button", { name: /Supporter email/ }).click();
  await expect(page.getByLabel("Subject")).toBeVisible();

  const subject = page.getByLabel("Subject");
  const message = page.getByLabel("Message");
  await subject.fill("Back the permanent school street before the order lapses");
  await message.fill(
    [
      "Hello,",
      "",
      "Please support making the St John the Baptist school street permanent before the experimental order lapses.",
      "",
      "This demo draft still needs a campaigner to check council timing, order wording, and contact consent before any real outreach is considered.",
      "",
      "Thank you,",
      "Campaign Factory demo workspace",
    ].join("\n"),
  );

  await page.getByRole("button", { name: "preview", exact: true }).click();
  await expect(page.getByText("Back the permanent school street before the order lapses")).toBeVisible();
  await expect(page.getByText(/44 ready fixture contacts/)).toBeVisible();

  await page.getByRole("button", { name: "Mark ready for review" }).click();
  await expect(page.getByRole("heading", { name: "Human approval gate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs human review" })).toBeVisible();

  await page.getByRole("button", { name: "Approve as human reviewer" }).click();
  await expect(page.getByRole("heading", { name: "Approved by human" })).toBeVisible();

  await page.getByRole("button", { name: "Queue locally for demo" }).click();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.getByText(/It is not connected to an email provider/)).toBeVisible();

  const provider = page.getByRole("button", { name: /Email provider · Coming soon/ });
  await expect(provider).toBeDisabled();
  await expect(provider).toHaveAttribute("aria-describedby", "operations-provider-note");

  await page.reload();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.getByText("Back the permanent school street before the order lapses")).toBeVisible();

  await page.getByRole("button", { name: "Reset demo state" }).last().click();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toBeVisible();
  await page.getByRole("button", { name: /Outbox & schedule/ }).first().click();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
});

test("operations workbench: all sidebar destinations are navigable and designed", async ({ page }) => {
  await page.goto("/operations");

  const destinations = [
    { nav: /Overview/, heading: /Make the St John the Baptist school street/i },
    { nav: /Campaign brief/, heading: "Campaign brief" },
    { nav: /Objective & targets/, heading: "Objective & targets" },
    { nav: /Power map/, heading: "Power map" },
    { nav: /Strategy & tactics/, heading: "Strategy & tactics" },
    { nav: /Evidence & checks/, heading: "Evidence & checks" },
    { nav: /Audiences/, heading: "Choose the contact set" },
    { nav: /Contacts/, heading: "Fixture-backed contact readiness" },
    { nav: /Drafts/, heading: "Communications" },
    { nav: /Reviews & approvals/, heading: "Human approval gate" },
    { nav: /Outbox & schedule/, heading: /Nothing queued yet|One local queue item/ },
    { nav: /Responses & results/, heading: /Coming soon: response handling/ },
  ];

  for (const destination of destinations) {
    await page.getByRole("button", { name: destination.nav }).first().click();
    await expect(page.getByRole("heading", { name: destination.heading }).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Lorem");
  }

  await page.getByRole("button", { name: /Campaign brief/ }).first().click();
  await expect(page.getByText("What the fixture says", { exact: true })).toBeVisible();
  await expect(page.getByText("Operational use", { exact: true })).toBeVisible();
});

test("operations workbench: desktop and narrow layouts avoid horizontal overflow", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toBeVisible();

    const metrics = await page.evaluate(() => {
      const operationsNav = document.querySelector('nav[aria-label="Campaign operations views"]');
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      return {
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        navScrollWidth: operationsNav?.scrollWidth ?? 0,
        navClientWidth: operationsNav?.clientWidth ?? 0,
        headerBottom: header?.getBoundingClientRect().bottom ?? 0,
        mainTop: main?.getBoundingClientRect().top ?? 0,
      };
    });

    expect(metrics.bodyScrollWidth, `body should not overflow at ${viewport.width}px`).toBeLessThanOrEqual(
      metrics.viewportWidth,
    );
    expect(metrics.navScrollWidth, `operations nav should not overflow at ${viewport.width}px`).toBeLessThanOrEqual(
      metrics.navClientWidth,
    );
    expect(metrics.mainTop, `main should not be hidden under chrome at ${viewport.width}px`).toBeGreaterThanOrEqual(
      metrics.headerBottom - 1,
    );
  }
});
