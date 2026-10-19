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
      RATING_SERVICE_PORT: '8085',
      DB_POOL_MAX: '10',
      KAFKA_BROKERS: '',
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
        'src/messaging/kafka.ts', // wiring to a real broker; its parts are tested separately
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
});
