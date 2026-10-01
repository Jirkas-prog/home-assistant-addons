import { sha256 } from '@noble/hashes/sha2.js';

// Home Assistant can be opened over local HTTP, where SubtleCrypto is absent.
export async function hashBytes(bytes) {
  const hash = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) : sha256(bytes);
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
