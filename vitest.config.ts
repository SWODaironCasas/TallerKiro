import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['./src/test-utils/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
