import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata is emitted in tests.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test-support/**',
        'src/**/*.cli.ts',
        'src/main.ts',
        'src/realtime.ts',
        'src/worker.ts',
        'src/infra/telemetry/**',
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
    },
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
