'use strict';
/**
 * StockFlow UI kit - modals (forms + confirm), toasts, loading overlay,
 * table + empty-state helpers. No external dependencies.
 */
(function (root) {
  const U = root.SFUtil;

  const ICONS = {
    success: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
  };

  const ui = {
    toast(message, type = 'success', opts = {}) {
      const region = document.getElementById('toast-region');
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.innerHTML = `
        <div class="toast-ico">${ICONS[type] || ICONS.info}</div>
        <div class="toast-msg"></div>
        <button class="toast-close" aria-label="Dismiss">&times;</button>`;
      el.querySelector('.toast-msg').textContent = message;
      const close = () => {
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200);
      };
      el.querySelector('.toast-close').addEventListener('click', close);
      region.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      const timeout = opts.timeout === undefined ? 4200 : opts.timeout;
      if (timeout > 0) setTimeout(close, timeout);
      return el;
    },

    loading(on, text) {
      const loader = document.getElementById('loader');
      if (text) document.getElementById('loader-text').textContent = text;
      loader.classList.toggle('hidden', !on);
    },

    /* ---------------- confirm dialog ---------------- */
    confirm(opts) {
      const {
        title = 'Are you sure?',
        message = '',
        detail = '',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = false
      } = opts || {};
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
          <div class="modal card modal-sm" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
            <div class="modal-header">
              <h2>${U.esc(title)}</h2>
              <button class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
              ${message ? `<p class="confirm-msg">${U.esc(message)}</p>` : ''}
              ${detail ? `<p class="confirm-detail">${U.esc(detail)}</p>` : ''}
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" data-action="cancel">${U.esc(cancelText)}</button>
              <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="ok">${U.esc(confirmText)}</button>
            </div>
          </div>`;
        const done = (val) => {
          backdrop.remove();
          document.removeEventListener('keydown', onKey);
          resolve(val);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); done(false); }
        };
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) done(false);
        });
        backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => done(false));
        backdrop.querySelector('[data-action="ok"]').addEventListener('click', () => done(true));
        backdrop.querySelector('.modal-close').addEventListener('click', () => done(false));
        document.addEventListener('keydown', onKey);
        document.getElementById('modal-root').appendChild(backdrop);
        const okBtn = backdrop.querySelector('[data-action="ok"]');
        if (okBtn) okBtn.focus();
      });
    },

    /* ---------------- form modal ---------------- */
    openForm(opts) {
      const {
        title,
        subtitle,
        fields = [],
        values = {},
        submitLabel = 'Save',
        cancelLabel = 'Cancel',
        onSubmit,
        width = 'md',
        chooseImage = null
      } = opts || {};

      return new Promise((resolve) => {
        let closed = false;
        const finish = (ok) => {
          if (closed) return;
          closed = true;
          backdrop.remove();
          document.removeEventListener('keydown', onKey);
          resolve(ok);
        };

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
          <div class="modal card modal-${width}" role="dialog" aria-modal="true">
            <div class="modal-header">
              <div>
                <h2>${U.esc(title)}</h2>
                ${subtitle ? `<p class="modal-sub">${U.esc(subtitle)}</p>` : ''}
              </div>
              <button class="modal-close" aria-label="Close" data-action="cancel">&times;</button>
            </div>
            <div class="modal-error hidden"></div>
            <div class="modal-body">
              <form novalidate></form>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" data-action="cancel">${U.esc(cancelLabel)}</button>
              <button class="btn btn-primary" data-action="save" type="submit">${U.esc(submitLabel)}</button>
            </div>
          </div>`;

        const form = backdrop.querySelector('form');
        form.className = 'form-grid';
        const errBox = backdrop.querySelector('.modal-error');
        const state = { ...values };

        const renderField = (f) => {
          const fkey = `f-${f.key}`;
          const wrap = document.createElement('div');
          wrap.className = `field${f.half ? '' : ' field-full'}`;
          wrap.dataset.field = f.key;

          const label = document.createElement('label');
          label.htmlFor = fkey;
          label.innerHTML = `${U.esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}`;
          wrap.appendChild(label);

          const msg = document.createElement('div');
          msg.className = 'field-msg';

          if (f.type === 'textarea') {
            const ta = document.createElement('textarea');
            ta.id = fkey; ta.name = f.key; ta.className = 'input';
            ta.rows = (f.rows || 3);
            ta.placeholder = f.placeholder || '';
            if (f.hint) ta.title = f.hint;
            ta.value = state[f.key] || '';
            wrap.appendChild(ta);
          } else if (f.type === 'select') {
            const sel = document.createElement('select');
            sel.id = fkey; sel.name = f.key; sel.className = 'input';
            const options = f.options || [];
            for (const o of options) {
              const opt = document.createElement('option');
              opt.value = o.value === undefined || o.value === null ? '' : o.value;
              opt.textContent = o.label;
              sel.appendChild(opt);
            }
            const cur = state[f.key];
            const match = options.some((o) => String(o.value) === String(cur));
            sel.value = match ? String(cur) : '';
            wrap.appendChild(sel);
          } else if (f.type === 'image') {
            const row = document.createElement('div');
            row.className = 'image-field';
            const preview = document.createElement('div');
            preview.className = 'image-preview';
            const actions = document.createElement('div');
            actions.className = 'image-actions';
            const pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.className = 'btn btn-ghost btn-sm';
            pickBtn.textContent = state[f.key] ? 'Change image' : 'Choose image…';
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'btn btn-ghost btn-sm';
            clearBtn.textContent = 'Remove';
            clearBtn.style.display = state[f.key] ? '' : 'none';
            const updatePreview = () => {
              preview.innerHTML = state[f.key]
                ? `<img src="${U.imageUrl(state[f.key])}" alt="Product image">`
                : `<span class="image-empty">No image</span>`;
            };
            pickBtn.addEventListener('click', async () => {
              if (chooseImage) {
                pickBtn.disabled = true;
                ui.loading(true, 'Reading image…');
                try {
                  const res = await chooseImage();
                  if (res) {
                    state[f.key] = res;
                    pickBtn.textContent = 'Change image';
                    clearBtn.style.display = '';
                    updatePreview();
                  }
                } catch (e) {
                  ui.toast(U.errMessage(e, 'Could not load that image.'), 'error');
                } finally {
                  pickBtn.disabled = false;
                  ui.loading(false);
                }
              }
            });
            clearBtn.addEventListener('click', () => {
              state[f.key] = null;
              pickBtn.textContent = 'Choose image…';
              clearBtn.style.display = 'none';
              updatePreview();
            });
            updatePreview();
            actions.appendChild(pickBtn);
            actions.appendChild(clearBtn);
            row.appendChild(preview);
            row.appendChild(actions);
            wrap.appendChild(row);
          } else {
            const inp = document.createElement('input');
            inp.id = fkey; inp.name = f.key; inp.className = 'input';
            inp.type = f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text';
            if (f.type === 'number') {
              if (f.min !== undefined) inp.min = f.min;
              if (f.max !== undefined) inp.max = f.max;
              inp.step = f.step || (f.decimals ? '0.01' : '1');
            }
            inp.placeholder = f.placeholder || '';
            if (f.hint) inp.title = f.hint;
            const startVal = state[f.key];
            inp.value = startVal === undefined || startVal === null ? '' : startVal;
            wrap.appendChild(inp);
          }

          wrap.appendChild(msg);
          return wrap;
        };

        for (const f of fields) form.appendChild(renderField(f));

        const setFieldError = (key, text) => {
          const wrap = backdrop.querySelector(`.field[data-field="${CSS.escape(key)}"]`);
          if (!wrap) return;
          wrap.classList.add('invalid');
          const msgEl = wrap.querySelector('.field-msg');
          msgEl.textContent = text;
        };
        const clearErrors = () => {
          U.qsa('.field.invalid', backdrop).forEach((w) => {
            w.classList.remove('invalid');
            w.querySelector('.field-msg').textContent = '';
          });
          errBox.classList.add('hidden');
          errBox.textContent = '';
        };
        const showFormError = (text) => {
          errBox.textContent = text;
          errBox.classList.remove('hidden');
        };

        const collect = () => {
          const out = { ...state };
          for (const f of fields) {
            if (f.type === 'image') { out[f.key] = state[f.key] || null; continue; }
            const input = form.elements[f.key];
            if (!input) continue;
            if (input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement ||
                input.type !== 'number') {
              out[f.key] = input.value.trim();
            } else {
              out[f.key] = input.value; // keep raw string; db.js coerces numbers
            }
          }
          return out;
        };

        const validate = (data) => {
          let firstErr = null;
          for (const f of fields) {
            const v = data[f.key];
            if (f.type === 'image') continue;
            if (f.required) {
              const empty = v === null || v === undefined || String(v).trim() === '';
              if (empty) {
                setFieldError(f.key, 'This field is required.');
                if (!firstErr) firstErr = f.key;
                continue;
              }
            }
            if (v && (f.type === 'number')) {
              const n = Number(v);
              if (!Number.isFinite(n)) {
                setFieldError(f.key, 'Enter a valid number.');
                if (!firstErr) firstErr = f.key;
              } else if (f.min !== undefined && n < f.min) {
                setFieldError(f.key, `Must be at least ${f.min}.`);
                if (!firstErr) firstErr = f.key;
              } else if (f.max !== undefined && n > f.max) {
                setFieldError(f.key, `Must be at most ${f.max}.`);
                if (!firstErr) firstErr = f.key;
              }
            }
            if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
              setFieldError(f.key, 'Enter a valid email address.');
              if (!firstErr) firstErr = f.key;
            }
          }
          return firstErr;
        };

        const onSave = async () => {
          clearErrors();
          const data = collect();
          const bad = validate(data);
          if (bad) {
            const el = backdrop.querySelector(`#f-${CSS.escape(bad)}`);
            if (el && el.focus) el.focus();
            return;
          }
          const saveBtn = backdrop.querySelector('[data-action="save"]');
          saveBtn.disabled = true;
          ui.loading(true, 'Saving…');
          try {
            const ok = onSubmit ? await onSubmit(data) : true;
            if (ok === false) return; // handler decided to keep modal open
            finish(true);
          } catch (e) {
            showFormError(U.errMessage(e, 'Could not save.'));
          } finally {
            saveBtn.disabled = false;
            ui.loading(false);
          }
        };

        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          if (e.key === 'Enter') {
            const t = e.target;
            if (t && t.tagName === 'TEXTAREA') return;
            e.preventDefault();
            onSave();
          }
        };

        form.addEventListener('submit', (e) => { e.preventDefault(); onSave(); });
        backdrop.querySelector('[data-action="save"]').addEventListener('click', () => onSave());
        backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
        backdrop.querySelector('.modal-close').addEventListener('click', () => finish(false));
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) finish(false);
        });
        // Clear validation as the user types.
        backdrop.addEventListener('input', (e) => {
          const f = e.target.closest('.field');
          if (f) { f.classList.remove('invalid'); f.querySelector('.field-msg').textContent = ''; }
        });
        document.addEventListener('keydown', onKey);

        document.getElementById('modal-root').appendChild(backdrop);
        const first = form.querySelector('input:not([type="hidden"]), select, textarea');
        if (first && first.focus) first.focus();
      });
    },

    /* ---------------- table builder ---------------- */
    // headers: [{key,label,type,align}]  rows: [ {_cells or arbitrary} ]
    tableMarkup(headers, rows, opts = {}) {
      const currency = opts.currency;
      const head = headers.map((h) => `<th class="${h.align ? 'ta-' + h.align : ''}">${U.esc(h.label)}</th>`).join('');
      const body = rows.map((r, idx) => {
        const cells = headers
          .map((h) => {
            let v = h.render ? h.render(r) : r[h.key];
            let txt;
            if (h.type === 'html') {
              txt = v === null || v === undefined ? '' : v;
            } else if (h.type && h.type !== 'text') {
              txt = root.SFFormat.cellText(v, h.type, currency);
            } else {
              txt = U.esc(v === null || v === undefined ? '' : v);
            }
            const cls = h.align ? `ta-${h.align}` : '';
            return `<td class="${cls}" ${h.cellClass ? 'data-cell="' + h.cellClass + '"' : ''}>${txt}</td>`;
          })
          .join('');
        return `<tr class="${r._total ? 'row-total' : ''}" ${r._rowId !== undefined ? `data-id="${r._rowId}"` : ''}>${cells}</tr>`;
      }).join('');
      const empty = rows.length
        ? ''
        : `<tr class="row-empty"><td colspan="${headers.length}">${
            opts.emptyHtml || '<div class="empty-inline">No records to show.</div>'
          }</td></tr>`;
      return `<div class="table-scroll"><table class="data-table ${opts.className || ''}">
        <thead><tr>${head}</tr></thead><tbody>${body}${empty}</tbody></table></div>`;
    },

    emptyMarkup(title, text, actionHtml) {
      return `<div class="empty-state">
        <div class="empty-art" aria-hidden="true"></div>
        <div class="empty-title">${U.esc(title)}</div>
        ${text ? `<p class="empty-text">${U.esc(text)}</p>` : ''}
        ${actionHtml || ''}
      </div>`;
    },

    chip(text, cls) {
      return `<span class="chip chip-${cls}">${U.esc(text)}</span>`;
    }
  };

  root.SFUI = ui;
})(window);
