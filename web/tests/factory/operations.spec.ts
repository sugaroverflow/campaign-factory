import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { GET as getFactoryRun } from "@/app/api/factory/runs/[id]/route";
import { GET as getFactoryRunDocuments } from "@/app/api/factory/runs/[id]/documents/route";
import { GET as getOperationsSource } from "@/app/api/operations/sources/[id]/route";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const COMPILED_DOCUMENT_DISCLAIMER =
  "AI-generated draft — please verify all facts and figures before publishing or campaigning with this material.";
const COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE = "Some facts in this section couldn't be fully checked in time";
const SOURCE_FETCH_HEADERS = { accept: "application/json", "cache-control": "no-cache", pragma: "no-cache" };

function expectOperationsSourceClientRequest(request: { headers: () => Record<string, string> }) {
  expect(request.headers().accept).toContain("application/json");
  expect(request.headers()["cache-control"]).toBe("no-cache");
  expect(request.headers().pragma).toBe("no-cache");
}

function expectPublicSourceJsonBoundary(headers: Headers, label: string) {
  expect(headers.get("cache-control"), label).toBe("no-store");
  expect(headers.get("content-security-policy"), label).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  expect(headers.get("cross-origin-resource-policy"), label).toBe("same-origin");
  expect(headers.get("expires"), label).toBe("0");
  expect(headers.get("pragma"), label).toBe("no-cache");
  expect(headers.get("referrer-policy"), label).toBe("no-referrer");
  expect(headers.get("x-content-type-options"), label).toBe("nosniff");
}

function withCompiledDocumentDisclaimer(plainText: string) {
  return `${plainText}\n\n${COMPILED_DOCUMENT_DISCLAIMER}`;
}

function canonicalOperationsDocuments(campaignTitle = "Keep KFC Out of Ormskirk") {
  const rows = [
    ["campaign_brief", 1, "Campaign Brief", false, ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], `${campaignTitle}\n\nPlace: Ormskirk, Lancashire\n\nTHE PROBLEM\nCanonical source document shell.`],
    ["objective_theory_of_change", 2, "Objective and Theory of Change", false, ["objective"], "OBJECTIVE AND THEORY OF CHANGE\n\nVerify the public decision route before stronger claims are reused."],
    ["power_stakeholder_map", 3, "Power and Stakeholder Map", false, ["power", "pressure"], "POWER AND STAKEHOLDER MAP\n\nPublic source stakeholder clues only."],
    ["campaign_strategy", 4, "Campaign Strategy", false, ["strategy"], "CAMPAIGN STRATEGY\n\nKeep evidence boundaries visible."],
    ["tactics_timeline", 5, "Tactics and Timeline", false, ["tactics"], "TACTICS AND TIMELINE\n\nCheck the public record first."],
    ["organising_plan", 6, "Organising Plan", false, ["organising"], "ORGANISING PLAN\n\nNo imported contacts."],
    ["lobbying_pack", 7, "Lobbying Pack", true, [], "LOBBYING PACK\n\nMeeting request\n\nKeep source provenance attached."],
    ["media_pack", 8, "Media Pack", true, [], "MEDIA PACK\n\nAssembling."],
    ["digital_pack", 9, "Digital Campaign Pack", true, [], "DIGITAL CAMPAIGN PACK\n\nSupporter email\n\nSubject: Source update\n\nKeep verification notes visible."],
  ] as const;

  return rows.map(([key, num, name, isPack, sectionKeys, plainText]) => {
    const textWithDisclaimer = withCompiledDocumentDisclaimer(plainText);
    return {
      key,
      num,
      name,
      status: key === "media_pack" ? "assembling" : "ready",
      html: `<p>${textWithDisclaimer}</p>`,
      plainText: textWithDisclaimer,
      isPack,
      sectionKeys,
      resourceCount: isPack && key !== "media_pack" ? 1 : 0,
      flags: [],
    };
  });
}

function campaignOperationsDocuments(
  campaign: { title: string; place: string; next?: string; organising?: string },
  extraTextByKey: Partial<Record<string, string>> = {},
) {
  const briefText = `${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`;
  const defaultTextByKey: Partial<Record<string, string>> = {
    campaign_brief: briefText,
    tactics_timeline: campaign.next ? `TACTICS AND TIMELINE\n\n${campaign.next}\n\nType: research\n\nTarget: public source record` : undefined,
    organising_plan: campaign.organising,
    ...extraTextByKey,
  };

  return canonicalOperationsDocuments(campaign.title).map((document) => {
    const plainText = defaultTextByKey[document.key];
    if (!plainText) return document;
    const textWithDisclaimer = withCompiledDocumentDisclaimer(plainText);
    const flags = [...document.flags];
    if (document.isPack && textWithDisclaimer.includes("Before you send this, check") && !flags.includes("Contains explicit verification placeholders.")) {
      flags.push("Contains explicit verification placeholders.");
    }
    return {
      ...document,
      plainText: textWithDisclaimer,
      html: `<p>${textWithDisclaimer}</p>`,
      flags,
    };
  });
}

function campaignEvidence(
  nextChecks: Array<{ id: string; description: string; reason: string; affectedSections?: string[] }>,
  unresolvedLoadBearing = 0,
) {
  const claims = Array.from({ length: unresolvedLoadBearing }, (_, index) => ({
    id: `claim-${index + 1}`,
    text: `Unresolved source claim ${index + 1}`,
    type: "other",
    label: "Verification incomplete",
    loadBearing: true,
    confidence: "medium",
    sourceCount: 1,
    affectedOutputs: [],
  }));

  return {
    groups: claims.length > 0 ? [{ label: "Verification incomplete", count: claims.length, claims }] : [],
    conflicts: [],
    nextChecks: nextChecks.map((check) => ({ ...check, claimIds: [], affectedSections: check.affectedSections ?? [] })),
    terminalGaps: [],
    draftNotes: [],
    totals: {
      claims: claims.length,
      loadBearing: claims.length,
      verifiedLoadBearing: 0,
      unresolvedLoadBearing: claims.length,
    },
  };
}

test("factory public source routes: unavailable read store returns JSON instead of an empty 500", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFactoryDatabaseUrl = process.env.FACTORY_DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];

  delete process.env.FACTORY_DATABASE_URL;
  delete process.env.DATABASE_URL;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    for (const { name, route } of [
      {
        name: "run header",
        route: () => getFactoryRun(new Request(`http://localhost/api/factory/runs/${curatedId}`), { params: Promise.resolve({ id: curatedId }) }),
      },
      {
        name: "compiled documents",
        route: () => getFactoryRunDocuments(new Request(`http://localhost/api/factory/runs/${curatedId}/documents`), { params: Promise.resolve({ id: curatedId }) }),
      },
    ]) {
      const response = await route();
      expect(response.status, name).toBe(503);
      expect(response.headers.get("content-type"), name).toContain("application/json");
      expectPublicSourceJsonBoundary(response.headers, name);

      const body = (await response.json()) as { error?: string; detail?: string };
      expect(body.error, name).toBe("Factory read store unavailable");
      expect(body.detail, name).toContain("could not be reached");
      expect(body.detail, name).not.toContain("DATABASE_URL");
    }
    expect(loggedErrors).toHaveLength(2);
  } finally {
    console.error = originalConsoleError;
    if (originalFactoryDatabaseUrl === undefined) {
      delete process.env.FACTORY_DATABASE_URL;
    } else {
      process.env.FACTORY_DATABASE_URL = originalFactoryDatabaseUrl;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});

test("factory public source routes: invalid ids are no-store JSON misses", async () => {
  for (const { name, route } of [
    {
      name: "run header",
      route: () => getFactoryRun(new Request("http://localhost/api/factory/runs/not-a-run-id"), { params: Promise.resolve({ id: "not-a-run-id" }) }),
    },
    {
      name: "compiled documents",
      route: () => getFactoryRunDocuments(new Request("http://localhost/api/factory/runs/not-a-run-id/documents"), { params: Promise.resolve({ id: "not-a-run-id" }) }),
    },
  ]) {
    const response = await route();
    expect(response.status, name).toBe(404);
    expect(response.headers.get("content-type"), name).toContain("application/json");
    expectPublicSourceJsonBoundary(response.headers, name);

    const body = (await response.json()) as { error?: string };
    expect(body.error, name).toBe("Run not found");
  }
});

test("factory public source routes: non-GET methods are explicit read-only no-store responses", async ({ request }) => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  for (const { name, path } of [
    { name: "run header", path: `/api/factory/runs/${curatedId}` },
    { name: "compiled documents", path: `/api/factory/runs/${curatedId}/documents` },
  ]) {
    for (const { method, makeRequest } of [
      { method: "HEAD", makeRequest: () => request.fetch(path, { method: "HEAD" }) },
      { method: "OPTIONS", makeRequest: () => request.fetch(path, { method: "OPTIONS" }) },
      { method: "POST", makeRequest: () => request.post(path, { data: { campaignId: curatedId } }) },
      { method: "PUT", makeRequest: () => request.put(path, { data: { campaignId: curatedId } }) },
      { method: "PATCH", makeRequest: () => request.patch(path, { data: { campaignId: curatedId } }) },
      { method: "DELETE", makeRequest: () => request.delete(path) },
    ]) {
      const response = await makeRequest();
      expect(response.status(), `${name} ${method}`).toBe(405);
      expect(response.headers()["cache-control"], `${name} ${method}`).toBe("no-store");
      expect(response.headers()["content-security-policy"], `${name} ${method}`).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      expect(response.headers()["cross-origin-resource-policy"], `${name} ${method}`).toBe("same-origin");
      expect(response.headers().expires, `${name} ${method}`).toBe("0");
      expect(response.headers().pragma, `${name} ${method}`).toBe("no-cache");
      expect(response.headers()["referrer-policy"], `${name} ${method}`).toBe("no-referrer");
      expect(response.headers()["x-content-type-options"], `${name} ${method}`).toBe("nosniff");
      expect(response.headers().allow, `${name} ${method}`).toBe("GET");

      if (method === "HEAD") {
        expect(await response.body()).toHaveLength(0);
        continue;
      }

      const body = (await response.json()) as { error?: string; detail?: string };
      expect(body.error, `${name} ${method}`).toBe("Factory public source is read-only");
      expect(body.detail, `${name} ${method}`).toContain("GET behaviour only");
    }
  }
});

test("operations source API: invalid and non-curated ids are allow-list misses with no-store caching", async ({ request }) => {
  for (const id of ["not-a-campaign-id", "00000000-0000-4000-8000-000000000000"]) {
    const response = await request.get(`/api/operations/sources/${id}`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers().expires).toBe("0");
    expect(response.headers().pragma).toBe("no-cache");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Operations source not found");
    expect(body.detail).toContain("curated public operations campaigns");
    expect(body.sourceOrigin).toBeUndefined();
  }
});

test("operations source API: non-GET methods are blocked as read-only no-store responses", async ({ request }) => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  for (const { method, makeRequest } of [
    { method: "HEAD", makeRequest: () => request.fetch(`/api/operations/sources/${curatedId}`, { method: "HEAD" }) },
    { method: "OPTIONS", makeRequest: () => request.fetch(`/api/operations/sources/${curatedId}`, { method: "OPTIONS" }) },
    { method: "POST", makeRequest: () => request.post(`/api/operations/sources/${curatedId}`, { data: { campaignId: curatedId } }) },
    { method: "PUT", makeRequest: () => request.put(`/api/operations/sources/${curatedId}`, { data: { campaignId: curatedId } }) },
    { method: "PATCH", makeRequest: () => request.patch(`/api/operations/sources/${curatedId}`, { data: { campaignId: curatedId } }) },
    { method: "DELETE", makeRequest: () => request.delete(`/api/operations/sources/${curatedId}`) },
  ]) {
    const response = await makeRequest();
    expect(response.status()).toBe(405);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers().expires).toBe("0");
    expect(response.headers().pragma).toBe("no-cache");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers().allow).toBe("GET");

    if (method === "HEAD") {
      expect(await response.body()).toHaveLength(0);
      continue;
    }

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Operations source is read-only");
    expect(body.detail).toContain("read-only GET behaviour only");
    expect(body.sourceOrigin).toBeUndefined();
  }
});

