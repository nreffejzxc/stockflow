'use strict';
/**
 * StockFlow renderer shell: view router, shared icon set, cross-view
 * navigation and startup wiring. Each view registers itself on window.SFViews
 * and implements `async mount(hostEl, ctx)`; ctx carries { go, params }.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  root.SFViews = root.SFViews || {};

  const ICONS = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 2l10 5v10l-10 5L2 17V7z"/><path d="M2 7l10 5 10-5M12 22V12"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-2.6-6.3"/><path d="M21 3v6h-6"/></svg>'
  };

  let current = null;

  function setActive(name) {
    U.qsa('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }

  async function go(name, params) {
    const view = root.SFViews[name];
    if (!view || typeof view.mount !== 'function') return;
    current = { name, params: params || null };
    try { localStorage.setItem('sf:lastView', name); } catch (_) { /* ignore */ }
    setActive(name);
    const rootEl = U.qs('#view-root');
    rootEl.innerHTML = '';
    UI.loading(true, view.loadingText || 'Loading…');
    try {
      await view.mount(rootEl, { go, params: params || null });
    } catch (e) {
      console.error('[view] failed to mount:', name, e);
      rootEl.innerHTML =
        `<div class="card" style="padding:30px;color:var(--ink-500)">
           Could not load this view. ${U.esc(U.errMessage(e, 'Please try again.'))}
         </div>`;
    } finally {
      UI.loading(false);
    }
  }

  function refresh() {
    return current ? go(current.name, current.params) : null;
  }

  async function startup() {
    U.qsa('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    try {
      const info = await root.stockflow.appInfo();
      const v = U.qs('#sidebar-version');
      if (v && info && info.version) v.textContent = info.version;
    } catch (_) { /* ignore */ }

    const hash = location.hash.replace(/^#/, '');
    let first = root.SFViews[hash] ? hash : 'dashboard';
    if (!root.SFViews[hash]) {
      try {
        const lv = localStorage.getItem('sf:lastView');
        if (lv && root.SFViews[lv]) first = lv;
      } catch (_) { /* ignore */ }
    }
    await go(first);
  }

  document.addEventListener('DOMContentLoaded', startup);

  root.SFApp = { go, refresh, currentView: () => current, icons: ICONS };
})(window);
