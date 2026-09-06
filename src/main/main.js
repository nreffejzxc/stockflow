'use strict';
/**
 * StockFlow Desktop - Electron main process.
 *
 * Security: contextIsolation on, nodeIntegration off, sandbox on, no remote
 * content, CSP in the HTML, a single whitelisted IPC channel, and image files
 * served through a dedicated media:// protocol from the main process only.
 */
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { openDatabase } = require('./db');
const { registerIpc } = require('./ipc');

const IS_E2E = process.env.STOCKFLOW_E2E === '1';
const E2E_DIR = process.env.STOCKFLOW_E2E_DIR ? path.resolve(process.env.STOCKFLOW_E2E_DIR) : null;
const E2E_CSV_DIR = E2E_DIR ? path.join(E2E_DIR, 'csv') : null;
const USER_DATA_OVERRIDE = process.env.STOCKFLOW_USER_DATA ? path.resolve(process.env.STOCKFLOW_USER_DATA) : null;

app.setAppUserModelId('com.stockflow.desktop');

// The media:// scheme must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: false, stream: true }
  }
]);

// Single instance - avoid two processes writing to the same SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

let win = null;
let db = null;
let imagesDir = null;

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About StockFlow',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About StockFlow Desktop',
              message: `StockFlow Desktop v${app.getVersion()}`,
              detail:
                'Offline inventory management for small businesses.\n\n' +
                `Data location:\n${app.getPath('userData')}`
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const preload = path.join(__dirname, 'preload.js');
  const offscreen = IS_E2E;

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.on('did-finish-load', () => {
    if (!IS_E2E) win.show();
  });

  win.webContents.on('console-message', (event, level, message) => {
    if (IS_E2E || process.env.STOCKFLOW_VERBOSE) {
      console.log(`[renderer:${level}] ${message}`);
    }
  });

  if (IS_E2E) {
    win.webContents.on('did-finish-load', () => {
      const e2e = require('./e2e');
      e2e
        .run({ win, db, imagesDir, outDir: E2E_DIR })
        .then((code) => app.exit(code || 0))
        .catch((err) => {
          console.error('[e2e] fatal', err);
          app.exit(1);
        });
    });
  }

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

function registerMediaProtocol() {
  // media://image/<name>  ->  <userData>/images/<name>
  protocol.handle('media', (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'image') return new Response('Not found', { status: 404 });
      const name = path.basename(decodeURIComponent(url.pathname));
      const full = path.resolve(imagesDir, name);
      if (path.dirname(full).toLowerCase() !== path.resolve(imagesDir).toLowerCase()) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(full).toString());
    } catch (_) {
      return new Response('Bad request', { status: 400 });
    }
  });
}

async function bootstrap() {
  try {
    if (USER_DATA_OVERRIDE) app.setPath('userData', USER_DATA_OVERRIDE);
    const dataDir = app.getPath('userData');
    imagesDir = path.join(dataDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });

    db = openDatabase({ dbPath: path.join(dataDir, 'stockflow.db'), dataDir });
    if (db.isWasm) await db.openNowAsync();

    registerMediaProtocol();
    buildMenu();

    registerIpc({
      db,
      getWindow: () => win,
      imagesDir,
      e2eCsvDir: E2E_CSV_DIR
    });

    createWindow();
  } catch (e) {
    console.error('[main] bootstrap failed:', e);
    dialog.showErrorBox(
      'StockFlow could not start',
      'The application data folder could not be opened or the database is corrupt.\n\n' +
        String((e && e.message) || e) +
        '\n\nIf this keeps happening, restore a database backup from Settings.'
    );
    app.exit(1);
  }
}

app.on('ready', bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) db.close();
  ipcMain.removeHandler('sf');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
