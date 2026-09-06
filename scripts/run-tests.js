'use strict';
/**
 * Test runner for `npm test`.
 *
 * db.js prefers the built-in `node:sqlite` module. If the system Node that runs
 * this script does not expose node:sqlite (Node < 22.13), it re-runs the tests
 * under Electron-as-Node, whose bundled Node is recent enough.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const testFile = path.join(root, 'test', 'db.test.js');

function nodeHasSqlite() {
  const r = spawnSync(process.execPath, ['-e', 'require("node:sqlite"); process.stdout.write("ok")'], {
    encoding: 'utf8'
  });
  return r.status === 0 && /ok/.test(r.stdout || '');
}

function run(cmd, args, env) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  if (r.error) {
    console.error('Failed to launch:', r.error.message);
    process.exit(2);
  }
  process.exit(r.status === null ? 1 : r.status);
}

if (nodeHasSqlite()) {
  console.log('[tests] system Node exposes node:sqlite - running with plain Node');
  run(process.execPath, ['--test', testFile], {});
} else {
  console.log('[tests] system Node lacks node:sqlite - running under Electron-as-Node');
  let electronBin = null;
  try {
    electronBin = require('electron'); // when run from Node this returns the path string
  } catch (_) { /* not installed yet */ }
  if (!electronBin || typeof electronBin !== 'string' || !fs.existsSync(electronBin)) {
    console.error(
      '[tests] Electron is not installed and the system Node cannot load node:sqlite.\n' +
      'Install dependencies first (npm install) or use Node >= 22.13.'
    );
    process.exit(2);
  }
  run(electronBin, ['--test', testFile], { ELECTRON_RUN_AS_NODE: '1' });
}
