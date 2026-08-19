import { openDB } from 'idb';
import { encryptData, decryptData } from '../utils/crypto.js';

const DB_NAME    = 'paperwork-assistant';
const DB_VERSION = 2; // Incremented for new meta store
const STORE      = 'documents';
const META_STORE = 'vault_meta';

// 🛡️ ENCRYPTION GUARD: The CryptoKey stays in memory ONLY.
let sessionKey = null;

export function setSessionKey(key) { sessionKey = key; }
export function isVaultLocked() { return sessionKey === null; }

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, {
            keyPath:       'id',
            autoIncrement: true,
          });
          store.createIndex('main_category',  'main_category');
          store.createIndex('urgency',        'urgency');
          store.createIndex('year',           'year');
          store.createIndex('action_required','action_required');
      }
      if (oldVersion < 2) {
          // Store for the master salt
          db.createObjectStore(META_STORE);
      }
    },
  });
}

/**
 * Retrieves or generates the Master Salt for the vault.
 */
export async function getVaultSalt() {
  const db = await getDB();
  let salt = await db.get(META_STORE, 'master_salt');

  if (!salt) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    await db.put(META_STORE, salt, 'master_salt');
  }
  return salt;
}

async function packDoc(doc) {
  if (!sessionKey) return doc;
  const packed = { ...doc };
  const sensitiveFields = ['sender', 'summary', 'action_steps', 'ocr_text'];

  for (const field of sensitiveFields) {
    if (packed[field] && typeof packed[field] === 'string') {
        packed[field] = await encryptData(packed[field], sessionKey);
    }
  }
  packed.is_encrypted = true;
  return packed;
}

async function unpackDoc(doc) {
  if (!doc || !doc.is_encrypted || !sessionKey) return doc;
  const unpacked = { ...doc };
  const sensitiveFields = ['sender', 'summary', 'action_steps', 'ocr_text'];

  for (const field of sensitiveFields) {
    if (unpacked[field]) {
      try {
        unpacked[field] = await decryptData(unpacked[field], sessionKey);
      } catch (e) {
        unpacked[field] = '[LOCKED]';
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
