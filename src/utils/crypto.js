/**
 * Utilities for AES-GCM encryption/decryption using the Web Crypto API.
 * Hardened v2.3 - Implements full binary safety and format detection.
 */

const ITERATIONS_V2 = 600000;
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Robust Base64 to Uint8Array converter.
 */
export function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

/**
 * Robust Uint8Array to Base64 converter.
 */
export function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

/**
 * Derives an AES-GCM key from a PIN and salt.
 */
export async function deriveKeyFromPin(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS_V2,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // Must be extractable to survive page refreshes in sessionStorage
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data (string or ArrayBuffer) using a Master Key.
 * Adds 'v2:' prefix for format identification.
 */
export async function encryptData(data, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    bytes
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return 'v2:' + bytesToBase64(combined);
}

/**
 * Decrypts data into a Uint8Array.
 */
export async function decryptToBytes(combinedB64, cryptoKey) {
  if (!combinedB64.startsWith('v2:')) {
    throw new Error("Unsupported or legacy data format.");
  }

  const b64 = combinedB64.slice(3);
  const combined = base64ToBytes(b64);
  const iv = combined.slice(0, IV_SIZE);
  const ciphertext = combined.slice(IV_SIZE);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    ciphertext
  );

  return new Uint8Array(decrypted);
}

/**
 * Decrypts data into a String.
 */
export async function decryptData(combinedB64, cryptoKey) {
  const bytes = await decryptToBytes(combinedB64, cryptoKey);
  return new TextDecoder().decode(bytes);
}
