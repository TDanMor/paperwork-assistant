/**
 * Utilities for AES-GCM encryption/decryption using the Web Crypto API.
 * Hardened for Phase 5 based on security audit.
 */

const ITERATIONS = 600000; // NIST SP 800-63B Recommendation
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Derives an AES-GCM key from a PIN and salt.
 * This should be called ONCE at session start.
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
 * Encrypts a string using a pre-derived CryptoKey.
 * Generates a UNIQUE IV for every call (Critical for AES-GCM).
 */
export async function encryptData(text, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const enc = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    enc.encode(text)
  );

  // Output: [iv (12 bytes)][ciphertext (variable)]
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode.apply(null, combined));
}

/**
 * Decrypts a base64 string using a pre-derived CryptoKey.
 */
export async function decryptData(combinedB64, cryptoKey) {
  try {
    const combined = new Uint8Array(atob(combinedB64).split("").map(c => c.charCodeAt(0)));

    // Check if this uses the old "Embedded Salt" format (Legacy Phase 4)
    // Legacy: [salt (16)][iv (12)][ciphertext]
    // New: [iv (12)][ciphertext]

    let iv, ciphertext;

    if (combined.length > (SALT_SIZE + IV_SIZE)) {
        // This is a heuristic guess, if we use a Master Salt, the combined length is usually smaller
        // but it's safer to just handle the IV offset.
    }

    // New format (Phase 5+)
    iv = combined.slice(0, IV_SIZE);
    ciphertext = combined.slice(IV_SIZE);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed:", e);
    throw new Error("Decryption failed. Incorrect key or corrupted data.");
  }
}

/**
 * Legacy Decryptor for Phase 4 data (if salt is embedded in string)
 */
export async function legacyDecrypt(combinedB64, pin) {
    const combined = new Uint8Array(atob(combinedB64).split("").map(c => c.charCodeAt(0)));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);

    const key = await deriveKeyFromPin(pin, salt); // This uses the 600k iterations now
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
}
