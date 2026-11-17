import { defineConfig } from '@playwright/test';

const PORT = 4400;

/**
 * End-to-end tests: real browsers against the real production build and server.
 * Unit and integration tests run separately through `ng test`.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Use the locally installed Chrome, so no browser download is needed.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && node dist/secure-live-message/server/server.mjs`,
    url: `http://localhost:${PORT}`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
