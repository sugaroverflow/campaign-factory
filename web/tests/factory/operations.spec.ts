import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("operations workbench: cross-view local review and demo queue flow", async ({ page }) => {
  await page.goto("/operations?demo=fixture");

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
  await expect(page.getByRole("heading", { name: "Copy follows the runway" })).toBeVisible();
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
  await expect(page.getByLabel("Approval gates")).toContainText("External action blocked");
  await expect(page.getByLabel("Communication preview for approval")).toContainText("Back the permanent school street before the order lapses");
  await expect(page.getByRole("heading", { name: "Needs human review" })).toBeVisible();

  await page.getByRole("button", { name: "Approve as human reviewer" }).click();
  await expect(page.getByRole("heading", { name: "Approved by human" })).toBeVisible();

  await page.getByRole("button", { name: /Outbox & schedule/ }).first().click();
  await page.getByLabel("Local schedule intent").selectOption("tomorrow_morning");
  await page.getByRole("button", { name: /Reviews & approvals/ }).first().click();

  await page.getByRole("button", { name: "Queue locally for demo" }).click();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.getByLabel("Local dispatch runway")).toContainText("Provider");
  await expect(page.getByLabel("Local dispatch runway")).toContainText("Complete");
  await expect(page.getByText(/It is not connected to an email provider/)).toBeVisible();
  await expect(page.getByText("Demo intent: next school-run morning after provider setup", { exact: true })).toBeVisible();

  const provider = page.getByRole("button", { name: /Email provider · Coming soon/ });
  await expect(provider).toBeDisabled();
  await expect(provider).toHaveAttribute("aria-describedby", "operations-provider-note");

  await page.reload();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.getByText("Back the permanent school street before the order lapses")).toBeVisible();
  await expect(page.getByText("Demo intent: next school-run morning after provider setup", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reset demo state" }).last().click();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toBeVisible();
  await page.getByRole("button", { name: /Outbox & schedule/ }).first().click();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
});

test("operations workbench: all sidebar destinations are navigable and designed", async ({ page }) => {
  await page.goto("/operations?demo=fixture");

  await expect(page.getByRole("heading", { name: "Brief to safe local outbox, one stage at a time." })).toBeVisible();
  await page.getByRole("button", { name: /Evidence: Current, Checks in view/ }).click();
  await expect(page.getByRole("heading", { name: "Evidence & checks" })).toBeVisible();
  await page.getByRole("button", { name: /Power map/ }).first().click();
  await expect(page.getByRole("heading", { name: "Leicester transport decision route" })).toBeVisible();
  await page.getByRole("button", { name: /Overview/ }).first().click();
  await page.getByRole("button", { name: /Local outbox: Coming soon boundary, Provider off/ }).click();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();

  const destinations = [
    { nav: /Overview/, heading: /Make the St John the Baptist school street/i },
    { nav: /Action plan/, heading: "Owned local work from source checks" },
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

test("operations workbench: contacts, disabled boundaries, and legacy local state migration", async ({ page }) => {
  await page.goto("/operations?demo=fixture");
  await page.evaluate(() => {
    localStorage.removeItem("cf_operations_demo_v3");
    localStorage.setItem(
      "cf_operations_demo_v1",
      JSON.stringify({
        selectedSegment: "local_allies",
        subject: "Legacy supporter subject still migrates",
        body: "This is a long enough legacy message body to prove the old local storage shape can still load into the expanded workbench without losing safe state.",
        status: "review",
        mode: "preview",
        activeView: "contacts",
        queuedAt: null,
        activity: [{ id: "legacy", label: "Legacy local state loaded for migration check." }],
      }),
    );
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Fixture-backed contact readiness" })).toBeVisible();
  await expect(page.getByText("Clean Air Leicester", { exact: true })).toBeVisible();
  await page.getByLabel("Readiness filter").selectOption("blocked");
  await expect(page.getByText("Ward casework watcher", { exact: true })).toBeVisible();
  await expect(page.getByText("A. Patel")).toHaveCount(0);
  await page.getByLabel("Segment filter").selectOption("all");
  await expect(page.getByText("S. Hussain", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import contacts · Coming soon/ })).toBeDisabled();

  await page.getByRole("button", { name: /Responses & results/ }).first().click();
  await expect(page.getByText(/No live provider, response stream, external measurement/)).toBeVisible();
  await expect(page.getByText(/No result is claimed from this demo queue/)).toBeVisible();
});

test("operations workbench: all views avoid overflow across presentation sizes", async ({ page }) => {
  const destinations = [
    /Overview/,
    /Action plan/,
    /Campaign brief/,
    /Objective & targets/,
    /Power map/,
    /Strategy & tactics/,
    /Evidence & checks/,
    /Audiences/,
    /Contacts/,
    /Drafts/,
    /Reviews & approvals/,
    /Outbox & schedule/,
    /Responses & results/,
  ];

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/operations?demo=fixture");

    if (viewport.width < 1024) {
      await page.getByText(/Operations navigation/).click();
    }

    await page.getByRole("button", { name: /Overview/ }).first().click();
    await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toBeVisible();

    for (const destination of destinations) {
      await page.getByRole("button", { name: destination }).first().click();

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
          activeNavCount: document.querySelectorAll('button[aria-current="page"]').length,
        };
      });

      expect(metrics.bodyScrollWidth, `body should not overflow at ${viewport.width}px for ${destination}`).toBeLessThanOrEqual(
        metrics.viewportWidth,
      );
      expect(metrics.navScrollWidth, `operations nav should not overflow at ${viewport.width}px for ${destination}`).toBeLessThanOrEqual(
        metrics.navClientWidth,
      );
      expect(metrics.mainTop, `main should not be hidden under chrome at ${viewport.width}px for ${destination}`).toBeGreaterThanOrEqual(
        metrics.headerBottom - 1,
      );
      expect(metrics.activeNavCount, `one active nav item should be exposed for ${destination}`).toBeGreaterThan(0);
    }
  }
});

