import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    // The integration tests spawn real git subprocesses — init, add, commit,
    // write-tree, diff — several times per case. Vitest's 5s default is enough
    // on an idle machine and not enough with four files running in parallel,
    // which showed up as tests timing out on one run and passing on the next.
    // A flaky suite in CI is worse than a slow one: it trains you to re-run
    // instead of read.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
