// Dev runner: one tsc watcher, then node --watch for the api, realtime and worker processes.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../../../.env');
const envArgs = existsSync(envFile) ? [`--env-file=${envFile}`] : [];
const children = [];
const run = (cmd, args, name) => {
  const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '1' } });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${name}] exited with ${code}`);
  });
  children.push(child);
  return child;
};

const tsc = spawn(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
children.push(tsc);
let started = false;
tsc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!started && /Found 0 errors/.test(String(chunk))) {
    started = true;
    for (const entry of ['main', 'realtime', 'worker'])
      run('node', [...envArgs, '--watch', `dist/${entry}.js`], entry);
  }
});

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
