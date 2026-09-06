'use strict';
/**
 * Categories view - list, search, add / edit / delete.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const view = {
    loadingText: 'Loading categories…',

    async mount(host, ctx) {
      let term = '';

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Categories</h1><p class="view-sub">Organise products into groups for easier reporting and filtering.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-primary" id="btn-add-category">${I().plus}<span>Add Category</span></button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search">${I().search}<input class="input" id="category-search" placeholder="Search categories…" /></div>
          <div class="spacer"></div>
        </div>
        <div class="card" id="category-box">
          <div class="meta-line" id="cat-meta"></div>
          <div id="cat-table"></div>
        </div>`;

      const table = U.qs('#cat-table', host);
      const meta = U.qs('#cat-meta', host);

      const actions = (r) => `<div class="row-actions">
        <button class="icon-btn" data-act="edit" data-id="${r.id}" title="Edit">${I().edit}</button>
        <button class="icon-btn danger" data-act="del" data-id="${r.id}" title="Delete">${I().trash}</button>
      </div>`;

      async function load() {
        const all = await root.stockflow.categoriesList();
        const items = term
          ? all.filter((c) => (c.name + ' ' + (c.description || '')).toLowerCase().includes(term.toLowerCase()))
          : all;
        meta.textContent = items.length
          ? (term ? `${items.length} of ${all.length} categories` : `${all.length} categor${all.length === 1 ? 'y' : 'ies'} total`)
          : '';
        if (!items.length) {
          table.innerHTML = UI.emptyMarkup(
            'No categories yet',
            term
              ? 'Nothing matches your search.'
              : 'Create categories like "Drinks" or "Electronics" to organise your products.',
            term
              ? ''
              : `<button class="btn btn-primary" data-add>${I().plus}<span>Add your first category</span></button>`
          );
          const b = table.querySelector('[data-add]');
          if (b) b.addEventListener('click', () => openForm(null));
          return;
        }
        table.innerHTML = UI.tableMarkup(
          [
            { key: 'name', label: 'Name' },
            { key: 'product_count', label: 'Products', type: 'num', align: 'right' },
            { key: 'description', label: 'Description', type: 'html', render: (r) => esc(r.description || '') || '<span class="muted">—</span>' },
            { key: 'created_at', label: 'Created', type: 'date' },
            { key: '', label: '', type: 'html', align: 'right', render: actions }
          ],
          items.map((r) => ({ ...r, _rowId: r.id })),
          { emptyHtml: '' }
        );
      }

      async function openForm(item) {
        const isEdit = !!item;
        const ok = await UI.openForm({
          title: isEdit ? 'Edit Category' : 'Add Category',
          subtitle: isEdit ? 'Update this category.' : 'Give the category a clear name.',
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Beverages', half: true },
            { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional notes…' }
          ],
          values: item ? { name: item.name, description: item.description || '' } : {},
          submitLabel: isEdit ? 'Save changes' : 'Add category',
          onSubmit: async (data) => {
            const body = { name: data.name, description: data.description };
            if (isEdit) await root.stockflow.categoriesUpdate(item.id, body);
            else await root.stockflow.categoriesCreate(body);
            UI.toast(isEdit ? 'Category updated.' : 'Category added.', 'success');
          }
        });
        if (ok) await load();
      }

      async function remove(item) {
        const warn = item.product_count > 0
          ? `This category is used by ${item.product_count} product${item.product_count === 1 ? '' : 's'}. They will be kept but become Uncategorized.`
          : 'No products are linked to this category.';
        if (!(await UI.confirm({
          title: 'Delete category?',
          message: `"${item.name}" will be permanently deleted.`,
          detail: warn,
          confirmText: 'Delete',
          danger: true
        }))) return;
        try {
          await root.stockflow.categoriesDelete(item.id);
          UI.toast('Category deleted.', 'success');
          await load();
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not delete this category.'), 'error');
        }
      }

      table.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        (async () => {
          const all = await root.stockflow.categoriesList();
          const found = all.find((c) => c.id === id);
          if (!found) return;
          if (btn.dataset.act === 'edit') await openForm(found);
          else await remove(found);
        })();
      });

      U.qs('#btn-add-category', host).addEventListener('click', () => openForm(null));
      U.qs('#category-search', host).addEventListener('input', U.debounce((e) => {
        term = e.target.value.trim();
        load().catch((err) => UI.toast(U.errMessage(err), 'error'));
      }, 200));

      await load();
    }
  };

  (root.SFViews = root.SFViews || {}).categories = view;
})(window);
