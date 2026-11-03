import globals from 'globals';
import { next } from '@touchgrass/config/eslint/next';

export default [
  ...next(import.meta.dirname),
  { files: ['e2e/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  { ignores: ['next-env.d.ts', 'playwright-report/**', 'test-results/**', 'e2e/.auth/**'] },
];
