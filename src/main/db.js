'use strict';
/**
 * StockFlow Desktop - data layer.
 *
 * Pure Node module (NO electron imports) so it can be unit-tested in any
 * Node/Electron runtime. All SQL lives here. Every stock mutation is wrapped
 * in a transaction that also writes a stock_movements history row, and the
 * "stock can never go negative" invariant is enforced here - never in the UI.
 */

const fs = require('fs');
const path = require('path');
const engineMod = require('./engine');

class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function qnorm(v) {
  return Math.round((v + Number.EPSILON) * 1e6) / 1e6;
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNum(v, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (v === null || v === undefined || v === '') {
    throw new AppError(`${label} is required.`);
  }
  if (!Number.isFinite(n)) throw new AppError(`${label} must be a valid number.`);
  if (n < min || n > max) {
    throw new AppError(`${label} must be between ${min} and ${max}.`);
  }
  return qnorm(n);
}

function toOptionalNum(v, label, { min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') return null;
  return toNum(v, label, { min, max });
}

function productStatus(p) {
  if (!p.is_active) return 'inactive';
  if (p.stock_qty <= 0) return 'out';
  if (p.min_stock > 0 && p.stock_qty <= p.min_stock) return 'low';
  return 'in';
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL COLLATE NOCASE UNIQUE,
  contact_person TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  sku           TEXT NOT NULL COLLATE NOCASE UNIQUE,
  barcode       TEXT COLLATE NOCASE,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price  REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  stock_qty      REAL NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  min_stock      REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  unit          TEXT NOT NULL DEFAULT 'pcs',
  description   TEXT,
  image         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode
  ON products(barcode COLLATE NOCASE) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,
  sku           TEXT,
  type          TEXT NOT NULL CHECK (type IN ('in','out','adjust')),
  quantity      REAL NOT NULL CHECK (quantity <> 0),
  previous_stock REAL NOT NULL CHECK (previous_stock >= 0),
  new_stock     REAL NOT NULL CHECK (new_stock >= 0),
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  cost          REAL,
  reason        TEXT,
  reference     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_mov_type_time ON stock_movements(type, created_at);
CREATE INDEX IF NOT EXISTS idx_mov_time ON stock_movements(created_at);
`;

const DEFAULT_SETTINGS = [
  ['businessName', 'My Business'],
  ['address', ''],
  ['phone', ''],
  ['email', ''],
  ['currency', 'USD'],
  ['defaultMinStock', '0']
];

/* ------------------------------------------------------------------ */
/* DB service                                                          */
/* ------------------------------------------------------------------ */

function createDb({ dbPath, dataDir }) {
  let handle = null;
  const engineKind = engineMod.engineKind();
  const isWasm = engineKind === 'wasm';

  function configure() {
    handle.exec('PRAGMA foreign_keys = ON;');
    handle.exec('PRAGMA busy_timeout = 5000;');
  }

  function migrate() {
    handle.exec(SCHEMA);
    const tx = handle.transaction(() => {
      const existing = handle.all('SELECT key FROM settings');
      const have = new Set(existing.map((r) => r.key));
      for (const [k, v] of DEFAULT_SETTINGS) {
        if (!have.has(k)) {
          handle.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
        }
      }
    });
    tx();
  }

  /* -------- settings -------- */

  function settingsAll() {
    const rows = handle.all('SELECT key, value FROM settings');
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  function settingsGet(key, dflt = null) {
    const row = handle.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : dflt;
  }

  function settingsSet(key, value) {
    const allowed = new Set(DEFAULT_SETTINGS.map((d) => d[0]));
    if (!allowed.has(key)) throw new AppError(`Unknown setting: ${key}`);
    handle.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, String(value === null || value === undefined ? '' : value)]
    );
    return settingsAll();
  }

  function getSettingNumber(key, dflt = 0) {
    const v = Number(settingsGet(key, dflt));
    return Number.isFinite(v) ? v : dflt;
  }

  /* -------- categories -------- */

  function categoriesList() {
    return handle.all(
      `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c
        ORDER BY c.name COLLATE NOCASE ASC`
    );
  }

  function categoriesCreate(data) {
    const name = strOrNull(data.name);
    if (!name) throw new AppError('Category name is required.');
    const description = strOrNull(data.description);
    const t = now();
    try {
      const res = handle.run(
        'INSERT INTO categories (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [name, description, t, t]
      );
      return categoriesGet(res.lastInsertRowid);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('A category with that name already exists.');
      throw e;
    }
  }

  function categoriesGet(id) {
    const row = handle.get(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c WHERE c.id = ?`,
      [id]
    );
    if (!row) throw new AppError('Category not found.');
    return row;
  }

