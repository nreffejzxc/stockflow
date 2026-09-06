'use strict';
/**
 * Generates the StockFlow app icons without any binary image tools:
 *   build/icon.png  (512x512 master)
 *   build/icon.ico  (multi-size, for Windows / electron-builder)
 *
 * Pure Node + pngjs + png-to-ico (devDependencies, no native code).
 * Design: rounded-square tile with a purple->indigo vertical gradient and three
 * white ascending "stock level" bars (an inventory/warehouse motif).
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 512;
const OUT_DIR = path.resolve(__dirname, '..', 'build');

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Robust rounded-rect test (point must be within the rounded outline).
function inRoundRect2(x, y, cx, cy, w, h, r) {
  const halfW = w / 2;
  const halfH = h / 2;
  // clamp point to inner rectangle
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const insideInner = Math.abs(x - cx) < halfW && Math.abs(y - cy) < halfH;
  if (!insideInner) return false;
  if (qx <= 0 || qy <= 0) return true; // in the straight part
  return qx * qx + qy * qy <= r * r;   // in the rounded corner
}

// Anti-aliased coverage of a boolean shape fn via 3x3 sub-samples.
function coverage(fn, px, py, size) {
  const sub = 3;
  let hits = 0;
  for (let i = 0; i < sub; i++) {
    for (let j = 0; j < sub; j++) {
      const sx = (px + (i + 0.5) / sub) / size;
      const sy = (py + (j + 0.5) / sub) / size;
      if (fn(sx, sy)) hits++;
    }
  }
  return hits / (sub * sub);
}

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const colorTop = hexToRgb('#6D5DF6');
  const colorBottom = hexToRgb('#4437C8');

  // Tile occupies the whole square with rounded corners.
  const tile = (x, y) => inRoundRect2(x, y, 0.5, 0.5, 1, 1, 0.16);

  // Three ascending bars.
  const margin = 0.21;
  const gap = 0.038;
  const barW = (1 - margin * 2 - gap * 2) / 3;
  const barBase = 0.755;          // where bars sit
  const heights = [0.2, 0.325, 0.47];
  const startX = 0.5 - barW * 1.5 - gap;
  const bars = heights.map((h, i) => {
    const cx = startX + i * (barW + gap);
    const cy = barBase - h / 2;
    const fn = (x, y) => inRoundRect2(x, y, cx, cy, barW, h, barW * 0.32);
    return fn;
  });
  // Soft underline below the bars.
  const underline = (x, y) => Math.abs(y - (barBase + 0.055)) < 0.011 && x > 0.17 && x < 0.83;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const bgA = coverage(tile, px, py, size);
      if (bgA <= 0) continue;

      let glyphA = 0;
      for (const b of bars) glyphA = Math.max(glyphA, coverage(b, px, py, size));
      glyphA = Math.max(glyphA, coverage(underline, px, py, size) * 0.35);

      // Background gradient colour at this pixel.
      const y = py / size;
      const t = Math.min(1, Math.max(0, (y - 0.03) / 0.9));
      const bgR = lerp(colorTop[0], colorBottom[0], t);
      const bgG = lerp(colorTop[1], colorBottom[1], t);
      const bgB = lerp(colorTop[2], colorBottom[2], t);

      // "over" compositing: glyph (white) over bg, both straight alpha.
      const outA = glyphA + bgA * (1 - glyphA);
      const outR = (255 * glyphA + bgR * bgA * (1 - glyphA)) / outA;
      const outG = (255 * glyphA + bgG * bgA * (1 - glyphA)) / outA;
      const outB = (255 * glyphA + bgB * bgA * (1 - glyphA)) / outA;

      const idx = (size * py + px) << 2;
      png.data[idx] = Math.round(outR);
      png.data[idx + 1] = Math.round(outG);
      png.data[idx + 2] = Math.round(outB);
      png.data[idx + 3] = Math.round(outA * 255);
    }
  }
  return png;
}

// Box-filter downsample of a square master to a target size.
function downsample(master, size) {
  const out = new PNG({ width: size, height: size });
  const factor = master.width / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const y0 = Math.floor(py * factor), y1 = Math.floor((py + 1) * factor);
      const x0 = Math.floor(px * factor), x1 = Math.floor((px + 1) * factor);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (master.width * y + x) << 2;
          r += master.data[idx];
          g += master.data[idx + 1];
          b += master.data[idx + 2];
          a += master.data[idx + 3];
          n++;
        }
      }
      const o = (size * py + px) << 2;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const master = drawIcon(SIZE);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), PNG.sync.write(master));

  const { imagesToIco } = require('png-to-ico');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((s) => downsample(master, s));
  try {
    const ico = imagesToIco(images);
    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
    console.log('Icons written to', OUT_DIR);
    console.log('  icon.png', fs.statSync(path.join(OUT_DIR, 'icon.png')).size, 'bytes');
    console.log('  icon.ico', fs.statSync(path.join(OUT_DIR, 'icon.ico')).size, 'bytes');
  } catch (err) {
    console.error('Failed to build icon.ico:', err);
    process.exit(1);
  }
}

main();
