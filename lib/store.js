// IndexedDB расширения (общая для service worker, offscreen-документа и страниц расширения):
//  shots   — временно хранит готовые скриншоты;
//  handles — доступы к папке сохранения и к последнему сохранённому файлу.

const DB_NAME = 'webscreen';
const SHOTS = 'shots';
const HANDLES = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHOTS)) db.createObjectStore(SHOTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let result;
    const req = fn(tx.objectStore(name));
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export const putShot = (shot) => withStore(SHOTS, 'readwrite', (s) => s.put(shot));
export const getShot = (id) => withStore(SHOTS, 'readonly', (s) => s.get(id));
export const deleteShot = (id) => withStore(SHOTS, 'readwrite', (s) => s.delete(id));

export function cleanupShots(maxAge) {
  const border = Date.now() - maxAge;
  return withStore(SHOTS, 'readwrite', (s) => {
    s.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (cursor.value.created < border) cursor.delete();
      cursor.continue();
    };
  });
}

export const getHandle = (key) => withStore(HANDLES, 'readonly', (s) => s.get(key));
export const setHandle = (key, handle) => withStore(HANDLES, 'readwrite', (s) => s.put(handle, key));
export const deleteHandle = (key) => withStore(HANDLES, 'readwrite', (s) => s.delete(key));
