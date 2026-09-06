'use strict';
/**
 * Reports view - generate Inventory / Movements / Low Stock / Valuation
 * reports, view them in the UI and export each as CSV.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const view = {
    loadingText: 'Loading reports…',

    async mount(host, ctx) {
      const settings = await U.getSettings();
      const cur = settings.currency || 'USD';
      const cats = await root.stockflow.categoriesList().catch(() => []);

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Reports</h1><p class="view-sub">Analyse and export your inventory data.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-primary" id="report-export" disabled title="Export the current report as CSV">${I().download}<span>Export CSV</span></button>
          </div>
        </div>
        <div class="tabs" id="report-kinds">
          <button class="tab active" data-kind="inventory">Inventory</button>
          <button class="tab" data-kind="movements">Stock Movements</button>
          <button class="tab" data-kind="low-stock">Low Stock</button>
          <button class="tab" data-kind="valuation">Valuation</button>
        </div>
        <div class="card report-filters" id="report-filters"></div>
        <div class="card" id="report-result" style="margin-top:16px">
          <div id="report-body"></div>
        </div>`;

      const kindsHost = U.qs('#report-kinds', host);
      const filtersHost = U.qs('#report-filters', host);
      const bodyHost = U.qs('#report-body', host);
      const exportBtn = U.qs('#report-export', host);

      let currentKind = 'inventory';
      let seq = 0;
      let current = null; // last report

      const catOptions = () =>
        `<option value="">All categories</option>` +
        cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

      const statusOptions = () => `
        <option value="all">All statuses</option>
        <option value="in">In Stock</option>
        <option value="low">Low Stock</option>
        <option value="out">Out of Stock</option>
        <option value="inactive">Inactive</option>`;

      function filtersHTML(kind) {
        switch (kind) {
          case 'inventory':
            return `<div class="report-toolbar">
              <div class="field" style="flex:1 1 220px;max-width:320px"><label>Search</label>
                <input class="input" data-pkey="search" placeholder="Name, SKU or barcode…" /></div>
              <div class="field"><label>Status</label>
                <select class="input" data-pkey="status">${statusOptions()}</select></div>
              <div class="field"><label>Category</label>
                <select class="input" data-pkey="categoryId">${catOptions()}</select></div>
            </div>`;
          case 'movements':
            return `<div class="report-toolbar">
              <div class="field" style="flex:1 1 200px;max-width:280px"><label>Search</label>
                <input class="input" data-pkey="search" placeholder="Product, SKU, reference…" /></div>
              <div class="field"><label>Type</label>
                <select class="input" data-pkey="type">
                  <option value="all">All types</option>
                  <option value="in">Stock In</option>
                  <option value="out">Stock Out</option>
                  <option value="adjust">Adjustment</option>
                </select></div>
              <div class="field"><label>From</label><input type="date" class="input" data-pkey="from" /></div>
              <div class="field"><label>To</label><input type="date" class="input" data-pkey="to" /></div>
            </div>`;
          case 'low-stock':
            return `<div class="report-toolbar">
              <div class="field" style="flex:1 1 220px;max-width:320px"><label>Search</label>
                <input class="input" data-pkey="search" placeholder="Name or SKU…" /></div>
              <div class="field"><label>Category</label>
                <select class="input" data-pkey="categoryId">${catOptions()}</select></div>
              <p class="hint-suggestion" style="align-self:center">Products at or below their minimum stock.</p>
            </div>`;
          default:
            return `<p class="hint-suggestion" style="margin:0">Value of on-hand stock by category, at purchase cost and retail price.</p>`;
        }
      }

      function collectParams() {
        const p = {};
        U.qsa('[data-pkey]', filtersHost).forEach((el) => {
          const v = el.value;
          if (el.type === 'date' ? v : (v === '' ? '' : v)) p[el.dataset.pkey] = el.type === 'date' ? v : v;
        });
        if (p.status === 'all' || p.status === undefined) delete p.status;
        if (p.type === 'all' || p.type === undefined) delete p.type;
        return p;
      }

      function headerWithAlign(h) {
        const numeric = ['money', 'qty', 'signedqty', 'num', 'pct'];
        return {
          key: h.key,
          label: h.label,
          type: h.type,
          align: numeric.includes(h.type) ? 'right' : undefined,
          render: undefined
        };
      }

      async function generate() {
        const mySeq = ++seq;
        const params = collectParams();
        UI.loading(true, 'Generating report…');
        try {
          const report = await root.stockflow.reportsGenerate(currentKind, params);
          if (mySeq !== seq) return;
          current = report;
          exportBtn.disabled = false;
          const headers = report.headers.map(headerWithAlign);

          const summaryPills = Object.entries(report.summary || {}).map(([k, v]) => {
            const labelMap = { rows: 'Rows', units: 'Units', costValue: 'Value (cost)', retailValue: 'Value (retail)' };
            let text;
            if (k === 'costValue' || k === 'retailValue') text = F.fmtMoney(v, cur);
            else text = F.fmtQty(v);
            return `<span class="summary-pill">${esc(labelMap[k] || k)}: <b>${text}</b></span>`;
          }).join('');

          if (!report.rows.length) {
            bodyHost.innerHTML = `
              <div style="padding:4px 18px 2px"><div class="meta-line" style="margin:0">${esc(report.title)}</div></div>
              ${summaryPills ? `<div class="report-summary">${summaryPills}</div>` : ''}
              <div class="empty-state" style="padding:30px">
                <div class="empty-inline">No records match this report. Adjust the filters or add some inventory first.</div>
              </div>`;
            return;
          }
          bodyHost.innerHTML = `
            <div style="padding:14px 18px 0">
              <div class="row-flex"><h3 style="margin:0;font-size:15px">${esc(report.title)}</h3></div>
              ${summaryPills ? `<div class="report-summary">${summaryPills}</div>` : ''}
            </div>
            ${UI.tableMarkup(headers, report.rows, { currency: cur, emptyHtml: '' })}`;
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not generate the report.'), 'error');
        } finally {
          UI.loading(false);
        }
      }

      function bindFilterEvents() {
        U.qsa('[data-pkey]', filtersHost).forEach((el) => {
          const handler = () => generate();
          if (el.type === 'search' || el.tagName === 'INPUT') {
            el.addEventListener('input', U.debounce(handler, 250));
          } else {
            el.addEventListener('change', handler);
          }
        });
      }

      function pickKind(kind) {
        currentKind = kind;
        U.qsa('.tab', kindsHost).forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
        filtersHost.innerHTML = filtersHTML(kind);
        bindFilterEvents();
        generate();
      }

      kindsHost.addEventListener('click', (e) => {
        const b = e.target.closest('.tab[data-kind]');
        if (b) pickKind(b.dataset.kind);
      });

      exportBtn.addEventListener('click', async () => {
        if (!current) return;
        try {
          const res = await root.stockflow.reportsExport(currentKind, collectParams());
          if (res && res.canceled) return;
          UI.toast(`CSV exported${res && res.path ? ' to ' + res.path : ''}.`, 'success');
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not export the CSV.'), 'error');
        }
      });

      pickKind('inventory');
    }
  };

  (root.SFViews = root.SFViews || {}).reports = view;
})(window);
