// Only primitives used by the pinned Office Agile encryptor; no key exchange or legacy Office decryption.
import { Buffer } from 'buffer';
import aes from 'browserify-aes';
import { sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
const algorithm = name => {
  if (name.toLowerCase() !== 'sha512') throw Error("Unsupported Excel footprint.");
  return sha512;
};
export function createHash(name) {
  const hash = algorithm(name).create();
  return {
    update(bytes) {
      hash.update(bytes);
      return this;
    },
    digest() {
      return Buffer.from(hash.digest());
    }
  };
}
export function createHmac(name, key) {
  const value = hmac.create(algorithm(name), key);
  return {
    update(bytes) {
      value.update(bytes);
      return this;
    },
    digest() {
      return Buffer.from(value.digest());
    }
  };
}
export const getHashes = () => ['sha512'];
export const randomBytes = n => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export const createCipheriv = (algorithm, key, iv) => {
  if (algorithm !== 'aes-256-cbc') throw Error("Unsupported Excel cipher.");
  return aes.createCipheriv(algorithm, key, iv);
};
export const createDecipheriv = () => {
  throw Error("This part of the application just encrypts Excel.");
};
