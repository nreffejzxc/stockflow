'use strict';
/**
 * Renderer utilities.
 * Depends on window.stockflow (preload) and window.SFFormat (shared/format.js).
 */
(function (root) {
  const F = root.SFFormat;

  const api = {
    esc(v) {
      return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    qs(sel, scope) {
      return (scope || document).querySelector(sel);
    },

    qsa(sel, scope) {
      return Array.from((scope || document).querySelectorAll(sel));
    },

    debounce(fn, wait) {
      let t = null;
      return function (...args) {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
      };
    },

    imageUrl(name) {
      return name ? `media://image/${encodeURIComponent(name)}` : null;
    },

    async getSettings() {
      if (!api._settings) {
        api._settings = await root.stockflow.settingsGet();
      }
      return api._settings;
    },

    clearSettingsCache() {
      api._settings = null;
    },

    async currencyCode() {
      const s = await api.getSettings();
      return (s && s.currency) || 'USD';
    },

    statusMeta(status) {
      switch (status) {
        case 'in': return { label: 'In Stock', cls: 'in' };
        case 'low': return { label: 'Low Stock', cls: 'low' };
        case 'out': return { label: 'Out of Stock', cls: 'out' };
        case 'inactive': return { label: 'Inactive', cls: 'inactive' };
        default: return { label: String(status), cls: 'muted' };
      }
    },

    typeMeta(type) {
      if (type === 'in') return { label: 'Stock In', cls: 'in' };
      if (type === 'out') return { label: 'Stock Out', cls: 'out' };
      return { label: 'Adjustment', cls: 'adj' };
    },

    // Status/type pill used in tables and cards.
    chip(text, cls) {
      return `<span class="chip chip-${api.esc(cls)}">${api.esc(text)}</span>`;
    },

    // Generic money formatting helper that resolves the currency once.
    async fmtMoneyCached(v) {
      return F.fmtMoney(v, await api.currencyCode());
    },

    fmt: F,

    // Toast/error extraction from a rejected promise (error may be an Error or {error}).
    errMessage(e, fallback) {
      if (e && typeof e === 'object') {
        if (e.message) return e.message;
        if (e.error) return e.error;
      }
      return e ? String(e) : (fallback || 'Something went wrong.');
    }
  };

  root.SFUtil = api;
})(window);
