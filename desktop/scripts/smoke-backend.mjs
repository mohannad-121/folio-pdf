#!/usr/bin/env node
// Smoke test for the frozen backend in desktop/build/backend (used locally and in CI).
// Starts folio-server on a free port, checks /api/health and the SPA index, uploads a tiny
// PDF, calls /api/organize/rotate and downloads the result. Exits non-zero on failure.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const isWin = process.platform === 'win32';
const exe = join(desktopDir, 'build', 'backend', isWin ? 'folio-server.exe' : 'folio-server');
const staticDir = join(desktopDir, 'build', 'frontend-dist');

// Minimal valid one-page PDF (xref offsets computed below).
function tinyPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const dataDir = mkdtempSync(join(tmpdir(), 'folio-smoke-'));
const base = `http://127.0.0.1:${port}`;
console.log(`[smoke] ${exe} on ${base} (data ${dataDir})`);

const child = spawn(exe, [], {
  env: {
    ...process.env,
    FOLIO_HOST: '127.0.0.1',
    FOLIO_PORT: String(port),
    FOLIO_DATA_DIR: dataDir,
    FOLIO_STATIC_DIR: staticDir,
    FOLIO_BILLING_ENABLED: 'false',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: true,
});

function stop() {
  if (child.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`[smoke] ok   ${name}`);
  } catch (err) {
    console.error(`[smoke] FAIL ${name}: ${err.message}`);
    throw err;
  }
}

let failed = false;
try {
  const deadline = Date.now() + 90_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        health = await r.json();
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!health) throw new Error('health check timed out');
  console.log('[smoke] health', JSON.stringify(health));

  await check('GET / serves index.html', async () => {
    const r = await fetch(`${base}/`);
    const html = await r.text();
    if (!r.ok || !html.includes('<div id="root"')) throw new Error(`status ${r.status}`);
  });

  let fileId;
  await check('POST /api/files', async () => {
    const form = new FormData();
    form.append('files', new Blob([tinyPdf()], { type: 'application/pdf' }), 'smoke.pdf');
    const r = await fetch(`${base}/api/files`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`status ${r.status}: ${await r.text()}`);
    fileId = (await r.json())[0].file_id;
  });

  let outId;
  await check('POST /api/organize/rotate (auto-discovered tool router)', async () => {
    const r = await fetch(`${base}/api/organize/rotate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, angle: 90 }),
    });
    if (!r.ok) throw new Error(`status ${r.status}: ${await r.text()}`);
    outId = (await r.json()).outputs[0].file_id;
  });

  await check('GET rotated download', async () => {
    const r = await fetch(`${base}/api/files/${outId}/download`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !buf.subarray(0, 5).toString().startsWith('%PDF')) throw new Error(`status ${r.status}`);
  });

  await check('GET /openapi.json lists tool routes', async () => {
    const spec = await (await fetch(`${base}/openapi.json`)).json();
    const areas = new Set(Object.keys(spec.paths).map((p) => p.split('/')[2]));
    console.log(`[smoke] API areas: ${[...areas].sort().join(', ')}`);
    for (const a of ['organize', 'convert', 'security', 'sign']) {
      if (!areas.has(a)) throw new Error(`missing /api/${a}`);
    }
  });
} catch {
  failed = true;
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows file locks */
  }
}
console.log(failed ? '[smoke] FAILED' : '[smoke] PASSED');
process.exit(failed ? 1 : 0);
