// `pnpm dev`: boots the whole stack locally with fake adapters.
// 1) .env from .env.example if missing  2) docker-compose infra  3) build shared  4) migrate + bucket + seed  5) turbo dev
import { execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (!existsSync(resolve(root, '.env'))) {
  copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
  console.log('Created .env from .env.example (fake adapters, no keys needed).');
}

sh('docker compose -f infra/docker/docker-compose.yml up -d --wait');
sh('pnpm turbo run build --filter=@touchgrass/shared --filter=@touchgrass/api');
const withEnv = 'node --env-file=../../.env';
sh(`cd apps/api && ${withEnv} dist/infra/database/migrate.cli.js up`);
sh(`cd apps/api && ${withEnv} dist/adapters/storage/storage-init.cli.js`);
sh(`cd apps/api && ${withEnv} dist/seed/seed.cli.js`);

const dev = spawn('pnpm', ['turbo', 'run', 'dev', '--ui=stream', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
dev.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => dev.kill('SIGINT'));
