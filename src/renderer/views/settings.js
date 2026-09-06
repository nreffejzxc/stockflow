'use strict';
/**
 * Settings view - business info, currency, default min-stock, backup/restore
 * and about information. Registers window.SFViews.settings.
 */
(function (root) {
  const U = root.SFUtil;
  const UI = root.SFUI;
  const F = root.SFFormat;
  const esc = U.esc;
  const I = () => root.SFApp.icons;

  const view = {
    loadingText: 'Loading settings…',

    async mount(host, ctx) {
      const [settings, info] = await Promise.all([
        root.stockflow.settingsGet(),
        root.stockflow.appInfo().catch(() => null)
      ]);

      const currencyOptions = Object.keys(F.CURRENCY_SYMBOLS).map((code) => {
        const sym = F.CURRENCY_SYMBOLS[code];
        return `<option value="${code}" ${code === settings.currency ? 'selected' : ''}>${code} (${sym})</option>`;
      }).join('');

      host.innerHTML = `
        <div class="view-header">
          <div><h1>Settings</h1><p class="view-sub">Business details, defaults and your data.</p></div>
        </div>
        <div class="settings-grid">
          <section class="card set-panel">
            <div class="panel-head"><h3>Business details</h3></div>
            <div class="panel-body">
              <div class="set-row">
                <div class="set-field"><label>Business name</label>
                  <input class="input" id="s-businessName" value="${esc(settings.businessName || '')}" placeholder="My Business" /></div>
                <div class="set-field"><label>Phone</label>
                  <input class="input" id="s-phone" type="tel" value="${esc(settings.phone || '')}" placeholder="+1 555 0100" /></div>
              </div>
              <div class="set-field"><label>Email</label>
                <input class="input" id="s-email" type="email" value="${esc(settings.email || '')}" placeholder="hello@business.com" /></div>
              <div class="set-field"><label>Address</label>
                <textarea class="input" id="s-address" rows="2" placeholder="Street, city, postal code…">${esc(settings.address || '')}</textarea></div>
              <div class="row-flex">
                <button class="btn btn-primary" id="s-save-business">Save business details</button>
              </div>
            </div>
          </section>

          <div style="display:flex;flex-direction:column;gap:16px">
            <section class="card set-panel">
              <div class="panel-head"><h3>Preferences</h3></div>
              <div class="panel-body">
                <div class="set-row">
                  <div class="set-field"><label>Currency</label>
                    <select class="input" id="s-currency">${currencyOptions}</select></div>
                  <div class="set-field"><label>Default min. stock for new products</label>
                    <input class="input" id="s-defaultMinStock" type="number" min="0" step="any"
                           value="${esc(String(settings.defaultMinStock !== undefined ? settings.defaultMinStock : 0))}" /></div>
                </div>
                <p class="hint-suggestion" style="margin:2px 0 12px">
                  Products at or below their minimum stock are flagged <b>Low Stock</b>; at zero they are <b>Out of Stock</b>.
                  Each product can override the default.
                </p>
                <div class="row-flex"><button class="btn btn-primary" id="s-save-prefs">Save preferences</button></div>
              </div>
            </section>

            <section class="card set-panel">
              <div class="panel-head"><h3>Backup &amp; restore</h3></div>
              <div class="panel-body">
                <p class="hint-suggestion" style="margin:0 0 12px">
                  Your data lives in a single SQLite database on this computer. Back it up regularly.
                </p>
                <div class="row-flex">
                  <button class="btn" id="s-backup">${I().download}<span>Backup now…</span></button>
                  <button class="btn" id="s-restore">${I().upload}<span>Restore from backup…</span></button>
                </div>
                <div class="kv" style="margin-top:14px"><span class="k">Database file</span><span class="v mono" id="s-dbpath" title="Click to copy">${esc((info && info.dbPath) || '…')}</span></div>
                <div class="kv"><span class="k">SQL engine</span><span class="v">${esc((info && info.engine) || '…')}</span></div>
              </div>
            </section>
          </div>
        </div>

        <section class="card set-panel" style="margin-top:16px">
          <div class="panel-head"><h3>About StockFlow</h3></div>
          <div class="panel-body">
            <div class="row-flex" style="gap:20px">
              <div class="brand-mark" style="width:46px;height:46px">
                <span></span><span></span><span></span>
              </div>
              <div>
                <div style="font-weight:700;font-size:15px">StockFlow Desktop <span class="badge-count" id="about-version">v${esc((info && info.version) || '1.0.0')}</span></div>
                <div class="hint-suggestion" style="margin-top:3px">
                  Offline inventory management for small businesses. Built with Electron and SQLite.
                </div>
              </div>
            </div>
          </div>
        </section>`;

      const dbPathEl = U.qs('#s-dbpath', host);
      if (dbPathEl) {
        dbPathEl.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(dbPathEl.textContent);
            UI.toast('Database path copied to clipboard.', 'info');
          } catch (_) { UI.toast(dbPathEl.textContent, 'info'); }
        });
      }

      async function saveBusiness() {
        try {
          await root.stockflow.settingsSet('businessName', U.qs('#s-businessName', host).value);
          await root.stockflow.settingsSet('phone', U.qs('#s-phone', host).value);
          await root.stockflow.settingsSet('email', U.qs('#s-email', host).value);
          await root.stockflow.settingsSet('address', U.qs('#s-address', host).value);
          U.clearSettingsCache();
          UI.toast('Business details saved.', 'success');
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not save settings.'), 'error');
        }
      }

      async function savePrefs() {
        try {
          await root.stockflow.settingsSet('currency', U.qs('#s-currency', host).value);
          const mn = Number(U.qs('#s-defaultMinStock', host).value);
          await root.stockflow.settingsSet('defaultMinStock', Number.isFinite(mn) && mn > 0 ? String(mn) : '0');
          U.clearSettingsCache();
          UI.toast('Preferences saved.', 'success');
        } catch (e) {
          UI.toast(U.errMessage(e, 'Could not save preferences.'), 'error');
        }
      }

      async function backup() {
        const btn = U.qs('#s-backup', host);
        btn.disabled = true;
        UI.loading(true, 'Creating backup…');
        try {
          const res = await root.stockflow.backupCreate();
          if (res && res.canceled) return;
          UI.toast(res && res.path ? `Backup saved: ${res.path}` : 'Backup created.', 'success');
        } catch (e) {
          UI.toast(U.errMessage(e, 'Backup failed.'), 'error');
        } finally {
          btn.disabled = false;
          UI.loading(false);
        }
      }

      async function restore() {
        if (!(await UI.confirm({
          title: 'Restore from backup?',
          message: 'The database will be replaced with the backup you choose.',
          detail: 'A safety copy of your current database is made automatically first, and the app will reload afterwards.',
          confirmText: 'Choose backup…',
          danger: true
        }))) return;
        const btn = U.qs('#s-restore', host);
        btn.disabled = true;
        UI.loading(true, 'Restoring database…');
        try {
          const res = await root.stockflow.backupRestore(null);
          if (res && res.canceled) return;
          // The window reloads automatically on success (main process).
          if (res && res.ok) U.clearSettingsCache();
        } catch (e) {
          UI.toast(U.errMessage(e, 'Restore failed.'), 'error');
        } finally {
          btn.disabled = false;
          UI.loading(false);
        }
      }

      U.qs('#s-save-business', host).addEventListener('click', saveBusiness);
      U.qs('#s-save-prefs', host).addEventListener('click', savePrefs);
      U.qs('#s-backup', host).addEventListener('click', backup);
      U.qs('#s-restore', host).addEventListener('click', restore);
    }
  };

  (root.SFViews = root.SFViews || {}).settings = view;
})(window);
