#!/usr/bin/env node
// Regenerate the app icons in desktop/build/ (committed, so CI never needs this):
//   icon.png  1024x1024, macOS-style padding (mac + Linux; electron-builder derives .icns from it)
//   icon.ico  16..256 multi-size, tighter padding (Windows)
// Renders an HTML/SVG master with headless Edge or Chrome (transparent background), then uses
// Pillow (backend venv or FOLIO_PYTHON) to build the .ico.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const out = join(desktopDir, 'build');

const browsers = [
  process.env.FOLIO_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browser = browsers.find((b) => existsSync(b));
if (!browser) throw new Error('No Edge/Chrome found; set FOLIO_BROWSER');

// inset = transparent margin around the rounded square (fraction of the canvas).
function html(inset) {
  const size = 1024;
  const box = Math.round(size * (1 - 2 * inset));
  const radius = Math.round(box * 0.225);
  return `<!doctype html><html><head><style>
  html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
  .box{position:absolute;left:${(size - box) / 2}px;top:${(size - box) / 2}px;width:${box}px;height:${box}px;
    border-radius:${radius}px;overflow:hidden;
    background:linear-gradient(135deg,#4a63ff 0%,#3f4ff8 38%,#7c3aed 100%);
    box-shadow:inset 0 ${Math.round(box * 0.012)}px 0 rgba(255,255,255,.35), inset 0 -${Math.round(box * 0.02)}px ${Math.round(box * 0.05)}px rgba(40,10,120,.35)}
  .shine{position:absolute;left:-10%;top:-62%;width:120%;height:100%;transform:rotate(12deg);
    background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.06))}
  svg{position:absolute;left:50%;top:50%;width:${Math.round(box * 0.6)}px;height:${Math.round(box * 0.6)}px;transform:translate(-50%,-50%);
    filter:drop-shadow(0 ${Math.round(box * 0.015)}px ${Math.round(box * 0.03)}px rgba(20,10,80,.35))}
  </style></head><body><div class="box"><div class="shine"></div>
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 3h7l5 5v13H7z" fill="rgba(255,255,255,.12)"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>
  </svg></div></body></html>`;
}

const tmp = mkdtempSync(join(tmpdir(), 'folio-icons-'));
function render(name, inset) {
  const page = join(tmp, `${name}.html`);
  writeFileSync(page, html(inset));
  const png = join(out, name);
  const r = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--user-data-dir=${join(tmp, 'profile')}`,
      '--window-size=1024,1024',
      `--screenshot=${png}`,
      pathToFileURL(page).href,
    ],
    { stdio: 'inherit', timeout: 60_000 },
  );
  if (r.status !== 0 || !existsSync(png)) throw new Error(`render failed for ${name}`);
  console.log(`[icons] ${png}`);
  return png;
}

render('icon.png', 0.098); // ~100px margin at 1024, like macOS Big Sur app icons
const winMaster = render('icon-win.png', 0.03);

const isWin = process.platform === 'win32';
const venvPy = join(desktopDir, '..', 'backend', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
const py = process.env.FOLIO_PYTHON || (existsSync(venvPy) ? venvPy : isWin ? 'python' : 'python3');
const code = `
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA')
sizes = [(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)]
src.save(sys.argv[2], format='ICO', sizes=sizes)
print('[icons]', sys.argv[2])
`;
const r = spawnSync(py, ['-c', code, winMaster, join(out, 'icon.ico')], { stdio: 'inherit' });
rmSync(winMaster, { force: true });
rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status ?? 1);