test("operations source API: configured source origin must remain the canonical allow-listed origin", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalEnv = process.env.OPERATIONS_SOURCE_ORIGIN;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Source reads must not run when the configured origin is outside the allow-list.");
  }) as typeof fetch;

  try {
    for (const origin of [
      "https://campaign-factory.vercel.app/api/factory",
      "https://example.invalid",
      "https://user:pass@campaign-factory.vercel.app",
      "javascript:alert(1)",
    ]) {
      process.env.OPERATIONS_SOURCE_ORIGIN = origin;
      const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(response.headers.get("expires")).toBe("0");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");

      const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string };
      expect(body.error).toBe("Operations source origin unavailable");
      expect(body.detail).toContain("not allow-listed");
      expect(body.sourceOrigin).toBeUndefined();
    }
  } finally {
    if (originalEnv === undefined) {
      delete process.env.OPERATIONS_SOURCE_ORIGIN;
    } else {
      process.env.OPERATIONS_SOURCE_ORIGIN = originalEnv;
    }
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: unavailable source run reads fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ error: "Factory read store unavailable", detail: "The Factory read store could not be reached." }, { status: 503 });
    }

    throw new Error("Documents must not hydrate when the source run read is unavailable.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned HTTP 503`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: missing source runs fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    throw new Error("Documents must not hydrate when the source run is missing.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned HTTP 404`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: empty upstream run failures stay source-unavailable before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return new Response("", { status: 500 });
    }

    throw new Error("Documents must not hydrate when the source run returns an empty upstream failure.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(500);
    expectPublicSourceJsonBoundary(response.headers, "empty source run failure");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned HTTP 500`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: rate-limited source runs preserve retry guidance and stop document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ error: "Too many source reads", detail: "Try again shortly." }, { status: 429, headers: { "Retry-After": "120" } });
    }

    throw new Error("Documents must not hydrate while the source run header is rate-limited.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(429);
    expectPublicSourceJsonBoundary(response.headers, "rate-limited source run");
    expect(response.headers.get("retry-after")).toBe("120");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned HTTP 429`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: source run retry guidance rejects non-numeric upstream headers", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json(
        { error: "Too many source reads", detail: "Try again shortly." },
        { status: 429, headers: { "Retry-After": "Fri, 17 Jul 2026 06:30:00 GMT" } },
      );
    }

    throw new Error("Documents must not hydrate while unsafe retry guidance is rejected.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(429);
    expectPublicSourceJsonBoundary(response.headers, "rate-limited source run with unsafe retry guidance");
    expect(response.headers.get("retry-after")).toBeNull();

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned HTTP 429`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: non-terminal source runs fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "running", stateVersion: 1, lastSequence: 1, events: [] });
    }

    throw new Error("Documents must not hydrate while the source run is still non-terminal.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as { error?: string; detail?: string; runStatus?: string; sourceOrigin?: string; documents?: unknown[] };
    expect(body.error).toBe("Campaign source not ready");
    expect(body.detail).toContain("This campaign is running");
    expect(body.runStatus).toBe("running");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream run redirects fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://example.invalid/api/factory/runs/redirected" },
      });
    }

    throw new Error("Documents should not be requested after a redirected source run header.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    expect(response.headers.get("location")).toBeNull();

    const bodyText = await response.text();
    expect(bodyText).not.toContain("example.invalid");
    const body = JSON.parse(bodyText) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain("redirected");
    expect(body.detail).not.toContain("example.invalid");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream document redirects fail closed after the validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return new Response(null, {
        status: 307,
        headers: { Location: "https://example.invalid/api/factory/runs/redirected/documents" },
      });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(response.headers.get("location")).toBeNull();

    const bodyText = await response.text();
    expect(bodyText).not.toContain("example.invalid");
    const body = JSON.parse(bodyText) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain("documents redirected");
    expect(body.detail).not.toContain("example.invalid");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream run responses require JSON content type before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return new Response(JSON.stringify({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] }), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    throw new Error("Documents should not be requested after a non-JSON source run response.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain("non-JSON content type");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream document responses require JSON content type after the validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return new Response(JSON.stringify({ documents: canonicalOperationsDocuments(), evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } } }), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain("non-JSON content type");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: malformed JSON source runs fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return new Response("{not valid json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error("Documents must not hydrate after a malformed JSON source run response.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expectPublicSourceJsonBoundary(response.headers, "malformed JSON source run");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} returned malformed JSON.`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: malformed JSON source documents fail closed after the validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return new Response("{not valid json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expectPublicSourceJsonBoundary(response.headers, "malformed JSON source documents");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source contract mismatch");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned malformed JSON.`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: unavailable source documents preserve read-store status after a validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return Response.json({ error: "Factory read store unavailable", detail: "The public campaign documents could not be reached." }, { status: 503 });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(503);
    expectPublicSourceJsonBoundary(response.headers, "document read store unavailable");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned HTTP 503`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: empty upstream document failures stay source-unavailable after a validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return new Response("", { status: 500 });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(500);
    expectPublicSourceJsonBoundary(response.headers, "empty document source failure");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned HTTP 500`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: rate-limited source documents preserve retry status after a validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return Response.json({ error: "Too many source reads", detail: "Try again shortly." }, { status: 429, headers: { "Retry-After": "120" } });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(429);
    expectPublicSourceJsonBoundary(response.headers, "document source rate limit");
    expect(response.headers.get("retry-after")).toBe("120");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned HTTP 429`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: document retry guidance rejects non-numeric upstream headers after a validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return Response.json(
        { error: "Too many source reads", detail: "Try again shortly." },
        { status: 429, headers: { "Retry-After": "999999" } },
      );
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(429);
    expectPublicSourceJsonBoundary(response.headers, "document source rate limit with unsafe retry guidance");
    expect(response.headers.get("retry-after")).toBeNull();

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned HTTP 429`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: denied source documents preserve upstream status after a validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return Response.json({ error: "Source access denied", detail: "The public source rejected this preview read." }, { status: 403 });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(403);
    expectPublicSourceJsonBoundary(response.headers, "denied document source");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents returned HTTP 403`);
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream run network failures fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      throw new Error("Leaked upstream credential https://user:pass@example.invalid/private-source");
    }

    throw new Error("Documents must not hydrate after the source run network read fails.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[] };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain("could not be reached.");
    expect(body.detail).toContain(`/api/factory/runs/${curatedId}`);
    expect(body.detail).not.toContain("Leaked upstream credential");
    expect(body.detail).not.toContain("user:pass");
    expect(body.detail).not.toContain("example.invalid");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: upstream run timeouts fail closed before document hydration", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requestedUrls: string[] = [];
  const clearedTimers: unknown[] = [];

  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
    clearedTimers.push(timer);
  }) as typeof clearTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);
    expect(init?.signal?.aborted).toBe(true);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      throw new Error("Timed-out upstream source should not leak this detail.");
    }

    throw new Error("Documents must not hydrate after the source run times out.");
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(504);
    expectPublicSourceJsonBoundary(response.headers, "timeout");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[] };
    expect(body.error).toBe("Campaign source run unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId} timed out after 10 seconds.`);
    expect(body.detail).not.toContain("Timed-out upstream source");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(requestedUrls).toEqual([`https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`]);
    expect(clearedTimers).toEqual([0]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("operations source API: upstream document timeouts fail closed after the validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requestedUrls: string[] = [];
  const clearedTimers: unknown[] = [];
  let timeoutIndex = 0;

  globalThis.setTimeout = ((callback: TimerHandler) => {
    timeoutIndex += 1;
    if (timeoutIndex === 2 && typeof callback === "function") callback();
    return timeoutIndex as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
    clearedTimers.push(timer);
  }) as typeof clearTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      expect(init?.signal?.aborted).toBe(false);
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error("Timed-out document source should not leak this detail.");
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(504);
    expectPublicSourceJsonBoundary(response.headers, "document timeout");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain(`Read-only source /api/factory/runs/${curatedId}/documents timed out after 10 seconds.`);
    expect(body.detail).not.toContain("Timed-out document source");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
    expect(clearedTimers).toEqual([1, 2]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("operations source API: upstream document network failures fail closed after the validated run header", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      throw new Error("Leaked document store credential https://user:pass@example.invalid/private-documents");
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}`), { params: Promise.resolve({ id: curatedId }) });
    expect(response.status).toBe(502);
    expectPublicSourceJsonBoundary(response.headers, "document network failure");

    const body = (await response.json()) as { error?: string; detail?: string; sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.error).toBe("Campaign source documents unavailable");
    expect(body.detail).toContain("could not be reached.");
    expect(body.detail).toContain(`/api/factory/runs/${curatedId}/documents`);
    expect(body.detail).not.toContain("Leaked document store credential");
    expect(body.detail).not.toContain("user:pass");
    expect(body.detail).not.toContain("example.invalid");
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toBeUndefined();
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations source API: successful source responses keep same-origin resource policy and ignore arbitrary query URLs", async () => {
  const curatedId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const sourceReadOptions: Array<{ method?: string; credentials?: RequestCredentials; referrerPolicy?: ReferrerPolicy }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrls.push(String(input));
    sourceReadOptions.push({ method: init?.method, credentials: init?.credentials, referrerPolicy: init?.referrerPolicy });
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("manual");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.headers).toEqual(SOURCE_FETCH_HEADERS);

    if (String(input).endsWith(`/api/factory/runs/${curatedId}`)) {
      return Response.json({ campaignId: curatedId, status: "partial", stateVersion: 1, lastSequence: 0, events: [] });
    }

    if (String(input).endsWith(`/api/factory/runs/${curatedId}/documents`)) {
      return Response.json({
        documents: canonicalOperationsDocuments(),
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      });
    }

    throw new Error(`Unexpected source request: ${String(input)}`);
  }) as typeof fetch;

  try {
    const response = await getOperationsSource(new Request(`http://localhost/api/operations/sources/${curatedId}?url=https%3A%2F%2Fexample.com%2Fanything%3Fsecret%3D1`), {
      params: Promise.resolve({ id: curatedId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as { sourceOrigin?: string; documents?: unknown[]; sourceRunUnavailable?: boolean };
    expect(body.sourceOrigin).toBe("https://campaign-factory.vercel.app");
    expect(body.documents).toHaveLength(9);
    expect(body.sourceRunUnavailable).toBeUndefined();
    expect(requestedUrls).toEqual([
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}`,
      `https://campaign-factory.vercel.app/api/factory/runs/${curatedId}/documents`,
    ]);
    expect(sourceReadOptions).toEqual([
      { method: "GET", credentials: "omit", referrerPolicy: "no-referrer" },
      { method: "GET", credentials: "omit", referrerPolicy: "no-referrer" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download JSON" }).click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/sample-campaign-operations-pack-\d{4}-\d{2}-\d{2}\.json/);
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).toBeTruthy();
  const pack = JSON.parse(await readFile(jsonPath!, "utf8")) as { boundary: { providerSending: string }; outbox: { queuedCount: number }; selectedAudience: { name: string } };
  expect(pack.boundary.providerSending).toBe("Not connected");
  expect(pack.outbox.queuedCount).toBe(1);
  expect(pack.selectedAudience.name).toBe("Nearby ward parents");

  const [markdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  expect(markdownDownload.suggestedFilename()).toMatch(/sample-campaign-operations-pack-\d{4}-\d{2}-\d{2}\.md/);

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

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    expectOperationsSourceClientRequest(route.request());
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    const documents = canonicalOperationsDocuments(campaign.title).map((document) =>
      document.key === "campaign_brief"
        ? {
            ...document,
            html: `<p>${withCompiledDocumentDisclaimer(`${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`)}</p>`,
            plainText: withCompiledDocumentDisclaimer(`${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`),
          }
        : document.key === "media_pack"
          ? { ...document, status: campaign.mediaStatus }
          : document,
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 1, lastSequence: 1, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Portfolio next gate", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
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
  await expect(page.getByRole("link", { name: "View source brief" }).first()).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95",
  );
});

test("operations portfolio: manual refresh ignores stale source responses", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const fallbackCampaigns = {
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      unresolved: 22,
      next: "Verify the exact affordable housing targets from council papers",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      unresolved: 17,
      next: "Retrieve the GLA decision report and Barnet committee minutes",
    },
  } as const;
  let ormskirkRequests = 0;
  let fulfillStaleOrmskirk: (() => Promise<void>) | null = null;

  const payloadFor = (id: string, campaign: { title: string; place: string; status: string; unresolved: number; next: string }, sequence = 1) => ({
    sourceOrigin: "https://campaign-factory.vercel.app",
    run: { campaignId: id, status: campaign.status, stateVersion: sequence, lastSequence: sequence, events: [] },
    documents: canonicalOperationsDocuments(campaign.title).map((document) => {
      if (document.key === "campaign_brief") {
        const plainText = withCompiledDocumentDisclaimer(`${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nPortfolio refresh race fixture.`);
        return { ...document, html: `<p>${plainText}</p>`, plainText };
      }
      return document.key === "media_pack" ? { ...document, status: "ready" } : document;
    }),
    evidence: {
      groups: [],
      conflicts: [],
      nextChecks: [{ id: "next", description: campaign.next, reason: "Portfolio refresh race", claimIds: [], affectedSections: [] }],
      terminalGaps: [],
      draftNotes: [],
      totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
    },
  });

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1];
    if (id === ormskirkId) {
      ormskirkRequests += 1;
      if (ormskirkRequests === 1) {
        await new Promise<void>((resolve) => {
          fulfillStaleOrmskirk = async () => {
            await route.fulfill({
              contentType: "application/json",
              body: JSON.stringify(
                payloadFor(
                  id,
                  {
                    title: "Stale Ormskirk source response",
                    place: "Old Ormskirk",
                    status: "partial",
                    unresolved: 34,
                    next: "This older source response must not win the refresh race",
                  },
                  1,
                ),
              ),
            }).catch(() => undefined);
            resolve();
          };
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          payloadFor(
            id,
            {
              title: "Fresh Ormskirk source response",
              place: "Ormskirk, Lancashire",
              status: "partial",
              unresolved: 33,
              next: "Fresh refresh response wins before the stale source returns",
            },
            2,
          ),
        ),
      });
      return;
    }

    const campaign = fallbackCampaigns[id as keyof typeof fallbackCampaigns];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payloadFor(id!, campaign)) });
  });

  await page.goto("/operations");
  await page.getByRole("button", { name: "Refresh portfolio" }).click();
  await expect(page.getByText("Fresh Ormskirk source response", { exact: true })).toBeVisible();
  await fulfillStaleOrmskirk?.();
  await expect(page.getByText("Stale Ormskirk source response", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Fresh refresh response wins before the stale source returns")).toBeVisible();
});

test("operations portfolio: local signals reflect only genuine campaign-local work", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      next: "Check Ormskirk appeal status before public escalation",
      unresolved: 34,
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      next: "Verify Tower Hamlets housing targets before local operations",
      unresolved: 22,
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      next: "Retrieve Barnet decision records before local escalation",
      unresolved: 17,
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 3, lastSequence: 11, events: [] },
        documents: campaignOperationsDocuments(campaign),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Portfolio local signal regression", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=evidence");
  await page.getByLabel("Source next checks ledger").getByRole("button", { name: "Create action" }).first().click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("Check Ormskirk appeal status before public escalation", { exact: true }).first()).toBeVisible();

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const ormskirkRow = portfolio.locator("article", { hasText: "Keep KFC Out of Ormskirk" });
  const towerHamletsRow = portfolio.locator("article", { hasText: "Build 5,000 affordable houses" });
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });

  await expect(ormskirkRow).toContainText("Local signals: 1 action.");
  await expect(towerHamletsRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(ormskirkRow).not.toContainText("working draft");
});