test("operations workbench: navigation focus and reduced motion remain accessible", async ({ page }) => {
  await page.goto("/operations?demo=fixture");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focusStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });

  expect(focusStyle.outlineStyle !== "none" || focusStyle.boxShadow !== "none").toBeTruthy();
  if (focusStyle.outlineStyle !== "none") expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedMotion = await page.locator(".ops-runway-stage").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { transitionDuration: style.transitionDuration, transform: style.transform };
  });

  expect(reducedMotion.transitionDuration).toBe("0s");
  expect(reducedMotion.transform).toBe("none");
});

test("operations portfolio: three curated public campaigns load independently", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      mediaStatus: "assembling",
      unresolved: 34,
      next: "Retrieve the official West Lancashire Borough Council planning application record",
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      mediaStatus: "ready",
      unresolved: 22,
      next: "Retrieve and verify the exact affordable housing percentage targets from Council papers",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      mediaStatus: "ready",
      unresolved: 17,
      next: "Attempt direct retrieval of the GLA decision report and Barnet Council committee minutes",
    },
  } as const;

  await page.route(/\/api\/factory\/runs\/([^/]+)\/documents$/, async (route) => {
    const id = route.request().url().match(/runs\/([^/]+)\/documents$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "ready", html: "", plainText: `${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`, isPack: false, sectionKeys: [], resourceCount: 0, flags: [] },
          { key: "media_pack", num: 2, name: "Media Pack", status: campaign.mediaStatus, html: "", plainText: "MEDIA PACK", isPack: true, sectionKeys: [], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Portfolio next gate", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 90, loadBearing: 70, verifiedLoadBearing: 70 - campaign.unresolved, unresolvedLoadBearing: campaign.unresolved },
        },
      }),
    });
  });
  await page.route(/\/api\/factory\/runs\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/runs\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ campaignId: id, status: campaigns[id].status, stateVersion: 1, lastSequence: 1, events: [] }),
    });
  });

  await page.goto("/operations");

  await expect(page.getByRole("heading", { name: /Three real campaigns, one operations portfolio/i })).toBeVisible();
  await expect(page.getByText("Keep KFC Out of Ormskirk", { exact: true })).toBeVisible();
  await expect(page.getByText("Build 5,000 affordable houses in Tower Hamlets in the next 3 years", { exact: true })).toBeVisible();
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet", { exact: true })).toBeVisible();
  await expect(page.getByText("Conference deep dive", { exact: true })).toBeVisible();
  await expect(page.getByText(/Partial but usable/).first()).toBeVisible();
  await expect(page.getByText(/Complete/).first()).toBeVisible();
  await expect(page.getByText(/no browser-local operations work yet for this campaign/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open workspace" }).first()).toHaveAttribute("href", "/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");
});

