'use strict';
// Folio PDF desktop shell.
//
// The window loads everything from a local FastAPI sidecar (frozen with PyInstaller) that
// also serves the built React app, so the UI, the API, cookies and pdf.js share one origin:
// http://127.0.0.1:<random port>/

const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeTheme, session, shell, clipboard, screen } =
  require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const log = require('electron-log/main');

const isDev = !app.isPackaged;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const DEV_URL = process.env.FOLIO_DEV_URL || '';
const REPO_URL = 'https://github.com/mohannad-121/folio-pdf';
const HEALTH_TIMEOUT_MS = 60_000;

const dataDir = path.join(app.getPath('userData'), 'data');
const logDir = path.join(dataDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });

log.transports.file.resolvePathFn = () => path.join(logDir, 'main.log');
log.transports.file.level = 'info';
log.initialize();
log.errorHandler.startCatching({ showDialog: false });
log.info(`Folio PDF ${app.getVersion()} starting (${process.platform}/${process.arch}, packaged: ${app.isPackaged})`);

/** @type {import('node:child_process').ChildProcess | null} */
let backend = null;
let baseUrl = '';
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let splash = null;
/** @type {BrowserWindow | null} */
let componentsWindow = null;
let ready = false;
let quitting = false;
const pendingFiles = [];

// ---- single instance + file associations ------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    for (const file of pdfArgs(argv)) openPdf(file);
  });

  // macOS: Finder "Open with", double-click, or a PDF dropped on the Dock icon. Can fire
  // before 'ready', so it only queues until the backend is up.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    openPdf(file);
  });

  app.whenReady().then(start).catch((err) => fatal('Folio PDF failed to start.', err));
}

function pdfArgs(argv) {
  // argv[0] is the executable (and argv[1] the app dir in dev). Accept existing *.pdf paths.
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && /\.pdf$/i.test(a))
    .map((a) => path.resolve(a))
    .filter((a) => {
      try {
        return fs.statSync(a).isFile();
      } catch {
        return false;
      }
    });
}

// ---- backend sidecar ------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function staticDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'frontend-dist');
  const built = path.join(__dirname, '..', 'build', 'frontend-dist');
  if (fs.existsSync(path.join(built, 'index.html'))) return built;
  return path.join(__dirname, '..', '..', 'frontend', 'dist');
}

function backendCommand() {
  if (app.isPackaged || process.env.FOLIO_USE_FROZEN_BACKEND === '1') {
    const dir = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(__dirname, '..', 'build', 'backend');
    return { cmd: path.join(dir, isWin ? 'folio-server.exe' : 'folio-server'), args: [] };
  }
  // Dev: run the backend from its virtualenv (or FOLIO_PYTHON).
  const backendDir = path.join(__dirname, '..', '..', 'backend');
  const venvPy = isWin ? path.join(backendDir, '.venv', 'Scripts', 'python.exe') : path.join(backendDir, '.venv', 'bin', 'python');
  const py = process.env.FOLIO_PYTHON || (fs.existsSync(venvPy) ? venvPy : isWin ? 'python' : 'python3');
  return { cmd: py, args: [path.join(backendDir, 'folio_server.py')] };
}

// GUI apps get a minimal PATH (macOS Finder launches don't see Homebrew; the Windows installers
// of Tesseract and Ghostscript don't touch PATH). Add the usual install locations so the
// backend's shutil.which() finds the optional tools.
function toolDirs() {
  const dirs = [];
  const exists = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  if (isWin) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (!base) continue;
      dirs.push(path.join(base, 'LibreOffice', 'program'), path.join(base, 'Tesseract-OCR'));
      try {
        const gs = path.join(base, 'gs');
        for (const v of fs.readdirSync(gs).sort().reverse()) dirs.push(path.join(gs, v, 'bin'));
      } catch {
        /* no ghostscript here */
      }
    }
  } else if (isMac) {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/Applications/LibreOffice.app/Contents/MacOS');
  } else {
    dirs.push('/usr/local/bin', '/usr/bin', '/snap/bin');
  }
  return dirs.filter(exists);
}

function backendPath() {
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return [...current, ...toolDirs().filter((d) => !current.includes(d))].join(path.delimiter);
}

function whichIn(names) {
  const dirs = backendPath().split(path.delimiter);
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs) {
    for (const n of names) {
      for (const e of exts) {
        const p = path.join(d, n + e);
        try {
          if (fs.statSync(p).isFile()) return p;
        } catch {
          /* keep looking */
        }
      }
    }
  }
  return null;
}

