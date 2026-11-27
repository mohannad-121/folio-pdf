#!/usr/bin/env node
// Build the React SPA and copy frontend/dist -> desktop/build/frontend-dist.
// Set FOLIO_SKIP_FRONTEND_BUILD=1 to only copy an existing frontend/dist.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const frontendDir = resolve(desktopDir, '..', 'frontend');
const src = join(frontendDir, 'dist');
const dest = join(desktopDir, 'build', 'frontend-dist');

if (process.env.FOLIO_SKIP_FRONTEND_BUILD !== '1') {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['--prefix', frontendDir, 'run', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32', // .cmd shims need a shell on Windows (Node >= 20 security change)
  });
  if (r.status !== 0) {
    console.error(`[build-frontend] frontend build failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(join(src, 'index.html'))) {
  console.error(`[build-frontend] ${src}/index.html not found`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[build-frontend] copied ${src} -> ${dest}`);
