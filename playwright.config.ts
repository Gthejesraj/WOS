import { defineConfig } from '@playwright/test'

/**
 * Playwright config for WOS Electron e2e tests.
 *
 * Prerequisites:
 *   - `npm run package` has produced `.vite/build/main.js`
 *     (or run `npm run lint && npx vite build` to build renderer+main).
 *
 * Run with: `npx playwright test`
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