test("operations workbench: campaignId route loads a read-only public campaign source", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = [
    ["campaign_brief", "Campaign Brief", "ready", "Keep KFC Out of Ormskirk\n\nPlace: Ormskirk, Lancashire\n\nTHE PROBLEM\nThe source brief says the campaign must defend the council refusal against appeal risk."],
    ["objective_theory_of_change", "Objective and Theory of Change", "ready", "OBJECTIVE AND THEORY OF CHANGE\n\nDismiss any appeal and uphold West Lancashire Borough Council's refusal."],
    ["power_stakeholder_map", "Power and Stakeholder Map", "ready", "POWER AND STAKEHOLDER MAP\n\nPlanning Inspectorate, council officers, ward councillors, residents and applicant."],
    ["campaign_strategy", "Campaign Strategy", "ready", "CAMPAIGN STRATEGY\n\nVerify the official appeal position before escalating."],
    ["tactics_timeline", "Tactics and Timeline", "ready", "TACTICS AND TIMELINE\n\nPhase 0: retrieve the official appeal record."],
    ["organising_plan", "Organising Plan", "ready", "ORGANISING PLAN\n\nCoordinate residents without implying a connected CRM."],
    ["lobbying_pack", "Lobbying Pack", "ready", "LOBBYING PACK\n\nMeeting request email and briefing drafts are available for later local working copies."],
    ["media_pack", "Media Pack", "assembling", "MEDIA PACK\n\nNothing in this pack yet."],
    [
      "digital_pack",
      "Digital Campaign Pack",
      "ready",
      [
        "DIGITAL CAMPAIGN PACK",
        "",
        "Supporter email — status update",
        "",
        "Subject: Ormskirk KFC — what we know, what we don't",
        "",
        "Dear supporter,",
        "",
        "What we know: the council reportedly refused the KFC change-of-use application, but the official record still needs checking.",
        "",
        "What we don't know: whether an appeal to the Planning Inspectorate is live, or decided. We are not treating one uncorroborated report as fact.",
        "",
        "Before you send this, check",
        "",
        "- Explicitly frames the disputed appeal outcome as unconfirmed single-source information.",
        "",
        "Social media post set",
        "",
        "POST 1: Follow for verified updates on the Ormskirk KFC planning status.",
      ].join("\n"),
    ],
  ].map(([key, name, status, plainText], index) => ({
    key,
    num: index + 1,
    name,
    status,
    html: `<p>${plainText}</p>`,
    plainText,
    isPack: index >= 6,
    sectionKeys: [],
    resourceCount: key === "media_pack" ? 0 : index >= 6 ? 2 : 0,
    flags: [],
  }));

  await page.route(`**/api/factory/runs/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ campaignId, status: "partial", stateVersion: 44, lastSequence: 1909, events: [] }),
    });
  });
  await page.route(`**/api/factory/runs/${campaignId}/documents`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [
            {
              id: "appeal-check",
              description: "Check the Planning Inspectorate appeals database for any live or decided appeal on this site",
              reason: "Determines whether the campaign is defending a refusal on appeal, which changes tactics and timeline entirely",
              claimIds: ["C3"],
              affectedSections: ["decision_route", "strategy"],
            },
          ],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 77, loadBearing: 66, verifiedLoadBearing: 32, unresolvedLoadBearing: 34 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: /Keep KFC Out of Ormskirk into operations/i })).toBeVisible();
  await expect(page.getByText("Real campaign source", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Read-only public data", { exact: true })).toBeVisible();
  await expect(page.getByText(/Partial but usable · 8\/9 docs ready/)).toBeVisible();
  await expect(page.getByText(/34 unresolved key facts/i).first()).toBeVisible();
  await expect(page.getByText(/Check the Planning Inspectorate appeals database/i).first()).toBeVisible();
  await expect(page.getByText(/Media Pack: assembling/i)).toBeVisible();
  await page.getByRole("button", { name: /Evidence & checks/ }).first().click();
  await page.getByRole("button", { name: "Create appeal-status action" }).click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("Confirm Planning Inspectorate appeal status", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Source campaign 69f257b6-9913-4395-94f7-5c25b4b5fe95/)).toBeVisible();
  await page.getByLabel(/Status for Confirm Planning Inspectorate appeal status/).selectOption("in_progress");
  await expect(page.getByLabel(/Status for Confirm Planning Inspectorate appeal status/)).toHaveValue("in_progress");
  await expect(page.getByRole("link", { name: /Back to source brief|View original brief/ }).first()).toHaveAttribute(
    "href",
    `/factory/c/${campaignId}`,
  );
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await expect(page.getByLabel("Source pack resources")).toContainText("Supporter email — status update");
  await page.getByRole("button", { name: "Use in editable draft" }).first().click();
  await expect(page.getByRole("heading", { name: /Working copy: Supporter email — status update/i })).toBeVisible();
  await expect(page.getByText(/Copied from Digital Campaign Pack in campaign/)).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("Ormskirk KFC — what we know, what we don't");
  await expect(page.getByLabel("Message")).toHaveValue(/Dear supporter/);
  await expect(page.getByText(/unconfirmed single-source information/i)).toBeVisible();

  await page.getByRole("button", { name: "Use in editable draft" }).first().click();
  await expect(page.getByRole("heading", { name: /Working copy: Social media post set/i })).toBeVisible();
  await expect(page.getByLabel("Local working draft library")).toContainText("Supporter email — status update");
  await expect(page.getByLabel("Local working draft library")).toContainText("Social media post set");
  await page.getByLabel("Local working draft library").getByRole("button", { name: /Supporter email — status update/ }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("Ormskirk KFC — what we know, what we don't");

  await page.getByRole("button", { name: /Campaign brief/ }).first().click();
  await expect(page.getByText("What the source says", { exact: true })).toBeVisible();
  await expect(page.getByText(/source brief says the campaign must defend the council refusal/i)).toBeVisible();
});
