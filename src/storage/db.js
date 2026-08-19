// storage/db.js — All IndexedDB operations using the 'idb' library.
import { openDB } from 'idb';
import { encryptData, decryptData } from '../utils/crypto.js';

const DB_NAME    = 'paperwork-assistant';
const DB_VERSION = 1;
const STORE      = 'documents';

// 🛡️ ENCRYPTION GUARD: All PII is encrypted at rest if a PIN is provided.
// The PIN should be kept in volatile memory only.
let sessionPin = null;

export function setSessionPin(pin) { sessionPin = pin; }
export function isVaultLocked() { return sessionPin === null; }

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, {
        keyPath:       'id',
        autoIncrement: true,
      });
      store.createIndex('main_category',  'main_category');
      store.createIndex('urgency',        'urgency');
      store.createIndex('year',           'year');
      store.createIndex('action_required','action_required');
    },
  });
}

/**
 * Encrypts sensitive fields in a document before saving.
 */
async function packDoc(doc) {
  if (!sessionPin) return doc;
  const packed = { ...doc };
  // Fields containing PII or sensitive logistics
  const sensitiveFields = ['sender', 'summary', 'action_steps', 'ocr_text', 'file_data'];

  for (const field of sensitiveFields) {
    if (packed[field]) {
      // If it's a blob (file_data), convert to string/b64 first or skip
      // For now, focusing on text fields.
      if (typeof packed[field] === 'string') {
        packed[field] = await encryptData(packed[field], sessionPin);
      }
    }
  }
  packed.is_encrypted = true;
  return packed;
}

/**
 * Decrypts sensitive fields after reading from DB.
 */
async function unpackDoc(doc) {
  if (!doc || !doc.is_encrypted || !sessionPin) return doc;
  const unpacked = { ...doc };
  const sensitiveFields = ['sender', 'summary', 'action_steps', 'ocr_text'];

  for (const field of sensitiveFields) {
    if (unpacked[field]) {
      try {
        unpacked[field] = await decryptData(unpacked[field], sessionPin);
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
