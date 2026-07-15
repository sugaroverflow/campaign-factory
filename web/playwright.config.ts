import { defineConfig, devices } from "@playwright/test";

// Campaign Factory end-to-end suite (PLAYWRIGHT workstream).
//
// Parameterised entirely by env so the SAME suite runs against localhost (mock
// worker) now and a Vercel preview URL later:
//   PW_BASE_URL            base origin              (default http://localhost:3000)
//   PW_PRESENTER_CODE      presenter code           (default factory-rehearsal-2026)
//   PW_TERMINAL_TIMEOUT_MS batch terminal wait      (default 5 min — mock; use ~25 min live)
//   PW_FIRST_CARD_TIMEOUT_MS  first-agent-card wait (default 60 s — mock; use ~120 s live)
//   PW_TEST_TIMEOUT_MS     per-test hard cap        (default = terminal + 10 min buffer)
//
// The long live waits are deliberately expressed PER-ASSERTION (see the specs),
// not as one giant global timeout, so a genuine hang fails fast on the right step.

const TERMINAL_TIMEOUT_MS = Number(process.env.PW_TERMINAL_TIMEOUT_MS) || 5 * 60_000;
const TEST_TIMEOUT_MS =
  Number(process.env.PW_TEST_TIMEOUT_MS) || TERMINAL_TIMEOUT_MS + 10 * 60_000;

export default defineConfig({
  testDir: "./tests/factory",
  testMatch: "**/*.spec.ts",

  // One live factory run at a time — the specs drive the real worker + dev DB
  // that other agents share, so we never fan out into parallel runs.
  fullyParallel: false,
  workers: 1,
  retries: Number(process.env.PW_RETRIES) || 0,

  // Per-test cap sized to the longest journey (a full live batch). Individual
  // long polls carry their own explicit { timeout } so hangs surface precisely.
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: 15_000 },

  outputDir: "test-results/artifacts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/html", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  use: {
    baseURL: process.env.PW_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  // No webServer block on purpose: the dev server (:3000) and mock worker
  // (:8787) are started and owned outside this suite; we never boot or kill them.

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
