'use strict';
/**
 * Products view - list with search/filters, add/edit form with image,
 * activate/deactivate toggle, delete. Registers window.SFViews.products.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const ICONS = {
    pause: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    resume: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M20 6L9 17l-5-5"/></svg>'
  };

  const view = {
    loadingText: 'Loading products…',

    async mount(host, ctx) {
      const go = ctx.go;
      const settings = await U.getSettings();
      const cur = settings.currency || 'USD';
      const params = ctx.params || {};
      host.innerHTML = `
        <div class="view-header">
          <div><h1>Products</h1><p class="view-sub">Everything you sell or keep in stock.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-primary" id="btn-add-product">${I().plus}<span>Add Product</span></button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search">${I().search}<input class="input" id="product-search" placeholder="Search name, SKU or barcode…" /></div>
          <select class="input" id="product-filter-category" style="max-width:180px"><option value="">All categories</option></select>
          <select class="input" id="product-filter-supplier" style="max-width:180px"><option value="">All suppliers</option></select>
          <select class="input" id="product-filter-status" style="max-width:150px">
            <option value="all">All statuses</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
            <option value="inactive">Inactive</option>
          </select>
          <div class="spacer"></div>
        </div>
        <div class="card" id="product-box">
          <div class="meta-line" id="product-meta"></div>
          <div id="product-table"></div>
        </div>`;

      const table = U.qs('#product-table', host);
      const meta = U.qs('#product-meta', host);
      const searchInput = U.qs('#product-search', host);
      const catSel = U.qs('#product-filter-category', host);
      const supSel = U.qs('#product-filter-supplier', host);
      const statusSel = U.qs('#product-filter-status', host);

      // hydrate category / supplier filter dropdowns
      const [cats, sups] = await Promise.all([
        root.stockflow.categoriesList().catch(() => []),
        root.stockflow.suppliersList().catch(() => [])
      ]);
      cats.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        catSel.appendChild(o);
      });
      sups.forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        supSel.appendChild(o);
      });

      // consume navigation params once
      if (params.status) statusSel.value = params.status;
      if (params.search) searchInput.value = params.search;
      if (params.categoryId) catSel.value = String(params.categoryId);
      if (params.supplierId) supSel.value = String(params.supplierId);

      const prodCell = (p) => {
        const img = p.image
          ? `<img src="${U.imageUrl(p.image)}" alt="" loading="lazy">`
          : `<span class="ph">${esc(String(p.name || '?').slice(0, 2).toUpperCase())}</span>`;
        return `<div class="prod-cell"><div class="prod-thumb">${img}</div>
          <div><div class="prod-name">${esc(p.name)}</div>
          <div class="prod-sub">${esc(p.category_name || 'Uncategorized')}</div></div></div>`;
      };

      const actions = (p) => {
        const toggleTitle = p.is_active ? 'Deactivate' : 'Activate';
        const toggleIcon = p.is_active ? ICONS.pause : ICONS.resume;
        return `<div class="row-actions">
          <button class="icon-btn" data-act="edit" data-id="${p.id}" title="Edit">${I().edit}</button>
          <button class="icon-btn" data-act="toggle" data-id="${p.id}" title="${toggleTitle}">${toggleIcon}</button>
          <button class="icon-btn danger" data-act="del" data-id="${p.id}" title="Delete">${I().trash}</button>
        </div>`;
      };

      const stockCell = (p) => {
        const cls = p.status === 'out' ? 'danger' : p.status === 'low' ? 'warn' : '';
        const stock = `<span class="stock-num ${cls}">${F.fmtQty(p.stock_qty)}</span><span class="stock-num unit">${esc(p.unit || '')}</span>`;
        if (p.status !== 'inactive' && Number(p.min_stock) > 0) {
          return `${stock}<div class="prod-sub">min ${F.fmtQty(p.min_stock)}</div>`;
        }
        return stock;
      };

      function buildTable(products) {
        if (!products.length) {
          return;
        }
        table.innerHTML = UI.tableMarkup(
          [
            { key: 'name', label: 'Product', type: 'html', render: prodCell },
            { key: 'sku', label: 'SKU', type: 'html', render: (p) => `<span class="mono">${esc(p.sku || '')}</span>` },
            { key: 'supplier_name', label: 'Supplier', type: 'html', render: (p) => esc(p.supplier_name || '') || '<span class="muted">—</span>' },
            { key: 'purchase_price', label: 'Purchase', type: 'html', align: 'right', render: (p) => F.fmtMoney(p.purchase_price, cur) },
            { key: 'selling_price', label: 'Selling', type: 'html', align: 'right', render: (p) => F.fmtMoney(p.selling_price, cur) },
            { key: 'stock_qty', label: 'Stock', type: 'html', render: stockCell },
            { key: 'status', label: 'Status', type: 'html', align: 'center', render: (p) => {
                const m = U.statusMeta(p.status);
                return U.chip(m.label, m.cls);
              } },
            { key: '', label: '', type: 'html', align: 'right', render: actions }
          ],
          products.map((p) => ({ ...p, _rowId: p.id })),
          { emptyHtml: '' }
        );
      }

      async function load() {
        const term = searchInput.value.trim();
        const filters = {
          search: term || undefined,
          categoryId: catSel.value ? Number(catSel.value) : undefined,
          supplierId: supSel.value ? Number(supSel.value) : undefined,
          status: statusSel.value || 'all'
        };
        const list = await root.stockflow.productsList(filters);
        const total = list.length;
        meta.textContent = filters.search || filters.categoryId || filters.supplierId || filters.status !== 'all'
          ? `${total} matching product${total === 1 ? '' : 's'}`
          : `${total} product${total === 1 ? '' : 's'}`;

        if (!total) {
          table.innerHTML = UI.emptyMarkup(
            'No products found',
            (filters.search || filters.categoryId || filters.supplierId || filters.status !== 'all')
              ? 'Try adjusting your search or filters.'
              : 'Add your first product to start tracking inventory.',
            (filters.search || filters.categoryId || filters.supplierId || filters.status !== 'all')
              ? `<button class="btn btn-ghost" data-clear>Clear filters</button>`
              : `<button class="btn btn-primary" data-add>${I().plus}<span>Add your first product</span></button>`
          );
          const clearBtn = table.querySelector('[data-clear]');
          if (clearBtn) clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            catSel.value = '';
            supSel.value = '';
            statusSel.value = 'all';
            load();
          });
          const addBtn = table.querySelector('[data-add]');
          if (addBtn) addBtn.addEventListener('click', () => openForm(null));
          return;
        }
        buildTable(list);
      }

      async function openForm(product) {
        const isEdit = !!product;
        const values = {
          name: product ? product.name : '',
          sku: product ? product.sku || '' : '',
          barcode: product ? product.barcode || '' : '',
          categoryId: product && product.category_id ? String(product.category_id) : '',
          supplierId: product && product.supplier_id ? String(product.supplier_id) : '',
          purchasePrice: product ? product.purchase_price : '',
          sellingPrice: product ? product.selling_price : '',
          minStock: product ? product.min_stock : '',
          unit: product ? product.unit : 'pcs',
          description: product ? product.description || '' : '',
          image: product ? product.image : null
        };

        const subtitle = isEdit
          ? `Current stock: ${F.fmtQty(product.stock_qty)} ${product.unit || ''} · adjust stock from the Stock page.`
          : 'Prices and quantity can be edited any time. Leave SKU blank to generate one.';

        const ok = await UI.openForm({
          title: isEdit ? 'Edit Product' : 'Add Product',
          subtitle,
          width: 'lg',
          fields: [
            { key: 'name', label: 'Product name', required: true, placeholder: 'e.g. Cola 330ml Can', half: true },
            { key: 'sku', label: 'SKU', placeholder: 'Auto-generate if blank', half: true, hint: 'Leave blank to auto-generate a unique SKU.' },
            { key: 'barcode', label: 'Barcode', placeholder: 'Optional', half: true, hint: 'Scanned with a barcode scanner if you have one.' },
            { key: 'unit', label: 'Unit', placeholder: 'pcs', half: true, hint: 'e.g. pcs, kg, box, liter' },
            { key: 'categoryId', label: 'Category', type: 'select', half: true, options: [
                { value: '', label: '— No category —' },
                ...cats.map((c) => ({ value: c.id, label: c.name }))
              ] },
            { key: 'supplierId', label: 'Supplier', type: 'select', half: true, options: [
                { value: '', label: '— No supplier —' },
                ...sups.map((s) => ({ value: s.id, label: s.name }))
              ] },
            { key: 'purchasePrice', label: 'Purchase price', type: 'number', decimals: true, min: 0, half: true, placeholder: '0.00' },
            { key: 'sellingPrice', label: 'Selling price', type: 'number', decimals: true, min: 0, half: true, placeholder: '0.00' },
            { key: 'minStock', label: 'Min. stock (alert level)', type: 'number', min: 0, half: true, placeholder: '0' },
            ...(!isEdit ? [
              { key: 'openingStock', label: 'Opening stock', type: 'number', min: 0, half: true, placeholder: '0', hint: 'Set initial quantity on hand.' },
              { key: 'openingCost', label: 'Opening cost (per unit)', type: 'number', decimals: true, min: 0, half: true, placeholder: 'Same as purchase price', hint: 'Used for the opening Stock In movement.' }
            ] : []),
            { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional details…' },
            { key: 'image', label: 'Product image', type: 'image' }
          ],
          values,
          submitLabel: isEdit ? 'Save changes' : 'Add product',
          chooseImage: () => root.stockflow.chooseImage().then((r) => (r && r.name) || null),
          onSubmit: async (data) => {
            const body = {
              name: data.name,
              sku: data.sku,
              barcode: data.barcode,
              categoryId: data.categoryId ? Number(data.categoryId) : null,
              supplierId: data.supplierId ? Number(data.supplierId) : null,
              purchasePrice: Number(data.purchasePrice) || 0,
              sellingPrice: Number(data.sellingPrice) || 0,
              minStock: Number(data.minStock) || 0,
              unit: data.unit || 'pcs',
              description: data.description,
              image: data.image
            };
            if (!isEdit) {
              body.openingStock = Number(data.openingStock) || 0;
              body.openingCost = data.openingCost !== '' && Number(data.openingCost) > 0 ? Number(data.openingCost) : null;
              await root.stockflow.productsCreate(body);
              UI.toast('Product added.', 'success');
            } else {
              await root.stockflow.productsUpdate(product.id, body);
              UI.toast('Product updated.', 'success');
            }
          }
        });
        if (ok) await load();
      }

      async function remove(p) {
        if (!(await UI.confirm({
          title: 'Delete product?',
          message: `"${p.name}" will be permanently deleted.`,
          detail: 'This also removes all of its stock movement history. Consider deactivating instead to keep history.',
          confirmText: 'Delete',
          danger: true
        }))) return;
        try {
          await root.stockflow.productsDelete(p.id);
          UI.toast('Product deleted.', 'success');
          await load();
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not delete this product.'), 'error');
        }
      }

      async function toggle(p) {
        try {
          const updated = await root.stockflow.productsToggleActive(p.id);
          UI.toast(updated.is_active ? `"${p.name}" activated.` : `"${p.name}" deactivated.`, 'success');
          await load();
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not update this product.'), 'error');
        }
      }

      // event wiring
      U.qs('#btn-add-product', host).addEventListener('click', () => openForm(null));
      searchInput.addEventListener('input', U.debounce(() => load().catch((e) => UI.toast(U.errMessage(e), 'error')), 250));
      catSel.addEventListener('change', () => load().catch((e) => UI.toast(U.errMessage(e), 'error')));
      supSel.addEventListener('change', () => load().catch((e) => UI.toast(U.errMessage(e), 'error')));
      statusSel.addEventListener('change', () => load().catch((e) => UI.toast(U.errMessage(e), 'error')));

      table.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        (async () => {
          try {
            const p = await root.stockflow.productsGet(id);
            if (btn.dataset.act === 'edit') await openForm(p);
            else if (btn.dataset.act === 'toggle') await toggle(p);
            else await remove(p);
          } catch (err) {
            UI.toast(U.errMessage(err, 'Product no longer exists.'), 'error');
            await load();
          }
        })();
      });

      // Fall back to the initials placeholder if a thumbnail fails to load
      // (capture phase because 'error' does not bubble). Inline onerror
      // attributes would violate the CSP, so we handle it here instead.
      table.addEventListener('error', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.closest('.prod-thumb')) t.remove();
      }, true);

      await load();
      // Navigating in with {action:'add'} opens the form straight away.
      if (params.action === 'add') await openForm(null);
    }
  };

  (root.SFViews = root.SFViews || {}).products = view;
})(window);
