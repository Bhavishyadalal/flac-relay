(() => {
  const byId = id => document.getElementById(id);
  const navButtons = document.querySelectorAll('[data-panel]');
  const pageSize = 50;
  let offset = 0;
  let total = 0;
  let listRequest = 0;
  let toastTimer;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  async function api(path, method = 'GET', body) {
    const response = await fetch('/api/admin/' + path, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    });
    if (response.status === 401 && path !== 'login') showLogin();
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'The request failed. Please try again.');
    return data;
  }

  function showLogin() {
    byId('session-check').hidden = true;
    byId('console').hidden = true;
    byId('sign-out').hidden = true;
    byId('login').hidden = false;
  }

  function showConsole(overview) {
    byId('session-check').hidden = true;
    byId('login').hidden = true;
    byId('console').hidden = false;
    byId('sign-out').hidden = false;
    renderOverview(overview);
    showPanel('providers', false);
  }

  function renderOverview(data) {
    byId('active-providers').textContent = Number(data.activeProviders || 0).toLocaleString();
    byId('total-addons').textContent = Number(data.totalAddons || 0).toLocaleString();
  }

  async function refreshOverview() {
    try { renderOverview(await api('overview')); }
    catch { /* The panel action reports its own failure. */ }
  }

  function notify(message, success = true) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.className = 'panel toast ' + (success ? 'success' : 'error');
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function showPanel(panel, focus = true) {
    for (const tab of navButtons) {
      const active = panel === tab.dataset.panel;
      tab.setAttribute('aria-pressed', String(active));
      byId('panel-' + tab.dataset.panel).hidden = !active;
    }
    if (panel === 'providers') void loadProviders();
    if (panel === 'addons') void loadAddons();
    if (focus) byId(panel + '-title').focus();
  }

  function listMessage(list, message) {
    list.replaceChildren(element('p', message, 'list-message'));
  }

  function action(label, run) {
    const button = element('button', label, 'button');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await run(); }
      catch (error) { notify(error.message, false); }
      finally { button.disabled = false; }
    });
    return button;
  }

  function record(title, detail, code, buttons) {
    const row = element('article', '', 'record');
    const info = element('div');
    info.append(element('h3', title), element('p', detail));
    if (code) info.append(element('code', code));
    const controls = element('div', '', 'actions');
    controls.append(...buttons);
    row.append(info, controls);
    return row;
  }

  async function loadProviders() {
    const list = byId('provider-list');
    listMessage(list, 'Loading sources…');
    try {
      const { providers } = await api('providers');
      if (!providers.length) return listMessage(list, 'No sources available. Add one to start searching.');
      list.replaceChildren(...providers.map(provider => {
        const toggle = action(provider.enabled ? 'Disable' : 'Enable', async () => {
          await api('providers/toggle', 'POST', { id: provider.id, enabled: !provider.enabled });
          notify(provider.enabled ? 'Source disabled' : 'Source enabled');
          await Promise.all([loadProviders(), refreshOverview()]);
        });
        toggle.setAttribute('aria-label', (provider.enabled ? 'Disable ' : 'Enable ') + provider.name);
        const buttons = [toggle];
        if (provider.type === 'remote-addon') {
          buttons.push(action('Remove', async () => {
            if (!confirm('Remove ' + provider.name + ' from your sources?')) return;
            await api('providers/' + encodeURIComponent(provider.id), 'DELETE');
            await Promise.all([loadProviders(), refreshOverview()]);
          }));
        }
        return record(provider.name, (provider.enabled ? 'Enabled' : 'Disabled') + ' · ' + (provider.type === 'remote-addon' ? 'Imported addon' : 'Built-in source'), provider.baseUrl, buttons);
      }));
    } catch (error) {
      listMessage(list, error.message);
    }
  }

  async function loadAddons() {
    const request = ++listRequest;
    const list = byId('addon-list');
    listMessage(list, 'Loading links…');
    byId('addon-pagination').hidden = true;
    const search = byId('addon-search-input').value.trim();
    try {
      const data = await api('addons?' + new URLSearchParams({ search, limit: pageSize, offset }));
      if (request !== listRequest) return;
      total = data.total;
      if (!data.addons.length) return listMessage(list, search ? 'No links match that email or alias.' : 'No personal links have been created yet.');
      list.replaceChildren(...data.addons.map(addon => {
        const url = location.origin + '/u/' + encodeURIComponent(addon.addon_slug) + '/manifest.json';
        const copy = action('Copy link', async () => {
          await navigator.clipboard.writeText(url);
          notify('Addon link copied');
        });
        const revoke = action(addon.is_revoked ? 'Restore' : 'Revoke', async () => {
          await api('addon/revoke', 'POST', { slug: addon.addon_slug, isRevoked: !addon.is_revoked });
          await loadAddons();
        });
        const date = new Date(addon.created_at);
        const created = Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleDateString();
        return record(addon.email || 'Anonymous', (addon.is_revoked ? 'Revoked' : 'Active') + created, url, [copy, revoke]);
      }));
      byId('addon-pagination').hidden = total <= pageSize;
      byId('addon-page-info').textContent = (offset + 1) + '–' + (offset + data.addons.length) + ' of ' + total;
      byId('previous-addons').disabled = offset === 0;
      byId('next-addons').disabled = offset + pageSize >= total;
    } catch (error) {
      if (request === listRequest) listMessage(list, error.message);
    }
  }

  function status(id, message, className) {
    const field = byId(id);
    field.className = 'notice' + (className ? ' ' + className : '');
    field.textContent = message;
    field.hidden = !message;
  }

  byId('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = byId('admin-password-input');
    const submit = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    status('login-error', '');
    try {
      await api('login', 'POST', { password: password.value });
      password.value = '';
      showConsole(await api('overview'));
      byId('providers-title').focus();
    } catch (error) { status('login-error', error.message, 'error'); }
    finally { submit.disabled = false; }
  });

  byId('password-toggle').addEventListener('click', event => {
    const input = byId('admin-password-input');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? 'Hide' : 'Show';
    event.currentTarget.setAttribute('aria-pressed', String(visible));
  });

  byId('sign-out').addEventListener('click', async () => {
    try {
      await api('logout', 'POST');
      showLogin();
      byId('admin-password-input').focus();
    } catch (error) { notify(error.message, false); }
  });

  byId('import-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = byId('import-url-input');
    const manifestUrl = input.value.trim();
    if (!manifestUrl) return status('import-feedback', 'Paste an addon manifest URL.', 'error');
    const submit = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    byId('view-imported-sources').hidden = true;
    status('import-feedback', 'Checking the manifest, search, and playback link…');
    try {
      const { provider, details } = await api('providers/test-import', 'POST', { manifestUrl });
      input.value = '';
      status('import-feedback', provider.name + ' added. Verified sample: ' + details.sampleTitle, 'success');
      byId('view-imported-sources').hidden = false;
      void refreshOverview();
    } catch (error) { status('import-feedback', error.message, 'error'); }
    finally { submit.disabled = false; }
  });

  for (const tab of navButtons) tab.addEventListener('click', () => showPanel(tab.dataset.panel));
  byId('add-source').addEventListener('click', () => showPanel('import'));
  byId('view-imported-sources').addEventListener('click', () => showPanel('providers'));
  byId('refresh-providers').addEventListener('click', loadProviders);
  byId('addon-search-form').addEventListener('submit', event => { event.preventDefault(); offset = 0; void loadAddons(); });
  byId('previous-addons').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); void loadAddons(); });
  byId('next-addons').addEventListener('click', () => { if (offset + pageSize < total) { offset += pageSize; void loadAddons(); } });
  api('overview').then(showConsole).catch(error => {
    if (!byId('login').hidden) return;
    showLogin();
    status('login-error', error.message, 'error');
  });
})();
