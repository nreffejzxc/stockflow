'use strict';
/**
 * IPC layer. One ipcMain.handle channel ('sf') whose actions are resolved
 * through an explicit whitelist map - the renderer can never invoke arbitrary
 * handlers. All mutations validate through db.js; friendly errors are rethrown
 * so the renderer can show them as toasts.
 */
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { buildReportCsv } = require('./csv');
const { AppError } = require('./db');

function registerIpc({ db, getWindow, imagesDir, e2eCsvDir }) {
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

  function safeImagePath(name) {
    const base = path.basename(String(name || '').replace(/\\/g, '/'));
    const full = path.resolve(imagesDir, base);
    if (path.dirname(full).toLowerCase() !== path.resolve(imagesDir).toLowerCase()) {
      throw new AppError('Invalid image path.');
    }
    return full;
  }

  function deleteImageIfExists(name) {
    if (!name) return;
    try {
      const full = safeImagePath(name);
      if (fs.existsSync(full)) fs.rmSync(full, { force: true });
    } catch (_) { /* ignore orphan */ }
  }

  async function chooseImage() {
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a product image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    const src = res.filePaths[0];
    const ext = path.extname(src).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) throw new AppError('Please choose a PNG, JPG, GIF, WEBP or BMP image.');
    fs.mkdirSync(imagesDir, { recursive: true });
    const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.copyFileSync(src, path.join(imagesDir, name));
    return { ok: true, name };
  }

  async function csvDialog(report) {
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showSaveDialog(win, {
      title: 'Export CSV',
      defaultPath: `${report.filename}-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV files', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  }

  async function defaultBackupPath() {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Backup database',
      defaultPath: `stockflow-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  }

  function backupFileNameSuggestion() {
    return `stockflow-backup-${new Date().toISOString().slice(0, 10)}.db`;
  }

  const handlers = {
    app: {
      async info() {
        return {
          name: 'StockFlow Desktop',
          version: require('../../package.json').version,
          dbPath: db.dbPath(),
          dataDir: db.dataDir(),
          engine: db.engineKind,
          platform: process.platform,
          appVersion: process.env.npm_package_version || null
        };
      }
    },

    settings: {
      get: ({ key }) => (key ? db.settingsGet(key) : db.settingsAll()),
      set: ({ key, value }) => db.settingsSet(key, value)
    },

    dashboard: {
      get: () => db.getDashboard()
    },

    categories: {
      list: () => db.categoriesList(),
      create: (data) => db.categoriesCreate(data || {}),
      update: (p) => db.categoriesUpdate(p.id, p),
      delete: (p) => db.categoriesDelete(p.id)
    },

    suppliers: {
      list: () => db.suppliersList(),
      create: (data) => db.suppliersCreate(data || {}),
      update: (p) => db.suppliersUpdate(p.id, p),
      delete: (p) => db.suppliersDelete(p.id)
    },

    products: {
      list: (p) => db.productsList(p || {}),
      get: (p) => db.productsGet(p.id),
      create: async (data) => db.productsCreate(data || {}),
      update: async (p) => {
        const before = db.productsGet(p.id);
        const updated = db.productsUpdate(p.id, p);
        if (before.image && before.image !== updated.image) deleteImageIfExists(before.image);
        return updated;
      },
      delete: async (p) => {
        const before = db.productsGet(p.id);
        const out = db.productsDelete(p.id);
        deleteImageIfExists(before.image);
        return out;
      },
      toggleActive: (p) => db.productsToggleActive(p.id),
      pick: (p) => db.productsBulkListForPicker((p && p.search) || '', (p && p.limit) || 60),
      chooseImage
    },

    stock: {
      in: (p) => db.stockIn(p || {}),
      out: (p) => db.stockOut(p || {}),
      adjust: (p) => db.stockAdjust(p || {}),
      movements: (p) => db.movementsList(p || {})
    },

    reports: {
      generate: ({ kind, params }) => db.reportsGenerate(kind, params || {}),
      exportCsv: async ({ kind, params }) => {
        const report = db.reportsGenerate(kind, params || {});
        const currency = db.settingsGet('currency', 'USD');
        const text = buildReportCsv(report, currency);
        let target = null;
        if (e2eCsvDir) {
          fs.mkdirSync(e2eCsvDir, { recursive: true });
          target = path.join(e2eCsvDir, `${report.filename}.csv`);
        } else {
          target = await csvDialog(report);
          if (!target) return { canceled: true };
        }
        fs.writeFileSync(target, text, 'utf8');
        return { ok: true, path: target, title: report.title, rows: report.rows.length };
      }
    },

    backup: {
      create: async () => {
        let target = null;
        if (e2eCsvDir) {
          fs.mkdirSync(e2eCsvDir, { recursive: true });
          target = path.join(e2eCsvDir, backupFileNameSuggestion());
        } else {
          target = await defaultBackupPath();
          if (!target) return { canceled: true };
        }
        const info = db.backupCreate(target);
        return { ok: true, ...info };
      },
      restore: async ({ filePath }) => {
        const win = getWindow();
        let src = filePath;
        if (!src) {
          if (!win) return { ok: false, error: 'No window' };
          const res = await dialog.showOpenDialog(win, {
            title: 'Restore database from backup',
            properties: ['openFile'],
            filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] }]
          });
          if (res.canceled || !res.filePaths.length) return { canceled: true };
          src = res.filePaths[0];
        }
        try {
          const out = db.backupRestore(src);
          if (win) {
            await dialog.showMessageBox(win, {
              type: 'info',
              title: 'Restore complete',
              message: 'The database was restored successfully.',
              detail: `Safety backup kept at:\n${out.safetyPath}`
            });
            win.reload();
          }
          return { ok: true, ...out };
        } catch (e) {
          const msg = e instanceof AppError ? e.message : 'Restore failed: ' + e.message;
          if (win) {
            await dialog.showMessageBox(win, {
              type: 'error',
              title: 'Restore failed',
              message: msg
            });
          }
          throw e;
        }
      }
    }
  };

  ipcMain.handle('sf', async (_event, req) => {
    try {
      if (!req || typeof req !== 'object') throw new AppError('Invalid request.');
      const { m, a, p } = req;
      const resource = handlers[m];
      if (!resource || typeof resource[a] !== 'function') {
        throw new AppError(`Unknown action: ${m}.${a}`);
      }
      const out = await resource[a](p);
      return { ok: true, data: out === undefined ? null : out };
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, error: e.message };
      }
      console.error('[ipc] unhandled error:', e);
      return { ok: false, error: 'Something went wrong. Please try again.' };
    }
  });
}

module.exports = { registerIpc };
