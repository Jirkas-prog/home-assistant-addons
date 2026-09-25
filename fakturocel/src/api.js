import { nativeClient, client, bridge } from './client-sync.js';
import { bytesBase64, base64Bytes } from './model.js';
export const base = new URL('./', location.href);
export let session = {};
export async function api(route, data) {
  if (nativeClient) {
    try {
      return await client.route(route, data);
    } catch (e) {
      if (e.status === 423) window.dispatchEvent(new Event("Fakturocel-locked"));
      throw e;
    }
  }
  let res;
  try {
    res = await fetch(new URL('api/' + route, base), {
      method: data ? 'POST' : 'GET',
      cache: 'no-store',
      headers: data ? {
        'Content-Type': 'application/json',
        "X-Fakturocel-Token": session.csrf || ''
      } : {},
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(180000)
    });
  } catch {
    throw Error("The server is not available. The edits are not yet confirmed as saved.");
  }
  let result;
  try {
    result = await res.json();
  } catch {
    throw Error("The server did not return the data. Verify login to Home Assistant.");
  }
  if (res.status === 423) window.dispatchEvent(new Event("Fakturocel-locked"));
  if (!res.ok) throw Object.assign(Error(result.error || 'Operace selhala.'), {
    status: res.status
  });
  return result;
}
export async function loadState() {
  session = await api('state');
  return session;
}
export async function loadAsset(name) {
  if (nativeClient && /^[a-f\d]{64}$/.test(name)) {
    client.require();
    const b = client.cache?.snapshot?.blobs?.[name];
    if (!b) throw Error("Attachment missing in local data. Restore a full backup.");
    return base64Bytes(b.base64);
  }
  const url = /^[a-f\d]{64}$/.test(name) ? new URL('api/blob/' + name, base) : new URL(name, base);
  const r = await fetch(url, {
    cache: 'no-store'
  });
  if (!r.ok) throw Error("Failed to load resource: " + name);
  return new Uint8Array(await r.arrayBuffer());
}
export function downloadBytes(bytes, name, mime = 'application/octet-stream') {
  if (nativeClient) return bridge.call('export', {
    name,
    base64: bytesBase64(bytes)
  });
  const url = URL.createObjectURL(new Blob([bytes], {
      type: mime
    })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadBackup(route = 'backup', name = "Fakturocel.fakturocel") {
  if (nativeClient) {
    const text = await (await import('./client-ui.js')).backupText();
    if (!(await downloadBytes(new TextEncoder().encode(text), name))) throw Error("The backup was not saved.");
    return text;
  }
  const r = await fetch(new URL('api/' + route, base), {
    cache: 'no-store'
  });
  if (!r.ok) throw Error("Failed to download backup.");
  const text = await r.text();
  await downloadBytes(new TextEncoder().encode(text), name);
  return text;
}
export async function upload(file) {
  let mime = file.type;
  if (/\.ttf$/i.test(file.name)) mime = 'font/ttf';
  if (/\.otf$/i.test(file.name)) mime = 'font/otf';
  if (/\.pdf$/i.test(file.name)) mime = 'application/pdf';
  return api('upload', {
    name: file.name,
    mime,
    base64: bytesBase64(new Uint8Array(await file.arrayBuffer()))
  });
}
export function pickFile(accept) {
  return new Promise(resolve => {
    const e = document.createElement('input');
    e.type = 'file';
    e.accept = accept;
    e.hidden = true;
    document.body.append(e);
    e.onchange = () => {
      const f = e.files[0] || null;
      e.remove();
      resolve(f);
    };
    e.oncancel = () => {
      e.remove();
      resolve(null);
    };
    e.click();
  });
}
export async function loadSecurity() {
  const result = await api('security');
  session = {
    ...session,
    ...result
  };
  return result;
}
export async function downloadRecovery(ticket) {
  if (nativeClient) {
    const {
      clientKeyPdf
    } = await import('./client-backup.js');
    return client.run(async () => {
      client.require();
      if (!(await downloadBytes(await clientKeyPdf(client.cache.exportContext, loadAsset), "Fakturocel-recovery-key.pdf", 'application/pdf'))) throw Error("PDF with key not saved.");
    });
  }
  const r = await fetch(new URL('api/security/recovery.pdf' + (ticket ? '?ticket=' + encodeURIComponent(ticket) : ''), base), {
    cache: 'no-store'
  });
  if (!r.ok) {
    if (r.status === 423) window.dispatchEvent(new Event("Fakturocel-locked"));
    const e = await r.json();
    throw Error(e.error || "PDF with key failed to download.");
  }
  const name = /Fakturocel-recovery-key-[A-F0-9]{16}\.pdf/.exec(r.headers.get('content-disposition') || '')?.[0] || "Fakturocel-recovery-key.pdf";
  await downloadBytes(new Uint8Array(await r.arrayBuffer()), name, 'application/pdf');
}
export async function exportExcel(password) {
  if (nativeClient) return (await import('./local-excel.js')).localExcel(client);
  const r = await fetch(new URL('api/export/excel', base), {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      "X-Fakturocel-Token": session.csrf || ''
    },
    body: JSON.stringify({
      password
    })
  });
  if (!r.ok) {
    const e = await r.json();
    if (r.status === 423) window.dispatchEvent(new Event("Fakturocel-locked"));
    throw Error(e.error || "Export failed.");
  }
  return new Uint8Array(await r.arrayBuffer());
}
const blobUrls = new Map();
export function assetUrl(hash) {
  if (!nativeClient) return new URL('api/blob/' + hash, base).href;
  if (!blobUrls.has(hash)) {
    const b = client.cache?.snapshot?.blobs?.[hash];
    if (!b) return '';
    blobUrls.set(hash, URL.createObjectURL(new Blob([base64Bytes(b.base64)], {
      type: b.mime
    })));
  }
  return blobUrls.get(hash);
}
