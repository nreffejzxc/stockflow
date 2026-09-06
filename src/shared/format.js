/**
 * StockFlow formatting helpers.
 * Pure module: usable from the renderer (as a global via <script>) and from
 * Node (CommonJS). No electron imports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SFFormat = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CURRENCY_SYMBOLS = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
    INR: '₹', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', CHF: 'Fr',
    SGD: 'S$', HKD: 'HK$', MYR: 'RM', PHP: '₱', THB: '฿',
    ZAR: 'R', BRL: 'R$', MXN: 'MX$', KRW: '₩', RUB: '₽',
    TRY: '₺', AED: 'AED', SEK: 'kr', NOK: 'kr', DKK: 'kr',
    PLN: 'zł', CZK: 'Kč', HUF: 'Ft', IDR: 'Rp', VND: '₫'
  };

  function currencySymbol(code) {
    return CURRENCY_SYMBOLS[String(code || 'USD').toUpperCase()] || (String(code || '').toUpperCase() + ' ');
  }

  function group(n) {
    // Group integer part with commas; keep decimals untouched.
    const s = String(n);
    const neg = s.startsWith('-') ? '-' : '';
    const body = neg ? s.slice(1) : s;
    const parts = body.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg + parts.join('.');
  }

  function round(n, dp) {
    const f = Math.pow(10, dp);
    return Math.round((Number(n) + Number.EPSILON) * f) / f;
  }

  /** Money, e.g. $1,234.50 */
  function fmtMoney(n, currency) {
    const sym = currencySymbol(currency);
    const v = round(Number.isFinite(n) ? n : 0, 2);
    const neg = v < 0 ? '-' : '';
    return `${neg}${sym}${group(Math.abs(v).toFixed(2))}`;
  }

  /** Plain 2-dp number without symbol (used in CSV for money cells). */
  function rawMoney(n) {
    return (Number.isFinite(Number(n)) ? round(n, 2) : 0).toFixed(2);
  }

  /** Quantities - up to 4 decimals, trailing zeros trimmed. */
  function fmtQty(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '0';
    const v = Number(n);
    if (Number.isInteger(v)) return group(v);
    const trimmed = String(round(v, 4));
    return group(trimmed);
  }

  /** Signed quantity for movement deltas: +5 / -3. */
  function fmtSignedQty(n) {
    const v = Number(n);
    if (v > 0) return '+' + fmtQty(v);
    if (v < 0) return '−' + fmtQty(Math.abs(v));
    return fmtQty(0);
  }

  function fmtPct(n) {
    const v = Number.isFinite(Number(n)) ? Number(n) : 0;
    return `${group(round(v, 2))}%`;
  }

  /** "2026-09-06 14:05:03" or ISO -> readable local date-time. */
  function fmtDateTime(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const date = fmtDate(`${m[1]}-${m[2]}-${m[3]}`);
      const hm = `${m[4]}:${m[5]}`;
      return `${date} ${hm}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    }
    return s;
  }

  /** "2026-09-06" -> "Sep 6, 2026" */
  function fmtDate(v) {
    if (!v) return '';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
    }
    return s;
  }

  /** Render one report cell to display text, per header type. */
  function cellText(value, type, currency) {
    if (value === null || value === undefined || value === '') return '—';
    switch (type) {
      case 'money': return fmtMoney(value, currency);
      case 'qty': return fmtQty(value);
      case 'signedqty': return fmtSignedQty(value);
      case 'num': return group(Number(value));
      case 'pct': return fmtPct(value);
      case 'date': return fmtDate(value);
      case 'datetime': return fmtDateTime(value);
      default: return String(value);
    }
  }

  return {
    CURRENCY_SYMBOLS,
    currencySymbol,
    fmtMoney,
    fmtQty,
    fmtSignedQty,
    fmtPct,
    fmtDate,
    fmtDateTime,
    cellText,
    rawMoney,
    round,
    group
  };
});
