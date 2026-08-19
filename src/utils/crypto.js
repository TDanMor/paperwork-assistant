/**
 * Utilities for AES-GCM encryption/decryption using the Web Crypto API.
 */

const ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Derives an AES-GCM key from a PIN and salt.
 */
async function deriveKey(pin, salt) {
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
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a string using a PIN.
 * Returns a base64 encoded string containing [salt][iv][ciphertext].
 */
export async function encryptData(text, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const key = await deriveKey(pin, salt);

  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    enc.encode(text)
  );

  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return btoa(String.fromCharCode.apply(null, combined));
}

/**
 * Decrypts a base64 string using a PIN.
 */
export async function decryptData(combinedB64, pin) {
  try {
    const combined = new Uint8Array(atob(combinedB64).split("").map(c => c.charCodeAt(0)));
    const salt = combined.slice(0, SALT_SIZE);
    const iv = combined.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const ciphertext = combined.slice(SALT_SIZE + IV_SIZE);

    const key = await deriveKey(pin, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed:", e);
    throw new Error("Incorrect PIN or corrupted data.");
  }
}