  function categoriesUpdate(id, data) {
    categoriesGet(id); // exists check
    const name = strOrNull(data.name);
    if (!name) throw new AppError('Category name is required.');
    const description = strOrNull(data.description);
    try {
      handle.run(
        'UPDATE categories SET name = ?, description = ?, updated_at = ? WHERE id = ?',
        [name, description, now(), id]
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('A category with that name already exists.');
      throw e;
    }
    return categoriesGet(id);
  }

  function categoriesDelete(id) {
    categoriesGet(id);
    handle.run('DELETE FROM categories WHERE id = ?', [id]);
    return { ok: true };
  }

  /* -------- suppliers -------- */

  function suppliersList() {
    return handle.all(
      `SELECT s.id, s.name, s.contact_person, s.phone, s.email, s.address, s.notes,
              s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count
         FROM suppliers s
        ORDER BY s.name COLLATE NOCASE ASC`
    );
  }

  function suppliersGet(id) {
    const row = handle.get(
      `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count
         FROM suppliers s WHERE s.id = ?`,
      [id]
    );
    if (!row) throw new AppError('Supplier not found.');
    return row;
  }

  function suppliersCreate(data) {
    const name = strOrNull(data.name);
    if (!name) throw new AppError('Supplier name is required.');
    const t = now();
    const rec = {
      contact_person: strOrNull(data.contactPerson),
      phone: strOrNull(data.phone),
      email: strOrNull(data.email),
      address: strOrNull(data.address),
      notes: strOrNull(data.notes)
    };
    try {
      const res = handle.run(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, rec.contact_person, rec.phone, rec.email, rec.address, rec.notes, t, t]
      );
      return suppliersGet(res.lastInsertRowid);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('A supplier with that name already exists.');
      throw e;
    }
  }

