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

  // Blob <-> data URL, so image bytes survive a round-trip through JSON.
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  const dataUrlToBlob = (url) => fetch(url).then((r) => r.blob());

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

    // --- Backup: whole-library export / restore as a self-contained JSON bundle ---
    async exportAll() {
      const recs = await this.list();
      const plans = await Promise.all(
        recs.map(async (r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          unitsPerPx: r.unitsPerPx,
          width: r.width,
          height: r.height,
          calibLine: r.calibLine || null,
          created: r.created,
          updated: r.updated,
          blob: r.blob ? await blobToDataUrl(r.blob) : null,
          thumb: r.thumb ? await blobToDataUrl(r.thumb) : null,
        }))
      );
      return { app: DB, version: VERSION, exported: Date.now(), plans };
    },
    // merge=true (restore): keep original ids and overwrite matches, so
    // re-importing the same backup is idempotent. merge=false: add as new.
    async importAll(bundle, { merge = true } = {}) {
      if (!bundle || bundle.app !== DB || !Array.isArray(bundle.plans)) {
        throw new Error("Not a Floor Plan Overlay backup file.");
      }
      let added = 0;
      let skipped = 0;
      for (const p of bundle.plans) {
        if (!p || !p.blob) {
          skipped++;
          continue;
        }
        await this.save({
          id: merge && p.id ? p.id : uuid(),
          name: p.name || "Untitled",
          blob: await dataUrlToBlob(p.blob),
          type: p.type || "image/jpeg",
          unitsPerPx: p.unitsPerPx,
          width: p.width,
          height: p.height,
          thumb: p.thumb ? await dataUrlToBlob(p.thumb) : null,
          calibLine: p.calibLine || null,
          created: p.created || Date.now(),
          updated: Date.now(),
        });
        added++;
      }
      return { added, skipped };
    },
  };
})();
