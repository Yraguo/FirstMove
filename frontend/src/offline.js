const DB_NAME = "efficiency_workbench_offline_v1";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "uid" });
      }
      if (!db.objectStoreNames.contains("files")) {
        const s = db.createObjectStore("files", { keyPath: "key" });
        s.createIndex("by_uid", "uid", { unique: false });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const s = db.createObjectStore("outbox", { keyPath: "id" });
        s.createIndex("by_uid", "uid", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txRun(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || (req && req.error));
  });
}

export const offlineDB = {
  async saveSnapshot(uid, etag, data) {
    const db = await openDB();
    await txRun(db, "snapshots", "readwrite", (s) =>
      s.put({ uid, etag, data, savedAt: Date.now() })
    );
    localStorage.setItem("workbench_last_uid", uid);
  },

  async loadSnapshot(uid) {
    const target = uid || localStorage.getItem("workbench_last_uid");
    if (!target) return null;
    const db = await openDB();
    return txRun(db, "snapshots", "readonly", (s) => s.get(target));
  },

  async saveLocalFile(uid, aid, name, size, blob) {
    const db = await openDB();
    await txRun(db, "files", "readwrite", (s) =>
      s.put({ key: `${uid}:${aid}`, uid, aid, name, size, blob, savedAt: Date.now() })
    );
  },

  async getLocalFile(uid, aid) {
    const db = await openDB();
    return txRun(db, "files", "readonly", (s) => s.get(`${uid}:${aid}`));
  },

  async listLocalFiles(uid) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const idx = tx.objectStore("files").index("by_uid");
      const req = idx.getAll(uid);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteLocalFile(uid, aid) {
    const db = await openDB();
    await txRun(db, "files", "readwrite", (s) => s.delete(`${uid}:${aid}`));
  },

  async pruneInaccessibleFiles(uid, validFileIds) {
    const all = await this.listLocalFiles(uid);
    const keep = new Set(validFileIds);
    for (const item of all) {
      if (!keep.has(item.aid)) {
        await this.deleteLocalFile(uid, item.aid);
      }
    }
  },

  async enqueue(item) {
    const db = await openDB();
    await txRun(db, "outbox", "readwrite", (s) =>
      s.put({ ...item, createdAt: item.createdAt || Date.now() })
    );
  },

  async listOutbox(uid) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("outbox", "readonly");
      const idx = tx.objectStore("outbox").index("by_uid");
      const req = idx.getAll(uid);
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => a.createdAt - b.createdAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async removeOutbox(id) {
    const db = await openDB();
    await txRun(db, "outbox", "readwrite", (s) => s.delete(id));
  }
};