async function startBackend() {
  const port = await freePort();
  const { cmd, args } = backendCommand();
  const env = {
    ...process.env,
    PATH: backendPath(),
    FOLIO_HOST: '127.0.0.1',
    FOLIO_PORT: String(port),
    FOLIO_DATA_DIR: dataDir,
    FOLIO_STATIC_DIR: staticDir(),
    FOLIO_BILLING_ENABLED: 'false',
    FOLIO_FILE_TTL_SECONDS: '604800',
    FOLIO_EXIT_ON_STDIN_EOF: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  log.info(`Starting backend: ${cmd} ${args.join(' ')} on port ${port}`);
  const child = spawn(cmd, args, {
    cwd: dataDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX: own process group so the whole tree (ocrmypdf workers, soffice...) can be killed.
    detached: !isWin,
  });
  backend = child;
  child.stdout.on('data', (d) => log.info(`[backend] ${String(d).trimEnd()}`));
  child.stderr.on('data', (d) => log.info(`[backend] ${String(d).trimEnd()}`));
  child.on('error', (err) => {
    log.error('Backend failed to spawn', err);
    child.spawnError = err;
  });
  child.on('exit', (code, signal) => {
    log.info(`Backend exited (code ${code}, signal ${signal})`);
    if (backend === child) backend = null;
    if (!quitting && ready) {
      dialog
        .showMessageBox({
          type: 'error',
          title: 'Folio PDF',
          message: 'The Folio engine stopped unexpectedly.',
          detail: `Restart the app to continue. Logs: ${logDir}`,
          buttons: ['Restart', 'Open logs folder', 'Quit'],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 1) shell.openPath(logDir);
          if (response === 0) app.relaunch();
          app.quit();
        });
    }
  });
  return `http://127.0.0.1:${port}`;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.spawnError) throw child.spawnError;
    if (child && child.exitCode !== null) throw new Error(`The engine exited early (code ${child.exitCode}).`);
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The engine did not answer within ${HEALTH_TIMEOUT_MS / 1000} seconds.`);
}

function killBackend() {
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null || !child.pid) return;
  log.info(`Stopping backend (pid ${child.pid})`);
  try {
    child.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    if (isWin) {
      // Kill the whole tree synchronously so no uvicorn/tesseract/soffice is orphaned.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }, 2000).unref();
    }
  } catch (err) {
    log.warn('Failed to stop backend', err);
  }
}

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', killBackend);
process.on('exit', killBackend);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    quitting = true;
    killBackend();
    app.exit(0);
  });
}

// ---- windows --------------------------------------------------------------------------------

function themeBackground() {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0f' : '#fafafa';
}

function createSplash() {
  splash = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    skipTaskbar: false,
    backgroundColor: '#080a14',
    title: 'Folio PDF',
    icon: appIcon(),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash?.show());
  splash.on('closed', () => {
    splash = null;
  });
}

function appIcon() {
  const p = path.join(__dirname, '..', 'build', isWin ? 'icon.ico' : 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

const secureWebPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: true,
});

function isAppUrl(url) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function isSafeExternal(url) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function createMainWindow() {
  // Default 1360x880, but never larger than the work area of the primary display (small/scaled laptops).
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1360, workArea.width),
    height: Math.min(880, workArea.height),
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Folio PDF',
    icon: appIcon(),
    backgroundColor: themeBackground(),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: false,
    webPreferences: secureWebPreferences(),
  });

  const wc = mainWindow.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      const u = new URL(url);
      // Attachment downloads opened in a new tab -> native download.
      if (/^\/api\/files\/[^/]+\/download$/.test(u.pathname) && !u.searchParams.get('inline')) {
        wc.downloadURL(url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 800,
          backgroundColor: themeBackground(),
          icon: appIcon(),
          webPreferences: secureWebPreferences(),
        },
      };
    }
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (!isAppUrl(url) && !url.startsWith('blob:')) {
      event.preventDefault();
      if (isSafeExternal(url)) shell.openExternal(url);
    }
  });

  if (isMac) {
    // Hidden inset title bar: make the app header draggable and keep clear of the traffic lights.
    wc.on('did-finish-load', () => {
      wc.insertCSS(`
        header.sticky { -webkit-app-region: drag; }
        header.sticky > div { padding-left: 84px !important; }
        header.sticky a, header.sticky button, header.sticky input, header.sticky select,
        header.sticky [role="button"], header.sticky [role="menu"], header.sticky [role="menuitem"] {
          -webkit-app-region: no-drag;
        }
      `).catch(() => {});
    });
  }

  wc.on('render-process-gone', (_e, details) => log.error('Renderer gone', details));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    splash?.close();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`${baseUrl}/`);
}

function openComponentsWindow() {
  if (componentsWindow) {
    componentsWindow.focus();
    return;
  }
  componentsWindow = new BrowserWindow({
    width: 680,
    height: 660,
    minWidth: 520,
    minHeight: 480,
    parent: mainWindow ?? undefined,
    modal: false,
    show: false,
    title: 'Optional components',
    icon: appIcon(),
    backgroundColor: themeBackground(),
    autoHideMenuBar: true,
    minimizable: false,
    webPreferences: secureWebPreferences(),
  });
  componentsWindow.setMenu(null);
  componentsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  componentsWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (isSafeExternal(url)) shell.openExternal(url);
  });
  componentsWindow.loadFile(path.join(__dirname, 'components.html'));
  componentsWindow.once('ready-to-show', () => componentsWindow?.show());
  componentsWindow.on('closed', () => {
    componentsWindow = null;
  });
}

// ---- open PDF (menu, file association, second instance, dock drop) --------------------------

async function openPdf(file) {
  if (!ready || !mainWindow) {
    pendingFiles.push(file);
    return;
  }
  try {
    log.info(`Opening ${file}`);
    const bytes = await fs.promises.readFile(file);
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: 'application/pdf' }), path.basename(file));
    const res = await fetch(`${baseUrl}/api/files`, { method: 'POST', body: form });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail ?? detail;
      } catch {
        /* not JSON */
      }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    const [out] = await res.json();
    const target = `${baseUrl}/view/${encodeURIComponent(out.file_id)}`;
    await mainWindow.loadURL(target);
    mainWindow.webContents.send('folio:open-file', { path: file, fileId: out.file_id });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    app.addRecentDocument(file);
  } catch (err) {
    log.error(`Failed to open ${file}`, err);
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Folio PDF',
      message: `Could not open ${path.basename(file)}`,
      detail: String(err?.message ?? err),
    });
  }
}

async function showOpenDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Open PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PDF documents', extensions: ['pdf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled) return;
  for (const f of filePaths) await openPdf(f);
}

// ---- downloads ------------------------------------------------------------------------------

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Save as',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    item.once('done', (_e, state) => {
      if (state !== 'completed') {
        if (state === 'interrupted') log.warn(`Download interrupted: ${item.getFilename()}`);
        return;
      }
      const saved = item.getSavePath();
      log.info(`Saved ${saved}`);
      if (Notification.isSupported()) {
        const n = new Notification({
          title: 'Download complete',
          body: `${path.basename(saved)}: click to show in folder`,
          silent: true,
        });
        n.on('click', () => shell.showItemInFolder(saved));
        n.show();
      }
    });
  });
}

// ---- IPC (preload API) ------------------------------------------------------------------------

function setupIpc() {
  ipcMain.on('folio:version', (e) => {
    e.returnValue = app.getVersion();
  });
  ipcMain.handle('folio:open-external', (_e, url) => {
    if (typeof url === 'string' && isSafeExternal(url)) return shell.openExternal(url);
    throw new Error('Only http(s) and mailto links can be opened.');
  });
  ipcMain.handle('folio:show-item-in-folder', (_e, p) => {
    if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) shell.showItemInFolder(p);
  });
  ipcMain.handle('folio:health', async () => {
    if (!baseUrl) throw new Error('Engine not started');
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    const health = await res.json();
    // /api/health does not report Ghostscript; look it up the same way the backend does.
    if (health.ghostscript === undefined) health.ghostscript = Boolean(whichIn(['gs', 'gswin64c', 'gswin32c']));
    return health;
  });
  ipcMain.handle('folio:copy-text', (_e, text) => {
    if (typeof text === 'string' && text.length < 2000) clipboard.writeText(text);
  });
  ipcMain.handle('folio:open-logs', () => shell.openPath(logDir));
  ipcMain.handle('folio:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

// ---- menu -------------------------------------------------------------------------------------

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push(
    {
      label: isMac ? 'File' : '&File',
      submenu: [
        { label: isMac ? 'Open PDF…' : '&Open PDF…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => mainWindow?.loadURL(`${baseUrl}/`) },
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu', label: isMac ? 'Edit' : '&Edit' },
    {
      label: isMac ? 'View' : '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu', label: isMac ? 'Window' : '&Window' },
    {
      role: 'help',
      label: isMac ? 'Help' : '&Help',
      submenu: [
        { label: isMac ? 'Optional Components…' : 'Optional &components…', click: () => openComponentsWindow() },
        { label: 'Open logs folder', click: () => shell.openPath(logDir) },
        { type: 'separator' },
        { label: 'Folio PDF on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an issue', click: () => shell.openExternal(`${REPO_URL}/issues`) },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Check for updates…', click: () => checkForUpdates(true) }]),
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- auto-update -----------------------------------------------------------------------------

let updater = null;
function getUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
      type: 'info',
      title: 'Update ready',
      message: `Folio PDF ${info.version} is ready to install.`,
      detail: 'Restart now to update, or it will be installed the next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      quitting = true;
      killBackend();
      autoUpdater.quitAndInstall();
    }
  });
  autoUpdater.on('error', (err) => log.warn('Auto-update error', err?.message ?? err));
  updater = autoUpdater;
  return updater;
}

function updatesSupported() {
  // Portable Windows builds and dev runs cannot self-update.
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

async function checkForUpdates(manual) {
  if (!updatesSupported()) {
    if (manual) {
      dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info',
        title: 'Updates',
        message: 'Automatic updates are not available for this build.',
        detail: `Download the latest version from ${REPO_URL}/releases`,
      });
    }
    return;
  }
  try {
    const result = await getUpdater().checkForUpdates();
    if (!manual) return;
    const latest = result?.updateInfo?.version;
    if (!result?.isUpdateAvailable) {
      dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info',
        title: 'Updates',
        message: 'Folio PDF is up to date.',
        detail: `Version ${app.getVersion()}${latest ? ` (latest: ${latest})` : ''}`,
      });
    } else {
      dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info',
        title: 'Updates',
        message: `Downloading Folio PDF ${latest}…`,
        detail: 'You will be asked to restart when it is ready.',
      });
    }
  } catch (err) {
    log.warn('Update check failed', err);
    if (manual) {
      dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'warning',
        title: 'Updates',
        message: 'Could not check for updates.',
        detail: String(err?.message ?? err),
      });
    }
  }
}

// ---- startup --------------------------------------------------------------------------------

function blockedHint(err) {
  if (!/UNKNOWN|EPERM|EACCES/.test(String(err?.code ?? err))) return '';
  return (
    '\n\nThe engine executable was blocked from running. Security software (for example ' +
    'Windows Smart App Control or an antivirus) may have blocked it; allow it and start Folio PDF again.'
  );
}

function fatal(message, err) {
  log.error(message, err);
  dialog.showErrorBox('Folio PDF', `${message}\n\n${err?.message ?? err ?? ''}\n\nLogs: ${logDir}`);
  quitting = true;
  killBackend();
  app.exit(1);
}

async function start() {
  if (isWin) app.setAppUserModelId('com.folio.pdf');
  setupIpc();
  setupDownloads();
  buildMenu();
  createSplash();

  for (const f of pdfArgs(process.argv)) pendingFiles.push(f);

  try {
    // FOLIO_DEV_URL: use an already running Vite dev server (it proxies /api to your backend).
    baseUrl = DEV_URL ? DEV_URL.replace(/\/+$/, '') : await startBackend();
    const health = await waitForHealth(baseUrl, backend);
    log.info(`Backend ready at ${baseUrl}`, health);
  } catch (err) {
    log.error('Backend failed to start', err);
    splash?.close();
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Folio PDF',
      message: 'Folio PDF could not start its local engine.',
      detail: `${err?.message ?? err}${blockedHint(err)}\n\nDetails are in the log files:\n${logDir}`,
      buttons: ['Open logs folder', 'Quit'],
      defaultId: 0,
    });
    if (response === 0) await shell.openPath(logDir);
    quitting = true;
    killBackend();
    app.exit(1);
    return;
  }

  createMainWindow();
  ready = true;
  mainWindow.webContents.once('did-finish-load', () => {
    for (const f of pendingFiles.splice(0)) openPdf(f);
  });

  if (!isDev) setTimeout(() => checkForUpdates(false), 8000);
}

app.on('activate', () => {
  if (ready && BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
