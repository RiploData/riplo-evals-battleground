import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests share one Postgres database and the importers query/upsert
    // by name+hash globally, so running test files in parallel causes cross-file
    // row collisions. Run files sequentially; the full suite is still only a few seconds.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
