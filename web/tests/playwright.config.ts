import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: '/tmp/milestone-playwright-results',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:43187/site/', browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined } },
  webServer: { command: 'node tests/serve.mjs', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:43187/site/', reuseExistingServer: true, timeout: 10_000 },
});