test("operations workbench: resetting one real campaign leaves other campaign-local work intact", async ({ page }) => {
  await page.goto("/operations?demo=fixture&view=evidence");
  await page.getByRole("button", { name: "Create appeal-status action" }).click();
  await expect(page.getByText("Verify council order status", { exact: true }).first()).toBeVisible();

  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      next: "Check Ormskirk appeal status before public escalation",
      unresolved: 34,
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      next: "Check Tower Hamlets affordable housing target papers",
      unresolved: 22,
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      next: "Check Barnet GLA and committee decision records",
      unresolved: 17,
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 5, lastSequence: 15, events: [] },
        documents: campaignOperationsDocuments(campaign),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Reset isolation regression", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=evidence");
  await page.getByLabel("Source next checks ledger").getByRole("button", { name: "Create action" }).first().click();
  await expect(page.getByText("Check Ormskirk appeal status before public escalation", { exact: true }).first()).toBeVisible();

  await page.goto("/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153&view=evidence");
  await page.getByLabel("Source next checks ledger").getByRole("button", { name: "Create action" }).first().click();
  await expect(page.getByText("Check Barnet GLA and committee decision records", { exact: true }).first()).toBeVisible();

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=outbox");
  await page.getByRole("button", { name: "Reset local workspace" }).last().click();
  await expect(page.getByText("Local source workspace state reset; public campaign data was not changed.")).toBeVisible();
  await page.getByRole("button", { name: /Action plan/ }).first().click();
  await expect(page.getByText("No local actions yet. Create the primary source-check action to turn the campaign boundary into owned work.")).toBeVisible();
  await expect(page.getByText("Actions: 0 local items")).toBeVisible();

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const ormskirkRow = portfolio.locator("article", { hasText: "Keep KFC Out of Ormskirk" });
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });

  await expect(ormskirkRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).toContainText("Local signals: 1 action.");

  await page.goto("/operations?demo=fixture&view=actions");
  await expect(page.getByText("Verify council order status", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Actions: 1 local item")).toBeVisible();
});

test("operations portfolio: one failed source does not blank usable campaigns", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      next: "Retrieve the official West Lancashire Borough Council planning application record",
      unresolved: 34,
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      next: "Attempt direct retrieval of the GLA decision report and Barnet Council committee minutes",
      unresolved: 17,
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    if (id === "57678ae0-29fd-4b4b-8a53-5c711cdb21cf") {
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "90" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Campaign source documents unavailable", detail: "Preview source returned HTTP 429.", sourceOrigin: "https://campaign-factory.vercel.app" }),
      });
      return;
    }
    const campaign = campaigns[id];
    const documents = canonicalOperationsDocuments(campaign.title).map((document) =>
      document.key === "campaign_brief"
        ? {
            ...document,
            html: `<p>${withCompiledDocumentDisclaimer(`${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`)}</p>`,
            plainText: withCompiledDocumentDisclaimer(`${campaign.title}\n\nPlace: ${campaign.place}\n\nTHE PROBLEM\nSource-backed campaign problem.`),
          }
        : document,
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 1, lastSequence: 1, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Portfolio next gate", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations");

  await expect(page.getByRole("heading", { name: /Three real campaigns, one operations portfolio/i })).toBeVisible();
  await expect(page.getByText("Keep KFC Out of Ormskirk", { exact: true })).toBeVisible();
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet", { exact: true })).toBeVisible();
  await expect(page.getByText("Campaign source unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/Preview source returned HTTP 429/)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toBeVisible();
  await expect(page.getByText("Source retry guidance: try again after 90 seconds.")).toBeVisible();
  await expect(page.getByText("https://campaign-factory.vercel.app", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Open workspace" }).nth(0)).toHaveAttribute("href", "/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");
  await expect(page.getByRole("link", { name: "Open workspace" }).nth(2)).toHaveAttribute("href", "/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153");
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View source brief" }).nth(1)).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/57678ae0-29fd-4b4b-8a53-5c711cdb21cf",
  );
});

test("operations workspace: failed direct source load keeps canonical source brief links", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Campaign source documents unavailable", detail: "Preview source returned HTTP 500.", sourceOrigin: "https://campaign-factory.vercel.app" }),
    });
  });

  await page.goto("/operations?campaignId=57678ae0-29fd-4b4b-8a53-5c711cdb21cf");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Preview source returned HTTP 500/)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toBeVisible();
  await expect(page.getByText("https://campaign-factory.vercel.app", { exact: true })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/57678ae0-29fd-4b4b-8a53-5c711cdb21cf",
  );
  await expect(page.getByRole("link", { name: "Back to source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/57678ae0-29fd-4b4b-8a53-5c711cdb21cf",
  );
});

test("operations workspace: source retry guidance is visible without fixture fallback", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "120" },
      contentType: "application/json",
      body: JSON.stringify({ error: "Campaign source run unavailable", detail: "Read-only source is rate-limited.", sourceOrigin: "https://campaign-factory.vercel.app" }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("Read-only source is rate-limited.")).toBeVisible();
  await expect(page.getByText("Source retry guidance: try again after 120 seconds.")).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workspace: browser source loads omit local cookies", async ({ page, context }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  await context.addCookies([{ name: "cf_private_probe", value: "do-not-forward", url: "http://localhost:3000" }]);

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    expectOperationsSourceClientRequest(route.request());
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 1, lastSequence: 1, events: [] },
        documents: canonicalOperationsDocuments(),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "appeal-check", description: "Confirm official appeal status before the next phase", reason: "Source-specific next gate", claimIds: [], affectedSections: ["strategy"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: /Keep KFC Out of Ormskirk into operations/i })).toBeVisible();
  await expect(page.getByText("Confirm official appeal status before the next phase").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workspace: non-JSON source responses stay as no-fixture-fallback failures", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Preview error shell</title><p>not json</p>",
    });
  });

  await page.goto("/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Operations source adapter returned a non-JSON content type \(HTTP 200\)/)).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/6b54225d-afa3-41d1-b053-89741094f153",
  );
});

test("operations workspace: source adapter redirects are not followed in the browser", async ({ page }) => {
  let redirectedProbeRequests = 0;
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 302,
      headers: { Location: "/api/operations/redirect-probe?target=https://example.invalid/leaked-source" },
      body: "",
    });
  });
  await page.route("**/api/operations/redirect-probe**", async (route) => {
    redirectedProbeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: "6b54225d-afa3-41d1-b053-89741094f153", status: "completed", stateVersion: 99, lastSequence: 99, events: [] },
        documents: canonicalOperationsDocuments("Redirected source should not hydrate Barnet"),
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto("/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Operations source adapter returned a non-JSON content type/)).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText("Redirected source should not hydrate Barnet")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  expect(redirectedProbeRequests).toBe(0);
});

test("operations workspace: non-JSON rate limits preserve retry guidance", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "75" },
      contentType: "text/html",
      body: "<!doctype html><title>Preview rate limit</title><p>try later</p>",
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Operations source adapter returned a non-JSON content type \(HTTP 429\)/)).toBeVisible();
  await expect(page.getByText("Source retry guidance: try again after 75 seconds.")).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workspace: malformed JSON source responses stay as no-fixture-fallback failures", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{not valid json",
    });
  });

  await page.goto("/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Operations source adapter returned malformed JSON \(HTTP 200\)/)).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/6b54225d-afa3-41d1-b053-89741094f153",
  );
});

test("operations workspace: malformed JSON rate limits preserve retry guidance", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "45" },
      contentType: "application/json",
      body: "{not valid json",
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Operations source adapter returned malformed JSON \(HTTP 429\)/)).toBeVisible();
  await expect(page.getByText("Source retry guidance: try again after 45 seconds.")).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workspace: upstream 404 source failures keep checked source diagnostics", async ({ page }) => {
  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Campaign source run unavailable", detail: "Read-only source /api/factory/runs/69f257b6-9913-4395-94f7-5c25b4b5fe95 returned HTTP 404.", sourceOrigin: "https://campaign-factory.vercel.app" }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText(/Read-only source \/api\/factory\/runs\/69f257b6-9913-4395-94f7-5c25b4b5fe95 returned HTTP 404/)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toBeVisible();
  await expect(page.getByText("https://campaign-factory.vercel.app", { exact: true })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/No curated public campaign source was found/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations portfolio: source labels carry through workspace switching without shared fixture contacts", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      next: "Retrieve the official West Lancashire Borough Council planning application record",
      organising: "ORGANISING PLAN\n\nResidents, ward councillors, local businesses and planning-watch volunteers need different asks.",
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      next: "Retrieve and verify the exact affordable housing percentage targets from Council papers",
      organising: "ORGANISING PLAN\n\nHousing campaigners, tenants, councillors and planning committee observers need separate routes.",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      next: "Attempt direct retrieval of the GLA decision report and Barnet Council committee minutes",
      organising: "ORGANISING PLAN\n\nLeisure users, local residents and planning decision watchers are audience clues, not imported contacts.",
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 1, lastSequence: 1, events: [] },
        documents: campaignOperationsDocuments(campaign, {
          power_stakeholder_map: [
            "POWER MAP",
            "",
            "Decides",
            `${campaign.title} planning lead — source power-map mention only.`,
            "Power: formal decision-route influence",
            "Position: must be researched before any contact claim exists",
            "Cares about: traceable public decision evidence",
            "What we ask of them: confirm the current public record before campaign copy escalates",
            "Recommended approach: create a local review question, not an imported contact task",
          ].join("\n"),
          digital_pack: `DIGITAL PACK\n\nAudience notes for ${campaign.title}.`,
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Switcher route next gate", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=contacts");

  await expect(page.getByRole("heading", { name: "Contact import boundary for this campaign" })).toBeVisible();
  await expect(page.getByText("No imported contacts for Keep KFC Out of Ormskirk")).toBeVisible();
  await expect(page.getByLabel("Source audience and stakeholder contact boundary")).toContainText("Named stakeholders from the source power map");
  await expect(page.getByLabel("Source audience and stakeholder contact boundary")).toContainText("Keep KFC Out of Ormskirk planning lead");
  await expect(page.getByLabel("Source audience and stakeholder contact boundary")).toContainText("Source ask: confirm the current public record before campaign copy escalates");
  await expect(page.getByLabel("Source audience and stakeholder contact boundary")).toContainText("Approach: create a local review question, not an imported contact task");
  await expect(page.getByLabel("Source audience and stakeholder contact boundary")).toContainText("source mention only; no contact record or consent state exists");
  await expect(page.getByRole("button", { name: "Reset local workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset demo state" })).toHaveCount(0);
  await expect(page.getByLabel("Campaign switcher")).toContainText("Current: KFC Out of Ormskirk");
  await expect(page.getByLabel("Campaign switcher")).toContainText("Stop the leisure park redevelopment in Barnet");
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.getByRole("button", { name: /Power map/ }).first().click();
  await expect(page.getByLabel("Source-backed stakeholder lanes")).toContainText("Source ask: confirm the current public record before campaign copy escalates");
  await expect(page.getByLabel("Source-backed stakeholder lanes")).toContainText("Approach: create a local review question, not an imported contact task");

  await page.getByRole("button", { name: /Audiences/ }).first().click();
  await expect(page.getByRole("heading", { name: "Plan audiences from this campaign source" })).toBeVisible();
  await expect(page.getByLabel("Source audience signals")).toContainText("Organising base");
  await expect(page.getByLabel("Audience segments")).toContainText("Residents");
  await expect(page.getByLabel("Audience segments")).toContainText("ward councillors");
  await expect(page.getByLabel("Audience segments")).toContainText("No imported contacts are counted");

  await page.getByRole("button", { name: /Contacts/ }).first().click();
  await page.getByRole("link", { name: /Stop the leisure park redevelopment in Barnet/ }).click();
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contact import boundary for this campaign" })).toBeVisible();
  await expect(page.getByText("No imported contacts for Stop the leisure park redevelopment in Barnet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset local workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset demo state" })).toHaveCount(0);
  await expect(page.getByLabel("Campaign switcher")).toContainText("Current: Stop the leisure park redevelopment in Barnet");
  await expect(page.getByRole("link", { name: "Portfolio" })).toHaveAttribute("href", "/operations");
});

