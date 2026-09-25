'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

const AD_HOST_PARTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.',
  'amazon-adsystem.com', 'adsystem.com', 'adnxs.com', 'taboola.com', 'outbrain.com',
  'criteo.com', 'criteo.net', 'scorecardresearch.com', 'zedo.com', 'yieldmo.com',
  'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'smartadserver.com'
];
const AD_PATH = /(?:^|[\/_-])(ads?|advert|advertising|banner|sponsor|promoted|tracking)(?:[\/_?.-]|$)/i;
const MIME_EXTENSIONS = {
  'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js', 'application/json': '.json',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'image/x-icon': '.ico', 'font/woff': '.woff', 'font/woff2': '.woff2', 'application/wasm': '.wasm',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3'
};

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_m, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function attributeFromTag(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  return match ? decodeEntities(match[2].trim()) : '';
}

function metaContent(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (attributeFromTag(tag, key).toLowerCase() === value.toLowerCase()) return attributeFromTag(tag, 'content');
  }
  return '';
}

function isPrivateIp(address) {
  if (!address) return true;
  if (address.startsWith('::ffff:')) return isPrivateIp(address.slice(7));
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') ||
      lower.startsWith('ff');
  }
  return true;
}

function isAdUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return AD_HOST_PARTS.some(part => host === part || host.endsWith(`.${part}`) || host.includes(part)) || AD_PATH.test(url.pathname);
  } catch { return false; }
}

function absoluteUrl(value, baseUrl) {
  if (!value || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value.trim())) return null;
  try {
    const url = new URL(decodeEntities(value), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function extensionFor(url, contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
  } catch { return '.bin'; }
}

function injectIntoHead(html, markup) {
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, match => `${match}${markup}`);
  return `${markup}${html}`;
}

function removeAdElements(html, baseUrl) {
  let blocked = 0;
  const result = html.replace(/<(script|iframe|img|ins)\b[\s\S]*?<\/\1\s*>|<(script|iframe|img|ins)\b[^>]*\/?>/gi, tag => {
    const source = attributeFromTag(tag, 'src') || attributeFromTag(tag, 'data-src');
    const target = absoluteUrl(source, baseUrl);
    if (target && isAdUrl(target)) { blocked += 1; return ''; }
    return tag;
  });
  return { html: result, blocked };
}

function rewriteCss(css, baseUrl, targetFor) {
  return String(css).replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, _quote, value) => {
    const target = absoluteUrl(value, baseUrl);
    if (!target) return match;
    const replacement = targetFor(target);
    return replacement ? `url("${replacement}")` : 'url("")';
  });
}

function rewriteLiveHtml(input, baseUrl, blockAds) {
  let html = String(input).replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?content-security-policy\1?[^>]*>/gi, '');
  let blocked = 0;
  if (blockAds) {
    const cleaned = removeAdElements(html, baseUrl);
    html = cleaned.html; blocked += cleaned.blocked;
  }
  html = html.replace(/<(img|script|link|source|video|audio|iframe)\b[^>]*>/gi, tag => {
    let remove = false;
    const rewritten = tag.replace(/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
      const target = absoluteUrl(value, baseUrl);
      if (!target) return match;
      if (blockAds && isAdUrl(target)) { remove = true; blocked += 1; return ''; }
      return `${attr}=${quote}./resource?url=${encodeURIComponent(target)}${quote}`;
    }).replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_match, quote, value) => {
      const parts = value.split(',').map(item => {
        const [raw, descriptor = ''] = item.trim().split(/\s+/, 2);
        const target = absoluteUrl(raw, baseUrl);
        if (!target || (blockAds && isAdUrl(target))) return '';
        return `./resource?url=${encodeURIComponent(target)}${descriptor ? ` ${descriptor}` : ''}`;
      }).filter(Boolean);
      return `srcset=${quote}${parts.join(', ')}${quote}`;
    });
    return remove ? '' : rewritten;
  });
  html = html.replace(/<(a|form)\b[^>]*>/gi, tag => tag.replace(/\b(href|action)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
    const target = absoluteUrl(value, baseUrl);
    return target ? `${attr}=${quote}./?url=${encodeURIComponent(target)}${quote}` : match;
  }));
  html = html.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_match, quote, css) => `style=${quote}${rewriteCss(css, baseUrl, target => blockAds && isAdUrl(target) ? '' : `./resource?url=${encodeURIComponent(target)}`)}${quote}`);
  const adStyle = blockAds ? '<style id="mybrowser-ad-filter">[class*="advert" i],[class*="ad-container" i],[id^="ad-" i],[id*="-ad-" i],[aria-label*="advert" i]{display:none!important}</style>' : '';
  html = injectIntoHead(html, `<meta name="referrer" content="no-referrer">${adStyle}`);
  return { html, blocked };
}

