'use strict';
/**
 * StockFlow preload - the only bridge between the sandboxed renderer and the
 * main process. Exposes a small, typed, whitelisted API as window.stockflow.
 * contextIsolation is on, nodeIntegration is off; the renderer cannot reach
 * Node, fs, or SQL directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

function call(resource, action, payload) {
  return ipcRenderer.invoke('sf', { m: resource, a: action, p: payload === undefined ? null : payload }).then((res) => {
    if (res && res.ok) return res.data;
    const message = (res && res.error) || 'Request failed.';
    const err = new Error(message);
    err.userFacing = true;
    throw err;
  });
}

const api = {
  // ---- app ----
  appInfo: () => call('app', 'info'),
  // ---- settings ----
  settingsGet: (key) => call('settings', 'get', { key }),
  settingsSet: (key, value) => call('settings', 'set', { key, value }),
  // ---- dashboard ----
  dashboardGet: () => call('dashboard', 'get'),
  // ---- categories ----
  categoriesList: () => call('categories', 'list'),
  categoriesCreate: (data) => call('categories', 'create', data),
  categoriesUpdate: (id, data) => call('categories', 'update', { id, ...data }),
  categoriesDelete: (id) => call('categories', 'delete', { id }),
  // ---- suppliers ----
  suppliersList: () => call('suppliers', 'list'),
  suppliersCreate: (data) => call('suppliers', 'create', data),
  suppliersUpdate: (id, data) => call('suppliers', 'update', { id, ...data }),
  suppliersDelete: (id) => call('suppliers', 'delete', { id }),
  // ---- products ----
  productsList: (filter) => call('products', 'list', filter || {}),
  productsGet: (id) => call('products', 'get', { id }),
  productsCreate: (data) => call('products', 'create', data),
  productsUpdate: (id, data) => call('products', 'update', { id, ...data }),
  productsDelete: (id) => call('products', 'delete', { id }),
  productsToggleActive: (id) => call('products', 'toggleActive', { id }),
  productsPick: (search, limit) => call('products', 'pick', { search: search || '', limit }),
  chooseImage: () => call('products', 'chooseImage'),
  // ---- stock ----
  stockIn: (data) => call('stock', 'in', data),
  stockOut: (data) => call('stock', 'out', data),
  stockAdjust: (data) => call('stock', 'adjust', data),
  movementsList: (filter) => call('stock', 'movements', filter || {}),
  // ---- reports ----
  reportsGenerate: (kind, params) => call('reports', 'generate', { kind, params: params || {} }),
  reportsExport: (kind, params) => call('reports', 'exportCsv', { kind, params: params || {} }),
  // ---- backup / restore ----
  backupCreate: () => call('backup', 'create'),
  backupRestore: (filePath) => call('backup', 'restore', { filePath })
};

contextBridge.exposeInMainWorld('stockflow', Object.freeze(api));
