import process from 'node:process'
import { defineConfig } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * End-to-end tests, run against the production build.
 *
 * This machine cannot run Playwright's own browsers, so they come from nix —
 * and CI takes them from the same shell, so both drive the same binary:
 *
 *     nix develop .#playwright -c pnpm test:e2e
 *
 * The shell exports `PLAYWRIGHT_BROWSERS_PATH` at the nixpkgs
 * `playwright-driver.browsers` derivation, which pins one set of browser
 * revisions. `@playwright/test` is therefore pinned exactly (no caret) to the
 * matching version — bump the two together, or a launch fails with
 * "Executable doesn't exist". Check what nixpkgs has with:
 *
 *     nix eval --raw 'github:NixOS/nixpkgs/nixos-26.05#playwright-driver.version'
 *
 * See e2e/README.md for the Etesync server the sync tests want.
 */
export default defineConfig({
  testDir: './e2e',
  // A run drives IndexedDB, a service worker and (for the sync tests) a real
  // server per browser context; one worker keeps that off each other's toes
  // and keeps failures reproducible. There are only a handful of tests.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    // The UI is phone-first; this is the viewport it is designed for. Not
    // `isMobile`, which changes little here beyond making clicks flakier.
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

  // The built app, not the dev server: the service worker, the lazy route
  // chunks and the minified bundle are all part of what is being checked.
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
