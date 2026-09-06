# StockFlow Desktop — v1.0.0

A complete, offline, desktop **inventory management application** for small businesses.
Built as a single self-contained Windows application — **no Node, npm, Python,
internet, or server required to run it.**

- **Status:** ✅ Production build complete and verified end-to-end (see *Verification*).
- **Location:** `stockflow-desktop\` (this project folder). Finished programs are in `stockflow-desktop\release\`.

---

## How to run (pick one)

| Option | File | What it does |
| --- | --- | --- |
| **Install (recommended)** | `release\StockFlow-Setup-1.0.0.exe` | Opens the installer → installs *StockFlow* to `%LOCALAPPDATA%\Programs\StockFlow` with Start-menu & desktop shortcuts, uninstaller included. |
| **Portable (no install)** | `release\StockFlow-1.0.0-portable.exe` | Single-file app. Double-click to run; works from a USB stick. |

Double-click the `.exe`. That's it.

> **Windows SmartScreen note:** the app is **not code-signed**, so on first launch
> Windows may show *"Windows protected your PC"*. Click **More info → Run anyway**.
> This is expected for any unsigned app and is harmless. (NSIS installer is the
> preferred artifact because portable self-extracting exes occasionally trip AV heuristics.)

**Your data** lives in the app's user-data folder (created automatically on first
run). The exact path is shown inside the app under **Settings → Database**. It contains:
`stockflow.db` (all products/stock/settings), `images\` (product photos), `backups\`
(manual backups). Data persists across updates and uninstalls.

---

## Features

- **Dashboard** — Total Products, Total Stock (units), Low Stock, Out of Stock, Inventory
  Value (cost & retail), Recent Stock Movements, Low-Stock product list.
- **Products** — full CRUD, search by name/SKU/barcode, filter by category/supplier/status,
  activate/deactivate, product photo, and **auto-generated unique SKU** when you leave it blank.
- **Categories & Suppliers** — CRUD + search; deleting one keeps your products
  (they become *Uncategorized* / no supplier).
- **Stock Management** — Stock In / Stock Out / Adjustment forms plus full **Movement History**
  with filters (type, date range, search). **Stock can never go negative** — every stock-out or
  adjustment is validated and every change writes a dated movement record with previous/new quantities.
- **Reports** — Inventory, Stock Movements, Low Stock, Inventory Valuation (by category with
  cost & retail value and margin). Every report **exports to CSV** (Excel-ready, UTF-8 BOM).
- **Settings** — business info, currency, default minimum-stock, **database Backup & Restore**
  (one-click snapshot files), About.
- Fully **offline** and private — nothing ever leaves your machine.

---

## Verification (what was tested before delivery)

1. **Logic test suite** — 23/23 DB tests green
   (CRUD for every entity, auto-SKU uniqueness, stock in/out/adjustment correctness,
   never-negative invariant, movement history, delete semantics, settings round-trip,
   reports, backup/restore round-trip, persistence across close/reopen, CSV escaping).
2. **Dev E2E (real UI, offscreen)** — 22/22 UI steps + 2/2 persistence steps pass.
   Drives the actual renderer to create categories/suppliers/products (with image),
   run stock in → out → rejected over-draw → adjustment, edit/toggle/delete,
   filter movement history, generate & export each report, change settings, and back up.
   Persistence re-launched against the same data store and confirmed intact.
3. **Packaged production build** — the actual `.exe`s were launched and re-verified:
   - Portable exe: first run 22/22, relaunch persistence 2/2 ✅
   - NSIS **silent install** → installed `StockFlow.exe`: first run 22/22, relaunch persistence 2/2 ✅
   - 16 screenshots captured of every screen from the running app and checked for real rendered content.

---

## Build artifacts (`stockflow-desktop\release\`)

| File | Size | SHA-256 |
| --- | --- | --- |
| `StockFlow-Setup-1.0.0.exe` | 111,737,003 B (106.56 MB) | `54a2b1ec2d1ecd5592d3a5e33a1749ca78e48daf33de3bdd99b0f9e28c0a8ebf` |
| `StockFlow-1.0.0-portable.exe` | 111,519,583 B (106.35 MB) | `54595b9ac2e82ba72e0eb3b8ab5b44e98e8a17f24f3ced3850caf4a2ddf0b07e` |

(`release\win-unpacked\StockFlow.exe` is the unpacked build used by the installer.)

---

## Technology

| Piece | Choice |
| --- | --- |
| Runtime | **Electron 44.2.0** (Chromium + Node 24.20) |
| Database | **SQLite** via Node's built-in `node:sqlite` — real, transactional, zero native modules |
| Data layer | `src/main/db.js` — schema, indexes, constraints, all queries (pure Node, engine-agnostic) |
| Security | `contextIsolation`, `sandbox`, no `nodeIntegration`, single whitelisted IPC channel, strict CSP, `media://` for images |
| UI | Vanilla HTML/CSS/JS (no framework, no CDN) — sidebar app with cards, tables, modals, toasts, confirmations, empty states |
| Packaging | **electron-builder 26.15.3** — NSIS installer + portable, ASAR, signed-with-nothing (unsigned) |
| Icons | Generated programmatically (`scripts/icon.js`) — no binary tools |

Source, tests, and scripts all live in this project for reproducibility. To rebuild:
`npm install && npm run dist` (from inside `stockflow-desktop\`).
