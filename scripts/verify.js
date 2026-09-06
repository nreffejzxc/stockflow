'use strict';
/**
 * StockFlow production verifier.
 *
 * After `npm run dist` has produced release/ artifacts this script:
 *   1. launches the portable exe with the offscreen E2E harness (fresh data),
 *   2. relaunches it (persistence phase) against the same data dir,
 *   3. silent-installs the NSIS setup into a temp dir and runs the installed
 *      app through the same first + second E2E phases,
 *   4. reports exe sizes and SHA-256, writing release/verify-result.json.
 *
 * Usage: node scripts/verify.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const PKG = require(path.join(ROOT, 'package.json'));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(kind, pattern) {
  const file = fs.readdirSync(RELEASE).find((f) => pattern.test(f));
  if (!file) throw new Error(`Missing ${kind} artifact in release/ (matching ${pattern})`);
  return path.join(RELEASE, file);
}

/** Run an exe with E2E env; resolves with its exit code. */
function runE2E(exe, { userData, outDir, phase, shots, label }) {
  const env = {
    ...process.env,
    STOCKFLOW_E2E: '1',
    STOCKFLOW_E2E_DIR: outDir,
    STOCKFLOW_USER_DATA: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  if (phase === 'second') env.STOCKFLOW_E2E_PHASE = 'second';
  if (shots) env.STOCKFLOW_E2E_SHOTS = shots;

  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label}: timed out after 150s\n${log.slice(-2000)}`));
    }, 150000);
    child.on('error', (e) => { clearTimeout(timeout); reject(new Error(`${label}: spawn failed - ${e.message}`)); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      console.log(`[verify] ${label}: exit ${code}`);
      if (log.trim()) {
        const lines = log.split('\n').filter((l) => /\[e2e\]|\[renderer:(error|warn)\]|\[ipc\]|\[main\]|Error|error/i.test(l)).slice(-40);
        if (lines.length) console.log('   ' + lines.join('\n   '));
      }
      resolve(code === 0 ? 0 : (code === null ? -1 : code));
    });
  });
}

function readResult(outDir) {
  const p = path.join(outDir, 'e2e-result.json');
  if (!fs.existsSync(p)) throw new Error('e2e-result.json not found at ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assertOk(result, label) {
  if (!result.ok) {
    const failed = (result.steps || []).filter((s) => !s.ok);
    throw new Error(`${label} FAILED ${failed.length} step(s): ` +
      failed.map((f) => `${f.name} (${f.detail})`).join('; '));
  }
  console.log(`[verify] ${label}: ${result.steps.length} steps OK`);
}

async function main() {
  const reports = { app: `${PKG.productName || 'StockFlow'} v${PKG.version}`, artifacts: {}, runs: [], date: new Date().toISOString() };

  if (!fs.existsSync(RELEASE)) {
    throw new Error(`No release/ directory at ${RELEASE}. Run npm run dist first.`);
  }

  const portable = artifact('portable', /-portable\.exe$/i);
  const setup = artifact('setup', /-Setup-.*\.exe$/i);

  // ---- portable: first + second phase ----
  const rootE2E = path.join(ROOT, 'artifacts', 'verify-portable');
  const pd1 = path.join(rootE2E, 'userdata-1');
  const pd2 = path.join(rootE2E, 'userdata-2');
  for (const d of [pd1, pd2, path.join(rootE2E, 'out')]) {
    fs.rmSync(d, { recursive: true, force: true });
  }

  const portableOut = path.join(rootE2E, 'out');
  let code = await runE2E(portable, {
    userData: pd1, outDir: portableOut, phase: 'first', shots: 'screenshots-portable', label: 'portable (phase 1)'
  });
  if (code !== 0) throw new Error('portable phase-1 exited with ' + code);
  assertOk(readResult(portableOut), 'portable first phase');

  code = await runE2E(portable, {
    userData: pd1, outDir: portableOut, phase: 'second', label: 'portable (phase 2 persistence)'
  });
  if (code !== 0) throw new Error('portable phase-2 exited with ' + code);
  assertOk(readResult(portableOut), 'portable persistence phase');
  reports.runs.push({ target: 'portable', first: 'pass', persistence: 'pass' });

  // ---- NSIS silent install + run installed app ----
  const installDir = path.join(ROOT, 'artifacts', 'verify-install');
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(installDir, { recursive: true });

  console.log('[verify] silent-installing setup…');
  const installCode = await new Promise((resolve, reject) => {
    const p = spawn(setup, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', (c) => resolve(c === 0 ? 0 : c));
  });
  if (installCode !== 0) throw new Error('NSIS silent install exited with ' + installCode);

  const installedExe = path.join(installDir, 'StockFlow.exe');
  if (!fs.existsSync(installedExe)) {
    const listing = fs.readdirSync(installDir).slice(0, 20);
    throw new Error('Installed exe not found (looked for ' + installedExe + '). Dir has: ' + listing.join(', '));
  }

  const instE2E = path.join(ROOT, 'artifacts', 'verify-installed');
  const id1 = path.join(instE2E, 'userdata-1');
  fs.rmSync(id1, { recursive: true, force: true });
  fs.rmSync(path.join(instE2E, 'out'), { recursive: true, force: true });

  code = await runE2E(installedExe, {
    userData: id1, outDir: path.join(instE2E, 'out'), phase: 'first', shots: 'screenshots-installed', label: 'installed (phase 1)'
  });
  if (code !== 0) throw new Error('installed phase-1 exited with ' + code);
  assertOk(readResult(path.join(instE2E, 'out')), 'installed first phase');

  code = await runE2E(installedExe, {
    userData: id1, outDir: path.join(instE2E, 'out'), phase: 'second', label: 'installed (phase 2 persistence)'
  });
  if (code !== 0) throw new Error('installed phase-2 exited with ' + code);
  assertOk(readResult(path.join(instE2E, 'out')), 'installed persistence phase');
  reports.runs.push({ target: 'installed (NSIS)', first: 'pass', persistence: 'pass' });

  // ---- sizes + hashes ----
  for (const f of [portable, setup, installedExe]) {
    const stat = fs.statSync(f);
    reports.artifacts[path.basename(f)] = {
      size: stat.size,
      sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
      sha256: sha256(f)
    };
    console.log(`[verify] ${path.basename(f)}: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  }

  reports.ok = true;
  fs.writeFileSync(path.join(RELEASE, 'verify-result.json'), JSON.stringify(reports, null, 2));
  console.log('\n[verify] ALL PRODUCTION CHECKS PASSED');
  console.log('Detailed result: ' + path.join(RELEASE, 'verify-result.json'));
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('[verify] FAILED:', e.message);
  process.exit(1);
});
