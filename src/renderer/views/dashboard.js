'use strict';
/**
 * Dashboard view - summary stat cards, recent stock movements, low-stock list.
 * Registers window.SFViews.dashboard.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;

  const CARD_ICONS = {
    products:
      '<svg viewBox="0 0 24 24"><path d="M12 2.2l9.6 4.9v9.8L12 21.8l-9.6-4.9V7.1z"/><path d="M12 21.8V12M2.4 7.1L12 12l9.6-4.9" fill="none" stroke="#fff" stroke-width="1.4" opacity=".85"/></svg>',
    units:
      '<svg viewBox="0 0 24 24"><path d="M12 2L3 6.8v10.4L12 22l9-4.8V6.8z"/><path d="M3 6.8L12 11.6l9-4.8M12 22v-10.4" fill="none" stroke="#fff" stroke-width="1.4" opacity=".85"/></svg>',
    value:
      '<svg viewBox="0 0 24 24"><path d="M12 2 2 12l10 10 10-10z"/></svg>',
    retail:
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
    low:
      '<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"/></svg>',
    out:
      '<svg viewBox="0 0 24 24"><path d="M12 22a10 10 0 110-20 10 10 0 010 20z" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function statCard(label, value, sub, tone, icon) {
    return `<div class="stat-card">
      <div class="stat-ico tone-${tone}">${icon}</div>
      <div class="stat-meta">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value" data-stat="${esc(label.toLowerCase().replace(/\s+/g, '-'))}">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>
    </div>`;
  }

  function cardLink(html, onClick) {
    const wrap = document.createElement('span');
    wrap.innerHTML = html;
    const link = wrap.querySelector('[data-goto]');
    if (link) link.addEventListener('click', onClick);
    return html;
  }

  function lowItem(p, go) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'low-item';
    el.title = 'View this product';
    const subBits = [p.sku].filter(Boolean);
    if (p.category_name) subBits.push(p.category_name);
    el.innerHTML = `<span class="low-name">${esc(p.name)}<span class="low-sub">${esc(subBits.join(' · '))}</span></span>
      <span class="low-stock ${Number(p.stock_qty) <= 0 ? 'zero' : ''}">
        <b>${F.fmtQty(p.stock_qty)}</b>/<span class="low-min">${F.fmtQty(p.min_stock)}</span> ${esc(p.unit || '')}</span>`;
    el.addEventListener('click', () => go('products', { search: p.name }));
    return el;
  }

  const view = {
    loadingText: 'Loading dashboard…',

    async mount(host, ctx) {
      const go = ctx.go;
      const settings = await U.getSettings();
      const cur = settings.currency || 'USD';

      const statRow = document.createElement('div');
      statRow.className = 'stat-grid';
      statRow.innerHTML = [
        statCard('Total Products', '…', '', 'indigo', CARD_ICONS.products),
        statCard('Total Stock', '…', 'units across active products', 'green', CARD_ICONS.units),
        statCard('Inventory Value', '…', 'at purchase cost', 'slate', CARD_ICONS.value),
        statCard('Retail Value', '…', 'at selling price', 'green', CARD_ICONS.retail),
        statCard('Low Stock', '…', 'needs attention', 'amber', CARD_ICONS.low),
        statCard('Out of Stock', '…', 'needs restocking', 'red', CARD_ICONS.out)
      ].join('');

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Dashboard</h1><p class="view-sub">Overview of your inventory at a glance.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-primary" id="btn-add-product">${root.SFApp.icons.plus}<span>Add Product</span></button>
          </div>
        </div>`;

      // Live links on the Low Stock / Out of Stock cards.
      const cards = [['low', 'low-stock'], ['out-of-stock', 'out-of-stock']];
      const lowEl = U.qs('[data-stat="low-stock"]', host);
      const outEl = U.qs('[data-stat="out-of-stock"]', host);
      const makeStatLink = (el) => {
        if (!el) return;
        el.style.cursor = 'pointer';
        el.title = 'Open the Products list';
      };
      makeStatLink(lowEl);
      makeStatLink(outEl);
      if (lowEl) lowEl.addEventListener('click', () => go('products', { status: 'low' }));
      if (outEl) outEl.addEventListener('click', () => go('products', { status: 'out' }));

      host.appendChild(statRow);

      const grid = document.createElement('div');
      grid.className = 'dash-grid';
      grid.innerHTML = `
        <section class="card">
          <div class="panel-head"><h3>Recent Stock Movements</h3><button class="link" data-goto="stock">Stock page</button></div>
          <div class="panel-body" id="recent-movements"></div>
        </section>
        <section class="card">
          <div class="panel-head"><h3>Low Stock Products</h3><button class="link" data-goto-low="1">View all</button></div>
          <div class="panel-body" id="low-stock-list"></div>
        </section>`;
      host.appendChild(grid);

      grid.querySelector('[data-goto="stock"]').addEventListener('click', () => go('stock'));
      grid.querySelector('[data-goto-low="1"]').addEventListener('click', () => go('products', { status: 'low' }));
      const addBtn = U.qs('#btn-add-product', host);
      if (addBtn) addBtn.addEventListener('click', () => go('products', { action: 'add' }));

      await this._fill(host, { go, cur });
    },

    async _fill(host, { go, cur }) {
      const d = await root.stockflow.dashboardGet();
      const FMT = {
        totalProducts: F.fmtQty(d.totalProducts),
        totalStock: F.fmtQty(d.totalStock),
        lowStock: F.fmtQty(d.lowStock),
        outOfStock: F.fmtQty(d.outOfStock),
        costValue: F.fmtMoney(d.costValue, cur),
        retailValue: F.fmtMoney(d.retailValue, cur)
      };
      const setStat = (label, v) => {
        const el = U.qs(`[data-stat="${label}"]`, host);
        if (el) el.textContent = v;
      };
      setStat('total-products', FMT.totalProducts);
      setStat('total-stock', FMT.totalStock);
      setStat('low-stock', FMT.lowStock);
      setStat('out-of-stock', FMT.outOfStock);
      setStat('inventory-value', FMT.costValue);
      setStat('retail-value', FMT.retailValue);
      const subs = host.querySelectorAll('.stat-sub');
      if (subs[0]) subs[0].textContent = `${F.fmtQty(d.activeProducts)} active`;
      if (subs[4]) subs[4].textContent = `${F.fmtQty(d.lowTotal)} need attention`;

      // ---- recent movements ----
      const movHost = U.qs('#recent-movements', host);
      if (!d.recentMovements.length) {
        movHost.innerHTML = `<div class="empty-state" style="padding:26px">
          <div class="empty-inline">No stock movements yet.</div>
          <div style="margin-top:10px"><button class="btn btn-sm" data-goto="stock">Open Stock page</button></div>
        </div>`;
        movHost.querySelector('[data-goto="stock"]').addEventListener('click', () => go('stock'));
      } else {
        movHost.innerHTML = UI.tableMarkup(
          [
            { key: 'created_at', label: 'Date', type: 'datetime' },
            { key: 'product_name', label: 'Product' },
            { key: 'type', label: 'Type', align: 'center', type: 'html', render: (r) => U.chip(U.typeMeta(r.type).label, 'type-' + r.type) },
            { key: 'quantity', label: 'Qty', type: 'html', align: 'right', render: (r) =>
                `<span class="qty ${Number(r.quantity) > 0 ? 'qty-up' : 'qty-down'}">${F.fmtSignedQty(r.quantity)}</span>` }
          ],
          d.recentMovements.slice(0, 8),
          { emptyHtml: '' }
        );
      }

      // ---- low stock list ----
      const lowHost = U.qs('#low-stock-list', host);
      lowHost.innerHTML = '';
      if (!d.lowStockProducts.length) {
        lowHost.innerHTML = `<div class="empty-inline" style="text-align:center;padding:26px">Nothing is running low. 🎉</div>`;
      } else {
        d.lowStockProducts.forEach((p) => lowHost.appendChild(lowItem(p, go)));
      }
    }
  };

  (root.SFViews = root.SFViews || {}).dashboard = view;
})(window);
