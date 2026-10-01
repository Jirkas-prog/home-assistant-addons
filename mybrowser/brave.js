'use strict';

const http = require('node:http');

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw httpError(400, 'Enter a valid absolute website URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, 'Only HTTP and HTTPS URLs are allowed');
  return url.href;
}

class BraveDesktop {
  constructor({ port = 9221 } = {}) {
    this.port = Number(port) || 9221;
  }

  async request(pathname, { method = 'GET', timeout = 2500 } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: this.port, path: pathname, method }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode || 500) >= 400) return reject(httpError(503, `Brave DevTools returned HTTP ${response.statusCode}`));
          try { resolve(text ? JSON.parse(text) : {}); }
          catch { reject(httpError(503, 'Brave DevTools returned invalid data')); }
        });
      });
      request.setTimeout(timeout, () => request.destroy(new Error('timeout')));
      request.on('error', error => reject(httpError(503, `Brave is still starting: ${error.message}`)));
      request.end();
    });
  }

  async targets() {
    const targets = await this.request('/json/list');
    return Array.isArray(targets) ? targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl) : [];
  }

  async activeTarget() {
    const targets = await this.targets();
    if (!targets.length) return null;
    for (const target of targets) {
      try {
        const result = await this.command(target, 'Runtime.evaluate', { expression: 'document.hasFocus()', returnByValue: true });
        if (result?.result?.value === true) return target;
      } catch {}
    }
    return targets[0];
  }

  async command(target, method, params = {}) {
    if (typeof WebSocket !== 'function') throw httpError(503, 'This Node.js runtime does not provide WebSocket support');
    return new Promise((resolve, reject) => {
      const id = 1;
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(httpError(503, 'Brave did not answer in time'));
      }, 5000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id, method, params })));
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.id !== id) return;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        if (message.error) reject(httpError(502, message.error.message || 'Brave command failed'));
        else resolve(message.result || {});
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(httpError(503, 'The Brave control channel is not available yet'));
      }, { once: true });
    });
  }

  async open(value) {
    const url = safeUrl(value);
    let target = await this.activeTarget();
    if (!target) {
      await this.request(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT', timeout: 5000 });
      target = await this.activeTarget();
    } else {
      await this.command(target, 'Page.navigate', { url });
      await this.command(target, 'Page.bringToFront');
    }
    return { ok: true, url, targetId: target?.id || null };
  }

  async action(action) {
    const target = await this.activeTarget();
    if (!target) throw httpError(503, 'Brave does not have an open page yet');
    if (action === 'reload') await this.command(target, 'Page.reload', { ignoreCache: false });
    else if (action === 'back') await this.command(target, 'Runtime.evaluate', { expression: 'history.back()' });
    else if (action === 'forward') await this.command(target, 'Runtime.evaluate', { expression: 'history.forward()' });
    else throw httpError(400, 'Unknown browser action');
    return { ok: true };
  }

  async state() {
    try {
      const target = await this.activeTarget();
      if (!target) return { available: true, ready: true, url: '', title: 'Brave' };
      return { available: true, ready: true, url: target.url || '', title: target.title || 'Brave', targetId: target.id };
    } catch (error) {
      return { available: false, ready: false, url: '', title: 'Brave', error: error.message };
    }
  }
}

module.exports = { BraveDesktop, safeUrl };
