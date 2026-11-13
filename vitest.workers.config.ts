import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({
    main: './tests/workers/entry.ts',
    remoteBindings: false,
    miniflare: {
      compatibilityDate: '2026-10-12',
      compatibilityFlags: ['nodejs_compat'],
      bindings: { BACKUPS_ENABLED: 'true', BACKUP_ALLOWANCE_USD: '0.5', LIVE_ACTIVATED: 'true', DAILY_ALLOWANCE_USD: '5', MODEL_EVALUATED: 'true', MODEL_EVALUATION_ID: 'de120033-e240-4edf-b0e0-20623c9571fc', BACKUP_ENVIRONMENT: 'test-binding-fingerprint', EVALUATIONS_ENABLED: 'true', EVALUATION_ALLOWANCE_USD: '0.75', ENVIRONMENT_NAME: 'test-evaluation-budget' },
      r2Buckets: { WORLD_BACKUPS: 'private-world', WORLD_BUILDS: 'private-builds', BUILDS: 'private-builds' },
      d1Databases: { PUBLIC_INDEX: 'arti-test-index' },
      durableObjects: { WORLD: { className: 'WorldDurableObject', useSQLite: true }, ENTITY_AGENT: { className: 'EntityAgent', useSQLite: true }, APP_DATA: { className: 'ApplicationStore', useSQLite: true } },
    },
  })],
  test: { include: ['tests/workers/**/*.test.ts', 'apps/world/features/**/*.worker.ts'] },
});
