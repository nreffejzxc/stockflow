'use strict';
/**
 * CSV serialisation for reports. Pure module (no electron).
 * Always writes UTF-8 with a BOM so Excel opens it correctly.
 */
const { cellText, rawMoney } = require('../shared/format');

function escapeCell(value) {
  const s = String(value === null || value === undefined ? '' : value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build CSV text from a report object: { headers:[{key,label,type}], rows:[obj], currency }
 * Returns { text, filename } where text includes the BOM.
 */
function buildReportCsv(report, currency) {
  const headers = report.headers;
  const lines = [];
  lines.push(headers.map((h) => escapeCell(h.label)).join(','));
  for (const row of report.rows) {
    const cells = headers.map((h) => {
      const v = row[h.key];
      if (h.type === 'money' && v !== null && v !== undefined && v !== '') {
        // Raw numeric for money keeps the column machine-readable; header notes the currency.
        return escapeCell(rawMoney(v));
      }
      return escapeCell(cellText(v, h.type, currency));
    });
    lines.push(cells.join(','));
  }
  // ﻿ = UTF-8 BOM.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Serialise an arbitrary list of flat objects to CSV. */
function buildObjectsCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map((h) => escapeCell(h.label)).join(','));
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => escapeCell(row[h.key] === undefined ? '' : row[h.key]))
        .join(',')
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildReportCsv, buildObjectsCsv, escapeCell };
