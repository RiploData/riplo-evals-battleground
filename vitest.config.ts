import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests run against a DEDICATED database (arena_test), provisioned
    // and migrated by global-setup, so they never collide with the dev database's
    // real seeded corpus. They still share one test DB, and the importers query/upsert
    // by name+hash globally, so files run sequentially to avoid cross-file collisions.
    fileParallelism: false,
    globalSetup: './tests/global-setup.ts',
    env: {
      DATABASE_URL: 'postgres://arena:arena@localhost:5544/arena_test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
