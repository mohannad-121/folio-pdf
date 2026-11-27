#!/usr/bin/env node
// Freeze the FastAPI backend with PyInstaller into desktop/build/backend/.
//
// Python is resolved in this order:
//   1. $FOLIO_PYTHON
//   2. ../backend/.venv  (Scripts/python.exe on Windows, bin/python elsewhere)
//   3. python3 / python on PATH
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, renameSync, mkdirSync } from 'node:fs';
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
moveDir(join(distPath, 'folio-server'), target);
rmSync(distPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });

/**
 * Rename with retries. On Windows, antivirus (Defender) often holds freshly written .exe/.dll
 * files open for a few seconds, making the rename fail with EPERM/EBUSY; wait and retry, then
 * fall back to copy + delete.
 */
function moveDir(from, to) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      console.warn(`[build-backend] ${e.code} moving ${from} (attempt ${attempt}/10), retrying...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * attempt);
    }
  }
  console.warn('[build-backend] rename kept failing, copying instead');
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

const exe = join(target, isWin ? 'folio-server.exe' : 'folio-server');
if (!existsSync(exe)) {
  console.error(`[build-backend] expected executable missing: ${exe}`);
  process.exit(1);
}
console.log(`[build-backend] OK -> ${exe}`);
