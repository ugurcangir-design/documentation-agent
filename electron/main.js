'use strict';

const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path    = require('path');
const http    = require('http');
const fs      = require('fs');

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT        = path.join(__dirname, '..');
const TSX_BIN     = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const VITE_BIN    = path.join(ROOT, 'client', 'node_modules', '.bin', 'vite');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const ICON_PATH   = path.join(ROOT, 'assets', 'icon.png');

// ── Ports ───────────────────────────────────────────────────────────────────
const SERVER_PORT = 3000;
const CLIENT_PORT = 5173;
const IS_PACKAGED = app.isPackaged;

// ── Process handles ─────────────────────────────────────────────────────────
let mainWindow   = null;
let serverProc   = null;
let clientProc   = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function waitForUrl(url, timeout = 35000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    (function attempt() {
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode < 500) return resolve();
        schedule();
      }).on('error', schedule);

      function schedule() {
        if (Date.now() < deadline) setTimeout(attempt, 600);
        else reject(new Error(`Timeout waiting for: ${url}`));
      }
    })();
  });
}

function spawnProc(bin, args, cwd, label) {
  const proc = spawn(bin, args, {
    cwd,
    env:   { ...process.env },
    stdio: 'pipe',
  });

  const tag = `\x1b[36m[${label}]\x1b[0m `;
  proc.stdout?.on('data', (d) => process.stdout.write(tag + d));
  proc.stderr?.on('data', (d) => process.stderr.write(tag + d));
  proc.on('error', (e) => console.error(tag + 'error:', e.message));

  return proc;
}

// ─────────────────────────────────────────────────────────────────────────────
// App menu
// ─────────────────────────────────────────────────────────────────────────────

function buildMenu() {
  const mac = process.platform === 'darwin';

  return Menu.buildFromTemplate([
    ...(mac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Düzenle',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Pencere',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(mac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Window
// ─────────────────────────────────────────────────────────────────────────────

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width:     1440,
    height:    900,
    minWidth:  1080,
    minHeight: 700,

    // macOS: traffic-light buttons inside the window, no title bar
    titleBarStyle:         process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition:  { x: 16, y: 16 },

    backgroundColor: '#F9FAFB',
    icon:            fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    title:           'DocAgent — Analysis Studio',

    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      // Allow loading /screenshots from Express
      webSecurity: !IS_PACKAGED,
    },

    show: false,  // reveal after 'ready-to-show'
  });

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // External links open in the default browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(buildMenu());

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server startup
// ─────────────────────────────────────────────────────────────────────────────

async function startDev() {
  console.log('\x1b[35m[DocAgent]\x1b[0m Starting backend…');

  serverProc = spawnProc(
    TSX_BIN,
    ['src/server/app.ts'],
    ROOT,
    'server'
  );

  console.log('\x1b[35m[DocAgent]\x1b[0m Starting client dev server…');

  clientProc = spawnProc(
    VITE_BIN,
    [],
    path.join(ROOT, 'client'),
    'client'
  );

  await Promise.all([
    waitForUrl(`http://localhost:${SERVER_PORT}/api/health`),
    waitForUrl(`http://localhost:${CLIENT_PORT}`),
  ]);

  return `http://localhost:${CLIENT_PORT}`;
}

async function startProd() {
  console.log('\x1b[35m[DocAgent]\x1b[0m Starting server (packaged)…');

  process.env.PORT = String(SERVER_PORT);

  serverProc = spawnProc(
    process.execPath,
    [path.join(__dirname, 'server-entry.js')],
    ROOT,
    'server'
  );

  await waitForUrl(`http://localhost:${SERVER_PORT}/api/health`);

  return `http://localhost:${SERVER_PORT}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────────

// Tray-style menu: keep app alive in dock, no window. Default browser shows UI.
function buildDockMenu(url) {
  return Menu.buildFromTemplate([
    { label: `DocAgent çalışıyor`, enabled: false },
    { label: url, enabled: false },
    { type: 'separator' },
    { label: 'Tarayıcıda Aç', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: 'Kapat', click: () => app.quit() },
  ]);
}

app.whenReady().then(async () => {
  console.log('\x1b[35m[DocAgent]\x1b[0m DocAgent — Analysis Studio');

  try {
    const url = IS_PACKAGED ? await startProd() : await startDev();

    console.log(`\x1b[35m[DocAgent]\x1b[0m Ready → ${url}`);

    // Open in default browser (Chrome/Safari/…), no Electron window
    shell.openExternal(url);

    // Dock right-click menu to re-open browser or quit
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setMenu(buildDockMenu(url));
    }

    // System tray menu (cross-platform reachable control)
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { label: 'Tarayıcıda Aç', click: () => shell.openExternal(url) },
          { type: 'separator' },
          { role: 'quit', label: 'Kapat' },
        ],
      },
    ]));
  } catch (err) {
    console.error('\x1b[31m[DocAgent]\x1b[0m Startup failed:', err.message);
    app.quit();
  }

  // On macOS, clicking the dock icon re-opens the browser
  app.on('activate', () => {
    const url = `http://localhost:${IS_PACKAGED ? SERVER_PORT : CLIENT_PORT}`;
    shell.openExternal(url);
  });
});

function killChildren() {
  serverProc?.kill('SIGTERM');
  clientProc?.kill('SIGTERM');
}

// Don't quit when "all windows closed" — there are no windows by design.
// User quits via Dock menu, Cmd+Q, or "Kapat" menu item.
app.on('window-all-closed', () => {
  // intentionally empty
});

app.on('before-quit', killChildren);