class RemoteManager {
  constructor({ dataDir, state, save, maxArchiveBytes, appendLog }) {
    this.dataDir = dataDir;
    this.state = state;
    this.save = save;
    this.maxArchiveBytes = maxArchiveBytes;
    this.appendLog = appendLog || (() => {});
    this.linksDir = path.join(dataDir, 'links');
    fs.mkdirSync(this.linksDir, { recursive: true });
  }

  async assertPublicUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); }
    catch { throw httpError(400, 'Zadejte platnou úplnou adresu webu'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, 'Povolené jsou pouze adresy HTTP a HTTPS');
    if (url.username || url.password) throw httpError(400, 'Adresa nesmí obsahovat přihlašovací údaje');
    if (process.env.ALLOW_PRIVATE_FETCH === '1') return url;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw httpError(403, 'Interní síťové adresy nejsou povoleny');
    let addresses;
    try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw httpError(400, 'Doménu se nepodařilo přeložit'); }
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw httpError(403, 'Adresa míří do privátní nebo lokální sítě');
    return url;
  }

  async safeFetch(value, { maximum = 20 * 1024 * 1024, accept = '*/*' } = {}) {
    let url = await this.assertPublicUrl(value);
    for (let redirect = 0; redirect <= 5; redirect++) {
      let response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          headers: { 'user-agent': 'MyBrowser/0.2 (Home Assistant offline library)', accept }
        });
      } catch (error) { throw httpError(502, `Web se nepodařilo načíst: ${error.message}`); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw httpError(502, 'Přesměrování nemá cílovou adresu');
        url = await this.assertPublicUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) throw httpError(response.status, `Vzdálený web vrátil HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maximum) throw httpError(413, 'Vzdálený soubor překračuje povolenou velikost');
      const chunks = []; let size = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > maximum) throw httpError(413, 'Vzdálený soubor překračuje povolenou velikost');
          chunks.push(chunk);
        }
      }
      return {
        url: url.href,
        status: response.status,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        body: Buffer.concat(chunks),
        cacheControl: response.headers.get('cache-control') || 'no-cache'
      };
    }
    throw httpError(508, 'Příliš mnoho přesměrování');
  }

  async refreshMetadata(id) {
    const link = this.state.links[id];
    if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
    link.metadataStatus = 'loading'; this.save();
    try {
      const page = await this.safeFetch(link.url, { maximum: 8 * 1024 * 1024, accept: 'text/html,application/xhtml+xml' });
      if (!/text\/html|application\/xhtml\+xml/i.test(page.contentType)) throw new Error('Odkaz nevede na HTML stránku');
      const html = page.body.toString('utf8');
      const title = stripTags((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
      const description = metaContent(html, 'property', 'og:description') || metaContent(html, 'name', 'description');
      const image = metaContent(html, 'property', 'og:image') || metaContent(html, 'name', 'twitter:image');
      const iconTag = (html.match(/<link\b[^>]*rel\s*=\s*(["'])[^"']*(?:icon|shortcut)[^"']*\1[^>]*>/i) || [])[0] || '';
      const icon = attributeFromTag(iconTag, 'href');
      link.resolvedUrl = page.url;
      if (link.autoTitle && title) link.name = title.slice(0, 100);
      link.description = stripTags(description).slice(0, 300);
      link.metadataStatus = 'ready';
      link.metadataUpdatedAt = new Date().toISOString();
      link.metadataError = null;
      this.save();
      const coverTarget = absoluteUrl(image || icon || '/favicon.ico', page.url);
      if (coverTarget && !isAdUrl(coverTarget)) await this.storeCover(id, coverTarget);
      return link;
    } catch (error) {
      link.metadataStatus = 'failed'; link.metadataError = error.message; link.metadataUpdatedAt = new Date().toISOString(); this.save();
      throw error;
    }
  }

  async storeCover(id, url) {
    try {
      const resource = await this.safeFetch(url, { maximum: 5 * 1024 * 1024, accept: 'image/*' });
      if (!resource.contentType.toLowerCase().startsWith('image/')) return;
      const directory = path.join(this.linksDir, id);
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, 'cover.bin');
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, resource.body);
      fs.renameSync(temp, file);
      const link = this.state.links[id];
      if (link) { link.coverMime = resource.contentType.split(';')[0]; link.coverUpdatedAt = new Date().toISOString(); this.save(); }
    } catch {}
  }

  coverFor(id) {
    const link = this.state.links[id];
    const file = path.join(this.linksDir, id, 'cover.bin');
    return link && fs.existsSync(file) ? { file, mime: link.coverMime || 'application/octet-stream' } : null;
  }

  async proxy(id, target, resource = false) {
    const link = this.state.links[id];
    if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
    return this.proxyUrl(target || link.url, resource, link.blockAds);
  }

  async proxyUrl(url, resource = false, blockAds = true) {
    if (blockAds && isAdUrl(url)) return { status: 204, contentType: 'text/plain', body: Buffer.alloc(0), html: false };
    const result = await this.safeFetch(url, { maximum: resource ? 25 * 1024 * 1024 : 10 * 1024 * 1024, accept: resource ? '*/*' : 'text/html,application/xhtml+xml' });
    const type = result.contentType.toLowerCase();
    if (type.includes('text/html') || type.includes('application/xhtml+xml')) {
      const rewritten = rewriteLiveHtml(result.body.toString('utf8'), result.url, blockAds);
      return { ...result, body: Buffer.from(rewritten.html), contentType: 'text/html; charset=utf-8', html: true, blocked: rewritten.blocked };
    }
    if (type.includes('text/css')) {
      const css = rewriteCss(result.body.toString('utf8'), result.url, item => blockAds && isAdUrl(item) ? '' : `./resource?url=${encodeURIComponent(item)}`);
      return { ...result, body: Buffer.from(css), contentType: 'text/css; charset=utf-8', html: false };
    }
    return { ...result, html: false };
  }

  startArchive(id) {
    const link = this.state.links[id];
    if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
    if ((link.archives || []).some(item => item.status === 'downloading')) throw new Error('Stažení offline verze už probíhá');
    const archive = {
      id: `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: new Date().toISOString(), status: 'downloading', url: link.url, bytes: 0, files: 0,
      blockedAds: Boolean(link.blockAds), error: null
    };
    link.archives ||= [];
    link.archives.unshift(archive);
    this.save();
    this.runArchive(id, archive).catch(error => console.error(`Offline archiv ${id}:`, error));
    return archive;
  }

  async runArchive(id, archive) {
    const link = this.state.links[id];
    const archiveRoot = path.join(this.linksDir, id, 'archives');
    const finalDirectory = path.join(archiveRoot, archive.id);
    const tempDirectory = `${finalDirectory}.downloading`;
    try {
      fs.mkdirSync(path.join(tempDirectory, 'assets'), { recursive: true });
      const page = await this.safeFetch(link.url, { maximum: Math.min(this.maxArchiveBytes, 10 * 1024 * 1024), accept: 'text/html,application/xhtml+xml' });
      if (!/text\/html|application\/xhtml\+xml/i.test(page.contentType)) throw new Error('Offline archiv podporuje HTML stránky');
      let html = page.body.toString('utf8');
      let total = page.body.length;
      let blocked = 0;
      if (link.blockAds) { const cleaned = removeAdElements(html, page.url); html = cleaned.html; blocked += cleaned.blocked; }
      const resources = new Map();
      const candidates = new Set();
      html.replace(/<(img|script|link|source|video|audio)\b[^>]*>/gi, tag => {
        for (const attr of ['src', 'href', 'poster']) {
          const target = absoluteUrl(attributeFromTag(tag, attr), page.url);
          if (target) candidates.add(target);
        }
        return tag;
      });
      html.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote, value) => { const target = absoluteUrl(value, page.url); if (target) candidates.add(target); return _match; });

      const saveResource = async (url, depth = 0) => {
        if (resources.has(url)) return resources.get(url);
        if (link.blockAds && isAdUrl(url)) { resources.set(url, ''); blocked += 1; return ''; }
        if (resources.size >= 150) return '';
        let resource;
        try { resource = await this.safeFetch(url, { maximum: Math.min(20 * 1024 * 1024, this.maxArchiveBytes - total) }); }
        catch { resources.set(url, ''); return ''; }
        if (total + resource.body.length > this.maxArchiveBytes) throw new Error('Offline verze překročila nastavený limit');
        const filename = `${crypto.createHash('sha256').update(resource.url).digest('hex').slice(0, 24)}${extensionFor(resource.url, resource.contentType)}`;
        const relative = `assets/${filename}`;
        resources.set(url, relative); resources.set(resource.url, relative);
        let body = resource.body;
        if (depth < 1 && /text\/css/i.test(resource.contentType)) {
          let css = body.toString('utf8');
          const nested = new Set();
          css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote, value) => { const target = absoluteUrl(value, resource.url); if (target) nested.add(target); return _match; });
          for (const target of nested) await saveResource(target, depth + 1);
          css = rewriteCss(css, resource.url, target => {
            const saved = resources.get(target); return saved ? path.basename(saved) : '';
          });
          body = Buffer.from(css);
        }
        total += body.length;
        fs.writeFileSync(path.join(tempDirectory, relative), body);
        return relative;
      };
      for (const candidate of [...candidates].slice(0, 150)) await saveResource(candidate);

      html = html.replace(/<(img|script|link|source|video|audio)\b[^>]*>/gi, tag => tag.replace(/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
        const target = absoluteUrl(value, page.url);
        if (!target) return match;
        const saved = resources.get(target);
        return saved ? `${attr}=${quote}${saved}${quote}` : '';
      }));
      html = html.replace(/<(a|form)\b[^>]*>/gi, tag => tag.replace(/\b(href|action)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
        const target = absoluteUrl(value, page.url);
        return target ? `${attr}=${quote}${target}${quote}` : match;
      }));
      html = rewriteCss(html, page.url, target => resources.get(target) || '');
      html = html.replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?content-security-policy\1?[^>]*>/gi, '');
      const policy = "default-src 'self' data:; img-src 'self' data:; media-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; frame-src 'none'";
      html = injectIntoHead(html, `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${link.blockAds ? '<style>[class*="advert" i],[class*="ad-container" i],[id^="ad-" i]{display:none!important}</style>' : ''}`);
      const index = Buffer.from(html);
      if (total + index.length > this.maxArchiveBytes) throw new Error('Offline verze překročila nastavený limit');
      fs.writeFileSync(path.join(tempDirectory, 'index.html'), index);
      total += index.length;
      fs.mkdirSync(archiveRoot, { recursive: true });
      fs.renameSync(tempDirectory, finalDirectory);
      archive.status = 'ready'; archive.bytes = total; archive.files = resources.size + 1; archive.blockedCount = blocked;
      archive.resolvedUrl = page.url; archive.finishedAt = new Date().toISOString();
      link.lastArchivedAt = archive.finishedAt;
      this.save();
    } catch (error) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
      archive.status = 'failed'; archive.error = error.message; archive.finishedAt = new Date().toISOString(); this.save();
      throw error;
    }
  }

  offlineFile(linkId, archiveId, relative = 'index.html') {
    const link = this.state.links[linkId];
    const archive = link?.archives?.find(item => item.id === archiveId && item.status === 'ready');
    if (!archive) throw httpError(404, 'Offline verze nebyla nalezena');
    const root = path.resolve(this.linksDir, linkId, 'archives', archiveId);
    const clean = String(relative || 'index.html').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some(part => part === '..' || part === '.')) throw httpError(400, 'Neplatná cesta');
    const file = path.resolve(root, clean);
    const relation = path.relative(root, file);
    if (relation.startsWith('..') || path.isAbsolute(relation) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError(404, 'Offline soubor nebyl nalezen');
    return file;
  }

  deleteArchive(linkId, archiveId) {
    const link = this.state.links[linkId];
    if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
    const index = (link.archives || []).findIndex(item => item.id === archiveId);
    if (index < 0) throw httpError(404, 'Offline verze nebyla nalezena');
    if (link.archives[index].status === 'downloading') throw new Error('Probíhající stažení nelze odstranit');
    const directory = path.resolve(this.linksDir, linkId, 'archives', archiveId);
    const root = path.resolve(this.linksDir, linkId, 'archives');
    if (!directory.startsWith(`${root}${path.sep}`)) throw new Error('Neplatná cesta archivu');
    fs.rmSync(directory, { recursive: true, force: true });
    link.archives.splice(index, 1); this.save();
  }

  deleteLinkData(id) {
    const directory = path.resolve(this.linksDir, id);
    const root = path.resolve(this.linksDir);
    if (!directory.startsWith(`${root}${path.sep}`)) throw new Error('Neplatná cesta odkazu');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { RemoteManager, isAdUrl, rewriteLiveHtml, rewriteCss, httpError };
