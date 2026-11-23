import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const phone = { ...devices["Pixel 7"] };

/**
 * End-to-end tests run against the production build (`next build` first).
 * Screenshots land in docs/screenshots/phase-N/ (see e2e/helpers.ts).
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Several pages render WebGL at once; more workers than this just fight over one GPU.
  workers: 3,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Headless Chromium falls back to software WebGL unless told to use the GPU.
    launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] },
  },
  projects: [
    { name: "desktop", testIgnore: /perf.spec|missions.spec|lessons.spec|videos.spec/, use: desktop },
    { name: "mobile", testIgnore: /perf.spec|missions.spec|lessons.spec|videos.spec/, use: phone },
    // Missions write mastery for demo students the map tests also use, so they run after those, desktop then phone.
    { name: "missions-desktop", testMatch: /missions.spec/, dependencies: ["desktop", "mobile"], use: desktop },
    { name: "missions-mobile", testMatch: /missions.spec/, dependencies: ["missions-desktop"], use: phone },
    // Mistake Recap and explainers (Phase 6): they also build plans for the demo students, so after the mission runs.
    { name: "lessons-desktop", testMatch: /lessons.spec/, dependencies: ["missions-mobile"], use: desktop },
    { name: "lessons-mobile", testMatch: /lessons.spec/, dependencies: ["lessons-desktop"], use: phone },
    // Explainer videos (Phase 7): they rebuild plans too, so after the lessons.
    { name: "videos-desktop", testMatch: /videos.spec/, dependencies: ["lessons-mobile"], use: desktop },
    { name: "videos-mobile", testMatch: /videos.spec/, dependencies: ["videos-desktop"], use: phone },
    // Frame-rate measurements run last and alone, so nothing competes for the GPU.
    { name: "perf-desktop", testMatch: /perf.spec/, dependencies: ["videos-mobile"], use: desktop },
    { name: "perf-mobile", testMatch: /perf.spec/, dependencies: ["perf-desktop"], use: phone },
  ],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    // Its own database, so e2e runs never touch your local demo state.
    env: { DATABASE_PATH: process.env.DATABASE_PATH ?? "data/progresso-e2e.db" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
