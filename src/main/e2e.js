'use strict';
/**
 * StockFlow end-to-end harness. Runs against the real renderer UI inside an
 * offscreen window when STOCKFLOW_E2E=1. Drives the DOM over
 * webContents.executeJavaScript, asserts state after each step, captures
 * screenshots, and writes <outDir>/e2e-result.json before exiting.
 *
 * Phases:
 *   first  (STOCKFLOW_E2E_PHASE unset/"first") - full UI scenario on fresh data
 *   second (STOCKFLOW_E2E_PHASE="second")      - persistence check on the same
 *                                                userData dir (must follow first)
 */
const fs = require('fs');
const path = require('path');

const PHASE = process.env.STOCKFLOW_E2E_PHASE === 'second' ? 'second' : 'first';
const SHOT_DIR = process.env.STOCKFLOW_E2E_SHOTS || 'screenshots';

let steps = [];
let screens = 0;

function record(name, ok, detail) {
  steps.push({ name, ok: !!ok, detail: detail || '' });
}

function shotName(label) {
  const n = String(++screens).padStart(2, '0');
  return `${n}-${label}.png`;
}

async function run({ win, db, outDir }) {
  const wc = win.webContents;
  const wd = win.webContents;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- low-level page driver ----
  await wc.executeJavaScript(`window.__sf = {
    q: (s) => document.querySelector(s),
    qa: (s) => Array.prototype.slice.call(document.querySelectorAll(s)),
    click: (s) => { const e = document.querySelector(s); if (!e) throw new Error('no element: ' + s); e.click(); return true; },
    set: (s, v) => { const e = document.querySelector(s); if (!e) throw new Error('no element: ' + s); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true; },
    setField: (k, v) => { const w = document.querySelector('.modal .field[data-field="' + k + '"]');
      if (!w) throw new Error('no modal field: ' + k);
      const el = w.querySelector('input,select,textarea');
      if (!el) throw new Error('no input in field: ' + k);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change', { bubbles: true }));
      return true; },
    saveModal: () => { const b = document.querySelector('.modal [data-action="save"]'); if (!b) throw new Error('no save button'); b.click(); return true; },
    confirmModal: () => { const b = document.querySelector('.modal [data-action="ok"]'); if (!b) throw new Error('no confirm button'); b.click(); return true; },
    rowBtn: (id, act) => { const b = document.querySelector('tr[data-id="' + id + '"] button[data-act="' + act + '"]'); if (!b) throw new Error('no row button ' + id + '/' + act); b.click(); return true; },
    tableText: () => { const t = document.querySelector('#view-root .data-table tbody, #movement-table .data-table tbody'); return t ? t.innerText : ''; },
    bodyText: () => document.body.innerText
  }; true;`, true);

  const exec = (code) => wc.executeJavaScript(code, true);
  const js = (expr) => wc.executeJavaScript(expr, true);

  async function waitFor(expr, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeout || 9000)) {
      try {
        if (await js(expr)) return true;
      } catch (_) { /* retry */ }
      await sleep(120);
    }
    throw new Error('timeout waiting for ' + (label || expr));
  }

  async function toast(contains, cls) {
    const sel = `.toast${cls ? '-' + cls : ''}`;
    await waitFor(`Array.from(document.querySelectorAll('${sel}')).some(t => t.innerText.indexOf(${JSON.stringify(contains)}) !== -1)`, 7000, `toast "${contains}"`);
  }

  async function capture(label) {
    try {
      await sleep(320);
      const img = await win.webContents.capturePage();
      const dir = path.join(outDir, SHOT_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, shotName(label));
      fs.writeFileSync(file, img.toPNG());
      return file;
    } catch (e) {
      console.error('[e2e] screenshot failed', label, e);
      return null;
    }
  }

  async function nav(view) {
    await wc.executeJavaScript(`window.SFApp.go(${JSON.stringify(view)}).then(() => true)`, true);
    await sleep(280);
  }

  async function modalGone() {
    await waitFor(`!document.querySelector('.modal')`, 9000, 'modal to close');
  }

  // helper to locate a modal form and fill it
  async function fillModal(obj) {
    for (const [k, v] of Object.entries(obj)) {
      await exec(`window.__sf.setField(${JSON.stringify(k)}, ${JSON.stringify(v)}); true;`);
    }
  }

  // helper: run scenario section in its own try so a failure is recorded
  async function step(label, fn) {
    try {
      await fn();
      record(label, true);
    } catch (e) {
      console.error('[e2e] FAILED:', label, e && e.message);
      record(label, false, (e && e.message) || String(e));
    }
  }

  function findByName(dbList, name) {
    const p = dbList.find((r) => r.name === name);
    if (!p) throw new Error('expected record not found: ' + name);
    return p;
  }

  const out = { phase: PHASE, startedAt: new Date().toISOString(), steps: [], ok: false };

  if (PHASE === 'first') {
    await runFirst(wd, { step, toast, nav, capture, waitFor, modalGone, fillModal, exec, js, sleep, db, findByName, outDir });
  } else {
    await runSecond(db, { step, nav, waitFor, exec, sleep, js, outDir });
  }

  const ok = steps.every((s) => s.ok);
  out.steps = steps;
  out.ok = ok;
  out.finishedAt = new Date().toISOString();
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'e2e-result.json'), JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('[e2e] could not write result json', e);
  }
  console.log(`[e2e] ${PHASE} phase -> ${ok ? 'PASS' : 'FAIL'} (${steps.filter((s) => s.ok).length}/${steps.length} steps)`);
  return ok ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* First phase - full UI scenario                                      */