  function suppliersUpdate(id, data) {
    suppliersGet(id);
    const name = strOrNull(data.name);
    if (!name) throw new AppError('Supplier name is required.');
    const rec = {
      contact_person: strOrNull(data.contactPerson),
      phone: strOrNull(data.phone),
      email: strOrNull(data.email),
      address: strOrNull(data.address),
      notes: strOrNull(data.notes)
    };
    try {
      handle.run(
        `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
        [name, rec.contact_person, rec.phone, rec.email, rec.address, rec.notes, now(), id]
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('A supplier with that name already exists.');
      throw e;
    }
    return suppliersGet(id);
  }

  function suppliersDelete(id) {
    suppliersGet(id);
    handle.run('DELETE FROM suppliers WHERE id = ?', [id]);
    return { ok: true };
  }

  /* -------- products -------- */

  const PRODUCT_SELECT = `
    SELECT p.*,
           c.name AS category_name,
           s.name AS supplier_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id`;

  function attachStatus(row) {
    if (!row) return row;
    return { ...row, status: productStatus(row) };
  }

  function productsGet(id) {
    const row = handle.get(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
    if (!row) throw new AppError('Product not found.');
    return attachStatus(row);
  }

  function productsList(filters = {}) {
    const { search, categoryId, supplierId, status, isActive } = filters;
    const where = [];
    const params = [];
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR IFNULL(p.barcode,'') LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    if (categoryId) {
      where.push('p.category_id = ?');
      params.push(Number(categoryId));
    }
    if (supplierId) {
      where.push('p.supplier_id = ?');
      params.push(Number(supplierId));
    }
    if (typeof isActive === 'boolean') {
      where.push('p.is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    const sql = `${PRODUCT_SELECT}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.name COLLATE NOCASE ASC`;
    let rows = handle.all(sql, params).map(attachStatus);
    if (status && status !== 'all') {
      rows = rows.filter((r) => r.status === status);
    }
    return rows;
  }

  function generateSku(name) {
    const base =
      String(name || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 4) || 'SKU';
    // Highest existing numeric suffix for this prefix (handles prefixes reused).
    const rows = handle.all(
      "SELECT sku FROM products WHERE sku LIKE ? COLLATE NOCASE",
      [`${base}-%`]
    );
    let maxN = 0;
    for (const r of rows) {
      const m = /-(\d+)$/.exec(r.sku);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    let n = maxN + 1;
    let candidate = `${base}-${n}`;
    // In the (unlikely) event of gaps colliding with a manually created SKU, keep searching.
    while (handle.get('SELECT id FROM products WHERE sku = ? COLLATE NOCASE', [candidate])) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  function validateSkuUnique(sku, excludeId) {
    const row = excludeId
      ? handle.get('SELECT id FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?', [sku, excludeId])
      : handle.get('SELECT id FROM products WHERE sku = ? COLLATE NOCASE', [sku]);
    if (row) throw new AppError(`SKU "${sku}" is already in use by another product.`);
  }

  function validateBarcodeUnique(barcode, excludeId) {
    if (!barcode) return;
    const row = excludeId
      ? handle.get('SELECT id FROM products WHERE barcode = ? COLLATE NOCASE AND id <> ?', [barcode, excludeId])
      : handle.get('SELECT id FROM products WHERE barcode = ? COLLATE NOCASE', [barcode]);
    if (row) throw new AppError(`Barcode "${barcode}" is already in use by another product.`);
  }

  function normalizeProductInput(data, { forUpdate = false } = {}) {
    const name = strOrNull(data.name);
    if (!name) throw new AppError('Product name is required.');
    if (name.length > 200) throw new AppError('Product name must be 200 characters or fewer.');

    let sku = strOrNull(data.sku);
    let barcode = strOrNull(data.barcode);
    if (barcode && barcode.length > 128) throw new AppError('Barcode is too long.');
    if (sku && sku.length > 64) throw new AppError('SKU is too long.');

    const purchasePrice = toOptionalNum(data.purchasePrice, 'Purchase price', { min: 0 }) ?? 0;
    const sellingPrice = toOptionalNum(data.sellingPrice, 'Selling price', { min: 0 }) ?? 0;
    const minStock = toOptionalNum(data.minStock, 'Minimum stock', { min: 0 })
      ?? getSettingNumber('defaultMinStock', 0);
    const unit = strOrNull(data.unit) || 'pcs';
    const description = strOrNull(data.description);
    const categoryId = data.categoryId ? Number(data.categoryId) : null;
    const supplierId = data.supplierId ? Number(data.supplierId) : null;
    const image = strOrNull(data.image);

    if (categoryId) {
      if (!handle.get('SELECT id FROM categories WHERE id = ?', [categoryId])) {
        throw new AppError('Selected category does not exist.');
      }
    }
    if (supplierId) {
      if (!handle.get('SELECT id FROM suppliers WHERE id = ?', [supplierId])) {
        throw new AppError('Selected supplier does not exist.');
      }
    }

    return {
      name, sku, barcode, categoryId, supplierId,
      purchasePrice, sellingPrice, minStock, unit, description, image
    };
  }

  function productsCreate(data) {
    const inp = normalizeProductInput(data);
    const t = now();
    if (!inp.sku) inp.sku = generateSku(inp.name);
    if (inp.sku) validateSkuUnique(inp.sku);

    const openingQty = toOptionalNum(data.openingStock, 'Opening stock', { min: 0 }) ?? 0;
    const openingCost = toOptionalNum(data.openingCost, 'Opening cost', { min: 0 }) ?? null;
    const supplierId = inp.supplierId;

    const tx = handle.transaction(() => {
      validateBarcodeUnique(inp.barcode);
      const res = handle.run(
        `INSERT INTO products
           (name, sku, barcode, category_id, supplier_id, purchase_price, selling_price,
            stock_qty, min_stock, unit, description, image, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)`,
        [
          inp.name, inp.sku, inp.barcode, inp.categoryId, inp.supplierId,
          inp.purchasePrice, inp.sellingPrice,
          inp.minStock, inp.unit, inp.description, inp.image, t, t
        ]
      );
      const productId = res.lastInsertRowid;

      if (openingQty > 0) {
        const supplierName = supplierId
          ? (handle.get('SELECT name FROM suppliers WHERE id = ?', [supplierId]) || {}).name || null
          : null;
        handle.run(
          `INSERT INTO stock_movements
             (product_id, product_name, sku, type, quantity, previous_stock, new_stock,
              supplier_id, supplier_name, cost, reason, reference, notes, created_at)
           VALUES (?, ?, ?, 'in', ?, 0, ?, ?, ?, ?, 'Opening stock added', 'Opening balance', ?, ?)`,
          [
            productId, inp.name, inp.sku, openingQty, openingQty,
            supplierId, supplierName,
            openingCost ?? inp.purchasePrice,
            data.openingNotes ? strOrNull(data.openingNotes) : 'Initial stock on product creation',
            t
          ]
        );
        handle.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [openingQty, t, productId]);
      }
      return productId;
    });
    const id = tx();
    return productsGet(id);
  }

  function productsUpdate(id, data) {
    const current = productsGet(id); // existence + current
    const inp = normalizeProductInput(data, { forUpdate: true });
    // Schema requires a SKU; an update that omits it keeps the existing one.
    if (!inp.sku) inp.sku = current.sku;

    const tx = handle.transaction(() => {
      if (inp.sku) validateSkuUnique(inp.sku, id);
      validateBarcodeUnique(inp.barcode, id);
      handle.run(
        `UPDATE products SET
           name = ?, sku = ?, barcode = ?, category_id = ?, supplier_id = ?,
           purchase_price = ?, selling_price = ?, min_stock = ?, unit = ?,
           description = ?, image = ?, updated_at = ?
         WHERE id = ?`,
        [
          inp.name, inp.sku, inp.barcode, inp.categoryId, inp.supplierId,
          inp.purchasePrice, inp.sellingPrice, inp.minStock, inp.unit,
          inp.description, inp.image, now(), id
        ]
      );
    });
    tx();
    return productsGet(id);
  }

  function productsDelete(id) {
    productsGet(id);
    handle.run('DELETE FROM products WHERE id = ?', [id]);
    return { ok: true };
  }

  function productsToggleActive(id) {
    const row = productsGet(id);
    handle.run('UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?', [
      row.is_active ? 0 : 1,
      now(),
      id
    ]);
    return productsGet(id);
  }

  function productsBulkListForPicker(search, limit = 60) {
    const params = [];
    let where = 'WHERE p.is_active = 1';
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where += ` AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR IFNULL(p.barcode,'') LIKE ? ESCAPE '\\')`;
      params.push(like, like, like);
    }
    const rows = handle.all(
      `SELECT p.id, p.name, p.sku, p.stock_qty, p.unit, p.selling_price
         FROM products p ${where}
        ORDER BY p.name COLLATE NOCASE ASC LIMIT ?`,
      [...params, limit]
    );
    return rows;
  }

  /* -------- stock -------- */

  function loadProductForStock(id) {
    const row = handle.get('SELECT * FROM products WHERE id = ?', [Number(id)]);
    if (!row) throw new AppError('Product not found.');
    return row;
  }

  function stockIn(data) {
    const product = loadProductForStock(data.productId);
    const quantity = toNum(data.quantity, 'Quantity');
    if (quantity <= 0) throw new AppError('Quantity must be greater than zero.');
    const supplierId = data.supplierId ? Number(data.supplierId) : null;
    const cost = toOptionalNum(data.cost, 'Cost', { min: 0 });
    const reference = strOrNull(data.reference);
    const notes = strOrNull(data.notes);

    if (supplierId && !handle.get('SELECT id FROM suppliers WHERE id = ?', [supplierId])) {
      throw new AppError('Selected supplier does not exist.');
    }

    const t = now();
    const previous = product.stock_qty;
    const next = qnorm(previous + quantity);
    const tx = handle.transaction(() => {
      handle.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [next, t, product.id]);
      handle.run(
        `INSERT INTO stock_movements
           (product_id, product_name, sku, type, quantity, previous_stock, new_stock,
            supplier_id, supplier_name, cost, reason, reference, notes, created_at)
         VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id, product.name, product.sku, quantity, previous, next,
          supplierId,
          supplierId ? (handle.get('SELECT name FROM suppliers WHERE id = ?', [supplierId]).name || null) : null,
          cost, null, reference, notes, t
        ]
      );
      return lastMovementId();
    });
    const movementId = tx();
    return getMovement(movementId);
  }

  function stockOut(data) {
    const product = loadProductForStock(data.productId);
    const quantity = toNum(data.quantity, 'Quantity');
    if (quantity <= 0) throw new AppError('Quantity must be greater than zero.');
    if (quantity > product.stock_qty) {
      throw new AppError(
        `Insufficient stock. Only ${formatQty(product.stock_qty)} ${product.unit} available for "${product.name}".`
      );
    }
    const reason = strOrNull(data.reason);
    const reference = strOrNull(data.reference);
    const notes = strOrNull(data.notes);

    const t = now();
    const previous = product.stock_qty;
    const next = qnorm(previous - quantity);
    const tx = handle.transaction(() => {
      handle.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [next, t, product.id]);
      handle.run(
        `INSERT INTO stock_movements
           (product_id, product_name, sku, type, quantity, previous_stock, new_stock,
            supplier_id, supplier_name, cost, reason, reference, notes, created_at)
         VALUES (?, ?, ?, 'out', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
        [product.id, product.name, product.sku, -quantity, previous, next, reason, reference, notes, t]
      );
      return lastMovementId();
    });
    const movementId = tx();
    return getMovement(movementId);
  }

  function stockAdjust(data) {
    const product = loadProductForStock(data.productId);
    const newQuantity = toNum(data.newQuantity, 'New quantity', { min: 0 });
    const reason = strOrNull(data.reason);
    const notes = strOrNull(data.notes);
    if (!reason) throw new AppError('A reason is required for stock adjustments.');

    const previous = product.stock_qty;
    const delta = qnorm(newQuantity - previous);
    if (delta === 0) throw new AppError('New quantity is the same as the current stock - nothing to adjust.');

    const t = now();
    const tx = handle.transaction(() => {
      handle.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [newQuantity, t, product.id]);
      handle.run(
        `INSERT INTO stock_movements
           (product_id, product_name, sku, type, quantity, previous_stock, new_stock,
            supplier_id, supplier_name, cost, reason, reference, notes, created_at)
         VALUES (?, ?, ?, 'adjust', ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
        [product.id, product.name, product.sku, delta, previous, newQuantity, reason, notes, t]
      );
      return lastMovementId();
    });
    const movementId = tx();
    return getMovement(movementId);
  }

  function lastMovementId() {
    return handle.get('SELECT last_insert_rowid() AS id').id;
  }

  function getMovement(id) {
    const row = handle.get(
      `SELECT m.*, p.stock_qty AS current_stock FROM stock_movements m
        LEFT JOIN products p ON p.id = m.product_id
       WHERE m.id = ?`,
      [id]
    );
    if (!row) throw new AppError('Movement not found.');
    return row;
  }

  function movementsList(filter = {}) {
    const { search, type, from, to, limit, offset } = filter;
    const where = [];
    const params = [];
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push(`(m.product_name LIKE ? ESCAPE '\\' OR m.sku LIKE ? ESCAPE '\\' OR IFNULL(m.reference,'') LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    if (type && type !== 'all') {
      where.push('m.type = ?');
      params.push(type);
    }
    if (from) {
      where.push("date(m.created_at) >= date(?)");
      params.push(from);
    }
    if (to) {
      where.push("date(m.created_at) <= date(?)");
      params.push(to);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const base = `FROM stock_movements m ${whereSql}`;

    const total = handle.get(`SELECT COUNT(*) AS n ${base}`, params).n;
    let sql = `SELECT m.* ${base} ORDER BY m.created_at DESC, m.id DESC`;
    const lim = Math.max(1, Math.min(Number(limit) || 500, 10000));
    if (offset) sql += ` LIMIT ${Math.max(0, Number(offset))}, ${lim}`;
    else sql += ` LIMIT ${lim}`;

    const rows = handle.all(sql, params);
    return { rows, total };
  }

  /* -------- dashboard -------- */

  function getDashboard() {
    const totals = handle.get(
      `SELECT COUNT(*) AS total_products,
              IFNULL(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active_products,
              IFNULL(SUM(CASE WHEN is_active = 1 THEN stock_qty ELSE 0 END), 0) AS total_stock,
              IFNULL(SUM(CASE WHEN is_active = 1 THEN stock_qty * purchase_price ELSE 0 END), 0) AS cost_value,
              IFNULL(SUM(CASE WHEN is_active = 1 THEN stock_qty * selling_price ELSE 0 END), 0) AS retail_value
         FROM products`
    );
    const low = handle.get(
      `SELECT COUNT(*) AS n FROM products
        WHERE is_active = 1 AND stock_qty > 0 AND min_stock > 0 AND stock_qty <= min_stock`
    ).n;
    const out = handle.get(
      `SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND stock_qty <= 0`
    ).n;

    const recent = movementsList({ limit: 8 }).rows;
    const lowStock = handle.all(
      `SELECT p.*, c.name AS category_name, s.name AS supplier_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.is_active = 1 AND p.stock_qty > 0 AND p.min_stock > 0 AND p.stock_qty <= p.min_stock
        ORDER BY (p.stock_qty - p.min_stock) ASC, p.name COLLATE NOCASE ASC
        LIMIT 8`
    ).map(attachStatus);
    const lowTotal = handle.get(
      `SELECT COUNT(*) AS n FROM products
        WHERE is_active = 1 AND stock_qty > 0 AND min_stock > 0 AND stock_qty <= min_stock`
    ).n;

    return {
      totalProducts: totals.total_products,
      activeProducts: totals.active_products,
      totalStock: totals.total_stock,
      lowStock: low,
      outOfStock: out,
      costValue: totals.cost_value,
      retailValue: totals.retail_value,
      recentMovements: recent,
      lowStockProducts: lowStock,
      lowTotal
    };
  }

  /* -------- reports -------- */

  function reportsGenerate(kind, params = {}) {
    if (kind === 'inventory') return reportInventory(params);
    if (kind === 'movements') return reportMovements(params);
    if (kind === 'low-stock') return reportLowStock(params);
    if (kind === 'valuation') return reportValuation(params);
    throw new AppError(`Unknown report: ${kind}`);
  }

  function reportInventory(params = {}) {
    let rows = productsList({
      search: params.search,
      categoryId: params.categoryId,
      supplierId: params.supplierId,
      status: params.status || 'all'
    });
    const headers = [
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'name', label: 'Product', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'supplier', label: 'Supplier', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', type: 'money' },
      { key: 'sellingPrice', label: 'Selling Price', type: 'money' },
      { key: 'stockQty', label: 'Stock', type: 'qty' },
      { key: 'minStock', label: 'Min Stock', type: 'qty' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'stockValue', label: 'Stock Value (cost)', type: 'money' },
      { key: 'retailValue', label: 'Stock Value (retail)', type: 'money' }
    ];
    let costSum = 0;
    let retailSum = 0;
    let unitsSum = 0;
    rows = rows.map((p) => {
      const stockValue = p.stock_qty * p.purchase_price;
      const retailValue = p.stock_qty * p.selling_price;
      costSum += stockValue;
      retailSum += retailValue;
      unitsSum += p.stock_qty;
      return {
        sku: p.sku,
        name: p.name,
        category: p.category_name || 'Uncategorized',
        supplier: p.supplier_name || '—',
        unit: p.unit,
        purchasePrice: p.purchase_price,
        sellingPrice: p.selling_price,
        stockQty: p.stock_qty,
        minStock: p.min_stock,
        status: statusLabel(p.status),
        stockValue: qnorm(stockValue),
        retailValue: qnorm(retailValue)
      };
    });
    const summary = { rows: rows.length, units: unitsSum, costValue: qnorm(costSum), retailValue: qnorm(retailSum) };
    return { kind: 'inventory', title: 'Inventory Report', filename: 'inventory-report', headers, rows, summary };
  }

  function reportMovements(params = {}) {
    const movs = movementsList({
      search: params.search,
      type: params.type || 'all',
      from: params.from || '',
      to: params.to || '',
      limit: params.limit || 5000
    }).rows;
    const headers = [
      { key: 'date', label: 'Date', type: 'datetime' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'signedqty' },
      { key: 'previous', label: 'Previous Stock', type: 'qty' },
      { key: 'new', label: 'New Stock', type: 'qty' },
      { key: 'supplier', label: 'Supplier', type: 'text' },
      { key: 'cost', label: 'Cost', type: 'money' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' }
    ];
    const rows = movs.map((m) => ({
      date: m.created_at,
      product: m.product_name,
      sku: m.sku || '',
      type: movementTypeLabel(m.type),
      quantity: m.quantity,
      previous: m.previous_stock,
      new: m.new_stock,
      supplier: m.supplier_name || '—',
      cost: m.cost,
      reference: m.reference || '',
      reason: m.reason || ''
    }));
    return { kind: 'movements', title: 'Stock Movement Report', filename: 'stock-movements', headers, rows, summary: { rows: rows.length } };
  }

  function reportLowStock(params = {}) {
    const rowsAll = productsList({ search: params.search, categoryId: params.categoryId });
    const filtered = rowsAll.filter((p) => p.is_active && p.stock_qty <= p.min_stock);
    const headers = [
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'name', label: 'Product', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'supplier', label: 'Supplier', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'stockQty', label: 'Stock', type: 'qty' },
      { key: 'minStock', label: 'Min Stock', type: 'qty' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'shortfall', label: 'Below Min', type: 'qty' }
    ];
    const rows = filtered.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category_name || 'Uncategorized',
      supplier: p.supplier_name || '—',
      unit: p.unit,
      stockQty: p.stock_qty,
      minStock: p.min_stock,
      status: p.stock_qty <= 0 ? 'Out of Stock' : 'Low Stock',
      shortfall: qnorm(Math.max(0, p.min_stock - p.stock_qty))
    }));
    return { kind: 'low-stock', title: 'Low Stock Report', filename: 'low-stock-report', headers, rows, summary: { rows: rows.length } };
  }

  function reportValuation() {
    const headers = [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'products', label: 'Products', type: 'num' },
      { key: 'units', label: 'Units', type: 'qty' },
      { key: 'costValue', label: 'Value (cost)', type: 'money' },
      { key: 'retailValue', label: 'Value (retail)', type: 'money' },
      { key: 'margin', label: 'Gross Margin %', type: 'pct' }
    ];
    const rows = handle.all(
      `SELECT IFNULL(c.name, 'Uncategorized') AS category,
              COUNT(*) AS products,
              IFNULL(SUM(p.stock_qty), 0) AS units,
              IFNULL(SUM(p.stock_qty * p.purchase_price), 0) AS costValue,
              IFNULL(SUM(p.stock_qty * p.selling_price), 0) AS retailValue
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        GROUP BY IFNULL(c.name, 'Uncategorized')
        ORDER BY category COLLATE NOCASE ASC`
    ).map((r) => ({
      category: r.category,
      products: r.products,
      units: r.units,
      costValue: qnorm(r.costValue),
      retailValue: qnorm(r.retailValue),
      margin: r.retailValue > 0 ? Math.round(((r.retailValue - r.costValue) / r.retailValue) * 10000) / 100 : 0
    }));
    const sum = rows.reduce(
      (a, r) => ({
        products: a.products + r.products,
        units: a.units + r.units,
        costValue: a.costValue + r.costValue,
        retailValue: a.retailValue + r.retailValue
      }),
      { products: 0, units: 0, costValue: 0, retailValue: 0 }
    );
    rows.push({
      category: 'TOTAL',
      products: sum.products,
      units: sum.units,
      costValue: qnorm(sum.costValue),
      retailValue: qnorm(sum.retailValue),
      margin: sum.retailValue > 0 ? Math.round(((sum.retailValue - sum.costValue) / sum.retailValue) * 10000) / 100 : 0,
      _total: true
    });
    return { kind: 'valuation', title: 'Inventory Valuation', filename: 'inventory-valuation', headers, rows, summary: { rows: rows.length - 1 } };
  }

  function statusLabel(s) {
    switch (s) {
      case 'in': return 'In Stock';
      case 'low': return 'Low Stock';
      case 'out': return 'Out of Stock';
      case 'inactive': return 'Inactive';
      default: return s;
    }
  }

  function movementTypeLabel(t) {
    if (t === 'in') return 'Stock In';
    if (t === 'out') return 'Stock Out';
    return 'Adjustment';
  }

  function formatQty(v) {
    const n = Number(v);
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 1e4) / 1e4);
  }

  /* -------- backup / restore -------- */

  function defaultBackupPath() {
    const dir = path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `stockflow-backup-${stamp()}.db`);
  }

  function backupCreate(targetPath) {
    const dest = targetPath || defaultBackupPath();
    const abs = path.resolve(dest);
    if (abs.toLowerCase() === path.resolve(dbPath).toLowerCase()) {
      throw new AppError('Cannot overwrite the active database file. Choose a different location.');
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    handle.backupTo(abs);
    const stat = fs.statSync(abs);
    return { path: abs, size: stat.size, createdAt: now() };
  }

  function assertSqliteFile(file) {
    // Cheap structural check that works for every engine: SQLite header magic.
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    try {
      fs.readSync(fd, buf, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (buf.toString('latin1') !== 'SQLite format 3 ') {
      throw new AppError('That file is not a valid SQLite database.');
    }
    if (isWasm) return; // full quick_check below requires a synchronous reopen
    const tmp = path.join(path.dirname(file), `.sf-check-${process.pid}-${Date.now()}.db`);
    try {
      fs.copyFileSync(file, tmp);
      const probe = engineMod.open(tmp);
      probe.exec('PRAGMA quick_check;');
      probe.close();
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
    }
  }

  function backupRestore(sourcePath) {
    if (!sourcePath) throw new AppError('No backup file was selected.');
    const src = path.resolve(sourcePath);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      throw new AppError('Backup file does not exist.');
    }
    if (src.toLowerCase() === path.resolve(dbPath).toLowerCase()) {
      throw new AppError('That is the current database file, not a backup.');
    }

    // Safety: snapshot the current DB before replacing it.
    const safetyPath = path.join(dataDir, 'backups', `pre-restore-${stamp()}.db`);
    fs.mkdirSync(path.dirname(safetyPath), { recursive: true });
    handle.backupTo(safetyPath);

    assertSqliteFile(src);

    handle.close();
    try {
      fs.copyFileSync(src, dbPath);
    } catch (e) {
      handle = engineMod.open(dbPath);
      configure();
      throw new AppError('Restore failed while copying the backup: ' + e.message);
    }
    handle = engineMod.open(dbPath);
    configure();
    const check = handle.get('PRAGMA quick_check;');
    if (!check || check.quick_check !== 'ok') {
      // Try to recover from the safety snapshot.
      try {
        handle.close();
        fs.copyFileSync(safetyPath, dbPath);
        handle = engineMod.open(dbPath);
        configure();
      } catch (_) { /* ignore */ }
      throw new AppError('The backup file could not be opened as a valid StockFlow database.');
    }
    return { ok: true, safetyPath, restoredAt: now() };
  }

  function integrityCheck() {
    const r = handle.get('PRAGMA quick_check;');
    return { ok: r && r.quick_check === 'ok' };
  }

  function close() {
    if (handle) {
      try { handle.close(); } catch (_) { /* ignore */ }
      handle = null;
    }
  }

  function isUniqueViolation(e) {
    const msg = String((e && e.message) || e || '');
    return /UNIQUE constraint failed|UNIQUE|constraint/i.test(msg);
  }

  /* ------------------------------------------------------------------ */

  // Actually open now (async path only for wasm).
  function openNow() {
    if (isWasm) return null; // caller must await reopenWasm
    handle = engineMod.open(dbPath);
    configure();
    migrate();
    return handle;
  }

  async function openNowAsync() {
    handle = await engineMod.open(dbPath);
    configure();
    migrate();
    return handle;
  }

  return {
    engineKind,
    isWasm,
    openNow,
    openNowAsync,
    dbPath: () => dbPath,
    dataDir: () => dataDir,

    settingsAll, settingsGet, settingsSet,
    categoriesList, categoriesGet, categoriesCreate, categoriesUpdate, categoriesDelete,
    suppliersList, suppliersGet, suppliersCreate, suppliersUpdate, suppliersDelete,
    productsGet, productsList, productsCreate, productsUpdate, productsDelete,
    productsToggleActive, productsBulkListForPicker,
    stockIn, stockOut, stockAdjust, movementsList,
    getDashboard,
    reportsGenerate,
    backupCreate, backupRestore, integrityCheck,
    close,
    productStatus
  };
}

function openDatabase(opts) {
  const svc = createDb(opts);
  if (!svc.isWasm) svc.openNow();
  return svc;
}

module.exports = { createDb, openDatabase, AppError, now, qnorm, strOrNull };
