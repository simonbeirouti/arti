import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.ts',
  outputDir: '/tmp/arti-shared-website-browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'pnpm exec vite --config apps/console/vite.config.ts --port 5190', url: 'http://127.0.0.1:5190', reuseExistingServer: true, cwd: fileURLToPath(new URL('../../../../../', import.meta.url)) },
});
