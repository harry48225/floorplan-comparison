// IndexedDB-backed store for calibrated floor plans.
// Exposes window.PlanStore. Records: { id, name, blob, type, unitsPerPx,
// width, height, thumb, created, updated }. See CLAUDE.md / PHASE2 spec.
window.PlanStore = (() => {
  "use strict";

  const DB = "floorplan-overlay";
  const STORE = "plans";
  const VERSION = 1;
  let dbPromise = null;

  function available() {
    try {
      return typeof indexedDB !== "undefined" && indexedDB !== null;
    } catch (_) {
      return false;
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("created", "created");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // Run a single request inside a transaction and resolve with its result.
  function op(mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  const uuid = () =>
    crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);

  return {
    available,
    uuid,
    save(rec) {
      return op("readwrite", (s) => s.put(rec)).then(() => rec.id);
    },
    get(id) {
      return op("readonly", (s) => s.get(id));
    },
    list() {
      return op("readonly", (s) => s.getAll()).then((a) => a.sort((x, y) => y.created - x.created));
    },
    remove(id) {
      return op("readwrite", (s) => s.delete(id));
    },
    async rename(id, name) {
      const rec = await this.get(id);
      if (!rec) return;
      rec.name = name;
      rec.updated = Date.now();
      return this.save(rec);
    },
    estimate() {
      return navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate()
        : Promise.resolve({ usage: 0, quota: 0 });
    },
    requestPersist() {
      return navigator.storage && navigator.storage.persist
        ? navigator.storage.persist()
        : Promise.resolve(false);
    },
    persisted() {
      return navigator.storage && navigator.storage.persisted
        ? navigator.storage.persisted()
        : Promise.resolve(false);
    },

    // --- Designed for a later phase, not wired into the UI yet ---
    // exportAll(): bundle records to a downloadable JSON (blobs -> data URLs).
    // importAll(file, {merge}): parse such a file and save() each record.
  };
})();
