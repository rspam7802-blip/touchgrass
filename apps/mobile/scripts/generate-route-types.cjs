// Regenerates .expo/types/router.d.ts (typed routes) without starting Metro, so `tsc` sees every route.
// Uses the same generator `expo start` runs.
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
process.env.EXPO_ROUTER_APP_ROOT = path.join(projectRoot, 'app');
const typedRoutes = require(
  require.resolve('@expo/router-server/build/typed-routes', { paths: [projectRoot] }),
);
typedRoutes.regenerateDeclarations(path.join(projectRoot, '.expo/types'), {});