test("operations workbench: source problem and theory fields hydrate the full context views", async ({ page }) => {
  const campaignId = "57678ae0-29fd-4b4b-8a53-5c711cdb21cf";
  const campaign = {
    title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
    place: "Tower Hamlets, London",
    status: "partial",
    next: "Verify the exact affordable housing delivery route in council papers",
  };

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: campaign.status, stateVersion: 4, lastSequence: 2, events: [] },
        documents: campaignOperationsDocuments(campaign, {
          campaign_brief: [
            campaign.title,
            "",
            `Place: ${campaign.place}`,
            "",
            "THE PROBLEM",
            "Tower Hamlets has an acute affordable housing shortfall and residents need a source-backed route for holding decision-makers to account.",
          ].join("\n"),
          objective_theory_of_change: [
            "OBJECTIVE AND THEORY OF CHANGE",
            "",
            "Decision-maker: Tower Hamlets Mayor and Cabinet housing route",
            "",
            "Specific action: adopt and publish a delivery plan for 5,000 affordable homes",
            "",
            "Minimum viable win: a dated council commitment with published delivery milestones",
            "",
            "Theory of change: if residents, tenants and planning-watch allies use verified housing evidence to press the Mayor and Cabinet route, the council has to publish clearer affordable-home milestones before local support is escalated.",
          ].join("\n"),
        }),
        evidence: campaignEvidence([{ id: "housing-route", description: campaign.next, reason: "Objective context hydration", affectedSections: ["objective"] }], 2),
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}&view=brief`);
  await expect(page.getByRole("heading", { name: "Campaign brief" })).toBeVisible();
  await expect(page.getByText("Problem", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tower Hamlets has an acute affordable housing shortfall").first()).toBeVisible();
  await expect(page.getByText("School-gate families")).toHaveCount(0);

  await page.getByRole("button", { name: /Objective & targets/ }).first().click();
  await expect(page.getByRole("heading", { name: "Objective & targets" })).toBeVisible();
  await expect(page.getByText("Theory of change", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("if residents, tenants and planning-watch allies use verified housing evidence").first()).toBeVisible();
  await expect(page.getByText("Mayor and Cabinet housing route").first()).toBeVisible();
  await expect(page.getByText("published delivery milestones").first()).toBeVisible();
});

test("operations workbench: campaign switching isolates local actions and source working copies", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      check: "Check Ormskirk appeal status before public escalation",
      packTitle: "Ormskirk supporter email",
      subject: "Ormskirk KFC source update",
      body: "Dear supporter,\n\nCheck the official appeal status before any local outreach is considered.",
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      check: "Check Tower Hamlets affordable housing target papers",
      packTitle: "Tower Hamlets supporter email",
      subject: "Tower Hamlets homes source update",
      body: "Dear supporter,\n\nCheck council housing targets before any local outreach is considered.",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      check: "Check Barnet leisure park decision report before local escalation",
      packTitle: "Barnet supporter email",
      subject: "Barnet leisure park source update",
      body: "Dear supporter,\n\nCheck the decision report before any local outreach is considered.",
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 12, lastSequence: 3, events: [] },
        documents: campaignOperationsDocuments(
          { ...campaign, next: campaign.check },
          {
            digital_pack: [`DIGITAL CAMPAIGN PACK`, "", campaign.packTitle, "", `Subject: ${campaign.subject}`, "", campaign.body, "", "Before you send this, check", "", "- Keep the public source boundary attached."].join("\n"),
          },
        ),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "campaign-check", description: campaign.check, reason: "Campaign-local action isolation", claimIds: [], affectedSections: ["strategy"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=evidence");
  await page.getByLabel("Source next checks ledger").getByRole("button", { name: "Create action" }).first().click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("Confirm Planning Inspectorate appeal status", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Check Ormskirk appeal status before public escalation", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: /Stop the leisure park redevelopment in Barnet/ }).click();
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("Check Ormskirk appeal status before public escalation", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Check Barnet leisure park decision report before local escalation", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: /KFC Out of Ormskirk/ }).click();
  await expect(page.getByText("Keep KFC Out of Ormskirk · Ormskirk, Lancashire")).toBeVisible();
  await expect(page.getByText("Check Ormskirk appeal status before public escalation", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await page.getByLabel("Source pack resources").getByRole("button", { name: "Use in editable draft" }).first().click();
  await expect(page.getByRole("heading", { name: /Working copy: Ormskirk supporter email/i })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("Ormskirk KFC source update");

  await page.getByRole("link", { name: /Stop the leisure park redevelopment in Barnet/ }).click();
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByLabel("Local working draft library")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Working copy: Ormskirk supporter email/i })).toHaveCount(0);

  await page.getByRole("link", { name: /KFC Out of Ormskirk/ }).click();
  await expect(page.getByLabel("Local working draft library")).toContainText("Ormskirk supporter email");
  await expect(page.getByRole("heading", { name: /Working copy: Ormskirk supporter email/i })).toBeVisible();
});

test("operations workbench: real source working copies move through local review and queue", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      packTitle: "Ormskirk supporter email",
      subject: "Ormskirk KFC source update",
      body: "Dear supporter,\n\nThe public source says this copy must keep the appeal-status check visible before any local outreach is considered.",
      next: "Check the Planning Inspectorate appeal status before queueing local copy",
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      packTitle: "Tower Hamlets supporter email",
      subject: "Tower Hamlets homes source update",
      body: "Dear supporter,\n\nKeep housing target source checks visible before any local outreach is considered.",
      next: "Verify Tower Hamlets housing target papers before queueing local copy",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      packTitle: "Barnet supporter email",
      subject: "Barnet leisure park source update",
      body: "Dear supporter,\n\nKeep decision-record source checks visible before any local outreach is considered.",
      next: "Check Barnet decision records before queueing local copy",
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 18, lastSequence: 31, events: [] },
        documents: campaignOperationsDocuments(campaign, {
          digital_pack: [`DIGITAL CAMPAIGN PACK`, "", campaign.packTitle, "", `Subject: ${campaign.subject}`, "", campaign.body, "", "Before you send this, check", "", "- Keep the public source boundary attached."].join("\n"),
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: campaign.next, reason: "Review/queue regression", claimIds: [], affectedSections: ["digital_pack"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=drafts");
  await page.getByLabel("Source pack resources").getByRole("button", { name: "Use in editable draft" }).first().click();
  await expect(page.getByRole("heading", { name: /Working copy: Ormskirk supporter email/i })).toBeVisible();
  await expect(page.getByText(/Copied from Digital Campaign Pack in campaign/)).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("Ormskirk KFC source update");

  await page.getByRole("button", { name: "Mark ready for review" }).click();
  await expect(page.getByRole("heading", { name: "Human approval gate" })).toBeVisible();
  await expect(page.getByLabel("Local working drafts for review")).toContainText("Ormskirk supporter email");
  await expect(page.getByLabel("Communication preview for approval")).toContainText("Digital Campaign Pack");
  await page.getByLabel("Optional reviewer note").fill("Reviewer confirmed the appeal-status warning must stay attached before any provider setup.");
  await expect(page.getByLabel("Communication preview for approval")).toContainText("Reviewer confirmed the appeal-status warning");

  await page.getByRole("button", { name: "Approve as human reviewer" }).click();
  await expect(page.getByRole("heading", { name: "Approved by human" })).toBeVisible();
  await page.getByRole("button", { name: "Queue locally for demo" }).click();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Ormskirk KFC source update");
  await expect(page.locator("main")).toContainText("Local copy from Digital Campaign Pack");
  await expect(page.getByText(/It is not connected to an email provider/)).toBeVisible();

  const [markdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  const markdownPath = await markdownDownload.path();
  expect(markdownPath).toBeTruthy();
  const markdownPack = await readFile(markdownPath!, "utf8");
  expect(markdownPack).toContain("Reviewer note: Reviewer confirmed the appeal-status warning must stay attached before any provider setup.");
  expect(markdownPack).toContain("Source/provenance: Digital Campaign Pack (digital_pack)");
  expect(markdownPack).toContain("Provider sending: Not connected");

  await page.goto("/operations?campaignId=6b54225d-afa3-41d1-b053-89741094f153&view=outbox");
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Ormskirk KFC source update");

  await page.goto("/operations?campaignId=69f257b6-9913-4395-94f7-5c25b4b5fe95&view=outbox");
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Ormskirk KFC source update");

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const ormskirkRow = portfolio.locator("article", { hasText: "Keep KFC Out of Ormskirk" });
  const towerHamletsRow = portfolio.locator("article", { hasText: "Build 5,000 affordable houses" });
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });

  await expect(ormskirkRow).toContainText("Local signals: 1 working draft · 1 queued locally.");
  await expect(towerHamletsRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
});

test("operations workbench: editing a queued source working copy clears local queue state", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] ?? ormskirkId;
    const sourceTitle =
      id === ormskirkId
        ? "Keep KFC Out of Ormskirk"
        : id === "57678ae0-29fd-4b4b-8a53-5c711cdb21cf"
          ? "Build 5,000 affordable houses in Tower Hamlets in the next 3 years"
          : "Stop the leisure park redevelopment in Barnet";
    const sourcePlace = id === ormskirkId ? "Ormskirk, Lancashire" : id === "57678ae0-29fd-4b4b-8a53-5c711cdb21cf" ? "Tower Hamlets, London" : "Barnet, London";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: "partial", stateVersion: 18, lastSequence: 31, events: [] },
        documents: campaignOperationsDocuments(
          { title: sourceTitle, place: sourcePlace, next: "Check the Planning Inspectorate appeal status before queueing local copy" },
          {
            digital_pack: ["DIGITAL CAMPAIGN PACK", "", "Ormskirk supporter email", "", "Subject: Ormskirk KFC source update", "", "Dear supporter,", "", "The public source says this copy must keep the appeal-status check visible before any local outreach is considered.", "", "Before you send this, check", "", "- Keep the public source boundary attached."].join("\n"),
          },
        ),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Check the Planning Inspectorate appeal status before queueing local copy", reason: "Queued edit regression", claimIds: [], affectedSections: ["digital_pack"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${ormskirkId}&view=drafts`);
  await page.getByLabel("Source pack resources").getByRole("button", { name: "Use in editable draft" }).first().click();
  await page.getByRole("button", { name: "Mark ready for review" }).click();
  await page.getByRole("button", { name: "Approve as human reviewer" }).click();
  await page.getByRole("button", { name: "Queue locally for demo" }).click();
  await expect(page.getByRole("heading", { name: "One local queue item" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Ormskirk KFC source update");

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await page.getByLabel("Subject").fill("Edited Ormskirk KFC source update");
  await expect(page.getByText("Editable local draft. It has not been reviewed or queued.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark ready for review" })).toBeEnabled();

  await page.getByRole("button", { name: /Outbox & schedule/ }).first().click();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Edited Ormskirk KFC source update");

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const ormskirkRow = portfolio.locator("article", { hasText: "Keep KFC Out of Ormskirk" });
  await expect(ormskirkRow).toContainText("Local signals: 1 working draft.");
  await expect(ormskirkRow).not.toContainText("queued locally");
});

test("operations portfolio ignores stale local state under the wrong campaign key", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const barnetId = "6b54225d-afa3-41d1-b053-89741094f153";

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] ?? ormskirkId;
    const isBarnet = id === barnetId;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: isBarnet ? "completed" : "partial", stateVersion: 11, lastSequence: 22, events: [] },
        documents: campaignOperationsDocuments({
          title: isBarnet ? "Stop the leisure park redevelopment in Barnet" : "Keep KFC Out of Ormskirk",
          place: isBarnet ? "Barnet, London" : "Ormskirk, Lancashire",
          next: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records",
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records", reason: "Portfolio local-state guard", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?demo=fixture");
  await page.evaluate(
    ({ ormskirkId, barnetId }) => {
      const staleState = {
        workspaceKey: ormskirkId,
        selectedSegment: "school_gates",
        subject: "Stale Ormskirk subject must not count for Barnet",
        body: "This stale state is stored under the Barnet key but still belongs to Ormskirk, so the portfolio must ignore it.",
        status: "queued",
        mode: "compose",
        activeDraft: "supporter_email",
        activeView: "outbox",
        contactFilter: "all",
        contactReadinessFilter: "all",
        scheduleIntent: "after_approval",
        queuedAt: "2026-07-16T16:50:00.000Z",
        localActions: [{ id: "stale-action", title: "Stale Ormskirk local action", source: "Stale workspace", owner: "Campaigner", timing: "Next", priority: "High", status: "next", provenance: "Wrong-key regression fixture" }],
        workingDrafts: [],
        activeWorkingDraftId: null,
        sourceWorkingCopy: null,
        activity: [{ id: "stale", label: "Stale wrong-key state" }],
      };
      localStorage.setItem(`cf_operations_demo_v3:${barnetId}`, JSON.stringify(staleState));
    },
    { ormskirkId, barnetId },
  );

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).not.toContainText("Stale Ormskirk local action");

  await page.goto(`/operations?campaignId=${barnetId}&view=outbox`);
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Stale Ormskirk subject must not count for Barnet");
  await expect(page.locator("main")).not.toContainText("Stale Ormskirk local action");
});

test("operations workbench ignores source actions whose provenance belongs to another campaign", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const barnetId = "6b54225d-afa3-41d1-b053-89741094f153";

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] ?? barnetId;
    const isBarnet = id === barnetId;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: isBarnet ? "completed" : "partial", stateVersion: 14, lastSequence: 25, events: [] },
        documents: campaignOperationsDocuments({
          title: isBarnet ? "Stop the leisure park redevelopment in Barnet" : "Keep KFC Out of Ormskirk",
          place: isBarnet ? "Barnet, London" : "Ormskirk, Lancashire",
          next: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records",
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records", reason: "Source action provenance guard", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?demo=fixture");
  await page.evaluate(
    ({ ormskirkId, barnetId }) => {
      localStorage.setItem(
        `cf_operations_demo_v3:${barnetId}`,
        JSON.stringify({
          workspaceKey: barnetId,
          sourceStateVersion: 14,
          sourceLastSequence: 25,
          sourceDocumentSignature: "stale-source-action-signature",
          selectedSegment: "school_gates",
          subject: "Barnet shell state with stale Ormskirk action",
          body: "The Barnet shell should survive, but the Ormskirk source action must be filtered out.",
          reviewerNote: "",
          status: "draft",
          mode: "compose",
          activeDraft: "supporter_email",
          activeView: "overview",
          contactFilter: "all",
          contactReadinessFilter: "all",
          scheduleIntent: "after_approval",
          queuedAt: null,
          localActions: [
            {
              id: `source:${ormskirkId}:primary-source-check`,
              title: "Stale Ormskirk appeal action",
              source: "Campaign source · Evidence & checks",
              owner: "Reviewer",
              timing: "Before phase change",
              priority: "High",
              status: "next",
              provenance: `Source campaign ${ormskirkId}; stale source-action regression fixture.`,
            },
          ],
          workingDrafts: [],
          activeWorkingDraftId: null,
          sourceWorkingCopy: null,
          activity: [{ id: "stale-action", label: "Created local action: Stale Ormskirk appeal action." }],
        }),
      );
    },
    { ormskirkId, barnetId },
  );

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).not.toContainText("Stale Ormskirk appeal action");

  await page.goto(`/operations?campaignId=${barnetId}&view=actions`);
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByText("No local actions yet. Create the primary source-check action to turn the campaign boundary into owned work.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Stale Ormskirk appeal action");
});

