// Regenerates .expo/types/router.d.ts (typed routes) without starting Metro, so `tsc` sees every route.
// Uses the same generator `expo start` runs.
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
process.env.EXPO_ROUTER_APP_ROOT = path.join(projectRoot, 'app');
const typedRoutes = require(
  require.resolve('@expo/router-server/build/typed-routes', { paths: [projectRoot] }),
);
const outDir = path.join(projectRoot, '.expo/types');
// A fresh checkout has no .expo folder yet (it is git-ignored).
fs.mkdirSync(outDir, { recursive: true });
typedRoutes.regenerateDeclarations(outDir, {});
