'use strict';

const http = require('node:http');
const https = require('node:https');

// Probe only the origin root, never saved paths or queries that could be actions.
// Any HTTP response means the server is reachable, including login/error pages.
function probeOrigin(value, { timeout = 4000 } = {}) {
  const origin = new URL('/', value);
  return new Promise(resolve => {
    const request = (origin.protocol === 'https:' ? https : http).request(origin, {
      method: 'HEAD', signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': 'MyBrowser availability check' }
    }, response => {
      resolve({ reachable: true, status: response.statusCode, checkedAt: new Date().toISOString() });
      response.destroy();
    });
    request.on('error', error => resolve({ reachable: false, error: error.code || 'CONNECTION_FAILED', checkedAt: new Date().toISOString() }));
    request.end();
  });
}

class Availability {
  constructor(validate, { ttl = 30000, timeout = 4000 } = {}) {
    this.validate = validate;
    this.ttl = ttl;
    this.timeout = timeout;
    this.cache = new Map();
  }

  async check(value) {
    const origin = new URL(value).origin;
    const cached = this.cache.get(origin);
    if (cached && Date.now() - cached.at < this.ttl) return cached.result;
    const result = Promise.resolve().then(() => this.validate(`${origin}/`))
      .then(() => probeOrigin(origin, { timeout: this.timeout }))
      .catch(() => ({ reachable: false, error: 'ADDRESS_NOT_ALLOWED', checkedAt: new Date().toISOString() }));
    this.cache.set(origin, { at: Date.now(), result });
    return result;
  }
}

module.exports = { Availability, probeOrigin };
