'use strict';
/**
 * StockFlow dev-mode E2E runner.
 *
 * Usage: npm run start:e2e            (both phases, fresh data)
 *        npm run start:e2e -- first   (seed + first phase only)
 *        npm run start:e2e -- second  (persistence check after a first run)
 *
 * Launches Electron (real main process + renderer) in offscreen mode and
 * captures screenshots into artifacts/dev-e2e/screenshots/. The E2E harness
 * itself lives in src/main/e2e.js and is loaded only when STOCKFLOW_E2E=1.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'dev-e2e');
const OUT = path.join(ART, 'out');
const UD = path.join(ART, 'userdata');
const SHOTS = 'screenshots';

function electronBin() {
  // When run under Node, the electron package exports the path to its binary.
  try {
    return require('electron');
  } catch (_) {
    const cand = path.join(ROOT, 'node_modules', '.bin', 'electron.cmd');
    if (fs.existsSync(cand)) return cand;
    throw new Error('Electron is not installed. Run npm install first.');
  }
}

function run(phase) {
  const env = {
    ...process.env,
    STOCKFLOW_E2E: '1',
    STOCKFLOW_E2E_DIR: OUT,
    STOCKFLOW_USER_DATA: UD,
    STOCKFLOW_E2E_SHOTS: SHOTS,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  if (phase === 'second') env.STOCKFLOW_E2E_PHASE = 'second';

  return new Promise((resolve, reject) => {
    const child = spawn(electronBin(), ['.'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = '';
    child.stdout.on('data', (d) => { process.stdout.write(d); log += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); log += d; });
    const t = setTimeout(() => { child.kill(); reject(new Error('dev e2e timed out')); }, 150000);
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve(code === 0 ? 0 : (code === null ? -1 : code));
    });
  });
}

function readResult() {
  const p = path.join(OUT, 'e2e-result.json');
  if (!fs.existsSync(p)) throw new Error('e2e-result.json not found - did the app run?');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function report(result) {
  const failed = (result.steps || []).filter((s) => !s.ok);
  console.log(`[run-e2e] ${result.phase} phase: ${failed.length ? 'FAIL' : 'PASS'} (${(result.steps || []).length} steps)`);
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  return failed.length === 0 && result.ok;
}

async function main() {
  const requested = process.argv[2] || 'both';

  if (requested === 'first' || requested === 'both') {
    fs.rmSync(ART, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const code = await run('first');
    if (code !== 0) { console.error('[run-e2e] electron exited ' + code); process.exit(1); }
    if (!report(readResult())) process.exit(1);
    console.log('[run-e2e] first phase passed. Screenshots in ' + path.join(ART, SHOTS));
  }

  if (requested === 'second' || requested === 'both') {
    if (!fs.existsSync(path.join(OUT, 'first-state.json'))) {
      console.error('[run-e2e] first-state.json missing - run the first phase first.');
      process.exit(1);
    }
    const code = await run('second');
    if (code !== 0) { console.error('[run-e2e] electron exited ' + code); process.exit(1); }
    if (!report(readResult())) process.exit(1);
    console.log('[run-e2e] persistence phase passed.');
  }

  console.log('[run-e2e] done.');
}

main().catch((e) => { console.error('[run-e2e] failed:', e.message); process.exit(1); });
