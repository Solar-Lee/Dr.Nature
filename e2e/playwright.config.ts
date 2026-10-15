// [P11-02a] Storefront device matrix: behaviour checks on the static export (apps/storefront/out).
// Docs: https://playwright.dev/docs/test-webserver, /docs/emulation, /docs/browsers (checked 2026-10-15
// against @playwright/test 1.64.1). How to run: docs/ops/preview-storefront.md.
//
// - The build is a precondition: `pnpm --dir apps/storefront exec next build` writes out/; this config
//   refuses to start without out/index.html (scripts/test-all.sh runs it after storefront:build).
// - A plain python static server on 127.0.0.1:3071 (port range 3070-3079 given to lane F;
//   TODO(需查證): docs/server-inventory.md is not in this repo, add the row there when it is). It is
//   started fresh every run (reuseExistingServer: false) so a stale server can never answer for it.
// - E2E_BASE_URL (docs/ENV.md) points the run at another site instead; then no server is started.
// - Browsers come from PLAYWRIGHT_BROWSERS_PATH when it is set (Mac mini: $HOME/drn/pw-browsers,
//   CLAUDE.md §1b), else Playwright's default cache.
import { defineConfig, devices, type Project } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = 3071;
const OUT = path.resolve(__dirname, "../apps/storefront/out");
const external = process.env.E2E_BASE_URL;

if (!external && !existsSync(path.join(OUT, "index.html"))) {
  throw new Error(`e2e: ${OUT}/index.html is missing. Build the storefront first: pnpm --dir apps/storefront exec next build`);
}

const desktop = { viewport: { width: 1280, height: 800 } };

// Tags decide which tests a project runs (no skipped noise in the report):
//   @motion  scroll choreography, not under reduced motion   @reduced  only under reduced motion
//   @mobile  the top bar menu (viewport < 1024px)             @once     site-level checks, one project
const desktopOnly = /@mobile|@reduced|@once/;
const mobileOnly = /@reduced|@once/;

const projects: Project[] = [
  { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], ...desktop }, grepInvert: /@mobile|@reduced/ },
  { name: "webkit-desktop", use: { ...devices["Desktop Safari"], ...desktop }, grepInvert: desktopOnly },
  { name: "firefox-desktop", use: { ...devices["Desktop Firefox"], ...desktop }, grepInvert: desktopOnly },
  { name: "chromium-iphone14", use: { ...devices["iPhone 14"], browserName: "chromium" }, grepInvert: mobileOnly },
  { name: "webkit-iphone14", use: { ...devices["iPhone 14"] }, grepInvert: mobileOnly },
  { name: "chromium-pixel7", use: { ...devices["Pixel 7"] }, grepInvert: mobileOnly },
  {
    name: "chromium-reduced-motion",
    use: { ...devices["Desktop Chrome"], ...desktop, reducedMotion: "reduce" },
    grepInvert: /@motion|@mobile|@once/,
  },
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory "${OUT}"`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
        stdout: "ignore",
        stderr: "ignore",
        timeout: 30_000,
      },
  projects,
});
