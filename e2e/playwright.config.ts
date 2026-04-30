import { defineConfig } from '@playwright/test'
import path from 'node:path'

// Driving harness — NOT a per-feature regression suite. Tests opt into longer
// timeouts because we boot a real Electron app + native sqlite.
export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, '.artifacts', 'html-report') }]],
  outputDir: path.join(__dirname, '.artifacts', 'test-results'),
  use: {
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
