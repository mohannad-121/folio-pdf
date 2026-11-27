#!/usr/bin/env node
// Freeze the FastAPI backend with PyInstaller into desktop/build/backend/.
//
// Python is resolved in this order:
//   1. $FOLIO_PYTHON
//   2. ../backend/.venv  (Scripts/python.exe on Windows, bin/python elsewhere)
//   3. python3 / python on PATH
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const backendDir = resolve(desktopDir, '..', 'backend');
const buildDir = join(desktopDir, 'build');
const isWin = process.platform === 'win32';

function works(py) {
  const r = spawnSync(py, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function findPython() {
  if (process.env.FOLIO_PYTHON) return process.env.FOLIO_PYTHON;
  const venv = isWin
    ? join(backendDir, '.venv', 'Scripts', 'python.exe')
    : join(backendDir, '.venv', 'bin', 'python');
  if (existsSync(venv)) return venv;
  for (const candidate of isWin ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    if (works(candidate)) return candidate;
  }
  throw new Error('No Python found. Set FOLIO_PYTHON or create backend/.venv.');
}

const python = findPython();
console.log(`[build-backend] python: ${python}`);

const check = spawnSync(python, ['-c', 'import PyInstaller, sys; print(PyInstaller.__version__, sys.version)'], {
  encoding: 'utf8',
});
if (check.status !== 0) {
  console.error('[build-backend] PyInstaller is not installed for this interpreter.');
  console.error(`  Run: "${python}" -m pip install pyinstaller`);
  process.exit(1);
}
console.log(`[build-backend] PyInstaller ${check.stdout.trim()}`);

const distPath = join(buildDir, 'pyinstaller-dist');
const workPath = join(buildDir, 'pyinstaller-work');
const target = join(buildDir, 'backend');
mkdirSync(buildDir, { recursive: true });
rmSync(distPath, { recursive: true, force: true });

const r = spawnSync(
  python,
  ['-m', 'PyInstaller', 'folio.spec', '--noconfirm', '--clean', '--distpath', distPath, '--workpath', workPath],
  { cwd: backendDir, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } },
);
if (r.status !== 0) {
  console.error(`[build-backend] PyInstaller failed (exit ${r.status}).`);
  process.exit(r.status ?? 1);
}

rmSync(target, { recursive: true, force: true });
renameSync(join(distPath, 'folio-server'), target);
rmSync(distPath, { recursive: true, force: true });

const exe = join(target, isWin ? 'folio-server.exe' : 'folio-server');
if (!existsSync(exe)) {
  console.error(`[build-backend] expected executable missing: ${exe}`);
  process.exit(1);
}
console.log(`[build-backend] OK -> ${exe}`);
