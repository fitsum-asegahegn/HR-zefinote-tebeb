const CACHE = "finote-attendance-v12";

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./i18n.js",
  "./auth.js",
  "./config.js",
  "./ethiopian-calendar.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

const RUNTIME_LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/docx@8/build/index.umd.js",
  "https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(APP_SHELL).then(() =>
        Promise.allSettled(RUNTIME_LIBS.map((u) => cache.add(u)))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((netResp) => {
          if (netResp && netResp.status === 200) {
            const copy = netResp.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return netResp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/* ---------- Background Sync (best-effort) ----------
   Progressive enhancement only: works on Chromium/Android when the tag is
   registered from app.js after an offline scan. Not supported on iOS
   Safari — the existing `online` event listener in auth.js is the
   reliable fallback used whenever the app itself is open. */
const SW_DB_NAME = "finote_attendance";
function swOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_DB_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
function swGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function swPut(db, store, val) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(val);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function swSettingsMap(db) {
  const rows = await swGetAll(db, "settings");
  const m = {};
  rows.forEach((r) => (m[r.key] = r.value));
  return m;
}

async function backgroundSyncAttendance() {
  try {
    const db = await swOpenDB();
    const settings = await swSettingsMap(db);
    const url = settings.sbUrlMirror, key = settings.sbKeyMirror, token = settings.sbAccessTokenMirror;
    if (!url || !key || !token) return;

    const attendance = await swGetAll(db, "attendance");
    const pending = attendance.filter((a) => !a.synced);
    if (pending.length) {
      const body = pending.map((a) => ({
        id: a.id, member_id: a.memberId, program_key: a.programKey, session_date: a.sessionDate,
        ts: a.timestamp, status: a.status, device_id: a.deviceId,
      }));
      const resp = await fetch(url + "/rest/v1/attendance?on_conflict=member_id,session_date,program_key", {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        for (const a of pending) { a.synced = true; await swPut(db, "attendance", a); }
      }
    }
  } catch (e) {
    // best-effort; the app's own online-event sync will retry when it's next opened
  }
}

self.addEventListener("sync", (e) => {
  if (e.tag === "sync-attendance") {
    e.waitUntil(backgroundSyncAttendance());
  }
});
