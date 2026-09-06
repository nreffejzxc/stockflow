'use strict';
/**
 * Suppliers view - list, search, add / edit / delete.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const view = {
    loadingText: 'Loading suppliers…',

    async mount(host, ctx) {
      let term = '';

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Suppliers</h1><p class="view-sub">Track who you buy from and their contact details.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-primary" id="btn-add-supplier">${I().plus}<span>Add Supplier</span></button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search">${I().search}<input class="input" id="supplier-search" placeholder="Search suppliers…" /></div>
          <div class="spacer"></div>
        </div>
        <div class="card" id="supplier-box">
          <div class="meta-line" id="sup-meta"></div>
          <div id="sup-table"></div>
        </div>`;

      const table = U.qs('#sup-table', host);
      const meta = U.qs('#sup-meta', host);

      const actions = (r) => `<div class="row-actions">
        <button class="icon-btn" data-act="edit" data-id="${r.id}" title="Edit">${I().edit}</button>
        <button class="icon-btn danger" data-act="del" data-id="${r.id}" title="Delete">${I().trash}</button>
      </div>`;

      async function load() {
        const all = await root.stockflow.suppliersList();
        const items = term
          ? all.filter((s) => (
              (s.name + ' ' + (s.contact_person || '') + ' ' + (s.email || '') + ' ' + (s.phone || '')).toLowerCase().includes(term.toLowerCase())
            ))
          : all;
        meta.textContent = items.length
          ? (term ? `${items.length} of ${all.length} suppliers` : `${all.length} supplier${all.length === 1 ? '' : 's'} total`)
          : '';
        if (!items.length) {
          table.innerHTML = UI.emptyMarkup(
            'No suppliers yet',
            term ? 'Nothing matches your search.' : 'Add your suppliers so you can record who stock comes from.',
            term ? '' : `<button class="btn btn-primary" data-add>${I().plus}<span>Add your first supplier</span></button>`
          );
          const b = table.querySelector('[data-add]');
          if (b) b.addEventListener('click', () => openForm(null));
          return;
        }
        table.innerHTML = UI.tableMarkup(
          [
            { key: 'name', label: 'Name' },
            { key: 'contact_person', label: 'Contact', type: 'html', render: (r) => esc(r.contact_person || '') || '<span class="muted">—</span>' },
            { key: 'phone', label: 'Phone', type: 'html', render: (r) => esc(r.phone || '') || '<span class="muted">—</span>' },
            { key: 'email', label: 'Email', type: 'html', render: (r) => esc(r.email || '') || '<span class="muted">—</span>' },
            { key: 'product_count', label: 'Products', type: 'num', align: 'right' },
            { key: '', label: '', type: 'html', align: 'right', render: actions }
          ],
          items.map((r) => ({ ...r, _rowId: r.id })),
          { emptyHtml: '' }
        );
      }

      async function openForm(item) {
        const isEdit = !!item;
        const values = isEdit
          ? {
              name: item.name,
              contactPerson: item.contact_person || '',
              phone: item.phone || '',
              email: item.email || '',
              address: item.address || '',
              notes: item.notes || ''
            }
          : { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' };
        const ok = await UI.openForm({
          title: isEdit ? 'Edit Supplier' : 'Add Supplier',
          subtitle: isEdit ? 'Update this supplier.' : 'Keep your suppliers’ details handy for reordering.',
          width: 'lg',
          fields: [
            { key: 'name', label: 'Supplier name', required: true, placeholder: 'e.g. Acme Wholesale', half: true },
            { key: 'contactPerson', label: 'Contact person', placeholder: 'e.g. Jane Doe', half: true },
            { key: 'phone', label: 'Phone', type: 'tel', placeholder: 'e.g. +1 555 0100', half: true },
            { key: 'email', label: 'Email', type: 'email', placeholder: 'e.g. sales@acme.com', half: true },
            { key: 'address', label: 'Address', type: 'textarea', placeholder: 'Street, city, postal code…' },
            { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Anything worth remembering…' }
          ],
          values,
          submitLabel: isEdit ? 'Save changes' : 'Add supplier',
          onSubmit: async (data) => {
            const body = {
              name: data.name,
              contactPerson: data.contactPerson,
              phone: data.phone,
              email: data.email,
              address: data.address,
              notes: data.notes
            };
            if (isEdit) await root.stockflow.suppliersUpdate(item.id, body);
            else await root.stockflow.suppliersCreate(body);
            UI.toast(isEdit ? 'Supplier updated.' : 'Supplier added.', 'success');
          }
        });
        if (ok) await load();
      }

      async function remove(item) {
        const warn = item.product_count > 0
          ? `This supplier is used by ${item.product_count} product${item.product_count === 1 ? '' : 's'}. They will be kept but marked as having no supplier.`
          : 'No products are linked to this supplier.';
        if (!(await UI.confirm({
          title: 'Delete supplier?',
          message: `"${item.name}" will be permanently deleted.`,
          detail: warn,
          confirmText: 'Delete',
          danger: true
        }))) return;
        try {
          await root.stockflow.suppliersDelete(item.id);
          UI.toast('Supplier deleted.', 'success');
          await load();
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not delete this supplier.'), 'error');
        }
      }

      table.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        (async () => {
          const all = await root.stockflow.suppliersList();
          const found = all.find((s) => s.id === id);
          if (!found) return;
          if (btn.dataset.act === 'edit') await openForm(found);
          else await remove(found);
        })();
      });

      U.qs('#btn-add-supplier', host).addEventListener('click', () => openForm(null));
      U.qs('#supplier-search', host).addEventListener('input', U.debounce((e) => {
        term = e.target.value.trim();
        load().catch((err) => UI.toast(U.errMessage(err), 'error'));
      }, 200));

      await load();
    }
  };

  (root.SFViews = root.SFViews || {}).suppliers = view;
})(window);
