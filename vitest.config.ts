import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'tests/**/*.test.ts', 'tooling/features/**/*.test.ts'], exclude: ['tests/e2e/**', 'tests/workers/**'], testTimeout: 15000 },
});
