import { node } from '@touchgrass/config/eslint/node';

export default [
  ...node(import.meta.dirname),
  { ignores: ['scripts/**', 'src/infra/database/migrations/**'] },
];
