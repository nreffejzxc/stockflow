'use strict';
/**
 * DB logic tests - run with `npm test` (see scripts/run-tests.js).
 * Covers every table's CRUD, stock invariants (never negative), movement
 * history correctness, auto-SKU, delete semantics, reports and backup/restore.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase, AppError } = require('../src/main/db');
const { buildReportCsv } = require('../src/main/csv');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stockflow-test-'));

function makeDb(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'stockflow.db');
  const svc = openDatabase({ dbPath, dataDir: dir });
  return { svc, dbPath, dir };
}

function closeDb(svc) {
  svc.close();
}

function expectAppError(fn, re) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof AppError, `expected AppError, got ${e}`);
    if (re) assert.match(e.message, re);
    return true;
  });
}

test('schema initialised with default settings', () => {
  const { svc } = makeDb('settings-basic');
  const s = svc.settingsAll();
  assert.strictEqual(s.businessName, 'My Business');
  assert.strictEqual(s.currency, 'USD');
  assert.strictEqual(s.defaultMinStock, '0');
  assert.ok(svc.integrityCheck().ok);
  closeDb(svc);
});

test('settings round-trip and unknown key rejected', () => {
  const { svc } = makeDb('settings-rt');
  const updated = svc.settingsSet('businessName', 'Acme Supplies');
  assert.strictEqual(updated.businessName, 'Acme Supplies');
  assert.strictEqual(svc.settingsGet('businessName'), 'Acme Supplies');
  expectAppError(() => svc.settingsSet('nope', 'x'), /Unknown setting/);
  closeDb(svc);
});

test('category CRUD, duplicate rejection, product counts', () => {
  const { svc } = makeDb('cats');
  const c1 = svc.categoriesCreate({ name: '  Beverages ', description: 'Drinks' });
  assert.strictEqual(c1.name, 'Beverages');
  expectAppError(() => svc.categoriesCreate({ name: 'beverages' }), /already exists/i);
  const c2 = svc.categoriesCreate({ name: 'Snacks' });

  const prod = svc.productsCreate({ name: 'Cola', categoryId: c1.id });
  assert.strictEqual(prod.category_name, 'Beverages');

  let list = svc.categoriesList();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list.find((c) => c.id === c1.id).product_count, 1);

  const up = svc.categoriesUpdate(c2.id, { name: 'Chips & Snacks' });
  assert.strictEqual(up.name, 'Chips & Snacks');
  svc.categoriesDelete(c2.id);
  list = svc.categoriesList();
  assert.strictEqual(list.length, 1);
  closeDb(svc);
});

test('deleting a category nulls product category', () => {
  const { svc } = makeDb('cats-null');
  const c = svc.categoriesCreate({ name: 'Temp' });
  const p = svc.productsCreate({ name: 'Item', categoryId: c.id });
  assert.strictEqual(p.category_id, c.id);
  svc.categoriesDelete(c.id);
  const reloaded = svc.productsGet(p.id);
  assert.strictEqual(reloaded.category_id, null);
  closeDb(svc);
});

test('supplier CRUD and delete nulls product supplier', () => {
  const { svc } = makeDb('suppliers');
  const s1 = svc.suppliersCreate({
    name: 'Fresh Foods Co',
    contactPerson: 'Ann',
    phone: '555-0100',
    email: 'ann@fresh.test',
    address: '1 Market St',
    notes: 'Fruits'
  });
  assert.strictEqual(s1.contact_person, 'Ann');
  expectAppError(() => svc.suppliersCreate({ name: 'fresh foods co' }), /already exists/i);

  const p = svc.productsCreate({ name: 'Apples', supplierId: s1.id });
  assert.strictEqual(p.supplier_name, 'Fresh Foods Co');
  assert.strictEqual(svc.suppliersList()[0].product_count, 1);

  svc.suppliersDelete(s1.id);
  assert.strictEqual(svc.productsGet(p.id).supplier_id, null);
  closeDb(svc);
});

test('product auto-SKU generation is unique and predictable', () => {
  const { svc } = makeDb('sku-auto');
  const a = svc.productsCreate({ name: 'Wireless Mouse', sku: '', purchasePrice: 5, sellingPrice: 9 });
  const b = svc.productsCreate({ name: 'Wireless Mouse', sku: '' });
  const c = svc.productsCreate({ name: 'Keyboard', sku: 'KB-10' });
  assert.match(a.sku, /^WIRE-\d+$/);
  assert.match(b.sku, /^WIRE-\d+$/);
  assert.notStrictEqual(a.sku, b.sku);
  assert.strictEqual(c.sku, 'KB-10');
  closeDb(svc);
});

test('duplicate SKU and barcode rejected', () => {
  const { svc } = makeDb('sku-dup');
  svc.productsCreate({ name: 'A', sku: 'SKU1' });
  expectAppError(() => svc.productsCreate({ name: 'B', sku: 'sku1' }), /already in use/i);
  svc.productsCreate({ name: 'C', sku: 'SKU2', barcode: '123456' });
  expectAppError(() => svc.productsCreate({ name: 'D', barcode: '123456' }), /already in use/i);
  // empty barcodes are fine to repeat
  svc.productsCreate({ name: 'E' });
  svc.productsCreate({ name: 'F' });
  closeDb(svc);
});

test('product validation: required name and non-negative numbers', () => {
  const { svc } = makeDb('val');
  expectAppError(() => svc.productsCreate({ name: '   ' }), /name is required/i);
  expectAppError(() => svc.productsCreate({ name: 'X', purchasePrice: -1 }), /between 0 and/i);
  expectAppError(() => svc.productsCreate({ name: 'X', sellingPrice: 'abc' }), /valid number/i);
  closeDb(svc);
});

test('product update changes fields but not stock', () => {
  const { svc } = makeDb('p-update');
  const cat = svc.categoriesCreate({ name: 'E' });
  const p = svc.productsCreate({ name: 'Old', purchasePrice: 1, sellingPrice: 2, minStock: 3 });
  svc.stockIn({ productId: p.id, quantity: 10 });
  const up = svc.productsUpdate(p.id, {
    name: 'New Name',
    categoryId: cat.id,
    purchasePrice: 1.5,
    sellingPrice: 3,
    minStock: 5,
    unit: 'box'
  });
  assert.strictEqual(up.name, 'New Name');
  assert.strictEqual(up.category_id, cat.id);
  assert.strictEqual(up.stock_qty, 10, 'stock unchanged by product edit');
  assert.strictEqual(up.min_stock, 5);
  closeDb(svc);
});

test('product toggle active / inactive', () => {
  const { svc } = makeDb('toggle');
  const p = svc.productsCreate({ name: 'T' });
  assert.strictEqual(p.is_active, 1);
  const off = svc.productsToggleActive(p.id);
  assert.strictEqual(off.is_active, 0);
  assert.strictEqual(off.status, 'inactive');
  const on = svc.productsToggleActive(p.id);
  assert.strictEqual(on.is_active, 1);
  closeDb(svc);
});

test('product delete removes product and cascades its movements', () => {
  const { svc } = makeDb('del-cascade');
  const p = svc.productsCreate({ name: 'Doomed', openingStock: 5 });
  svc.stockOut({ productId: p.id, quantity: 2, reason: 'Sold' });
  assert.strictEqual(svc.movementsList({}).total, 2);
  svc.productsDelete(p.id);
  assert.strictEqual(svc.movementsList({}).total, 0, 'movements cascaded away');
  expectAppError(() => svc.productsGet(p.id), /not found/i);
  closeDb(svc);
});

test('creating product with opening stock logs an "in" movement', () => {
  const { svc } = makeDb('opening');
  const p = svc.productsCreate({ name: 'Start', openingStock: 25, openingCost: 2, purchasePrice: 2 });
  assert.strictEqual(p.stock_qty, 25);
  const movs = svc.movementsList({}).rows;
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].type, 'in');
  assert.strictEqual(movs[0].quantity, 25);
  assert.strictEqual(movs[0].previous_stock, 0);
  assert.strictEqual(movs[0].new_stock, 25);
  assert.strictEqual(movs[0].reference, 'Opening balance');
  closeDb(svc);
});

test('stock in/out/adjust keep previous/new consistent and never negative', () => {
  const { svc } = makeDb('stock-core');
  const p = svc.productsCreate({ name: 'Widget', minStock: 5, unit: 'pcs' });
  assert.strictEqual(p.status, 'out');

  const in1 = svc.stockIn({ productId: p.id, quantity: 100, cost: 4, reference: 'PO-001', notes: 'restock' });
  assert.strictEqual(in1.new_stock, 100);
  assert.strictEqual(in1.type, 'in');

  const out1 = svc.stockOut({ productId: p.id, quantity: 30, reason: 'Sale', reference: 'SALE-1' });
  assert.strictEqual(out1.quantity, -30);
  assert.strictEqual(out1.previous_stock, 100);
  assert.strictEqual(out1.new_stock, 70);
  assert.strictEqual(out1.sku, p.sku);

  // Out more than available -> rejected, nothing changes.
  const beforeMovs = svc.movementsList({}).total;
  expectAppError(
    () => svc.stockOut({ productId: p.id, quantity: 999, reason: 'x' }),
    /Insufficient stock/i
  );
  assert.strictEqual(svc.productsGet(p.id).stock_qty, 70, 'stock unchanged after failed out');
  assert.strictEqual(svc.movementsList({}).total, beforeMovs, 'no movement written on failed out');

  // Negative out quantity.
  expectAppError(() => svc.stockOut({ productId: p.id, quantity: -3, reason: 'x' }), /greater than zero/);

  // Adjustment sets absolute quantity.
  const adj = svc.stockAdjust({ productId: p.id, newQuantity: 80, reason: 'Cycle count correction' });
  assert.strictEqual(adj.quantity, 10);
  assert.strictEqual(adj.previous_stock, 70);
  assert.strictEqual(adj.new_stock, 80);
  assert.strictEqual(svc.productsGet(p.id).stock_qty, 80);

  // Adjustment down.
  const adj2 = svc.stockAdjust({ productId: p.id, newQuantity: 3, reason: 'Damage found' });
  assert.strictEqual(adj2.quantity, -77);
  assert.strictEqual(svc.productsGet(p.id).stock_qty, 3);

  // Adjustment to a negative number rejected.
  expectAppError(
    () => svc.stockAdjust({ productId: p.id, newQuantity: -5, reason: 'oops' }),
    /between 0 and/i
  );
  // Adjustment to zero is allowed (valid).
  svc.stockAdjust({ productId: p.id, newQuantity: 0, reason: 'Wrote off' });
  assert.strictEqual(svc.productsGet(p.id).stock_qty, 0);

  // No-op adjustment rejected.
  expectAppError(
    () => svc.stockAdjust({ productId: p.id, newQuantity: 0, reason: 'nothing' }),
    /nothing to adjust/i
  );
  closeDb(svc);
});

test('adjustment requires a reason; stock-in validates qty > 0', () => {
  const { svc } = makeDb('stock-valid');
  const p = svc.productsCreate({ name: 'V' });
  expectAppError(() => svc.stockAdjust({ productId: p.id, newQuantity: 5 }), /reason is required/i);
  expectAppError(() => svc.stockIn({ productId: p.id, quantity: 0 }), /greater than zero/);
  closeDb(svc);
});

test('movement history snapshots survive product edits', () => {
  const { svc } = makeDb('snapshot');
  const p = svc.productsCreate({ name: 'OriginalName' });
  svc.stockIn({ productId: p.id, quantity: 10 });
  svc.productsUpdate(p.id, { name: 'Renamed' });
  svc.stockOut({ productId: p.id, quantity: 1, reason: 'sale' });
  const movs = svc.movementsList({}).rows;
  assert.strictEqual(movs.length, 2, 'stock in + stock out = 2 movements (create logs none)');
  // Newest first; the first (oldest) movement still carries the old product name snapshot.
  const first = movs[movs.length - 1];
  assert.strictEqual(first.product_name, 'OriginalName');
  const latest = movs[0];
  assert.strictEqual(latest.product_name, 'Renamed');
  assert.strictEqual(svc.productsGet(p.id).name, 'Renamed');
  closeDb(svc);
});

test('movement list filters by type, search and dates', () => {
  const { svc } = makeDb('mov-filter');
  const p = svc.productsCreate({ name: 'FilterMe' });
  svc.stockIn({ productId: p.id, quantity: 50, reference: 'REF-IN' });
  svc.stockOut({ productId: p.id, quantity: 10, reason: 'Sale', reference: 'REF-OUT' });
  svc.stockAdjust({ productId: p.id, newQuantity: 25, reason: 'Count' });

  assert.strictEqual(svc.movementsList({ type: 'in' }).total, 1);
  assert.strictEqual(svc.movementsList({ type: 'out' }).total, 1);
  assert.strictEqual(svc.movementsList({ type: 'adjust' }).total, 1);
  assert.strictEqual(svc.movementsList({ search: 'filterme' }).total, 3);
  assert.strictEqual(svc.movementsList({ search: 'REF-OUT' }).total, 1);
  assert.strictEqual(svc.movementsList({ from: '2099-01-01' }).total, 0);
  closeDb(svc);
});

test('dashboard stats reflect stock conditions', () => {
  const { svc } = makeDb('dash');
  const a = svc.productsCreate({ name: 'Healthy', openingStock: 50, minStock: 10, purchasePrice: 2, sellingPrice: 4 });
  const b = svc.productsCreate({ name: 'LowProd', openingStock: 4, minStock: 10, purchasePrice: 1, sellingPrice: 3 });
  const c = svc.productsCreate({ name: 'EmptyProd', openingStock: 0, minStock: 5 });
  svc.productsToggleActive(c.id); // inactive, excluded
  const stats = svc.getDashboard();
  assert.strictEqual(stats.activeProducts, 2);
  assert.strictEqual(stats.totalStock, 54);
  assert.strictEqual(stats.lowStock, 1, 'b is low, c inactive not counted');
  assert.strictEqual(stats.outOfStock, 0);
  assert.strictEqual(stats.costValue, 50 * 2 + 4 * 1);
  assert.strictEqual(stats.retailValue, 50 * 4 + 4 * 3);
  assert.ok(Array.isArray(stats.recentMovements));
  assert.ok(Array.isArray(stats.lowStockProducts));
  closeDb(svc);
});

test('product list filters: search, category, status', () => {
  const { svc } = makeDb('plist');
  const cat = svc.categoriesCreate({ name: 'Drinks' });
  const p1 = svc.productsCreate({ name: 'Cola', sku: 'COLA1', categoryId: cat.id, openingStock: 30, minStock: 5 });
  svc.productsCreate({ name: 'Soda' }); // out of stock
  svc.productsCreate({ name: 'Lemonade', categoryId: cat.id, openingStock: 2, minStock: 10 }); // low

  assert.strictEqual(svc.productsList({ search: 'cola' }).length, 1);
  assert.strictEqual(svc.productsList({ search: 'COLA1' }).length, 1);
  assert.strictEqual(svc.productsList({ categoryId: cat.id }).length, 2);
  assert.strictEqual(svc.productsList({ status: 'in' }).length, 1);
  assert.strictEqual(svc.productsList({ status: 'out' }).length, 1);
  assert.strictEqual(svc.productsList({ status: 'low' }).length, 1);
  const p1st = svc.productsGet(p1.id);
  assert.strictEqual(p1st.status, 'in');
  closeDb(svc);
});

test('reports: inventory, movements, low-stock, valuation', () => {
  const { svc } = makeDb('reports');
  const cat = svc.categoriesCreate({ name: 'Drinks' });
  const a = svc.productsCreate({ name: 'Cola', sku: 'C1', categoryId: cat.id, openingStock: 10, purchasePrice: 1, sellingPrice: 2, minStock: 3 });
  svc.productsCreate({ name: 'Soda', sku: 'S1', categoryId: cat.id, purchasePrice: 1, sellingPrice: 2, minStock: 3 }); // out
  svc.productsCreate({ name: 'Chips', purchasePrice: 2, sellingPrice: 4, openingStock: 100 });

  svc.stockOut({ productId: a.id, quantity: 1, reason: 'sale' });

  const inv = svc.reportsGenerate('inventory');
  assert.strictEqual(inv.rows.length, 3);
  const colaInv = inv.rows.find((r) => r.name === 'Cola');
  assert.strictEqual(colaInv.stockValue, 9 * 1);
  const low = svc.reportsGenerate('low-stock');
  assert.strictEqual(low.rows.length, 1, 'only the out-of-stock Soda is <= min');
  assert.strictEqual(low.rows[0].name, 'Soda');
  const val = svc.reportsGenerate('valuation');
  assert.strictEqual(val.rows[val.rows.length - 1].category, 'TOTAL');
  assert.strictEqual(val.rows[val.rows.length - 1].costValue, 9 * 1 + 0 + 100 * 2);
  const mov = svc.reportsGenerate('movements');
  assert.strictEqual(mov.rows.length, 3);
  // CSV builder works on a report object (BOM + header labels)
  const csv = buildReportCsv(inv, 'USD');
  assert.ok(csv.startsWith('﻿'), 'file starts with a UTF-8 BOM');
  assert.match(csv, /SKU,Product,Category/);
  closeDb(svc);
});

test('backup/restore round-trip restores data', () => {
  const { svc, dbPath, dir } = makeDb('backup');
  const c = svc.categoriesCreate({ name: 'Drinks' });
  svc.productsCreate({ name: 'Cola', categoryId: c.id, openingStock: 7 });
  const backupPath = path.join(dir, 'snapshot.db');
  const bk = svc.backupCreate(backupPath);
  assert.ok(fs.existsSync(bk.path));
  const bkBytes = fs.statSync(bk.path).size;
  assert.ok(bkBytes > 0);

  // Mutate after backup.
  svc.productsCreate({ name: 'After Backup', openingStock: 3 });
  assert.strictEqual(svc.productsList({}).length, 2);

  // Restore -> only the pre-backup product remains.
  svc.backupRestore(backupPath);
  assert.strictEqual(svc.productsList({}).length, 1);
  const p = svc.productsGet(svc.productsList({})[0].id);
  assert.strictEqual(p.name, 'Cola');
  assert.strictEqual(p.stock_qty, 7);
  assert.ok(svc.integrityCheck().ok);
  assert.strictEqual(svc.dbPath(), dbPath);
  closeDb(svc);
});

test('backup refuses to overwrite live db; restore rejects invalid files', () => {
  const { svc, dbPath, dir } = makeDb('backup-bad');
  expectAppError(() => svc.backupCreate(dbPath), /cannot overwrite/i);

  const badFile = path.join(dir, 'bad.db');
  fs.writeFileSync(badFile, 'this is not a sqlite database at all');
  // On restore, either assertSqliteFile or copy step fails with an AppError.
  assert.throws(() => svc.backupRestore(badFile), AppError);

  // Live db still healthy.
  svc.productsCreate({ name: 'Still Works' });
  assert.strictEqual(svc.productsList({}).length, 1);
  closeDb(svc);
});

test('data persists across close and reopen', () => {
  const dir = path.join(tmpRoot, 'persist');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'stockflow.db');
  let svc = openDatabase({ dbPath, dataDir: dir });
  const c = svc.categoriesCreate({ name: 'Persist Cat' });
  const p = svc.productsCreate({ name: 'Persist Prod', categoryId: c.id, openingStock: 42, minStock: 5 });
  svc.settingsSet('currency', 'EUR');
  svc.close();

  svc = openDatabase({ dbPath, dataDir: dir });
  const rows = svc.productsList({});
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].stock_qty, 42);
  assert.strictEqual(svc.categoriesList().length, 1);
  assert.strictEqual(svc.settingsGet('currency'), 'EUR');
  assert.strictEqual(svc.movementsList({}).total, 1);
  assert.strictEqual(svc.productsGet(p.id).name, 'Persist Prod');
  svc.close();
});

test('CSV escaping handles quotes, commas and newlines', () => {
  const { buildObjectsCsv } = require('../src/main/csv');
  const csv = buildObjectsCsv(
    [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Note' }],
    [{ a: 'plain', b: 'ok' }, { a: 'say "hi"', b: 'a, b' }, { a: 'multi\nline', b: '' }]
  );
  assert.match(csv, /"say ""hi"""/);
  assert.match(csv, /"a, b"/);
  assert.match(csv, /"multi\nline"/);
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

// Keep a reference to avoid unused-variable lint noise (app/before intentionally).
void test; void before; void AppError; void closeDb; void expectAppError;