test("operations workbench ignores source working drafts whose provenance belongs to another campaign", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const barnetId = "6b54225d-afa3-41d1-b053-89741094f153";

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] ?? barnetId;
    const isBarnet = id === barnetId;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: isBarnet ? "completed" : "partial", stateVersion: 12, lastSequence: 23, events: [] },
        documents: campaignOperationsDocuments({
          title: isBarnet ? "Stop the leisure park redevelopment in Barnet" : "Keep KFC Out of Ormskirk",
          place: isBarnet ? "Barnet, London" : "Ormskirk, Lancashire",
          next: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records",
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records", reason: "Working draft provenance guard", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?demo=fixture");
  await page.evaluate(
    ({ ormskirkId, barnetId }) => {
      const staleCopy = {
        id: "ormskirk-stale-source-copy",
        campaignId: ormskirkId,
        title: "Ormskirk source copy must not appear in Barnet",
        channel: "Email",
        sourceDocument: "Digital Campaign Pack",
        sourceDocumentKey: "digital_pack",
        createdAt: "2026-07-16T17:31:00.000Z",
        warnings: ["Ormskirk-only source warning"],
        provenance: `Copied from Digital Campaign Pack in campaign ${ormskirkId}; stale mixed-state regression fixture.`,
      };
      localStorage.setItem(
        `cf_operations_demo_v3:${barnetId}`,
        JSON.stringify({
          workspaceKey: barnetId,
          sourceStateVersion: 12,
          sourceLastSequence: 23,
          sourceDocumentSignature: "stale-mixed-signature",
          selectedSegment: "school_gates",
          subject: "Barnet shell state with stale Ormskirk draft",
          body: "The top-level Barnet shell should survive, but the Ormskirk source working draft must be filtered out.",
          reviewerNote: "",
          status: "draft",
          mode: "compose",
          activeDraft: "supporter_email",
          activeView: "outbox",
          contactFilter: "all",
          contactReadinessFilter: "all",
          scheduleIntent: "after_approval",
          queuedAt: null,
          localActions: [],
          workingDrafts: [
            {
              id: staleCopy.id,
              title: staleCopy.title,
              channel: "Email",
              subject: "Stale Ormskirk source update",
              body: "This queued source draft belongs to Ormskirk and must never hydrate inside Barnet.",
              reviewerNote: "Stale Ormskirk reviewer note",
              status: "queued",
              queuedAt: "2026-07-16T17:31:30.000Z",
              createdAt: staleCopy.createdAt,
              updatedAt: staleCopy.createdAt,
              sourceWorkingCopy: staleCopy,
            },
          ],
          activeWorkingDraftId: staleCopy.id,
          sourceWorkingCopy: staleCopy,
          activity: [{ id: "mixed", label: "Mixed-campaign stale working draft seeded." }],
        }),
      );
    },
    { ormskirkId, barnetId },
  );

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).not.toContainText("Stale Ormskirk source update");

  await page.goto(`/operations?campaignId=${barnetId}&view=outbox`);
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Ormskirk source copy must not appear in Barnet");
  await expect(page.locator("main")).not.toContainText("Stale Ormskirk source update");

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await expect(page.getByLabel("Local working draft library")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Stale Ormskirk reviewer note");
});

test("operations workbench resets legacy top-level source drafts from another campaign", async ({ page }) => {
  const ormskirkId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const barnetId = "6b54225d-afa3-41d1-b053-89741094f153";

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] ?? barnetId;
    const isBarnet = id === barnetId;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: isBarnet ? "completed" : "partial", stateVersion: 13, lastSequence: 24, events: [] },
        documents: campaignOperationsDocuments({
          title: isBarnet ? "Stop the leisure park redevelopment in Barnet" : "Keep KFC Out of Ormskirk",
          place: isBarnet ? "Barnet, London" : "Ormskirk, Lancashire",
          next: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records",
        }),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: isBarnet ? "Check Barnet decision records" : "Check Ormskirk appeal records", reason: "Legacy source-copy guard", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto("/operations?demo=fixture");
  await page.evaluate(
    ({ ormskirkId, barnetId }) => {
      const staleCopy = {
        id: "legacy-ormskirk-source-copy",
        campaignId: ormskirkId,
        title: "Legacy Ormskirk source copy must not queue in Barnet",
        channel: "Email",
        sourceDocument: "Digital Campaign Pack",
        sourceDocumentKey: "digital_pack",
        createdAt: "2026-07-16T17:39:00.000Z",
        warnings: ["Legacy Ormskirk warning"],
        provenance: `Copied from Digital Campaign Pack in campaign ${ormskirkId}; legacy top-level regression fixture.`,
      };
      localStorage.setItem(
        `cf_operations_demo_v3:${barnetId}`,
        JSON.stringify({
          workspaceKey: barnetId,
          sourceStateVersion: 13,
          sourceLastSequence: 24,
          sourceDocumentSignature: "legacy-stale-source-copy",
          selectedSegment: "school_gates",
          subject: "Legacy Ormskirk queued source subject",
          body: "This legacy top-level source draft belongs to Ormskirk and must not appear or stay queued in Barnet.",
          reviewerNote: "Legacy Ormskirk reviewer note",
          status: "queued",
          mode: "compose",
          activeDraft: "supporter_email",
          activeView: "outbox",
          contactFilter: "all",
          contactReadinessFilter: "all",
          scheduleIntent: "after_approval",
          queuedAt: "2026-07-16T17:39:30.000Z",
          localActions: [],
          workingDrafts: [],
          activeWorkingDraftId: null,
          sourceWorkingCopy: staleCopy,
          activity: [{ id: "legacy", label: "Legacy top-level stale source copy seeded." }],
        }),
      );
    },
    { ormskirkId, barnetId },
  );

  await page.goto("/operations");
  const portfolio = page.getByLabel("Campaign operations portfolio");
  const barnetRow = portfolio.locator("article", { hasText: "Stop the leisure park redevelopment" });
  await expect(barnetRow).toContainText("Local signals: no browser-local operations work yet for this campaign.");
  await expect(barnetRow).not.toContainText("Legacy Ormskirk queued source subject");

  await page.goto(`/operations?campaignId=${barnetId}&view=outbox`);
  await expect(page.getByText("Stop the leisure park redevelopment in Barnet · Barnet, London")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing queued yet" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Legacy Ormskirk queued source subject");
  await expect(page.locator("main")).not.toContainText("Legacy Ormskirk reviewer note");

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await expect(page.getByLabel("Subject")).toHaveValue("Local source draft reset");
  await expect(page.locator("main")).not.toContainText("Legacy Ormskirk queued source subject");
  await expect(page.locator("main")).not.toContainText("Legacy Ormskirk reviewer note");
});

