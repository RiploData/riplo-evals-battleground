import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Playwright e2e specs run via `npm run test:e2e`, not vitest.
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
    // Integration tests run against a DEDICATED database (arena_test), provisioned
    // and migrated by global-setup, so they never collide with the dev database's
    // real seeded corpus. They still share one test DB, and the importers query/upsert
    // by name+hash globally, so files run sequentially to avoid cross-file collisions.
    fileParallelism: false,
    globalSetup: './tests/global-setup.ts',
    env: {
      DATABASE_URL: 'postgres://arena:arena@localhost:5544/arena_test',
      // Keep the dev-auth bypass OFF during tests so the WorkOS path is exercised.
      // (dotenv/config in test files will not override an already-set key.)
      ARENA_DEV_AUTH_EMAIL: '',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
