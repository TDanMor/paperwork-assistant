import { openDB } from 'idb';
import { encryptData, decryptData, decryptToBytes } from '../utils/crypto.js';

const DB_NAME    = 'paperwork-assistant';
const DB_VERSION = 2;
const STORE      = 'documents';
const META_STORE = 'vault_meta';

let sessionKey = null;

export function setSessionKey(key) { sessionKey = key; }
export function isVaultLocked() { return sessionKey === null; }

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      console.log(`Upgrading database from ${oldVersion} to ${DB_VERSION}`);
      if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath:       'id',
            autoIncrement: true,
          });
          store.createIndex('urgency', 'urgency');
          store.createIndex('year',    'year');
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
      }
    },
  });
}

export async function getVaultSalt() {
  try {
    const db = await getDB();
    let salt = await db.get(META_STORE, 'master_salt');
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      await db.put(META_STORE, salt, 'master_salt');
    }
    return salt;
  } catch (e) {
    console.error("Master salt retrieval failed:", e);
    throw new Error("Vault initialization failed. Your browser database might be corrupted.");
  }
}

/**
 * Checks if a PIN is correct by attempting to decrypt a canary.
 */
export async function verifyVaultPIN(cryptoKey) {
    const db = await getDB();
    const canary = await db.get(META_STORE, 'pin_canary');
    if (!canary) {
        // First run: Create canary
        const encrypted = await encryptData("VERIFIED", cryptoKey);
        await db.put(META_STORE, encrypted, 'pin_canary');
        return true;
    }
    try {
        const decrypted = await decryptData(canary, cryptoKey);
        return decrypted === "VERIFIED";
    } catch (e) {
        return false;
    }
}

async function packDoc(doc) {
  if (!sessionKey) return doc;
  const packed = { ...doc };

  // Encrypt EVERYTHING except id and is_encrypted
  const fields = ['sender', 'summary', 'action_steps', 'ocr_text', 'document_type', 'main_category', 'sub_category', 'action_required', 'dates', 'money', 'file_data'];

  for (const f of fields) {
    if (packed[f]) {
      if (f === 'file_data' && packed[f] instanceof Blob) {
          const buffer = await packed[f].arrayBuffer();
          packed[f] = await encryptData(buffer, sessionKey);
      } else if (typeof packed[f] === 'object') {
          packed[f] = await encryptData(JSON.stringify(packed[f]), sessionKey);
      } else if (typeof packed[f] === 'string') {
          packed[f] = await encryptData(packed[f], sessionKey);
      }
    }
  }
  packed.is_encrypted = true;
  return packed;
}

async function unpackDoc(doc) {
  if (!doc || !doc.is_encrypted || !sessionKey) return doc;
  const unpacked = { ...doc };
  const fields = ['sender', 'summary', 'action_steps', 'ocr_text', 'document_type', 'main_category', 'sub_category', 'action_required', 'dates', 'money', 'file_data'];

  for (const f of fields) {
    if (unpacked[f] && typeof unpacked[f] === 'string' && unpacked[f].startsWith('v2:')) {
      try {
        if (f === 'file_data') {
            const bytes = await decryptToBytes(unpacked[f], sessionKey);
            unpacked[f] = new Blob([bytes]);
        } else if (f === 'dates' || f === 'money') {
            const json = await decryptData(unpacked[f], sessionKey);
            unpacked[f] = JSON.parse(json);
        } else {
            unpacked[f] = await decryptData(unpacked[f], sessionKey);
        }
      } catch (e) {
        unpacked[f] = f === 'file_data' ? null : '[LOCKED]';
      }
    }
  }
  return unpacked;
}

export async function saveDocument(doc) {
  const db = await getDB();
  const packed = await packDoc(doc);
  const id = await db.add(STORE, packed);
  return { ...doc, id };
}

export async function updateDocument(doc) {
  const db = await getDB();
  const packed = await packDoc(doc);
  await db.put(STORE, packed);
  return doc;
}

export async function getAllDocuments() {
  const db  = await getDB();
  const all = await db.getAll(STORE);
  const unpacked = await Promise.all(all.map(unpackDoc));
  return unpacked.reverse();
}

export async function getDocumentById(id) {
  const db = await getDB();
  const doc = await db.get(STORE, id);
  return unpackDoc(doc);
}

export async function deleteDocument(id) {
  const db = await getDB();
  return db.delete(STORE, id);
}

export async function clearAllDocuments() {
  const db = await getDB();
  return db.clear(STORE);
}
