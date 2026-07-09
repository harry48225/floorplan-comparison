// IndexedDB-backed store for calibrated floor plans.
// Exposes window.PlanStore. Records: { id, name, blob, type, unitsPerPx,
// width, height, thumb, created, updated }. See CLAUDE.md / PHASE2 spec.
// A second "session" store holds the open workspace (see the session*
// methods): a "meta" record plus one "img:<sid>" record per open plan.
// A third "furniture" store holds the user's custom furniture items (see the
// furniture* methods): { id, name, w, h, icon, created, updated }.
window.PlanStore = (() => {
  "use strict";

  const DB = "floorplan-overlay";
  const STORE = "plans";
  const SESSION = "session"; // the open workspace, restored on next visit
  const FURNITURE = "furniture"; // user-created furniture items
  const VERSION = 3;
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
        if (!db.objectStoreNames.contains(SESSION)) {
          db.createObjectStore(SESSION, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(FURNITURE)) {
          db.createObjectStore(FURNITURE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // Run a single request inside a transaction and resolve with its result.
  function op(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = fn(db.transaction(store, mode).objectStore(store));
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
      return op(STORE, "readwrite", (s) => s.put(rec)).then(() => rec.id);
    },
    get(id) {
      return op(STORE, "readonly", (s) => s.get(id));
    },
    list() {
      return op(STORE, "readonly", (s) => s.getAll()).then((a) => a.sort((x, y) => y.created - x.created));
    },
    count() {
      return op(STORE, "readonly", (s) => s.count());
    },
    remove(id) {
      return op(STORE, "readwrite", (s) => s.delete(id));
    },

    // --- Session: the open workspace (meta + one image record per plan) ---
    sessionPut(rec) {
      return op(SESSION, "readwrite", (s) => s.put(rec)).then(() => rec.id);
    },
    sessionGet(id) {
      return op(SESSION, "readonly", (s) => s.get(id));
    },
    sessionDelete(id) {
      return op(SESSION, "readwrite", (s) => s.delete(id));
    },
    sessionAll() {
      return op(SESSION, "readonly", (s) => s.getAll());
    },

    // --- Custom furniture: user-created catalogue items ---
    furniturePut(rec) {
      return op(FURNITURE, "readwrite", (s) => s.put(rec)).then(() => rec.id);
    },
    furnitureDelete(id) {
      return op(FURNITURE, "readwrite", (s) => s.delete(id));
    },
    furnitureAll() {
      return op(FURNITURE, "readonly", (s) => s.getAll()).then((a) => a.sort((x, y) => x.created - y.created));
    },
    async rename(id, name) {
      const rec = await this.get(id);
      if (!rec) return;
      rec.name = name;
      rec.updated = Date.now();
      return this.save(rec);
    },
    // Write just a plan's layout annotations — no blob/thumb re-encode.
    async setAnnotations(id, annotations) {
      const rec = await this.get(id);
      if (!rec) return;
      rec.annotations = annotations;
      rec.updated = Date.now();
      return this.save(rec);
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
          annotations: r.annotations || null,
          created: r.created,
          updated: r.updated,
          blob: r.blob ? await blobToDataUrl(r.blob) : null,
          thumb: r.thumb ? await blobToDataUrl(r.thumb) : null,
        }))
      );
      const furniture = await this.furnitureAll();
      return { app: DB, version: VERSION, exported: Date.now(), plans, furniture };
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
          annotations: p.annotations || null,
          created: p.created || Date.now(),
          updated: Date.now(),
        });
        added++;
      }
      // Older backups have no furniture list; merge keeps original ids so
      // re-importing stays idempotent.
      let furniture = 0;
      if (Array.isArray(bundle.furniture)) {
        for (const f of bundle.furniture) {
          if (!f || !f.name || !(f.w > 0) || !(f.h > 0)) continue;
          await this.furniturePut({
            id: merge && f.id ? f.id : uuid(),
            name: f.name,
            w: f.w,
            h: f.h,
            icon: f.icon || "table",
            created: f.created || Date.now(),
            updated: Date.now(),
          });
          furniture++;
        }
      }
      return { added, skipped, furniture };
    },
  };
})();