test("operations workbench: failed or not-yet-usable real source loads do not fall back to the fixture", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Campaign source documents unavailable", detail: "Preview source returned HTTP 500." }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/Preview source returned HTTP 500/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Campaign source documents unavailable",
        detail: "Unsafe upstream detail should not render",
        sourceOrigin: "https://campaign-factory.example/source",
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/public campaign source could not be loaded \(HTTP 502\)/i)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toHaveCount(0);
  await expect(page.getByText("Unsafe upstream detail should not render")).toHaveCount(0);
  await expect(page.getByText("campaign-factory.example")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Campaign source not ready",
        detail: "This campaign is queued, so compiled operations source material is not available yet.",
        runStatus: "queued",
        sourceOrigin: "https://campaign-factory.vercel.app",
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign not usable yet" })).toBeVisible();
  await expect(page.getByText(/campaign is queued/i)).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "running", stateVersion: 1, lastSequence: 1, events: [] },
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "assembling", html: "", plainText: "Keep KFC Out of Ormskirk", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign not usable yet" })).toBeVisible();
  await expect(page.getByText(/campaign is still running/i)).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 2, lastSequence: 2, events: [] },
        documents: null,
        evidence: null,
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toBeVisible();
  await expect(page.getByText("https://campaign-factory.vercel.app", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "javascript:alert(1)",
        run: { campaignId, status: "partial", stateVersion: 3, lastSequence: 3, events: [] },
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "ready", html: "", plainText: "Unsafe source origin should not hydrate Ormskirk", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95",
  );
  await expect(page.getByText("Unsafe source origin should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://reader:secret@campaign-factory.vercel.app/source",
        run: { campaignId, status: "partial", stateVersion: 4, lastSequence: 4, events: [] },
        documents: canonicalOperationsDocuments("Credentialed source origin should not hydrate Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Credentialed source origin regression", reason: "Read-only source origins must not carry credentials", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95",
  );
  await expect(page.getByText("Credentialed source origin should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Credentialed source origin regression")).toHaveCount(0);
  await expect(page.getByText("reader:secret")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app/source",
        run: { campaignId, status: "partial", stateVersion: 5, lastSequence: 5, events: [] },
        documents: canonicalOperationsDocuments("Path-qualified source origin should not hydrate Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Path-qualified source origin regression", reason: "Read-only source origins must be exact origins, not source URLs", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toHaveCount(0);
  await expect(page.getByText("Path-qualified source origin should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Path-qualified source origin regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.example/source",
        run: { campaignId, status: "partial", stateVersion: 5, lastSequence: 5, events: [] },
        documents: canonicalOperationsDocuments("Non-canonical source origin should not hydrate Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Non-canonical source origin regression", reason: "Read-only source origins must be explicitly allow-listed", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to source brief" })).toHaveAttribute(
    "href",
    "https://campaign-factory.vercel.app/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95",
  );
  await expect(page.getByText("Non-canonical source origin should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Non-canonical source origin regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "ready", html: "", plainText: "Malformed source without a run should not hydrate Ormskirk", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Checked read-only source:")).toBeVisible();
  await expect(page.getByText("https://campaign-factory.vercel.app", { exact: true })).toBeVisible();
  await expect(page.getByText("Malformed source without a run should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 3, lastSequence: 3, events: [null] },
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "ready", html: "", plainText: "Malformed run event should not hydrate Ormskirk", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Malformed run event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: "57678ae0-29fd-4b4b-8a53-5c711cdb21cf", status: "partial", stateVersion: 3, lastSequence: 3, events: [] },
        documents: [
          { key: "campaign_brief", num: 1, name: "Campaign Brief", status: "ready", html: "", plainText: "Mismatched Tower Hamlets source should not hydrate Ormskirk", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"], resourceCount: 0, flags: [] },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Mismatched Tower Hamlets source should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: same-origin source responses require JSON content type before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 6, lastSequence: 6, events: [] },
        documents: canonicalOperationsDocuments("Text/plain source should not hydrate Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Text/plain source content type regression", reason: "Browser hydration must require JSON media types", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/non-JSON content type/i)).toBeVisible();
  await expect(page.getByText("Text/plain source should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Text/plain source content type regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: malformed source document entries do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: [
          {
            key: "fixture_pack",
            num: 99,
            name: "Fixture Pack",
            status: "done",
            html: "<p>Malformed document should not hydrate Ormskirk</p>",
            plainText: "Unknown compiled document should not hydrate Ormskirk",
            isPack: true,
            sectionKeys: [],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Malformed document regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Malformed document should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Unknown compiled document should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents must carry non-empty public text", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: canonicalOperationsDocuments("Keep KFC Out of Ormskirk").map((doc) =>
          doc.key === "campaign_brief"
            ? {
                ...doc,
                html: "   ",
                plainText: "Blank public source text should not hydrate Ormskirk",
              }
            : doc,
        ),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Blank compiled-document text regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Blank public source text should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents reject markup-only public HTML", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: canonicalOperationsDocuments("Keep KFC Out of Ormskirk").map((doc) =>
          doc.key === "campaign_brief"
            ? {
                ...doc,
                html: "<article><p>&nbsp;</p><span> </span></article>",
                plainText: "Markup-only public HTML should not hydrate Ormskirk",
              }
            : doc,
        ),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Markup-only compiled-document HTML regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Markup-only public HTML should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents must match canonical metadata", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 7,
            name: "Fixture Brief",
            status: "ready",
            html: "<p>Canonical metadata mismatch should not hydrate Ormskirk</p>",
            plainText: "Canonical metadata mismatch should not hydrate Ormskirk",
            isPack: true,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Canonical document metadata regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Canonical metadata mismatch should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents must keep canonical section order", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Out-of-order canonical section set should not hydrate Ormskirk</p>",
            plainText: "Out-of-order canonical section set should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["evidence", "problem"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Canonical section-order regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Out-of-order canonical section set should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents must include every canonical source section", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  documents[0] = {
    ...documents[0],
    html: "<p>Reduced Campaign Brief sections should not hydrate Ormskirk</p>",
    plainText: "Reduced Campaign Brief sections should not hydrate Ormskirk",
    sectionKeys: ["problem", "evidence"],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Reduced canonical source-section regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Reduced Campaign Brief sections should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Reduced canonical source-section regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled source documents must include every canonical document in order", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documentSectionKeys: Record<string, string[]> = {
    campaign_brief: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
    objective_theory_of_change: ["objective"],
    power_stakeholder_map: ["power", "pressure"],
    campaign_strategy: ["strategy"],
    tactics_timeline: ["tactics"],
    organising_plan: ["organising"],
    lobbying_pack: [],
    media_pack: [],
    digital_pack: [],
  };
  const canonicalDocuments = [
    ["campaign_brief", "Campaign Brief", "Missing Media Pack should not hydrate Ormskirk"],
    ["objective_theory_of_change", "Objective and Theory of Change", "Objective shell"],
    ["power_stakeholder_map", "Power and Stakeholder Map", "Power shell"],
    ["campaign_strategy", "Campaign Strategy", "Strategy shell"],
    ["tactics_timeline", "Tactics and Timeline", "Tactics shell"],
    ["organising_plan", "Organising Plan", "Organising shell"],
    ["lobbying_pack", "Lobbying Pack", "Lobbying shell"],
    ["digital_pack", "Digital Campaign Pack", "Digital shell"],
  ].map(([key, name, plainText], index) => ({
    key,
    num: index < 7 ? index + 1 : 9,
    name,
    status: "ready",
    html: `<p>${plainText}</p>`,
    plainText,
    isPack: index >= 6,
    sectionKeys: documentSectionKeys[key],
    resourceCount: index >= 6 ? 1 : 0,
    flags: [],
  }));

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 9, lastSequence: 99, events: [] },
        documents: canonicalDocuments,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Canonical document-list regression", reason: "Contract validation", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Missing Media Pack should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: malformed source evidence entries do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Valid document shell should still be held back</p>",
            plainText: "Valid document shell should still be held back",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Fixture evidence",
              count: 1,
              claims: [
                {
                  id: "claim-1",
                  text: "Malformed evidence should not hydrate Ormskirk",
                  type: "other",
                  label: "Fixture evidence",
                  loadBearing: true,
                  confidence: "high",
                  sourceCount: 0,
                  affectedOutputs: [],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Malformed evidence regression", reason: "Contract validation", affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Valid document shell should still be held back")).toHaveCount(0);
  await expect(page.getByText("Malformed evidence should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence claims must reference canonical affected outputs", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Invalid claim affected output should not hydrate Ormskirk</p>",
            plainText: "Invalid claim affected output should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "claim-1",
                  text: "Fixture-shaped affected output should stay hidden",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["fixture_section"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Affected output regression", reason: "Contract validation", claimIds: ["claim-1"], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Invalid claim affected output should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Fixture-shaped affected output should stay hidden")).toHaveCount(0);
  await expect(page.getByText("Affected output regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Duplicate claim affected outputs should not hydrate Ormskirk</p>",
            plainText: "Duplicate claim affected outputs should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "claim-duplicate-output",
                  text: "Duplicate affected output should stay hidden",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief", "campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Duplicate affected-output regression", reason: "Contract validation", claimIds: ["claim-duplicate-output"], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Duplicate claim affected outputs should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Duplicate affected output should stay hidden")).toHaveCount(0);
  await expect(page.getByText("Duplicate affected-output regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence claims must use canonical claim types", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Fixture claim type should not hydrate Ormskirk</p>",
            plainText: "Fixture claim type should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "claim-fixture-type",
                  text: "Fixture-only claim type should stay hidden",
                  type: "fixture_assumption",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Claim type regression", reason: "Contract validation", claimIds: ["claim-fixture-type"], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Fixture claim type should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Fixture-only claim type should stay hidden")).toHaveCount(0);
  await expect(page.getByText("Claim type regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence groups must remain canonical", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Non-canonical evidence group order should not hydrate Ormskirk</p>",
            plainText: "Non-canonical evidence group order should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "late-claim",
                  text: "Late evidence group should stay hidden",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
            {
              label: "Verified public information",
              count: 1,
              claims: [
                {
                  id: "early-claim",
                  text: "Out-of-order evidence group should fail closed",
                  type: "other",
                  label: "Verified public information",
                  loadBearing: false,
                  confidence: "high",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Evidence group ordering regression", reason: "Contract validation", claimIds: ["late-claim"], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 2, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Non-canonical evidence group order should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Late evidence group should stay hidden")).toHaveCount(0);
  await expect(page.getByText("Out-of-order evidence group should fail closed")).toHaveCount(0);
  await expect(page.getByText("Evidence group ordering regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Empty evidence group should not hydrate Ormskirk</p>",
            plainText: "Empty evidence group should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [{ label: "Verification incomplete", count: 0, claims: [] }],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Empty group regression", reason: "Contract validation", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Empty evidence group should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Empty group regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workbench: duplicate source evidence references do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Duplicate evidence references should still be held back</p>",
            plainText: "Duplicate evidence references should still be held back",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [
            { id: "duplicate-next", description: "Duplicate next check reference", reason: "Contract validation", claimIds: ["C1", "C1"], affectedSections: ["strategy"] },
            { id: "duplicate-next", description: "Duplicate next check shadow", reason: "Contract validation", claimIds: ["C2"], affectedSections: ["strategy", "strategy"] },
          ],
          terminalGaps: [
            { id: "duplicate-gap", description: "Duplicate terminal gap reference", at: "2026-07-16T20:30:00Z" },
            { id: "duplicate-gap", description: "Duplicate terminal gap shadow", at: "2026-07-16T20:31:00Z" },
          ],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Duplicate evidence references should still be held back")).toHaveCount(0);
  await expect(page.getByText("Duplicate next check reference")).toHaveCount(0);
  await expect(page.getByText("Duplicate terminal gap reference")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source next checks must reference canonical sections", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Invalid next-check references should not hydrate Ormskirk</p>",
            plainText: "Invalid next-check references should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "known-claim",
                  text: "Known source claim should stay hidden with malformed next checks",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [
            {
              id: "invalid-reference",
              description: "Fixture section should fail closed",
              reason: "Contract validation",
              claimIds: ["missing-claim"],
              affectedSections: ["fixture_section"],
            },
          ],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Invalid next-check references should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Known source claim should stay hidden with malformed next checks")).toHaveCount(0);
  await expect(page.getByText("Fixture section should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source next checks must reference known claims when a claim ledger is present", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Unknown claim reference should not hydrate Ormskirk</p>",
            plainText: "Unknown claim reference should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "known-claim",
                  text: "Known source claim should not hydrate with an unknown next-check reference",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [
            {
              id: "missing-claim-reference",
              description: "Unknown claim reference should fail closed",
              reason: "Contract validation",
              claimIds: ["missing-claim"],
              affectedSections: ["problem"],
            },
          ],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Unknown claim reference should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Known source claim should not hydrate with an unknown next-check reference")).toHaveCount(0);
  await expect(page.getByText("Unknown claim reference should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source next checks cannot reference claims when the ledger is empty", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments(),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [
            {
              id: "orphan-next-check",
              description: "Orphan next-check claim should fail closed",
              reason: "Contract validation",
              claimIds: ["missing-claim"],
              affectedSections: ["problem"],
            },
          ],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Orphan next-check claim should fail closed")).toHaveCount(0);
  await expect(page.getByText("Canonical source document shell")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence conflicts must match public ledger claims", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments("Omitted conflict Ormskirk"),
        evidence: {
          groups: [
            {
              label: "Conflicting evidence",
              count: 1,
              claims: [
                {
                  id: "conflict-claim",
                  text: "Public conflict claim should fail closed when omitted from the conflict list",
                  type: "process",
                  label: "Conflicting evidence",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 2,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [
            {
              id: "omitted-conflict-check",
              description: "Omitted source conflict should fail closed",
              reason: "Contract validation",
              claimIds: ["conflict-claim"],
              affectedSections: ["evidence"],
            },
          ],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Omitted conflict Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Public conflict claim should fail closed when omitted from the conflict list")).toHaveCount(0);
  await expect(page.getByText("Omitted source conflict should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence totals must match public ledger groups", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments("Phantom evidence totals Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [
            {
              id: "phantom-totals-check",
              description: "Phantom evidence totals should fail closed",
              reason: "Contract validation",
              claimIds: [],
              affectedSections: ["problem"],
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

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Phantom evidence totals Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Phantom evidence totals should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source next checks and draft notes require public text", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments("Keep KFC Out of Ormskirk"),
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "known-claim",
                  text: "Known source claim should stay hidden when checks or draft notes are blank",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [
            {
              id: "blank-check",
              description: "   ",
              reason: "Contract validation must not allow a blank public next-check description",
              claimIds: ["known-claim"],
              affectedSections: ["problem"],
            },
          ],
          terminalGaps: [],
          draftNotes: [{ text: "", section: "Digital Campaign Pack" }],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Known source claim should stay hidden when checks or draft notes are blank")).toHaveCount(0);
  await expect(page.getByText("Contract validation must not allow a blank public next-check description")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: unavailable run header must not carry hidden source event state", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        sourceRunUnavailable: true,
        run: { campaignId, status: "completed", stateVersion: 8, lastSequence: 12, events: [] },
        documents: canonicalOperationsDocuments("Hidden event-state Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Hidden run state should not hydrate", reason: "The unavailable marker must only wrap the synthetic empty run header", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not include a validated run header/i)).toBeVisible();
  await expect(page.getByText("Hidden event-state Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Hidden run state should not hydrate")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: unavailable run-header marker must be boolean provenance", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        sourceRunUnavailable: "true",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments("String provenance marker Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "String unavailable marker should not hydrate", reason: "The unavailable provenance marker must be typed", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/malformed unavailable run-header provenance/i)).toBeVisible();
  await expect(page.getByText("String provenance marker Ormskirk")).toHaveCount(0);
  await expect(page.getByText("String unavailable marker should not hydrate")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: synthetic run header must carry unavailable provenance", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 0, lastSequence: 0, events: [] },
        documents: canonicalOperationsDocuments("Unmarked synthetic Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Unmarked synthetic header should not hydrate", reason: "The synthetic empty partial header is only allowed for unavailable run-header provenance", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/unvalidated synthetic run header/i)).toBeVisible();
  await expect(page.getByText("Unmarked synthetic Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Unmarked synthetic header should not hydrate")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: unavailable run header must fail closed before document hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        sourceRunUnavailable: true,
        run: { campaignId, status: "partial", stateVersion: 0, lastSequence: 0, events: [] },
        documents: canonicalOperationsDocuments("Run header unavailable Ormskirk"),
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Confirm the public source run header once the endpoint recovers", reason: "The compiled documents loaded but the run header was unavailable", claimIds: [], affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not include a validated run header/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run header unavailable Ormskirk" })).toHaveCount(0);
  await expect(page.getByText("Confirm the public source run header once the endpoint recovers")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
});

test("operations workbench: source terminal gaps require public text and journey steps", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: canonicalOperationsDocuments("Keep KFC Out of Ormskirk"),
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "known-claim",
                  text: "Known source claim should stay hidden when terminal gaps are malformed",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [
            {
              id: "next",
              description: "Terminal gap contract validation",
              reason: "Contract validation",
              claimIds: ["known-claim"],
              affectedSections: ["problem"],
            },
          ],
          terminalGaps: [
            { id: "blank-terminal-gap", description: "   ", step: 3, at: "2026-07-16T20:30:00Z" },
            { id: "zero-step-terminal-gap", description: "Terminal gap step must be a real journey step", step: 0, at: "2026-07-16T20:31:00Z" },
          ],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Known source claim should stay hidden when terminal gaps are malformed")).toHaveCount(0);
  await expect(page.getByText("Terminal gap step must be a real journey step")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence conflicts must match ledger claims", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Orphaned evidence conflict should not hydrate Ormskirk</p>",
            plainText: "Orphaned evidence conflict should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "known-claim",
                  text: "Known source claim should stay hidden with orphaned conflict metadata",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [
            {
              id: "orphan-conflict",
              text: "Orphaned conflict should fail closed",
              type: "other",
              label: "Conflicting evidence",
              loadBearing: true,
              confidence: "medium",
              sourceCount: 1,
              affectedOutputs: ["campaign_brief"],
            },
          ],
          nextChecks: [{ id: "next", description: "Orphaned conflict regression", reason: "Contract validation", claimIds: ["known-claim"], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Orphaned evidence conflict should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Known source claim should stay hidden with orphaned conflict metadata")).toHaveCount(0);
  await expect(page.getByText("Orphaned conflict should fail closed")).toHaveCount(0);
  await expect(page.getByText("Orphaned conflict regression")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source evidence ids must be non-empty before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Blank evidence ids should not hydrate Ormskirk</p>",
            plainText: "Blank evidence ids should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "",
                  text: "Blank claim id should fail closed before becoming a source gate",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "medium",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "", description: "Blank next check id should fail closed", reason: "Contract validation", claimIds: [], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Blank evidence ids should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Blank claim id should fail closed before becoming a source gate")).toHaveCount(0);
  await expect(page.getByText("Blank next check id should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source run events must use positive sequence numbers", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-zero",
              sequence: 0,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              visibility: "public",
              payload: { summary: "Zero-sequence source event should not hydrate Ormskirk" },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Zero-sequence event should not hydrate Ormskirk</p>",
            plainText: "Zero-sequence event should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign|typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Zero-sequence event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Zero-sequence source event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source run events must be in ascending stream order", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-two",
              sequence: 2,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:41:00Z",
              visibility: "public",
              payload: { summary: "Out-of-order later event should not hydrate Ormskirk" },
            },
            {
              eventId: "event-one",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              visibility: "public",
              payload: { summary: "Out-of-order earlier event should not hydrate Ormskirk" },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Out-of-order source events should not hydrate Ormskirk</p>",
            plainText: "Out-of-order source events should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign|typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Out-of-order source events should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Out-of-order later event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Out-of-order earlier event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source run events must be chronological", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-earlier-sequence",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:41:00Z",
              visibility: "public",
              payload: { summary: "Later timestamp source event should not hydrate Ormskirk" },
            },
            {
              eventId: "event-later-sequence",
              sequence: 2,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              visibility: "public",
              payload: { summary: "Earlier timestamp source event should not hydrate Ormskirk" },
            },
          ],
        },
        documents: canonicalOperationsDocuments("Reverse timestamp Ormskirk"),
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Reverse timestamp Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Later timestamp source event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Earlier timestamp source event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source run event state versions cannot exceed run state version", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-future-state-version",
              sequence: 11,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              stateVersion: 11,
              visibility: "public",
              payload: { summary: "Future state-version event should not hydrate Ormskirk" },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Future state-version source event should not hydrate Ormskirk</p>",
            plainText: "Future state-version source event should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign|typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Future state-version source event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Future state-version event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source run event state versions cannot go backwards", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-state-five",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              stateVersion: 5,
              visibility: "public",
              payload: { summary: "Higher state-version event should not hydrate Ormskirk" },
            },
            {
              eventId: "event-state-four",
              sequence: 2,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:41:00Z",
              stateVersion: 4,
              visibility: "public",
              payload: { summary: "Lower state-version event should not hydrate Ormskirk" },
            },
          ],
        },
        documents: canonicalOperationsDocuments("Reverse state-version Ormskirk"),
        evidence: { groups: [], conflicts: [], nextChecks: [], terminalGaps: [], draftNotes: [], totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 } },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Reverse state-version Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Higher state-version event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Lower state-version event should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: source reference arrays must use non-empty unique ids", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-1",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              visibility: "public",
              payload: {
                summary: "Blank event source reference should not hydrate Ormskirk",
                sourceIds: ["source-1", ""],
                claimIds: ["claim-1", "claim-1"],
              },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Blank source references should not hydrate Ormskirk</p>",
            plainText: "Blank source references should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Blank next-check claim reference should fail closed", reason: "Contract validation", claimIds: [""], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign|typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Blank source references should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Blank event source reference should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Blank next-check claim reference should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Blank next-check claim references should not hydrate Ormskirk</p>",
            plainText: "Blank next-check claim references should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Blank next-check claim reference should fail closed", reason: "Contract validation", claimIds: [""], affectedSections: ["problem"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Blank next-check claim references should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Blank next-check claim reference should fail closed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: malformed source timestamps do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-1",
              sequence: 1,
              campaignId,
              type: "work.update",
              at: "not an ISO timestamp",
              visibility: "public",
              payload: { summary: "Malformed run timestamp should not hydrate Ormskirk" },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Valid source shell should still be held back</p>",
            plainText: "Valid source shell should still be held back",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Malformed run timestamp should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Valid source shell should still be held back")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);

  await page.unroute(`**/api/operations/sources/${campaignId}`);
  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Malformed terminal gap timestamp should not hydrate Ormskirk</p>",
            plainText: "Malformed terminal gap timestamp should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [{ id: "gap-1", description: "Gap with malformed timestamp", at: "2026-07-16" }],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Malformed terminal gap timestamp should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Gap with malformed timestamp")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled documents require source-shaped resource counts and flags", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 10, lastSequence: 100, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Non-pack resource count should not hydrate Ormskirk</p>",
            plainText: "Non-pack resource count should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 1,
            flags: [""],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Non-pack resource count should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: malformed source event references do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "event-1",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:40:00Z",
              visibility: "public",
              payload: {
                summary: "Fixture-shaped event reference should not hydrate Ormskirk",
                documentKey: "fixture_pack",
                documentStatus: "done",
                sectionStep: 11,
                sectionStatus: "approved",
              },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Valid document shell should remain hidden behind bad event refs</p>",
            plainText: "Valid document shell should remain hidden behind bad event refs",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Fixture-shaped event reference should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Valid document shell should remain hidden behind bad event refs")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: internal source events do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 100,
          events: [
            {
              eventId: "internal-event-1",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:45:00Z",
              visibility: "internal",
              payload: {
                summary: "Internal event summary should not hydrate Ormskirk",
                documentKey: "campaign_brief",
                documentStatus: "ready",
              },
            },
          ],
        },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Public document shell should stay hidden behind internal events</p>",
            plainText: "Public document shell should stay hidden behind internal events",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Internal event summary should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Public document shell should stay hidden behind internal events")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: blank source event summaries do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = [
    { key: "campaign_brief", num: 1, name: "Campaign Brief", isPack: false, sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"] },
    { key: "objective_theory_of_change", num: 2, name: "Objective and Theory of Change", isPack: false, sectionKeys: ["objective"] },
    { key: "power_stakeholder_map", num: 3, name: "Power and Stakeholder Map", isPack: false, sectionKeys: ["power", "pressure"] },
    { key: "campaign_strategy", num: 4, name: "Campaign Strategy", isPack: false, sectionKeys: ["strategy"] },
    { key: "tactics_timeline", num: 5, name: "Tactics and Timeline", isPack: false, sectionKeys: ["tactics"] },
    { key: "organising_plan", num: 6, name: "Organising Plan", isPack: false, sectionKeys: ["organising"] },
    { key: "lobbying_pack", num: 7, name: "Lobbying Pack", isPack: true, sectionKeys: [] },
    { key: "media_pack", num: 8, name: "Media Pack", isPack: true, sectionKeys: [] },
    { key: "digital_pack", num: 9, name: "Digital Campaign Pack", isPack: true, sectionKeys: [] },
  ].map((doc) => ({
    ...doc,
    status: "ready",
    html: `<p>Blank source event summary should not hydrate ${doc.name}</p>`,
    plainText: `Blank source event summary should not hydrate ${doc.name}`,
    resourceCount: 0,
    flags: [],
  }));

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: {
          campaignId,
          status: "partial",
          stateVersion: 10,
          lastSequence: 1,
          events: [
            {
              eventId: "blank-summary-event-1",
              sequence: 1,
              campaignId,
              type: "document.status",
              at: "2026-07-16T20:50:00Z",
              visibility: "public",
              payload: { summary: "", documentKey: "campaign_brief", documentStatus: "ready" },
            },
          ],
        },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/did not match the requested campaign/i)).toBeVisible();
  await expect(page.getByText("Blank source event summary should not hydrate Campaign Brief")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: unsupported compiled document flags do not hydrate a real workspace", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  documents[0] = {
    ...documents[0],
    html: "<p>Unsupported document flag should not hydrate Ormskirk</p>",
    plainText: "Unsupported document flag should not hydrate Ormskirk",
    flags: ["Ready for provider delivery"],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Unsupported document flag should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Ready for provider delivery")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: compiled documents must carry the shared safety disclaimer before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  const plainText = "Missing compiled-document disclaimer should not hydrate Ormskirk";
  documents[0] = {
    ...documents[0],
    html: `<p>${plainText}</p>`,
    plainText,
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Missing compiled-document disclaimer should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: encoded compiled-document disclaimer hydrates as the same source boundary", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments("Encoded disclaimer Ormskirk").map((doc) => ({
    ...doc,
    html: `<p>${doc.plainText.replace(/AI-generated draft — please verify/g, "AI-generated draft &mdash; please verify")}</p>`,
  }));

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Keep the encoded compiler boundary visible", reason: "HTML entities should not look like missing disclaimer text", claimIds: [], affectedSections: ["campaign_brief"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Encoded disclaimer Ormskirk" }).first()).toBeVisible();
  await expect(page.getByText("Real campaign source", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: encoded rendered verification notes hydrate as the same source warning", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments("Encoded warning Ormskirk");
  const plainText = `Encoded warning Ormskirk\n\n${COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE}\n\n${COMPILED_DOCUMENT_DISCLAIMER}`;
  documents[0] = {
    ...documents[0],
    html: `<p>Encoded warning Ormskirk</p><p>${COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE.replace("couldn't", "couldn&rsquo;t")}</p><p>${COMPILED_DOCUMENT_DISCLAIMER.replace("AI-generated draft — please verify", "AI-generated draft &mdash; please verify")}</p>`,
    plainText,
    flags: ["A source section is flagged needs verification."],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Keep encoded verification warnings visible", reason: "HTML entities should not look like stripped warning notes", claimIds: [], affectedSections: ["campaign_brief"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Encoded warning Ormskirk" }).first()).toBeVisible();
  await expect(page.getByText("Real campaign source", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Keep encoded verification warnings visible").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: document verification flags must match rendered source notes before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  documents[0] = {
    ...documents[0],
    html: "<p>Phantom needs-verification document flag should not hydrate Ormskirk</p>",
    plainText: "Phantom needs-verification document flag should not hydrate Ormskirk",
    flags: ["A source section is flagged needs verification."],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Phantom needs-verification document flag should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("A source section is flagged needs verification.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: document verification notes must remain visible in rendered source before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  documents[0] = {
    ...documents[0],
    html: `<p>Rendered verification note stripped from document shell.</p><p>${COMPILED_DOCUMENT_DISCLAIMER}</p>`,
    plainText: `Plain-text verification note alone should not hydrate Ormskirk\n\n${COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE}\n\n${COMPILED_DOCUMENT_DISCLAIMER}`,
    flags: ["A source section is flagged needs verification."],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Rendered verification note stripped from document shell.")).toHaveCount(0);
  await expect(page.getByText("Plain-text verification note alone should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: document verification notes must not hydrate without matching flags", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  const plainText = `Omitted verification flag should not hydrate Ormskirk\n\n${COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE}\n\n${COMPILED_DOCUMENT_DISCLAIMER}`;
  documents[0] = {
    ...documents[0],
    html: `<p>Omitted verification flag should not hydrate Ormskirk</p><p>${COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE}</p><p>${COMPILED_DOCUMENT_DISCLAIMER}</p>`,
    plainText,
    flags: [],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 0, loadBearing: 0, verifiedLoadBearing: 0, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Omitted verification flag should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText(COMPILED_DOCUMENT_NEEDS_VERIFICATION_NOTE)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: unresolved document claim flags must match the evidence ledger before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documents = canonicalOperationsDocuments();
  documents[0] = {
    ...documents[0],
    html: "<p>Phantom unresolved document flag should not hydrate Ormskirk</p>",
    plainText: "Phantom unresolved document flag should not hydrate Ormskirk",
    flags: ["Unresolved load-bearing claim: Phantom council decision claim should not hydrate Ormskirk"],
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 13, lastSequence: 103, events: [] },
        documents,
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 1,
              claims: [
                {
                  id: "claim-real",
                  text: "A different unresolved source claim is present in the ledger",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "high",
                  sourceCount: 1,
                  affectedOutputs: ["campaign_brief"],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Check the actual public claim ledger", reason: "Document flags must be source-backed", claimIds: ["claim-real"], affectedSections: ["campaign_brief"] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Phantom unresolved document flag should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Phantom council decision claim should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("A different unresolved source claim is present in the ledger")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: rejects inconsistent evidence totals before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 11, lastSequence: 101, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Inconsistent evidence totals should not hydrate Ormskirk</p>",
            plainText: "Inconsistent evidence totals should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verification incomplete",
              count: 2,
              claims: [
                {
                  id: "claim-1",
                  text: "Evidence count mismatch should not hydrate Ormskirk",
                  type: "other",
                  label: "Verification incomplete",
                  loadBearing: true,
                  confidence: "high",
                  sourceCount: 0,
                  affectedOutputs: [],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Inconsistent evidence totals regression", reason: "Contract validation", affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 2, loadBearing: 2, verifiedLoadBearing: 2, unresolvedLoadBearing: 1 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Inconsistent evidence totals should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Evidence count mismatch should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: rejects evidence aggregates that do not match grouped claims before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 12, lastSequence: 102, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "<p>Mismatched grouped evidence should not hydrate Ormskirk</p>",
            plainText: "Mismatched grouped evidence should not hydrate Ormskirk",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0,
            flags: [],
          },
        ],
        evidence: {
          groups: [
            {
              label: "Verified public information",
              count: 1,
              claims: [
                {
                  id: "claim-1",
                  text: "Grouped evidence aggregate mismatch should not hydrate Ormskirk",
                  type: "other",
                  label: "Verified public information",
                  loadBearing: true,
                  confidence: "high",
                  sourceCount: 1,
                  affectedOutputs: [],
                },
              ],
            },
          ],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Grouped aggregate regression", reason: "Contract validation", affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 2, loadBearing: 1, verifiedLoadBearing: 1, unresolvedLoadBearing: 0 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Mismatched grouped evidence should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByText("Grouped evidence aggregate mismatch should not hydrate Ormskirk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: rejects fractional source counters before hydration", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 12, lastSequence: 18, events: [] },
        documents: [
          {
            key: "campaign_brief",
            num: 1,
            name: "Campaign Brief",
            status: "ready",
            html: "",
            plainText: "Keep KFC Out of Ormskirk\n\nPlace: Ormskirk, Lancashire\n\nTHE PROBLEM\nFractional source counters should never hydrate.",
            isPack: false,
            sectionKeys: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
            resourceCount: 0.5,
            flags: [],
          },
        ],
        evidence: {
          groups: [],
          conflicts: [],
          nextChecks: [{ id: "next", description: "Fractional counter regression", reason: "Contract validation", affectedSections: [] }],
          terminalGaps: [],
          draftNotes: [],
          totals: { claims: 1, loadBearing: 1, verifiedLoadBearing: 0, unresolvedLoadBearing: 0.5 },
        },
      }),
    });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText(/typed public document contract/i)).toBeVisible();
  await expect(page.getByText("Fractional source counters should never hydrate")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
});

test("operations workbench: invalid or non-curated campaign IDs are blocked without fixture fallback", async ({ page }) => {
  await page.goto("/operations?campaignId=not-a-campaign-id");

  await expect(page.getByRole("heading", { name: "Campaign ID not recognised" })).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Factory" })).toHaveAttribute("href", "/factory");
  await expect(page.getByRole("link", { name: "View source brief" })).toHaveCount(0);

  await page.goto("/operations?campaignId=00000000-0000-4000-8000-000000000000");

  await expect(page.getByRole("heading", { name: "Campaign source unavailable" })).toBeVisible();
  await expect(page.getByText("No curated public campaign source was found for that campaign ID.")).toBeVisible();
  await expect(page.getByText("No fixture fallback used", { exact: true })).toBeVisible();
  await expect(page.getByText("Use one of the curated Operations campaign IDs or return to Campaign Factory.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText("A. Patel")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Factory" })).toHaveAttribute("href", "/factory");
  await expect(page.getByRole("link", { name: "View source brief" })).toHaveCount(0);
});

test("operations source adapter: rejects arbitrary proxy reads and non-GET writes", async ({ request }) => {
  const invalid = await request.get("/api/operations/sources/not-a-campaign-id?url=https://example.com/anything");
  expect(invalid.status()).toBe(404);
  expect(invalid.headers()["content-type"]).toContain("application/json");
  expect(await invalid.json()).toMatchObject({
    error: "Operations source not found",
    detail: "This read-only preview source path only exposes the curated public operations campaigns.",
  });

  const nonCurated = await request.get("/api/operations/sources/00000000-0000-4000-8000-000000000000?url=https://example.com/anything");
  expect(nonCurated.status()).toBe(404);
  expect(await nonCurated.json()).toMatchObject({
    error: "Operations source not found",
    detail: "This read-only preview source path only exposes the curated public operations campaigns.",
  });

  const postAttempt = await request.post("/api/operations/sources/69f257b6-9913-4395-94f7-5c25b4b5fe95", {
    data: { url: "https://example.com/anything" },
  });
  expect(postAttempt.status()).toBe(405);
});

test("operations workbench: source updates preserve browser-local work and require acknowledgement", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  let sourceVersion = 44;
  let lastSequence = 1909;
  const sourcePayload = () => {
    const documents = campaignOperationsDocuments(
      { title: "Keep KFC Out of Ormskirk", place: "Ormskirk, Lancashire", next: "P0 Official status verification" },
      {
        campaign_strategy: "CAMPAIGN STRATEGY\n\nPriority audiences\n\n- Residents directly affected by amenity",
      },
    );
    documents[7] = {
      ...documents[7],
      status: sourceVersion === 44 ? "assembling" : "ready",
      resourceCount: sourceVersion === 44 ? 0 : 1,
    };

    return {
      sourceOrigin: "https://campaign-factory.vercel.app",
      run: { campaignId, status: "partial", stateVersion: sourceVersion, lastSequence, events: [] },
      documents,
      evidence: campaignEvidence([
        {
          id: "appeal-check",
          description: sourceVersion === 44 ? "Check the Planning Inspectorate appeals database" : "Check the updated Planning Inspectorate and council appeal records",
          reason: "Source version changed",
          affectedSections: ["strategy"],
        },
      ]),
    };
  };

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(sourcePayload()) });
  });

  await page.goto(`/operations?campaignId=${campaignId}`);
  await expect(page.getByRole("heading", { name: /Keep KFC Out of Ormskirk into operations/i })).toBeVisible();
  await page.getByRole("button", { name: /Evidence & checks/ }).first().click();
  await page.getByRole("button", { name: "Create appeal-status action" }).click();
  await expect(page.getByText("Confirm Planning Inspectorate appeal status", { exact: true }).first()).toBeVisible();

  sourceVersion = 45;
  lastSequence = 1918;
  await page.reload();
  await page.getByRole("button", { name: /Overview/ }).first().click();
  await expect(page.getByText("Read-only source has changed since this local workspace started.")).toBeVisible();
  await expect(page.getByText(/Your browser-local actions and drafts were preserved/)).toBeVisible();
  await page.getByRole("button", { name: /Action plan/ }).first().click();
  await expect(page.getByText("Confirm Planning Inspectorate appeal status", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Outbox & schedule/ }).first().click();
  await expect(page.getByLabel("Export operations pack")).toContainText("Client-side download");
  const [changedJsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download JSON" }).click(),
  ]);
  const changedJsonPath = await changedJsonDownload.path();
  expect(changedJsonPath).toBeTruthy();
  const changedPack = JSON.parse(await readFile(changedJsonPath!, "utf8")) as { campaign: { sourceBaselineChanged: boolean } };
  expect(changedPack.campaign.sourceBaselineChanged).toBe(true);

  const [changedMarkdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  const changedMarkdownPath = await changedMarkdownDownload.path();
  expect(changedMarkdownPath).toBeTruthy();
  const changedMarkdown = await readFile(changedMarkdownPath!, "utf8");
  expect(changedMarkdown).toContain("Source update warning: read-only source changed after this local workspace started");

  await page.getByRole("button", { name: /Overview/ }).first().click();
  await page.getByRole("button", { name: "Acknowledge updated source" }).click();
  await expect(page.getByText("Read-only source has changed since this local workspace started.")).toHaveCount(0);
});

test("operations workbench: all real campaign routes export source-specific local packs", async ({ page }) => {
  const campaigns = {
    "69f257b6-9913-4395-94f7-5c25b4b5fe95": {
      title: "Keep KFC Out of Ormskirk",
      place: "Ormskirk, Lancashire",
      status: "partial",
      unresolved: 34,
      next: "Check the Planning Inspectorate appeals database before public escalation",
      slug: "keep-kfc-out-of-ormskirk",
    },
    "57678ae0-29fd-4b4b-8a53-5c711cdb21cf": {
      title: "Build 5,000 affordable houses in Tower Hamlets in the next 3 years",
      place: "Tower Hamlets, London",
      status: "partial",
      unresolved: 22,
      next: "Verify the exact affordable housing targets from council papers",
      slug: "build-5-000-affordable-houses-in-tower-hamlets-in-the-next",
    },
    "6b54225d-afa3-41d1-b053-89741094f153": {
      title: "Stop the leisure park redevelopment in Barnet",
      place: "Barnet, London",
      status: "completed",
      unresolved: 17,
      next: "Retrieve the GLA decision report and Barnet committee minutes",
      slug: "stop-the-leisure-park-redevelopment-in-barnet",
    },
  } as const;

  await page.route(/\/api\/operations\/sources\/([^/]+)$/, async (route) => {
    const id = route.request().url().match(/sources\/([^/]+)$/)?.[1] as keyof typeof campaigns;
    const campaign = campaigns[id];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId: id, status: campaign.status, stateVersion: 7, lastSequence: 21, events: [] },
        documents: campaignOperationsDocuments(campaign, {
          objective_theory_of_change: `OBJECTIVE AND THEORY OF CHANGE\n\nDecision-maker: Local decision route for ${campaign.title}\n\nMinimum viable win: Verified public evidence boundary before any local operations work is approved.`,
          organising_plan: `ORGANISING PLAN\n\nResidents and campaign supporters for ${campaign.place} are source audience clues only.`,
          digital_pack: `DIGITAL CAMPAIGN PACK\n\nSupporter email — ${campaign.title}\n\nSubject: Source update for ${campaign.place}\n\nUse verified source boundaries before outreach.`,
        }),
        evidence: campaignEvidence(
          [{ id: "next", description: campaign.next, reason: "Export should carry source-specific evidence gates", affectedSections: ["evidence"] }],
          campaign.unresolved,
        ),
      }),
    });
  });

  for (const [id, campaign] of Object.entries(campaigns)) {
    await page.goto(`/operations?campaignId=${id}&view=outbox`);
    await expect(page.getByText(`${campaign.title} · ${campaign.place}`)).toBeVisible();
    await expect(page.getByLabel("Export operations pack")).toContainText("Client-side download");
    await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);

    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download JSON" }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(new RegExp(`${campaign.slug}-operations-pack-\\d{4}-\\d{2}-\\d{2}\\.json`));
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).toBeTruthy();
    const pack = JSON.parse(await readFile(jsonPath!, "utf8")) as {
      campaign: { id: string; title: string; place: string; sourceOrigin: string; runStatus: string };
      boundary: { sourceWriteBack: string; contactImport: string; providerSending: string; responsesOrResults: string };
      evidence: { totals: { unresolvedLoadBearing: number }; nextChecks: Array<{ description: string }> };
    };

    expect(pack.campaign).toMatchObject({
      id,
      title: campaign.title,
      place: campaign.place,
      sourceOrigin: "https://campaign-factory.vercel.app",
      runStatus: campaign.status,
    });
    expect(pack.boundary.sourceWriteBack).toBe("Not connected");
    expect(pack.boundary.contactImport).toBe("No real contacts imported for this campaign");
    expect(pack.boundary.providerSending).toBe("Not connected");
    expect(pack.boundary.responsesOrResults).toContain("no delivery or outcome is claimed");
    expect(pack.evidence.totals.unresolvedLoadBearing).toBe(campaign.unresolved);
    expect(pack.evidence.nextChecks[0].description).toBe(campaign.next);
    expect(JSON.stringify(pack)).not.toContain("St John the Baptist");
    expect(JSON.stringify(pack)).not.toContain("demo-fixture");
  }
});

test("operations workbench: campaignId route loads a read-only public campaign source", async ({ page }) => {
  const campaignId = "69f257b6-9913-4395-94f7-5c25b4b5fe95";
  const documentRows = [
    ["campaign_brief", "Campaign Brief", "ready", "Keep KFC Out of Ormskirk\n\nPlace: Ormskirk, Lancashire\n\nTHE PROBLEM\nThe source brief says the campaign must defend the council refusal against appeal risk."],
    ["objective_theory_of_change", "Objective and Theory of Change", "ready", "OBJECTIVE AND THEORY OF CHANGE\n\nDecision-maker: Planning Inspectorate appeal decision-maker\n\nSpecific action: dismiss any appeal and uphold West Lancashire Borough Council's refusal\n\nBy: only after the official appeal status is verified\n\nMinimum viable win: a dated, citable official appeal record is retrieved and used before public escalation."],
    ["power_stakeholder_map", "Power and Stakeholder Map", "ready", "POWER AND STAKEHOLDER MAP\n\nDecides\n\nPlanning Inspector — National appeal body, Planning Inspectorate\n\nPower: High\n\nPosition: Appeal decision-maker whose current decision status is unverified\n\nInfluences\n\nWard councillor — Existing elected ally\n\nPower: Medium\n\nPosition: Can coordinate residents and planning officers without becoming an imported contact."],
    ["campaign_strategy", "Campaign Strategy", "ready", "CAMPAIGN STRATEGY\n\nRoute to influence\n\nPrivate/formal first: confirm appeal status before any public action and use official written-representation routes only if live.\n\nCoalition strategy\n\nAffected residents and Cllr Gareth Dowling remain the core coalition while school-community voices provide careful evidence.\n\nPriority audiences\n\n- Residents directly affected by amenity and noise\n\n- Parents linked to the school route"],
    ["tactics_timeline", "Tactics and Timeline", "ready", "TACTICS AND TIMELINE\n\nP0 Official status verification of appeal/decision\n\nType: research/administrative\n\nTarget: Planning Inspectorate appeals database\n\nP0 Private coordination with Cllr Gareth Dowling and planning officers"],
    ["organising_plan", "Organising Plan", "ready", "ORGANISING PLAN\n\nCoordinate residents without implying a connected CRM."],
    [
      "lobbying_pack",
      "Lobbying Pack",
      "ready",
      [
        "LOBBYING PACK",
        "",
        "Phone Script — Council Planning Team",
        "",
        "OPEN: Hello, I am checking the current public status of the Ormskirk KFC planning application before residents reuse stronger campaign claims.",
        "",
        "ASK: Could you point me to the official appeal record or confirm there is no live appeal listed?",
        "",
        "Before you send this, check",
        "",
        "- Do not imply a named officer has already confirmed the status.",
      ].join("\n"),
    ],
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
  ];
  const documentSectionKeys: Record<string, string[]> = {
    campaign_brief: ["problem", "evidence", "objective", "decision_route", "power", "pressure", "strategy", "tactics", "organising"],
    objective_theory_of_change: ["objective"],
    power_stakeholder_map: ["power", "pressure"],
    campaign_strategy: ["strategy"],
    tactics_timeline: ["tactics"],
    organising_plan: ["organising"],
    lobbying_pack: [],
    media_pack: [],
    digital_pack: [],
  };

  const documents = documentRows.map(([key, name, status, plainText], index) => {
    const textWithDisclaimer = withCompiledDocumentDisclaimer(plainText);
    const flags = index >= 6 && textWithDisclaimer.includes("Before you send this, check") ? ["Contains explicit verification placeholders."] : [];
    return {
      key,
      num: index + 1,
      name,
      status,
      html: `<p>${textWithDisclaimer}</p>`,
      plainText: textWithDisclaimer,
      isPack: index >= 6,
      sectionKeys: documentSectionKeys[key],
      resourceCount: key === "media_pack" ? 0 : index >= 6 ? 2 : 0,
      flags,
    };
  });

  await page.route(`**/api/operations/sources/${campaignId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sourceOrigin: "https://campaign-factory.vercel.app",
        run: { campaignId, status: "partial", stateVersion: 44, lastSequence: 1909, events: [] },
        documents,
        evidence: campaignEvidence(
          [
            {
              id: "appeal-check",
              description: "Check the Planning Inspectorate appeals database for any live or decided appeal on this site",
              reason: "Determines whether the campaign is defending a refusal on appeal, which changes tactics and timeline entirely",
              affectedSections: ["decision_route", "strategy"],
            },
            {
              id: "resident-evidence-check",
              description: "Confirm whether resident amenity evidence can be quoted beyond the planning objection bundle",
              reason: "Public supporter copy needs consent and quotation boundaries before stronger claims are reused",
              affectedSections: ["digital_pack", "organising_plan"],
            },
          ],
          34,
        ),
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
  await expect(page.getByLabel("Source next checks ledger")).toContainText("Confirm whether resident amenity evidence can be quoted");
  await expect(page.getByLabel("Source document readiness")).toContainText("Media Pack");
  await page.getByLabel("Source next checks ledger").getByRole("button", { name: "Create action" }).nth(1).click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByLabel("Recommended source actions").getByText(/Check: Confirm whether resident amenity evidence/)).toBeVisible();
  await page.getByRole("button", { name: /Evidence & checks/ }).first().click();
  await page.getByRole("button", { name: "Create appeal-status action" }).click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("Confirm Planning Inspectorate appeal status", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Source campaign 69f257b6-9913-4395-94f7-5c25b4b5fe95/).first()).toBeVisible();
  await page.getByLabel(/Status for Confirm Planning Inspectorate appeal status/).selectOption("in_progress");
  await expect(page.getByLabel(/Status for Confirm Planning Inspectorate appeal status/)).toHaveValue("in_progress");
  await expect(page.getByRole("link", { name: /Back to source brief|View original brief/ }).first()).toHaveAttribute(
    "href",
    `https://campaign-factory.vercel.app/factory/c/${campaignId}`,
  );
  await expect(page.getByRole("heading", { name: /Make the St John the Baptist school street/i })).toHaveCount(0);
  await expect(page.getByText(/School-gate families|Nearby ward parents|Clean Air Leicester|St John the Baptist/)).toHaveCount(0);

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await expect(page.getByLabel("Source pack resources")).toContainText("Supporter email — status update");
  await expect(page.getByLabel("Source pack resources")).toContainText("Phone Script — Council Planning Team");
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
  await page.getByLabel("Source pack resources").getByRole("button", { name: "Use in editable draft" }).last().click();
  await expect(page.getByRole("heading", { name: /Working copy: Phone Script — Council Planning Team/i })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("Phone Script — Council Planning Team");
  await expect(page.getByLabel("Message")).toHaveValue(/Could you point me to the official appeal record/);
  await expect(page.getByText(/Do not imply a named officer has already confirmed the status/i)).toBeVisible();

  await page.getByRole("button", { name: /Campaign brief/ }).first().click();
  await expect(page.getByText("What the source says", { exact: true })).toBeVisible();
  await expect(page.getByText(/source brief says the campaign must defend the council refusal/i)).toBeVisible();
  await page.getByRole("button", { name: /Objective & targets/ }).first().click();
  await expect(page.getByText("Planning Inspectorate appeal decision-maker")).toBeVisible();
  await expect(page.getByText(/a dated, citable official appeal record/i)).toBeVisible();
  await page.getByRole("button", { name: /Power map/ }).first().click();
  await expect(page.getByLabel("Source-backed stakeholder lanes")).toContainText("Planning Inspector");
  await expect(page.getByLabel("Source-backed stakeholder lanes")).toContainText("Appeal decision-maker whose current decision status is unverified");
  await page.getByRole("button", { name: /Strategy & tactics/ }).first().click();
  await expect(page.getByText(/Private\/formal first: confirm appeal status/i)).toBeVisible();
  await expect(page.getByText("P0 Official status verification of appeal/decision", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Source tactic action candidates")).toContainText("target: Planning Inspectorate appeals database");
  await page.getByLabel("Source tactic action candidates").getByRole("button", { name: "Create local action" }).first().click();
  await expect(page.getByRole("heading", { name: "Owned local work from source checks" })).toBeVisible();
  await expect(page.getByText("P0 Official status verification of appeal/decision", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Campaign source · Tactics and Timeline · research\/administrative/)).toBeVisible();
  await page.getByRole("button", { name: /Audiences/ }).first().click();
  await expect(page.getByLabel("Source audience signals")).toContainText("Priority audience sequence");
  await expect(page.getByLabel("Source audience signals")).toContainText("Residents directly affected by amenity and noise");
  await expect(page.getByLabel("Audience segments")).toContainText("Parents linked to the school route");
});
