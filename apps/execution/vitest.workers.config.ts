import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({
    main: './apps/execution/features/application-services/test-entry.ts',
    remoteBindings: false,
    miniflare: {
      compatibilityDate: '2026-10-12',
      compatibilityFlags: ['nodejs_compat'],
      r2Buckets: ['BUILDS'],
      durableObjects: { APP_DATA: { className: 'ApplicationStore', useSQLite: true }, WORLD: { className: 'WriteAuthority', useSQLite: true } },
    },
  })],
  test: { include: ['apps/execution/**/*.worker.ts'], testTimeout: 30_000 },
});