/* ------------------------------------------------------------------ */
async function runFirst(wd, T) {
  const { step, toast, nav, capture, waitFor, modalGone, fillModal, exec, js, sleep, db, findByName, outDir } = T;

  await waitFor(`!!document.querySelector('.stat-grid')`, 12000, 'dashboard ready');

  // ---------- categories ----------
  await step('categories: add via UI', async () => {
    await nav('categories');
    await waitFor(`!!document.querySelector('#btn-add-category')`, 6000, 'categories view');
    await capture('categories-empty');
    await exec(`window.__sf.click('#btn-add-category'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'category modal');
    await capture('category-modal');
    await fillModal({ name: 'Beverages', description: 'Drinks and sodas' });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    await waitFor(`document.querySelector('#cat-table').innerText.indexOf('Beverages') !== -1`, 6000, 'category in list');
    await capture('categories-list');
  });

  await step('categories: duplicate name rejected', async () => {
    await exec(`window.__sf.click('#btn-add-category'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'category modal');
    await fillModal({ name: 'Beverages' });
    await exec(`window.__sf.saveModal(); true;`);
    await sleep(700);
    const err = await js(`(document.querySelector('.modal .modal-error') || {}).innerText || ''`);
    if (err.indexOf('already exists') === -1) throw new Error('expected duplicate error, got: ' + err);
    await exec(`window.__sf.click('.modal [data-action="cancel"]'); true;`);
    await modalGone();
  });

  // ---------- suppliers ----------
  await step('suppliers: add via UI', async () => {
    await nav('suppliers');
    await waitFor(`!!document.querySelector('#btn-add-supplier')`, 6000, 'suppliers view');
    await exec(`window.__sf.click('#btn-add-supplier'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'supplier modal');
    await fillModal({ name: 'Acme Distribution', contactPerson: 'Jane Smith', phone: '+1 555 0142', email: 'orders@acme.example' });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    await waitFor(`document.querySelector('#sup-table').innerText.indexOf('Acme Distribution') !== -1`, 6000, 'supplier in list');
    await capture('suppliers-list');
  });

  // data for the rest
  const cats = db.categoriesList();
  const sups = db.suppliersList();
  const bev = cats.find((c) => c.name === 'Beverages');
  const acme = sups.find((s) => s.name === 'Acme Distribution');
  if (!bev || !acme) throw new Error('fixtures missing');

  // ---------- products ----------
  await step('products: add Cola Classic with opening stock', async () => {
    await nav('products');
    await waitFor(`!!document.querySelector('#btn-add-product')`, 6000, 'products view');
    await capture('products-empty');
    await exec(`window.__sf.click('#btn-add-product'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'product modal');
    await capture('product-modal');
    await fillModal({
      name: 'Cola Classic', sku: '', barcode: '5449000000996', unit: 'pcs',
      categoryId: String(bev.id), supplierId: String(acme.id),
      purchasePrice: '0.80', sellingPrice: '1.50', minStock: '5',
      openingStock: '10', openingCost: '0.80', description: '330ml can'
    });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    await waitFor(`document.querySelector('#product-table').innerText.indexOf('Cola Classic') !== -1`, 8000, 'cola row');
  });

  await step('products: add Cola Zero (out of stock)', async () => {
    await exec(`window.__sf.click('#btn-add-product'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'product modal 2');
    await fillModal({
      name: 'Cola Zero', sku: '', barcode: '', unit: 'pcs',
      categoryId: String(bev.id), supplierId: String(acme.id),
      purchasePrice: '0.90', sellingPrice: '1.70', minStock: '3', openingStock: '0'
    });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    await waitFor(`document.querySelector('#product-table').innerText.indexOf('Cola Zero') !== -1`, 8000, 'cola zero row');
  });

  await step('products: add Pretzel Bag (low stock)', async () => {
    await exec(`window.__sf.click('#btn-add-product'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'product modal 3');
    await fillModal({
      name: 'Pretzel Bag', sku: '', barcode: '', unit: 'bag',
      categoryId: '', supplierId: String(acme.id),
      purchasePrice: '1.20', sellingPrice: '2.40', minStock: '2', openingStock: '1'
    });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
  });

  await step('products: auto-SKU generated', async () => {
    const cola = findByName(db.productsList({}), 'Cola Classic');
    if (!/^COLA-\d+$/.test(cola.sku || '')) throw new Error('expected COLA-NN sku, got ' + cola.sku);
    const zero = findByName(db.productsList({}), 'Cola Zero');
    if (!/^COLA-\d+$/.test(zero.sku || '')) throw new Error('expected generated sku for zero, got ' + zero.sku);
    if (cola.sku === zero.sku) throw new Error('SKUs collided');
    await capture('products-list');
  });

  const prods = () => db.productsList({});
  const cola = findByName(prods(), 'Cola Classic');
  const zero = findByName(prods(), 'Cola Zero');
  const pretzel = findByName(prods(), 'Pretzel Bag');

  // ---------- stock ----------
  await step('stock: in +15 on Cola Classic', async () => {
    await nav('stock');
    await waitFor(`!!document.querySelector('#picker-input')`, 6000, 'stock view');
    await exec(`window.__sf.set('#picker-input', 'Cola Classic'); true;`);
    await waitFor(`!!document.querySelector('#picker-dropdown .picker-item[data-id="${cola.id}"]')`, 7000, 'picker result');
    await exec(`window.__sf.click('#picker-dropdown .picker-item[data-id="${cola.id}"]'); true;`);
    await waitFor(`document.querySelector('#picker-selected').innerText.indexOf('10') !== -1`, 6000, 'selected shows 10');
    await exec(`window.__sf.set('#in-qty', '15'); true;`);
    await exec(`window.__sf.set('#in-reference', 'PO-2200'); true;`);
    await capture('stock-in-tab');
    await exec(`window.__sf.click('[data-submit="in"]'); true;`);
    await toast('Added 15', 'success');
    await waitFor(`document.querySelector('#picker-selected').innerText.indexOf('25') !== -1`, 6000, 'stock now 25');
    await capture('stock-after-in');
  });

  await step('stock: reject insufficient stock out', async () => {
    await exec(`window.__sf.click('.tab[data-tab="out"]'); true;`);
    await sleep(200);
    await exec(`window.__sf.set('#out-qty', '30'); true;`);
    await exec(`window.__sf.set('#out-reason', 'Sold'); true;`);
    await exec(`window.__sf.click('[data-submit="out"]'); true;`);
    await toast('Insufficient stock', 'error');
    const still = await js(`(document.querySelector('#picker-selected .sp-avail') || { innerText: '' }).innerText`);
    if (still.indexOf('25') === -1) throw new Error('stock changed after rejected out: ' + still);
  });

  await step('stock: valid out -6', async () => {
    await exec(`window.__sf.set('#out-qty', '6'); true;`);
    await exec(`window.__sf.set('#out-reason', 'Sold'); true;`);
    await exec(`window.__sf.set('#out-reference', 'INV-101'); true;`);
    await exec(`window.__sf.click('[data-submit="out"]'); true;`);
    await toast('Removed 6', 'success');
    await waitFor(`document.querySelector('#picker-selected').innerText.indexOf('19') !== -1`, 6000, 'stock now 19');
  });

  await step('stock: adjustment to 20', async () => {
    await exec(`window.__sf.click('.tab[data-tab="adjust"]'); true;`);
    await sleep(200);
    await exec(`window.__sf.set('#adj-qty', '20'); true;`);
    await exec(`window.__sf.set('#adj-reason', 'Stock count correction'); true;`);
    await capture('stock-adjust-tab');
    await exec(`window.__sf.click('[data-submit="adjust"]'); true;`);
    await toast('20', 'success');
    await waitFor(`document.querySelector('#picker-selected').innerText.indexOf('20') !== -1`, 6000, 'stock now 20');
  });

  await step('stock: movement history rows present', async () => {
    await waitFor(`document.querySelector('#movement-table') !== null`, 7000, 'movement table');
    await sleep(300);
    const text = await js(`document.querySelector('#movement-table').innerText`);
    for (const need of ['Stock In', 'Stock Out', 'Adjustment', 'PO-2200', 'INV-101', 'Stock count correction']) {
      if (text.indexOf(need) === -1) throw new Error('movement history missing ' + need);
    }
    await capture('stock-movements');
  });

  await step('stock: movement filter type', async () => {
    await exec(`window.__sf.set('#movement-type', 'adjust'); true;`);
    await sleep(600);
    const text = await js(`document.querySelector('#movement-table').innerText`);
    if (text.indexOf('Adjustment') === -1) throw new Error('no adjustments after filter');
    if (text.indexOf('Stock In') !== -1) throw new Error('Stock In leaked through filter');
    await exec(`window.__sf.set('#movement-type', 'all'); true;`);
  });

  // ---------- products edit / toggle / filters / delete ----------
  await step('products: toggle Cola Zero off and on', async () => {
    await nav('products');
    await waitFor(`!!document.querySelector('#product-search')`, 6000, 'products');
    await exec(`window.__sf.rowBtn(${zero.id}, 'toggle'); true;`);
    await sleep(700);
    let p = db.productsGet(zero.id);
    if (p.is_active !== 0) throw new Error('expected inactive after toggle');
    const rowText = await js(`document.querySelector('#product-table').innerText`);
    if (rowText.indexOf('Inactive') === -1) throw new Error('no Inactive chip shown');
    await exec(`window.__sf.rowBtn(${zero.id}, 'toggle'); true;`);
    await sleep(700);
    p = db.productsGet(zero.id);
    if (p.is_active !== 1) throw new Error('expected active after re-toggle');
  });

  await step('products: edit selling price of Pretzel Bag', async () => {
    await exec(`window.__sf.rowBtn(${pretzel.id}, 'edit'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'edit modal');
    await fillModal({ sellingPrice: '2.60', minStock: '3' });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    const p = db.productsGet(pretzel.id);
    if (p.selling_price !== 2.6 || p.min_stock !== 3) throw new Error('edit did not persist');
  });

  await step('products: search narrows list', async () => {
    await exec(`window.__sf.set('#product-search', 'Pretzel'); true;`);
    await sleep(700);
    const text = await js(`document.querySelector('#product-table').innerText`);
    if (text.indexOf('Pretzel Bag') === -1) throw new Error('search missed Pretzel');
    if (text.indexOf('Cola Classic') !== -1) throw new Error('search leaked other products');
    await exec(`window.__sf.set('#product-search', ''); true;`);
    await sleep(600);
  });

  await step('products: delete temporary product', async () => {
    await nav('categories');
    await sleep(200);
    await nav('products');
    await sleep(400);
    await exec(`window.__sf.click('#btn-add-product'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'add modal');
    await fillModal({ name: 'Temp To Delete', sku: 'TMP-1', openingStock: '0' });
    await exec(`window.__sf.saveModal(); true;`);
    await modalGone();
    await sleep(400);
    const tmp = db.productsList({}).find((p) => p.sku === 'TMP-1');
    if (!tmp) throw new Error('temp product missing');
    await exec(`window.__sf.rowBtn(${tmp.id}, 'del'); true;`);
    await waitFor(`!!document.querySelector('.modal')`, 6000, 'delete confirm');
    await capture('product-delete-confirm');
    await exec(`window.__sf.confirmModal(); true;`);
    await modalGone();
    await sleep(500);
    let gone = false;
    try { db.productsGet(tmp.id); } catch (_) { gone = true; }
    if (!gone) throw new Error('temp product still exists');
    await waitFor(`document.querySelector('#product-table').innerText.indexOf('Temp To Delete') === -1`, 6000, 'removed from table');
  });

  // ---------- dashboard ----------
  await step('dashboard: stats updated', async () => {
    await nav('dashboard');
    await waitFor(`!!document.querySelector('[data-stat="total-products"]')`, 7000, 'dashboard stats');
    await sleep(300);
    const total = await js(`document.querySelector('[data-stat="total-products"]').textContent`);
    // 3 products remain (Cola Classic, Cola Zero, Pretzel Bag); temp was deleted
    if (total !== '3') throw new Error('expected 3 total products, got ' + total);
    const lowCount = await js(`document.querySelector('[data-stat="low-stock"]').textContent`);
    if (lowCount !== '1') throw new Error('expected 1 low stock, got ' + lowCount);
    const outCount = await js(`document.querySelector('[data-stat="out-of-stock"]').textContent`);
    if (outCount !== '1') throw new Error('expected 1 out of stock, got ' + outCount);
    const recent = await js(`document.querySelector('#recent-movements').innerText`);
    if (recent.indexOf('Cola Classic') === -1) throw new Error('recent movements missing Cola');
    await capture('dashboard');
  });

  // ---------- reports ----------
  await step('reports: inventory shows rows and exports', async () => {
    await nav('reports');
    await waitFor(`!!document.querySelector('[data-kind="inventory"]')`, 7000, 'reports view');
    await sleep(900);
    const text = await js(`document.querySelector('#report-body').innerText`);
    for (const need of ['Inventory Report', 'Cola Classic', 'Pretzel Bag']) {
      if (text.indexOf(need) === -1) throw new Error('inventory report missing ' + need);
    }
    await capture('reports-inventory');
    await exec(`window.__sf.click('#report-export'); true;`);
    await sleep(900);
    const csv = path.join(outDir, 'csv', 'inventory-report.csv');
    if (!fs.existsSync(csv)) throw new Error('inventory CSV not exported');
    const content = fs.readFileSync(csv, 'utf8');
    if (!content.startsWith('﻿')) throw new Error('CSV missing BOM');
    if (content.indexOf('SKU,Product,Category') === -1) throw new Error('CSV missing header row');
  });

  await step('reports: movements + filter + export', async () => {
    await exec(`window.__sf.click('[data-kind="movements"]'); true;`);
    await sleep(900);
    let text = await js(`document.querySelector('#report-body').innerText`);
    if (text.indexOf('Stock In') === -1) throw new Error('movements report empty');
    await exec(`window.__sf.set('[data-pkey="type"]', 'adjust'); true;`);
    await sleep(900);
    text = await js(`document.querySelector('#report-body').innerText`);
    if (text.indexOf('Stock count correction') === -1) throw new Error('adjusted movement missing');
    await exec(`window.__sf.set('[data-pkey="type"]', 'all'); true;`);
    await sleep(500);
    await exec(`window.__sf.click('#report-export'); true;`);
    await sleep(900);
    const csv = path.join(outDir, 'csv', 'stock-movements.csv');
    if (!fs.existsSync(csv)) throw new Error('movements CSV not exported');
  });

  await step('reports: low stock & valuation', async () => {
    await exec(`window.__sf.click('[data-kind="low-stock"]'); true;`);
    await sleep(900);
    let text = await js(`document.querySelector('#report-body').innerText`);
    if (text.indexOf('Pretzel Bag') === -1) throw new Error('low stock report missing Pretzel');
    await exec(`window.__sf.click('[data-kind="valuation"]'); true;`);
    await sleep(900);
    text = await js(`document.querySelector('#report-body').innerText`);
    // Table headers are CSS-uppercased, so compare case-insensitively.
    const hay = text.toUpperCase();
    for (const need of ['TOTAL', 'Value (cost)', 'Gross Margin']) {
      if (hay.indexOf(need.toUpperCase()) === -1) throw new Error('valuation missing ' + need);
    }
    await capture('reports-valuation');
  });

  // ---------- settings ----------
  await step('settings: business info + currency + backup', async () => {
    await nav('settings');
    await waitFor(`!!document.querySelector('#s-save-business')`, 7000, 'settings view');
    await exec(`window.__sf.set('#s-businessName', 'StockFlow Demo Shop'); true;`);
    await exec(`window.__sf.set('#s-phone', '+1 555 0000'); true;`);
    await exec(`window.__sf.click('#s-save-business'); true;`);
    await toast('Business details saved', 'success');
    const s = db.settingsAll();
    if (s.businessName !== 'StockFlow Demo Shop') throw new Error('businessName not saved');
    await exec(`window.__sf.set('#s-currency', 'EUR'); true;`);
    await exec(`window.__sf.click('#s-save-prefs'); true;`);
    await toast('Preferences saved', 'success');
    if (db.settingsAll().currency !== 'EUR') throw new Error('currency not saved');
    await exec(`window.__sf.click('#s-backup'); true;`);
    await toast('Backup saved', 'success');
    const dir = path.join(outDir, 'csv');
    const backups = fs.readdirSync(dir).filter((f) => /^stockflow-backup-.*\.db$/.test(f));
    if (!backups.length) throw new Error('no backup file created');
    await capture('settings');
  });

  // persist the snapshot we expect on relaunch
  const state = {
    phase: 'first',
    products: db.productsList({}).map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock_qty: p.stock_qty })),
    categories: db.categoriesList().length,
    suppliers: db.suppliersList().length,
    settings: db.settingsAll(),
    backupFile: fs.readdirSync(path.join(outDir, 'csv')).find((f) => /^stockflow-backup-.*\.db$/.test(f)) || null
  };
  fs.writeFileSync(path.join(outDir, 'first-state.json'), JSON.stringify(state, null, 2));
}

/* ------------------------------------------------------------------ */
/* Second phase - persistence across relaunch                          */
/* ------------------------------------------------------------------ */
async function runSecond(db, T) {
  const { step, nav, waitFor, exec, outDir } = T;

  await step('persistence: UI loads and DB intact', async () => {
    // The app restores the last-visited view across launches (phase 1 ended on
    // Settings), so navigate to the Dashboard before asserting its stats.
    await nav('dashboard');
    await waitFor(`!!document.querySelector('.stat-grid')`, 12000, 'dashboard ready');
    const statePath = path.join(outDir, 'first-state.json');
    if (!fs.existsSync(statePath)) throw new Error('first-state.json missing - run first phase first');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    const products = db.productsList({});
    if (products.length !== state.products.length) {
      throw new Error(`expected ${state.products.length} products, got ${products.length}`);
    }
    for (const expected of state.products) {
      const p = products.find((x) => x.name === expected.name);
      if (!p) throw new Error('missing product ' + expected.name);
      if (p.sku !== expected.sku) throw new Error('sku mismatch for ' + expected.name);
      if (Number(p.stock_qty) !== Number(expected.stock_qty)) {
        throw new Error(`stock mismatch ${expected.name}: expected ${expected.stock_qty}, got ${p.stock_qty}`);
      }
    }
    if (db.categoriesList().length !== state.categories) throw new Error('categories count changed');
    if (db.suppliersList().length !== state.suppliers) throw new Error('suppliers count changed');
    const s = db.settingsAll();
    if (s.businessName !== state.settings.businessName) throw new Error('businessName not persisted');
    if (s.currency !== state.settings.currency) throw new Error('currency not persisted');

    const total = await exec(`document.querySelector('[data-stat="total-products"]').textContent`);
    if (total !== String(products.length)) throw new Error('dashboard shows ' + total + ' products');
  });

  await step('persistence: backup file still on disk', async () => {
    const statePath = path.join(outDir, 'first-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state.backupFile) throw new Error('no backup expected');
    const p = path.join(outDir, 'csv', state.backupFile);
    if (!fs.existsSync(p)) throw new Error('backup file missing after relaunch: ' + p);
  });
}

module.exports = { run };
