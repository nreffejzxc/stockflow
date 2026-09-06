'use strict';
/**
 * Stock view - product search-picker, Stock In / Out / Adjustment forms,
 * and the movement history table with filters.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const view = {
    loadingText: 'Loading stock…',

    async mount(host, ctx) {
      const go = ctx.go;
      const settings = await U.getSettings();
      const cur = settings.currency || 'USD';
      const suppliers = await root.stockflow.suppliersList().catch(() => []);

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Stock</h1><p class="view-sub">Record stock movements — every change keeps a full history.</p></div>
        </div>

        <div class="tabs" role="tablist">
          <button class="tab active" data-tab="in">Stock In</button>
          <button class="tab" data-tab="out">Stock Out</button>
          <button class="tab" data-tab="adjust">Adjustment</button>
        </div>

        <div class="card form-card" style="margin-bottom:18px">
          <div class="panel-body">
            <div class="picker">
              <label style="font-size:12.5px;font-weight:600;margin-bottom:5px;display:block">Product</label>
              <div class="picker-input-row">
                <div class="search">${I().search}
                  <input class="input picker-input" id="picker-input" placeholder="Type to search products…" autocomplete="off" />
                </div>
              </div>
              <div class="picker-dropdown" id="picker-dropdown"></div>
              <div class="selected-product" id="picker-selected">
                <div class="sp-missing">No product selected — type to search above.</div>
              </div>
            </div>

            <div id="tabs-panels">
              <!-- Stock In -->
              <section class="tab-panel" id="tab-in">
                <div class="form-grid" style="margin-top:6px">
                  <div class="field" style="grid-column:auto">
                    <label for="in-qty">Quantity <span class="req">*</span></label>
                    <input class="input" type="number" id="in-qty" min="0" step="any" placeholder="0" />
                  </div>
                  <div class="field">
                    <label for="in-cost">Unit cost</label>
                    <input class="input" type="number" id="in-cost" min="0" step="any" placeholder="0.00" />
                  </div>
                  <div class="field">
                    <label for="in-supplier">Supplier</label>
                    <select class="input" id="in-supplier"><option value="">— None —</option></select>
                  </div>
                  <div class="field">
                    <label for="in-reference">Reference</label>
                    <input class="input" type="text" id="in-reference" placeholder="e.g. PO #1042" />
                  </div>
                  <div class="field field-full">
                    <label for="in-notes">Notes</label>
                    <textarea class="input" id="in-notes" rows="2" placeholder="Optional…"></textarea>
                  </div>
                </div>
                <div class="row-flex" style="margin-top:2px">
                  <button class="btn btn-success" data-submit="in">${I().plus}<span>Add stock</span></button>
                  <span class="hint-suggestion">Increases on-hand quantity.</span>
                </div>
              </section>

              <!-- Stock Out -->
              <section class="tab-panel hidden" id="tab-out">
                <div class="form-grid" style="margin-top:6px">
                  <div class="field">
                    <label for="out-qty">Quantity <span class="req">*</span></label>
                    <input class="input" type="number" id="out-qty" min="0" step="any" placeholder="0" />
                  </div>
                  <div class="field">
                    <label for="out-reference">Reference</label>
                    <input class="input" type="text" id="out-reference" placeholder="e.g. Invoice #88" />
                  </div>
                  <div class="field field-full">
                    <label for="out-reason">Reason</label>
                    <input class="input" type="text" id="out-reason" placeholder="e.g. Sold, damaged, expired…" />
                    <div class="quick-reasons" data-target="out-reason"></div>
                  </div>
                  <div class="field field-full">
                    <label for="out-notes">Notes</label>
                    <textarea class="input" id="out-notes" rows="2" placeholder="Optional…"></textarea>
                  </div>
                </div>
                <div class="row-flex" style="margin-top:2px">
                  <button class="btn btn-danger" data-submit="out">${I().box}<span>Remove stock</span></button>
                  <span class="hint-suggestion">Cannot go below zero.</span>
                </div>
              </section>

              <!-- Adjustment -->
              <section class="tab-panel hidden" id="tab-adjust">
                <div class="form-grid" style="margin-top:6px">
                  <div class="field">
                    <label for="adj-qty">New quantity on hand <span class="req">*</span></label>
                    <input class="input" type="number" id="adj-qty" min="0" step="any" placeholder="0" />
                    <div class="field-help">Set the actual counted quantity. The difference is recorded automatically.</div>
                  </div>
                  <div class="field">
                    <label for="adj-reason">Reason <span class="req">*</span></label>
                    <input class="input" type="text" id="adj-reason" placeholder="e.g. Stock count correction" />
                    <div class="quick-reasons" data-target="adj-reason"></div>
                  </div>
                  <div class="field field-full">
                    <label for="adj-notes">Notes</label>
                    <textarea class="input" id="adj-notes" rows="2" placeholder="Optional details…"></textarea>
                  </div>
                </div>
                <div class="row-flex" style="margin-top:2px">
                  <button class="btn btn-primary" data-submit="adjust">Save adjustment</button>
                  <span class="hint-suggestion">Applies a positive or negative correction.</span>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:18px">
          <div class="panel-head">
            <h3>Movement History</h3>
          </div>
          <div class="toolbar" style="padding:0 14px;margin-bottom:0">
            <div class="search" style="flex:1 1 240px;max-width:320px">${I().search}
              <input class="input" id="movement-search" placeholder="Search product, SKU, reference…" />
            </div>
            <select class="input" id="movement-type" style="max-width:150px">
              <option value="all">All types</option>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="adjust">Adjustment</option>
            </select>
            <input type="date" class="input" id="movement-from" title="From date" style="max-width:150px" />
            <span class="muted">to</span>
            <input type="date" class="input" id="movement-to" title="To date" style="max-width:150px" />
          </div>
          <div id="movement-box">
            <div class="meta-line" id="movement-meta"></div>
            <div id="movement-table"></div>
          </div>
        </div>`;

      // ---------- supplier dropdown for Stock In ----------
      const supSel = U.qs('#in-supplier', host);
      suppliers.forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        supSel.appendChild(o);
      });

      // ---------- picker ----------
      const pickerInput = U.qs('#picker-input', host);
      const dropdown = U.qs('#picker-dropdown', host);
      const selectedHost = U.qs('#picker-selected', host);
      let selected = null; // { id, name, unit, stock_qty }

      function refreshSelectedPanel() {
        if (!selected) {
          selectedHost.innerHTML = `<div class="sp-missing">No product selected — type to search above.</div>`;
          return;
        }
        const cls = Number(selected.stock_qty) <= 0 ? 'danger' : '';
        selectedHost.innerHTML = `
          <div>
            <div class="prod-name">${esc(selected.name)} <span class="mono muted">${esc(selected.sku || '')}</span></div>
            <div class="sp-avail">On hand: <b class="stock-num ${cls}">${F.fmtQty(selected.stock_qty)}</b>
              <span class="stock-num unit">${esc(selected.unit || '')}</span></div>
          </div>`;
      }

      function renderDropdown(items, term) {
        if (!items.length) {
          dropdown.innerHTML = `<div class="picker-empty">No products match “${esc(term)}”.</div>`;
          return;
        }
        dropdown.innerHTML = items.map((p) => `
          <div class="picker-item" data-id="${p.id}">
            <div><div class="pi-name">${esc(p.name)}</div><div class="pi-sub">${esc(p.sku || '')}</div></div>
            <div class="pi-stock ${Number(p.stock_qty) <= 0 ? 'danger' : ''}">${F.fmtQty(p.stock_qty)} ${esc(p.unit || '')}</div>
          </div>`).join('');
      }

      async function searchPicker(term) {
        let list = [];
        try {
          list = await root.stockflow.productsPick(term, 60);
        } catch (_) { /* ignore */ }
        if (term !== pickerInput.value.trim()) return; // stale
        renderDropdown(list, term);
        dropdown.classList.add('open');
      }

      let pickerTimer = null;
      pickerInput.addEventListener('input', () => {
        clearTimeout(pickerTimer);
        const term = pickerInput.value.trim();
        if (!term) {
          dropdown.classList.remove('open');
          return;
        }
        pickerTimer = setTimeout(() => searchPicker(term), 130);
      });
      pickerInput.addEventListener('focus', () => {
        if (pickerInput.value.trim()) searchPicker(pickerInput.value.trim());
      });
      document.addEventListener('click', (e) => {
        if (!host.contains(e.target)) return;
        if (!e.target.closest('.picker')) dropdown.classList.remove('open');
      });
      dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.picker-item');
        if (!item) return;
        const id = Number(item.dataset.id);
        (async () => {
          try {
            const p = await root.stockflow.productsGet(id);
            selected = { id: p.id, name: p.name, sku: p.sku, unit: p.unit, stock_qty: p.stock_qty };
            pickerInput.value = p.name;
            dropdown.classList.remove('open');
            refreshSelectedPanel();
          } catch (err) {
            UI.toast(U.errMessage(err, 'Could not load product.'), 'error');
          }
        })();
      });

      // ---------- tabs ----------
      const tabs = U.qsa('.tab', host);
      const panels = { in: U.qs('#tab-in', host), out: U.qs('#tab-out', host), adjust: U.qs('#tab-adjust', host) };
      function setTab(tab) {
        tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        Object.entries(panels).forEach(([k, el]) => el.classList.toggle('hidden', k !== tab));
      }
      tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

      // quick-reason chips
      const QUICK = {
        'out-reason': ['Sold', 'Damaged', 'Expired', 'Internal use', 'Returned to supplier'],
        'adj-reason': ['Stock count correction', 'Damage write-off', 'Expired stock', 'Found during stocktake']
      };
      Object.entries(QUICK).forEach(([target, chips]) => {
        const box = U.qs(`[data-target="${target}"]`, host);
        if (!box) return;
        box.innerHTML = chips
          .map((c) => `<button type="button">${esc(c)}</button>`)
          .join('');
        box.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          const input = U.qs('#' + target, host);
          if (input) input.value = b.textContent;
        });
      });

      // ---------- submits ----------
      function num(id) {
        const el = U.qs('#' + id, host);
        const v = el.value.trim();
        if (v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }

      function requireProduct() {
        if (!selected) {
          UI.toast('Choose a product first.', 'error');
          return false;
        }
        return true;
      }

      function refreshStockAfter(id) {
        return root.stockflow.productsGet(id).then((p) => {
          selected = { id: p.id, name: p.name, sku: p.sku, unit: p.unit, stock_qty: p.stock_qty };
          refreshSelectedPanel();
          return p;
        });
      }

      async function submitIn() {
        if (!requireProduct()) return;
        const qty = num('in-qty');
        if (qty === null || qty <= 0) { UI.toast('Enter a quantity greater than zero.', 'error'); return; }
        const costRaw = num('in-cost');
        const payload = {
          productId: selected.id,
          quantity: qty,
          cost: costRaw !== null && costRaw > 0 ? costRaw : null,
          supplierId: supSel.value ? Number(supSel.value) : null,
          reference: U.qs('#in-reference', host).value.trim(),
          notes: U.qs('#in-notes', host).value.trim()
        };
        try {
          const mv = await root.stockflow.stockIn(payload);
          UI.toast(`Added ${F.fmtQty(qty)} ${selected.unit} to "${selected.name}". New stock: ${F.fmtQty(mv.new_stock)}.`, 'success');
          U.qs('#in-qty', host).value = '';
          U.qs('#in-cost', host).value = '';
          U.qs('#in-reference', host).value = '';
          U.qs('#in-notes', host).value = '';
          supSel.value = '';
          await refreshStockAfter(selected.id);
          await loadMovements(true);
        } catch (e) {
          UI.toast(U.errMessage(e), 'error');
        }
      }

      async function submitOut() {
        if (!requireProduct()) return;
        const qty = num('out-qty');
        if (qty === null || qty <= 0) { UI.toast('Enter a quantity greater than zero.', 'error'); return; }
        const payload = {
          productId: selected.id,
          quantity: qty,
          reason: U.qs('#out-reason', host).value.trim(),
          reference: U.qs('#out-reference', host).value.trim(),
          notes: U.qs('#out-notes', host).value.trim()
        };
        try {
          const mv = await root.stockflow.stockOut(payload);
          UI.toast(`Removed ${F.fmtQty(qty)} ${selected.unit} from "${selected.name}". New stock: ${F.fmtQty(mv.new_stock)}.`, 'success');
          U.qs('#out-qty', host).value = '';
          U.qs('#out-reason', host).value = '';
          U.qs('#out-reference', host).value = '';
          U.qs('#out-notes', host).value = '';
          await refreshStockAfter(selected.id);
          await loadMovements(true);
        } catch (e) {
          UI.toast(U.errMessage(e), 'error');
        }
      }

      async function submitAdjust() {
        if (!requireProduct()) return;
        const qty = num('adj-qty');
        const reason = U.qs('#adj-reason', host).value.trim();
        if (qty === null || qty < 0) { UI.toast('Enter a valid new quantity.', 'error'); return; }
        if (!reason) { UI.toast('A reason is required for adjustments.', 'error'); return; }
        try {
          const mv = await root.stockflow.stockAdjust({
            productId: selected.id,
            newQuantity: qty,
            reason,
            notes: U.qs('#adj-notes', host).value.trim()
          });
          const delta = Number(mv.quantity);
          const dir = delta >= 0 ? 'corrected up to' : 'corrected down to';
          UI.toast(`Stock for "${selected.name}" ${dir} ${F.fmtQty(mv.new_stock)} ${selected.unit}.`, 'success');
          U.qs('#adj-qty', host).value = '';
          U.qs('#adj-reason', host).value = '';
          U.qs('#adj-notes', host).value = '';
          await refreshStockAfter(selected.id);
          await loadMovements(true);
        } catch (e) {
          UI.toast(U.errMessage(e), 'error');
        }
      }

      U.qs('[data-submit="in"]', host).addEventListener('click', submitIn);
      U.qs('[data-submit="out"]', host).addEventListener('click', submitOut);
      U.qs('[data-submit="adjust"]', host).addEventListener('click', submitAdjust);

      // Enter submits the active form (from a number/text field).
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const t = e.target;
        if (t.tagName === 'TEXTAREA') return;
        if (!t.closest('.tab-panel:not(.hidden)')) return;
        e.preventDefault();
        const shown = [...host.querySelectorAll('.tab-panel')].find((p) => !p.classList.contains('hidden'));
        const kind = shown && shown.id.replace('tab-', '');
        if (kind === 'in') submitIn();
        else if (kind === 'out') submitOut();
        else if (kind === 'adjust') submitAdjust();
      });

      // ---------- movement history ----------
      const mvTable = U.qs('#movement-table', host);
      const mvMeta = U.qs('#movement-meta', host);
      const mvSearch = U.qs('#movement-search', host);
      const mvType = U.qs('#movement-type', host);
      const mvFrom = U.qs('#movement-from', host);
      const mvTo = U.qs('#movement-to', host);
      let mvOffset = 0;
      let mvTotal = 0;
      let mvRows = [];

      const mvActions = () => '';

      function movementTypeChip(t) {
        const m = U.typeMeta(t);
        return U.chip(m.label, 'type-' + t);
      }

      async function loadMovements(reset) {
        if (reset) {
          mvOffset = 0;
          mvRows = [];
        }
        const res = await root.stockflow.movementsList({
          search: mvSearch.value.trim() || undefined,
          type: mvType.value || 'all',
          from: mvFrom.value || undefined,
          to: mvTo.value || undefined,
          limit: 100,
          offset: mvOffset
        });
        mvTotal = res.total;
        mvRows = reset ? res.rows : mvRows.concat(res.rows);
        mvOffset = reset ? res.rows.length : mvOffset + res.rows.length;

        const shown = mvRows.length;
        mvMeta.textContent = mvTotal
          ? `${shown} of ${mvTotal} movement${mvTotal === 1 ? '' : 's'}`
          : '';

        if (!mvRows.length) {
          mvTable.innerHTML = UI.emptyMarkup(
            'No movements yet',
            'Record a Stock In, Stock Out or Adjustment and it will appear here.',
            ''
          );
          return;
        }
        mvTable.innerHTML = UI.tableMarkup(
          [
            { key: 'created_at', label: 'Date', type: 'datetime' },
            { key: 'product_name', label: 'Product' },
            { key: 'sku', label: 'SKU', type: 'html', render: (r) => `<span class="mono muted">${esc(r.sku || '')}</span>` },
            { key: 'type', label: 'Type', type: 'html', align: 'center', render: (r) => movementTypeChip(r.type) },
            { key: 'quantity', label: 'Qty', type: 'html', align: 'right', render: (r) =>
                `<span class="qty ${Number(r.quantity) > 0 ? 'qty-up' : 'qty-down'}">${F.fmtSignedQty(r.quantity)}</span>` },
            { key: 'previous_stock', label: 'Before', type: 'qty', align: 'right' },
            { key: 'new_stock', label: 'After', type: 'qty', align: 'right' },
            { key: 'supplier_name', label: 'Supplier', type: 'html', render: (r) => esc(r.supplier_name || '') || '<span class="muted">—</span>' },
            { key: 'cost', label: 'Cost', type: 'money', align: 'right' },
            { key: 'reference', label: 'Reference', type: 'html', render: (r) => esc(r.reference || '') || '<span class="muted">—</span>' },
            { key: 'reason', label: 'Reason', type: 'html', render: (r) => esc(r.reason || '') || '<span class="muted">—</span>' }
          ],
          mvRows.map((r) => ({ ...r, _rowId: r.id })),
          { currency: cur, emptyHtml: '' }
        );
        if (shown < mvTotal) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'text-align:center;padding:10px 0';
          wrap.innerHTML = `<button class="btn btn-ghost" id="movement-more">Load more (${mvTotal - shown} remaining)</button>`;
          mvTable.appendChild(wrap);
          U.qs('#movement-more', mvTable).addEventListener('click', () =>
            loadMovements(false).catch((e) => UI.toast(U.errMessage(e), 'error')));
        }
      }

      mvSearch.addEventListener('input', U.debounce(() => loadMovements(true).catch((e) => UI.toast(U.errMessage(e), 'error')), 250));
      mvType.addEventListener('change', () => loadMovements(true).catch((e) => UI.toast(U.errMessage(e), 'error')));
      mvFrom.addEventListener('change', () => loadMovements(true).catch((e) => UI.toast(U.errMessage(e), 'error')));
      mvTo.addEventListener('change', () => loadMovements(true).catch((e) => UI.toast(U.errMessage(e), 'error')));

      await loadMovements(true);
    }
  };

  (root.SFViews = root.SFViews || {}).stock = view;
})(window);
