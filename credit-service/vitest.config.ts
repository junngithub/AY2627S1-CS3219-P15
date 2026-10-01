import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/constants.ts';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // DB integration tests share one database — run files serially so their
    // TRUNCATEs don't race each other.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: TEST_DATABASE_URL,
      CREDIT_SERVICE_PORT: '3000',
      DB_POOL_MAX: '10',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts', // bootstrap: listen + graceful shutdown
        'src/app.ts', // bootstrap: Fastify instance + logger wiring
        'src/config.ts', // env plumbing (?? defaults); exercised by every test
        'src/database/schema.ts', // declarative; thunks run only during migration
      ],
      // Scoped logic sits at 100%; this floor flags any real regression.
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
});
