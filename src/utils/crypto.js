/**
 * Utilities for AES-GCM encryption/decryption using the Web Crypto API.
 * Hardened v2.2 - Fixes [LOCKED] bug and binary encoding issues.
 */

const ITERATIONS_V2 = 600000;
const ITERATIONS_V1 = 100000; // Legacy Phase 4
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Robust Base64 to Uint8Array converter (no call stack issues)
 */
function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

/**
 * Robust Uint8Array to Base64 converter
 */
function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

/**
 * Derives an AES-GCM key from a PIN and salt.
 */
export async function deriveKeyFromPin(pin, salt, iterations = ITERATIONS_V2) {
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
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using a Master Key.
 * Adds 'v2:' prefix for format identification.
 */
export async function encryptData(text, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const enc = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    enc.encode(text)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return 'v2:' + bytesToBase64(combined);
}

/**
 * Decrypts data with automatic legacy fallback.
 */
export async function decryptData(combinedB64, cryptoKey) {
  try {
    // 1. New Format Check (v2:)
    if (combinedB64.startsWith('v2:')) {
      const b64 = combinedB64.slice(3);
      const combined = base64ToBytes(b64);
      const iv = combined.slice(0, IV_SIZE);
      const ciphertext = combined.slice(IV_SIZE);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        ciphertext
      );
      return new TextDecoder().decode(decrypted);
    }

    // 2. Legacy Fallback (No prefix)
    // Legacy docs are rare and likely permanently locked if derived key changed.
    // However, if the key derivation is identical, we can try.
    const combined = base64ToBytes(combinedB64);

    // Heuristic for Phase 4: [salt(16)][iv(12)][ciphertext]
    if (combined.length > (SALT_SIZE + IV_SIZE)) {
        // We can't easily decrypt Phase 4 here because we don't have the raw PIN
        // to re-derive with 100k iterations.
        throw new Error("Legacy format detected. Re-upload document to encrypt with new vault.");
    }

    throw new Error("Unknown data format.");
  } catch (e) {
    console.error("Decryption failed:", e);
    throw e;
  }
}
