// storage/db.js — All IndexedDB operations using the 'idb' library.
import { openDB } from 'idb';

const DB_NAME    = 'paperwork-assistant';
const DB_VERSION = 1;
const STORE      = 'documents';

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

export async function saveDocument(doc) {
  const db = await getDB();
  const id = await db.add(STORE, doc);
  return { ...doc, id };
}

export async function updateDocument(doc) {
  const db = await getDB();
  await db.put(STORE, doc);
  return doc;
}

export async function getAllDocuments() {
  const db  = await getDB();
  const all = await db.getAll(STORE);
  return all.reverse();
}

export async function getDocumentById(id) {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function deleteDocument(id) {
  const db = await getDB();
  return db.delete(STORE, id);
}

export async function clearAllDocuments() {
  const db = await getDB();
  return db.clear(STORE);
}
