# StockFlow Desktop

A complete, **offline-first inventory management desktop app** for small businesses.
Built with Electron + SQLite — single self-contained Windows `.exe`, **no runtime,
internet, or server required**. Data never leaves the machine.

> Ready-to-run installers are distributed as **GitHub Releases** (see right-hand
> sidebar). This repository holds the full source.

## Features

- **Dashboard** — total products & units, low/out-of-stock counts, inventory value
  (cost & retail), recent stock movements, low-stock list.
- **Products** — CRUD, search (name/SKU/barcode), category & supplier & status filters,
  activate/deactivate, product photo, auto-generated unique SKU.
- **Categories & Suppliers** — CRUD + search; deleting one keeps your products.
- **Stock Management** — Stock In / Stock Out / Adjustment with a **never-negative**
  invariant and full **Movement History** (type / date / search filters).
- **Reports** — Inventory, Stock Movements, Low Stock, Valuation (by category) — each
  exportable to CSV (Excel-ready, UTF-8 BOM).
- **Settings** — business info, currency, default minimum stock, **database Backup &
  Restore**, About.

## Tech

| Piece | Choice |
|---|---|
| Runtime | Electron 44 (Chromium + Node 24) |
| Database | SQLite via Node's built-in `node:sqlite` (transactional, no native modules) |
| Renderer | Vanilla HTML/CSS/JS (no framework, no CDN) |
| Security | `contextIsolation`, `sandbox`, whitelisted IPC, strict CSP |
| Packaging | electron-builder (NSIS installer + portable, ASAR) |

## Project layout

```
src/
  main/    Electron main: db layer, IPC, window, media:// images, E2E harness
  renderer HTML/CSS/JS single-page app (views/ for each screen)
  shared/  format helpers used by the renderer
test/      db logic tests (node:test)
scripts/   run tests / e2e, icon generation, post-build verifier
```

## Development

```bash
npm install        # first time only
npm test           # DB logic tests
npm run start:e2e  # offscreen UI E2E + screenshots + persistence check
npm run dist       # build release\StockFlow-Setup-<ver>.exe + -portable.exe
npm run verify     # launch the packaged exes and assert they pass the E2E
```

## Verify releases

Every release is smoke-tested end-to-end before publishing: DB logic suite,
real-UI E2E (both phases incl. persistence across relaunch), and the **packaged**
installer + portable exe are launched and pass the same checks. See `REPORT.md`.
