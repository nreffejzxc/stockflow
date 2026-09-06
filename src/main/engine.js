'use strict';
/**
 * SQLite engine adapter.
 *
 * Provides one uniform synchronous interface so the rest of the app does not
 * care whether SQLite comes from:
 *   - node:sqlite (built into Electron's Node, no native module)   [preferred]
 *   - better-sqlite3 (native module)                               [fallback]
 *   - sql.js (WASM)                                                [last resort]
 *
 * Exposed handle methods: exec, run, get, all, transaction, close, backupTo,
 * restoreFrom, integrityCheck.
 */

const fs = require('fs');
const path = require('path');

class SQLError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SQLError';
    this.cause = cause;
  }
}

function pickEngineKind() {
  if (process.env.STOCKFLOW_SQL_ENGINE) {
    return process.env.STOCKFLOW_SQL_ENGINE;
  }
  try {
    const s = require('node:sqlite');
    if (s && typeof s.DatabaseSync === 'function') return 'node';
  } catch (_) { /* ignore */ }
  try {
    require('better-sqlite3');
    return 'better';
  } catch (_) { /* ignore */ }
  return 'wasm';
}

const toNumber = (v) => {
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
  }
  return v;
};

// Recursively normalise returned values (BigInt -> Number).
function normalizeRow(row) {
  if (row === null || row === undefined) return row;
  if (typeof row !== 'object') return toNumber(row);
  if (Array.isArray(row)) return row.map(normalizeRow);
  const out = {};
  for (const k of Object.keys(row)) out[k] = toNumber(row[k]);
  return out;
}

function quoteSqlString(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/* ------------------------------------------------------------------ */
/* node:sqlite engine                                                  */
/* ------------------------------------------------------------------ */
function openNode(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true
  });

  const prepareArgs = (sql, params) => {
    const stmt = raw.prepare(sql);
    return { stmt, params: Array.isArray(params) ? params : [] };
  };

  return {
    kind: 'node',
    exec(sql) {
      try {
        raw.exec(sql);
      } catch (e) {
        throw new SQLError('SQLite error: ' + e.message, e);
      }
    },
    run(sql, params) {
      try {
        const { stmt, params: args } = prepareArgs(sql, params);
        const res = stmt.run(...args);
        return { changes: toNumber(res.changes), lastInsertRowid: toNumber(res.lastInsertRowid) };
      } catch (e) {
        throw new SQLError('SQLite error: ' + e.message, e);
      }
    },
    get(sql, params) {
      try {
        const { stmt, params: args } = prepareArgs(sql, params);
        return normalizeRow(stmt.get(...args));
      } catch (e) {
        throw new SQLError('SQLite error: ' + e.message, e);
      }
    },
    all(sql, params) {
      try {
        const { stmt, params: args } = prepareArgs(sql, params);
        return stmt.all(...args).map(normalizeRow);
      } catch (e) {
        throw new SQLError('SQLite error: ' + e.message, e);
      }
    },
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          try { raw.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
          throw e;
        }
      };
    },
    backupTo(targetPath) {
      // VACUUM INTO produces a consistent single-file snapshot.
      this.exec(`VACUUM INTO ${quoteSqlString(targetPath)}`);
    },
    close() {
      try { raw.close(); } catch (_) { /* ignore */ }
    }
  };
}

/* ------------------------------------------------------------------ */
/* better-sqlite3 engine                                               */
/* ------------------------------------------------------------------ */
function openBetter(dbPath) {
  const Database = require('better-sqlite3');
  const raw = new Database(dbPath);
  raw.pragma('foreign_keys = ON');
  raw.pragma('journal_mode = WAL');

  const prep = (sql) => {
    let stmt;
    try { stmt = raw.prepare(sql); } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    return stmt;
  };

  return {
    kind: 'better',
    exec(sql) {
      try { raw.exec(sql); } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    run(sql, params) {
      try {
        const stmt = prep(sql);
        const res = stmt.run(...(Array.isArray(params) ? params : []));
        return { changes: toNumber(res.changes), lastInsertRowid: toNumber(res.lastInsertRowid) };
      } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    get(sql, params) {
      try {
        const stmt = prep(sql);
        return normalizeRow(stmt.get(...(Array.isArray(params) ? params : [])));
      } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    all(sql, params) {
      try {
        const stmt = prep(sql);
        return stmt.all(...(Array.isArray(params) ? params : [])).map(normalizeRow);
      } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    transaction(fn) {
      return (...args) => raw.transaction(fn)(...args);
    },
    backupTo(targetPath) {
      this.exec(`VACUUM INTO ${quoteSqlString(targetPath)}`);
    },
    close() {
      try { raw.close(); } catch (_) { /* ignore */ }
    }
  };
}

/* ------------------------------------------------------------------ */
/* sql.js (WASM) engine                                                */
/* ------------------------------------------------------------------ */
// In-memory database persisted to disk after every committed transaction.
// Initialisation is asynchronous because the WASM binary must be fetched.
async function openWasm(dbPath) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f)
  });

  let raw;
  if (fs.existsSync(dbPath)) {
    raw = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    raw = new SQL.Database();
  }

  const persist = () => {
    const data = raw.export();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));
  };

  const bind = (stmt, params) => {
    const p = Array.isArray(params) ? params : [];
    if (p.length) stmt.bind(p);
  };

  const runStatement = (sql, params) => {
    const stmt = raw.prepare(sql);
    bind(stmt, params);
    const info = stmt.step();
    let lastInsertRowid = 0;
    let changes = 0;
    const res = raw.exec('SELECT last_insert_rowid() AS id, changes() AS ch');
    if (res.length && res[0].values.length) {
      lastInsertRowid = res[0].values[0][0];
      changes = res[0].values[1][0];
    }
    try { stmt.free(); } catch (_) { /* ignore */ }
    return { changes: toNumber(changes), lastInsertRowid: toNumber(lastInsertRowid) };
  };

  return {
    kind: 'wasm',
    _persist: persist,
    exec(sql) {
      try { raw.exec(sql); } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    run(sql, params) {
      try { return runStatement(sql, params); } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    get(sql, params) {
      try {
        const stmt = raw.prepare(sql);
        bind(stmt, params);
        const out = stmt.step() ? stmt.getAsObject() : undefined;
        try { stmt.free(); } catch (_) { /* ignore */ }
        return normalizeRow(out);
      } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    all(sql, params) {
      try {
        const stmt = raw.prepare(sql);
        bind(stmt, params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        try { stmt.free(); } catch (_) { /* ignore */ }
        return rows.map(normalizeRow);
      } catch (e) { throw new SQLError('SQLite error: ' + e.message, e); }
    },
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          persist();
          return out;
        } catch (e) {
          try { raw.exec('ROLLBACK'); } catch (_) { /* ignore */ }
          throw e;
        }
      };
    },
    backupTo(targetPath) {
      // Persist to main file first, then copy - simple and consistent enough for WASM.
      persist();
      fs.copyFileSync(dbPath, targetPath);
    },
    close() {
      persist();
      try { raw.close(); } catch (_) { /* ignore */ }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
// Synchronous for node/better engines (their handles are ready at once).
// The wasm engine is async to load its binary, so it returns a Promise -
// the only caller that needs it (db.openNowAsync) awaits it. Callers of the
// sync path must never receive a Promise, so `open` itself is not async.
function open(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const kind = pickEngineKind();
  if (kind === 'wasm') return openWasm(dbPath);
  if (kind === 'better') return openBetter(dbPath);
  return openNode(dbPath);
}

function engineKind() {
  return pickEngineKind();
}

module.exports = { open, pickEngineKind, engineKind, SQLError };
