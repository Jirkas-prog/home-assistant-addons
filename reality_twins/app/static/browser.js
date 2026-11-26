'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const language = (() => { try { return localStorage.getItem('reality-twins-language') === 'en' ? 'en' : 'cs'; } catch { return 'cs'; } })();
  const copy = {
    cs: { title: 'Přihlášení k Instagramu', return: 'Zpět do nastavení', intro: 'Tady ovládáš skutečný Instagram v prohlížeči doplňku. Přihlas se a dokonči případné ověření. Potom zvol Hotovo, ověřit účet.', starting: 'Spouštím prohlížeč…', controls: 'Klikni do stránky a piš klávesnicí. Na telefonu můžeš vložit text do vybraného pole pomocí formuláře níže.', textLabel: 'Text pro vybrané pole Instagramu', textNote: 'Nejdřív klikni do cílového pole ve stránce. Text se po vložení ihned vymaže.', insert: 'Vložit text', selectAll: 'Vybrat vše', up: 'Posunout nahoru', down: 'Posunout dolů', finish: 'Hotovo, ověřit účet', close: 'Zavřít bez ověření', reopen: 'Znovu otevřít prohlížeč', active: 'Prohlížeč je připravený', closed: 'Okno prohlížeče je zavřené', expired: 'Přístup k oknu vypršel. Otevři ho znovu.', busy: 'Probíhá publikování', failed: 'Akci se nepodařilo dokončit.', timeout: 'Prohlížeč neodpověděl včas. Zkontroluj stránku před opakováním.', account: 'Účet je ověřený', ready: 'Připojení je uložené. V nastavení můžeš zapnout publikování.', screen: 'Instagram v prohlížeči doplňku', notConfirmed: 'Přihlášení ještě nebylo potvrzeno. Dokonči ho na Instagramu.' },
    en: { title: 'Sign in to Instagram', return: 'Back to Settings', intro: 'You are controlling the real Instagram website in the add-on browser. Sign in and complete any verification. Then choose Done, verify account.', starting: 'Starting browser…', controls: 'Click the page and type with your keyboard. On a phone, use the form below to insert text into the selected field.', textLabel: 'Text for the selected Instagram field', textNote: 'First click the target field on the page. The text is cleared immediately after insertion.', insert: 'Insert text', selectAll: 'Select all', up: 'Scroll up', down: 'Scroll down', finish: 'Done, verify account', close: 'Close without verification', reopen: 'Reopen browser', active: 'Browser ready', closed: 'Browser window closed', expired: 'The browser view expired. Open it again.', busy: 'Publishing in progress', failed: 'The action could not be completed.', timeout: 'The browser did not respond in time. Check the page before repeating the action.', account: 'Account verified', ready: 'Your connection is saved. You can enable publishing in Settings.', screen: 'Instagram in the add-on browser', notConfirmed: 'Sign-in has not been confirmed yet. Complete it on Instagram.' }
  };
  Object.assign(copy.cs, { desktop: 'Počítač', mobile: 'Mobil', modeNote: 'Změna zobrazení otevře úvodní stránku Instagramu. Přihlášení zůstane stejné.', switching: 'Měním zobrazení…' });
  Object.assign(copy.en, { desktop: 'Desktop', mobile: 'Mobile', modeNote: 'Switching view opens the Instagram home page. Your sign-in stays the same.', switching: 'Switching view…' });
  const t = key => copy[language][key];
  document.documentElement.lang = language;
  document.querySelectorAll('[data-text]').forEach(node => { node.textContent = t(node.dataset.text); });
  const screen = $('#browser-screen');
  screen.alt = t('screen');
  screen.setAttribute('aria-label', t('screen'));
  $('#browser-text').setAttribute('aria-label', t('textLabel'));
  let active = false, finishing = false, polling = false, timer = null, imageURL = '', generation = 0, inputChain = Promise.resolve(), requestChain = Promise.resolve();
  let width = 1100, height = 760, mode = 'desktop';

  function request(path, body, binary = false, options = {}) {
    const revision = generation;
    // Chromium has one owner thread. A screenshot must not race a click, text
    // insertion or the final account check. Failed input is never retried.
    const result = requestChain.then(() => {
      if (!options.always && revision !== generation) return null;
      if (path === 'browser/frame' && (!active || finishing || document.hidden)) return null;
      return performRequest(path, body, binary, options);
    });
    requestChain = result.catch(() => {});
    return result;
  }

  async function performRequest(path, body, binary, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`../api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, keepalive: Boolean(options.keepalive),
        headers: { 'X-RT-Language': language, ...(body === undefined ? {} : { 'X-RT-Request': '1', 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.ok && binary) return response.blob();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((language === 'cs' ? data.error_cs : data.error) || data.error || t('failed'));
      return data;
    } catch (error) { throw new Error(error.name === 'AbortError' ? t('timeout') : error.message || t('failed')); }
    finally { clearTimeout(timeout); }
  }

  function showError(error) { $('#browser-error').textContent = error.message || String(error); $('#browser-error').hidden = false; }
  function setControls() {
    for (const item of ['desktop', 'mobile']) {
      $(`#browser-${item}`).disabled = !active || finishing || mode === item;
      $(`#browser-${item}`).setAttribute('aria-pressed', String(mode === item));
    }
    $('#browser-finish').disabled = !active || finishing;
    $('#browser-text-form').querySelectorAll('input,button').forEach(node => { node.disabled = !active || finishing; });
    document.querySelectorAll('[data-key],[data-scroll]').forEach(node => { node.disabled = !active || finishing; });
    $('#browser-restart').hidden = active;
    screen.setAttribute('aria-disabled', String(!active || finishing));
  }
  function revokeFrame() {
    screen.hidden = true;
    screen.removeAttribute('src');
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = '';
  }
  function stopView(message) {
    active = false; generation++; clearTimeout(timer); $('#browser-text').value = '';
    $('#browser-status').textContent = message;
    $('#browser-loading').textContent = message;
    $('#browser-loading').hidden = false;
    revokeFrame(); setControls();
  }
  function status(data) {
    width = Number(data.width) || 1100; height = Number(data.height) || 760;
    mode = data.mode === 'mobile' ? 'mobile' : 'desktop';
    screen.setAttribute('width', String(width)); screen.setAttribute('height', String(height));
    $('.browser-viewport').dataset.mode = mode;
    if (data.url) $('#browser-url').textContent = data.url;
    if (!data.active) { stopView(data.busy ? t('busy') : t('expired')); return; }
    active = true;
    $('#browser-status').textContent = t('active');
    setControls();
  }
  async function poll() {
    if (!active || polling || finishing || document.hidden) return;
    polling = true;
    const revision = generation;
    try {
      const current = await request('browser/status');
      if (!active || finishing || revision !== generation || !current) return;
      status(current);
      if (!active || finishing || revision !== generation) return;
      const blob = await request('browser/frame', undefined, true);
      if (!active || finishing || revision !== generation || !blob) return;
      const previous = imageURL;
      imageURL = URL.createObjectURL(blob);
      screen.src = imageURL; screen.hidden = false; $('#browser-loading').hidden = true;
      if (previous) URL.revokeObjectURL(previous);
    } catch (error) { if (revision === generation) { stopView(t('closed')); showError(error); } }
    finally { polling = false; if (active && !finishing) timer = setTimeout(poll, 1200); }
  }
  async function start() {
    if (active || finishing) return;
    const revision = generation;
    finishing = true; setControls();
    $('#browser-restart').disabled = true;
    $('#browser-error').hidden = true; $('#browser-complete').hidden = true;
    $('#browser-loading').hidden = false; $('#browser-loading').textContent = t('starting');
    try { const result = await request('browser/start', {}); if (revision === generation && result) status(result); }
    catch (error) { if (revision === generation) { stopView(t('closed')); showError(error); } }
    finally { finishing = false; $('#browser-restart').disabled = false; setControls(); if (active) poll(); }
  }
  async function changeMode(next) {
    if (!active || finishing || mode === next) return;
    finishing = true; clearTimeout(timer); setControls(); $('#browser-error').hidden = true;
    try {
      await inputChain;
      if (!active) return;
      generation++;
      revokeFrame(); $('#browser-loading').hidden = false; $('#browser-loading').textContent = t('switching');
      const result = await request('browser/mode', { mode: next });
      if (result) status(result);
    } catch (error) { stopView(t('closed')); showError(error); }
    finally { finishing = false; setControls(); if (active) poll(); }
  }
  $('#browser-desktop').addEventListener('click', () => changeMode('desktop'));
  $('#browser-mobile').addEventListener('click', () => changeMode('mobile'));
  function input(payload) {
    if (!active || finishing) return;
    const revision = generation;
    inputChain = inputChain.then(async () => {
      try {
        if (!active || revision !== generation) return;
        const result = await request('browser/input', payload);
        if (active && revision === generation && result) status(result);
      }
      catch (error) { if (revision === generation) { stopView(t('closed')); showError(error); } }
      finally { if (payload.type === 'text') payload.text = ''; }
    });
  }
  screen.addEventListener('click', event => {
    const rect = screen.getBoundingClientRect();
    screen.focus({ preventScroll: true });
    input({ type: 'click', x: Math.min(width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * width / rect.width))), y: Math.min(height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * height / rect.height))) });
  });
  screen.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.metaKey) return;
    const key = event.ctrlKey ? (event.key.toLowerCase() === 'a' ? 'Control+A' : '') : event.shiftKey && event.key === 'Tab' ? 'Shift+Tab' : event.key;
    if (['Enter','Tab','Shift+Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Control+A','Escape','PageUp','PageDown'].includes(key)) {
      event.preventDefault(); input({ type: 'key', key });
    } else if (!event.ctrlKey && event.key.length === 1) { event.preventDefault(); input({ type: 'text', text: event.key }); }
  });
  screen.addEventListener('paste', event => { event.preventDefault(); const text = event.clipboardData?.getData('text') || ''; if (text && text.length <= 1024) input({ type: 'text', text }); });
  screen.addEventListener('wheel', event => { event.preventDefault(); input({ type: 'scroll', delta_y: Math.max(-1200, Math.min(1200, Math.round(event.deltaY))) }); }, { passive: false });
  $('#browser-text-form').addEventListener('submit', event => { event.preventDefault(); const field = $('#browser-text'); const text = field.value; field.value = ''; if (text) input({ type: 'text', text }); });
  document.querySelectorAll('[data-key]').forEach(node => node.addEventListener('click', () => input({ type: 'key', key: node.dataset.key })));
  document.querySelectorAll('[data-scroll]').forEach(node => node.addEventListener('click', () => input({ type: 'scroll', delta_y: Number(node.dataset.scroll) })));
  $('#browser-finish').addEventListener('click', async () => {
    if (!active || finishing) return;
    const revision = generation;
    finishing = true; clearTimeout(timer); setControls(); $('#browser-error').hidden = true;
    try {
      await inputChain;
      if (!active || revision !== generation) return;
      const result = await request('browser/finish', {});
      if (revision !== generation || !result) return;
      if (!result.connected) throw new Error(t('notConfirmed'));
      stopView(t('account'));
      $('#browser-complete').textContent = `${result.username ? `@${result.username} — ` : ''}${t('ready')}`;
      $('#browser-complete').hidden = false;
    } catch (error) { showError(error); }
    finally { finishing = false; setControls(); if (active) poll(); }
  });
  async function close() {
    if (finishing) return;
    finishing = true; setControls(); clearTimeout(timer);
    try { await inputChain; await request('browser/close', {}); stopView(t('closed')); }
    catch (error) { showError(error); }
    finally { finishing = false; setControls(); if (active) poll(); }
  }
  $('#browser-close').addEventListener('click', close);
  $('#browser-restart').addEventListener('click', start);
  $('#return-link').addEventListener('click', async event => {
    if (active) { event.preventDefault(); await close(); if (!active) location.href = '../#settings'; }
  });
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && active) poll(); });
  window.addEventListener('pagehide', () => {
    $('#browser-text').value = ''; revokeFrame();
    const needsClose = active || finishing;
    active = false; finishing = true; generation++; clearTimeout(timer);
    // Best-effort close stays behind any in-flight Chromium action. The server
    // lease also expires if unloading the document interrupts this request.
    if (needsClose) request('browser/close', {}, false, { always: true, keepalive: true }).catch(() => {});
  });
  setControls(); start();
})();
