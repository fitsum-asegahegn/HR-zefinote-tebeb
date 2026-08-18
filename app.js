/* ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)
   Offline-first via IndexedDB. Supabase is optional for multi-device sync + auth. */

// ---------- Constants ----------
const DB_NAME = "finote_attendance";
const DB_VERSION = 1;
function PROGRAM_DEFS() {
  return [
    { key: "timhert", name: getLang() === "am" ? "ትምህርት (Course)" : "Course (ትምህርት)" },
    { key: "mezmur", name: getLang() === "am" ? "ዝማሬ (Mezmur)" : "Mezmur (ዝማሬ)" },
    { key: "tselot", name: getLang() === "am" ? "ጸሎት (Tselot)" : "Tselot (ጸሎት)" },
  ];
}
const DEFAULT_SETTINGS = {
  defaultStartTime: "10:00",
  graceMinutes: 30,
  confessionIntervalMonths: 12,
  absenceThreshold: 3,
  deviceName: "",
  lastPulledAt: "",
};

let db;
let currentTab = "dashboard";
let appState = "boot"; // boot | setup | auth | offline-no-session | app
let scanState = { streaming: false, stream: null, program: "timhert", recentHits: new Map(), batch: [] };

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("members")) {
        const s = d.createObjectStore("members", { keyPath: "id" });
        s.createIndex("qrId", "qrId", { unique: true });
        s.createIndex("fullName", "fullName", { unique: false });
      }
      if (!d.objectStoreNames.contains("attendance")) {
        const s = d.createObjectStore("attendance", { keyPath: "id" });
        s.createIndex("memberDateProgram", ["memberId", "sessionDate", "programKey"], { unique: true });
        s.createIndex("sessionDate", "sessionDate", { unique: false });
        s.createIndex("synced", "synced", { unique: false });
      }
      if (!d.objectStoreNames.contains("settings")) {
        d.createObjectStore("settings", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("programs")) {
        d.createObjectStore("programs", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("hrEvents")) {
        d.createObjectStore("hrEvents", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
function tx(store, mode = "readonly") { return db.transaction(store, mode).objectStore(store); }
function reqp(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function getAll(store) { return reqp(tx(store).getAll()); }
async function put(store, val) { return reqp(tx(store, "readwrite").put(val)); }
async function del(store, key) { return reqp(tx(store, "readwrite").delete(key)); }
async function get(store, key) { return reqp(tx(store).get(key)); }

function uid() { return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10); }
function shortId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- Settings ----------
async function getSettings() {
  const rows = await getAll("settings");
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => (s[r.key] = r.value));
  return s;
}
async function setSetting(key, value) { await put("settings", { key, value }); }
async function ensureDeviceId() {
  const existing = await get("settings", "deviceId");
  if (!existing) await setSetting("deviceId", "dev-" + shortId());
}
async function ensurePrograms() {
  for (const p of PROGRAM_DEFS()) {
    const existing = await get("programs", p.key);
    if (!existing) await put("programs", { key: p.key, name: p.name, startTime: "", graceMinutes: "" });
  }
}
async function ensureHrEvents() {
  const existing = await getAll("hrEvents");
  if (existing.length) return;
  const today = new Date();
  const defaults = [
    { titleKey: "hr.monthlyMeeting", recurrenceDays: 30 },
    { titleKey: "hr.agapeDay", recurrenceDays: 182 },
    { titleKey: "hr.spiritualTrip", recurrenceDays: 365 },
    { titleKey: "hr.recognition", recurrenceDays: 365 },
    { titleKey: "hr.celebrationCheckin", recurrenceDays: 0 },
  ];
  for (const d of defaults) {
    const next = d.recurrenceDays > 0 ? addDays(today, 14) : null;
    await put("hrEvents", { id: uid(), titleKey: d.titleKey, recurrenceDays: d.recurrenceDays, nextDate: next ? isoDate(next) : null, lastDone: null });
  }
}
const HR_EVENT_LABELS = {
  am: {
    "hr.monthlyMeeting": ["ወርሃዊ የክፍል ስብሰባና የልምድ ልውውጥ", "አራቱም ንዑስ ክፍላት ተሰብስበው ይመካከራሉ"],
    "hr.agapeDay": ["የክፍል ውስጥ አጋፔ / ግንኙነት ቀን", "ለክፍሉ አባላት ብቻ"],
    "hr.spiritualTrip": ["የክፍል ውስጥ መንፈሳዊ ጉዞ", "በክረምት"],
    "hr.recognition": ["የውስጥ እውቅናና ማበረታቻ", "ለታታሪ አባላት"],
    "hr.celebrationCheckin": ["የክፍል ውስጥ ደስታ/ሐዘን መጠያየቅ", "እንደአጋጣሚው — በእጅ ብቻ ይታወሳል"],
  },
  en: {
    "hr.monthlyMeeting": ["Monthly team meeting & experience sharing", "All 4 sub-units gather to discuss"],
    "hr.agapeDay": ["Internal agape / connection day", "For department members only"],
    "hr.spiritualTrip": ["Internal spiritual trip", "During summer break"],
    "hr.recognition": ["Internal recognition & appreciation", "For members who served diligently"],
    "hr.celebrationCheckin": ["Internal celebration/condolence check-ins", "As needed — tracked manually"],
  },
};
function hrLabel(titleKey) {
  const lang = getLang();
  return (HR_EVENT_LABELS[lang] && HR_EVENT_LABELS[lang][titleKey]) || HR_EVENT_LABELS.am[titleKey] || [titleKey, ""];
}

// ---------- Date helpers ----------
function isoDate(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function todayISO() { return isoDate(new Date()); }
function fmtDT(iso) { const d = new Date(iso); return d.toLocaleString(getLang() === "en" ? "en-GB" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

// ---------- Members ----------
async function importMembersFromWorkbook(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  let count = 0;
  const existingList = await getAll("members");
  for (const row of rows) {
    const name = pick(row, ["ሙሉ ስም", "ስም", "Name", "Full Name", "name"]);
    if (!name) continue;
    const phone = pick(row, ["ስልክ", "ስልክ ቁጥር", "Phone", "phone"]);
    const category = pick(row, ["ምድብ", "ክፍል", "Category", "category"]) || "";
    const confDate = pick(row, ["ንስሃ ቀን", "የመጨረሻ ንስሃ", "Last Confession", "lastConfession"]);
    let member = existingList.find((m) => m.fullName.trim() === String(name).trim());
    if (!member) {
      member = {
        id: uid(), qrId: "FTW1|" + shortId(), fullName: String(name).trim(),
        phone: phone ? String(phone).trim() : "", category: String(category).trim(),
        lastConfessionDate: parseMaybeDate(confDate), joinDate: todayISO(), active: true, synced: false,
      };
      existingList.push(member);
    } else {
      member.phone = phone ? String(phone).trim() : member.phone;
      member.category = category ? String(category).trim() : member.category;
      if (confDate) member.lastConfessionDate = parseMaybeDate(confDate);
      member.synced = false;
    }
    await put("members", member);
    count++;
  }
  return count;
}
function pick(row, keys) { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return ""; }
function parseMaybeDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isoDate(v);
  const d = new Date(String(v).trim());
  return !isNaN(d.getTime()) ? isoDate(d) : null;
}
async function addMemberManual(fullName, phone, category) {
  const member = { id: uid(), qrId: "FTW1|" + shortId(), fullName: fullName.trim(), phone: (phone || "").trim(), category: (category || "").trim(), lastConfessionDate: null, joinDate: todayISO(), active: true, synced: false };
  await put("members", member);
  return member;
}

// ---------- Attendance logic ----------
async function getProgramConfig(programKey) {
  const p = await get("programs", programKey);
  const s = await getSettings();
  return {
    startTime: (p && p.startTime) || s.defaultStartTime,
    graceMinutes: (p && p.graceMinutes !== "" && p.graceMinutes != null) ? Number(p.graceMinutes) : Number(s.graceMinutes),
  };
}
async function recordAttendance(memberId, programKey, atDate = new Date()) {
  const sessionDate = isoDate(atDate);
  const cfg = await getProgramConfig(programKey);
  const [h, m] = cfg.startTime.split(":").map(Number);
  const startDT = new Date(atDate);
  startDT.setHours(h, m, 0, 0);
  const lateAfter = new Date(startDT.getTime() + cfg.graceMinutes * 60000);
  const status = atDate.getTime() <= lateAfter.getTime() ? "on-time" : "late";
  const store = tx("attendance");
  const idx = store.index("memberDateProgram");
  const existing = await reqp(idx.get([memberId, sessionDate, programKey]));
  const settings = await getSettings();
  const record = existing || { id: uid(), memberId, programKey, sessionDate };
  record.timestamp = atDate.toISOString();
  record.status = status;
  record.deviceId = settings.deviceId;
  record.synced = false;
  await put("attendance", record);
  if (!navigator.onLine) requestBackgroundSync();
  return { record, status };
}
function requestBackgroundSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready.then((reg) => reg.sync.register("sync-attendance")).catch(() => {});
  }
}

// ---------- Dashboard analytics ----------
async function computeConsecutiveAbsences() {
  const members = (await getAll("members")).filter((m) => m.active !== false);
  const attendance = await getAll("attendance");
  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))].sort().reverse();
  const settings = await getSettings();
  const threshold = Number(settings.absenceThreshold) || 3;
  const results = [];
  for (const mem of members) {
    let streak = 0;
    for (const d of sessionDates) {
      const present = attendance.some((a) => a.memberId === mem.id && a.sessionDate === d);
      if (present) break;
      streak++;
      if (streak >= threshold) break;
    }
    if (streak >= threshold) results.push({ member: mem, streak });
  }
  return results;
}
async function computeConfessionDue() {
  const members = (await getAll("members")).filter((m) => m.active !== false);
  const settings = await getSettings();
  const monthsThreshold = Number(settings.confessionIntervalMonths) || 12;
  const now = new Date();
  const due = [];
  for (const mem of members) {
    if (!mem.lastConfessionDate) { due.push({ member: mem, monthsSince: null }); continue; }
    const last = new Date(mem.lastConfessionDate);
    const months = (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
    if (months >= monthsThreshold) due.push({ member: mem, monthsSince: months });
  }
  return due;
}
async function computeHrEventsDue() {
  const events = await getAll("hrEvents");
  const today = todayISO();
  return events.filter((e) => e.nextDate).map((e) => ({ ...e, overdue: e.nextDate <= today })).sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999"));
}
async function markHrEventDone(id) {
  const e = await get("hrEvents", id);
  if (!e) return;
  e.lastDone = todayISO();
  if (e.recurrenceDays > 0) e.nextDate = isoDate(addDays(new Date(), e.recurrenceDays));
  await put("hrEvents", e);
}

// ---------- JSON export/import (works with or without Supabase) ----------
async function exportScansJSON() {
  const attendance = await getAll("attendance");
  const members = await getAll("members");
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), attendance, members }, null, 2)], { type: "application/json" });
  downloadBlob(blob, `finote-scans-${todayISO()}.json`);
}
async function importScansJSON(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  let mCount = 0, aCount = 0;
  if (data.members) for (const m of data.members) { const existing = await get("members", m.id); if (!existing) { await put("members", m); mCount++; } }
  if (data.attendance) for (const a of data.attendance) { const existing = await get("attendance", a.id); if (!existing) { await put("attendance", a); aCount++; } }
  return { mCount, aCount };
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function exportAttendanceExcel() {
  const attendance = await getAll("attendance");
  const members = await getAll("members");
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  const rows = attendance.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((a) => ({
    Date: a.sessionDate,
    Program: progs.find((p) => p.key === a.programKey)?.name || a.programKey,
    Name: memberMap.get(a.memberId)?.fullName || "?",
    Phone: memberMap.get(a.memberId)?.phone || "",
    Status: a.status === "late" ? t("scan.late") : t("scan.onTime"),
    Time: fmtDT(a.timestamp),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");
  XLSX.writeFile(wb, `finote-attendance-${todayISO()}.xlsx`);
}

// ---------- UI helpers ----------
function el(id) { return document.getElementById(id); }

function applyStaticI18n() {
  el("headerTitle").textContent = t("app.title");
  el("headerSub").textContent = t("app.subtitle");
  document.querySelectorAll(".tab-btn").forEach((b) => { b.querySelector(".lbl").textContent = t("nav." + b.dataset.tab); });
  document.documentElement.lang = getLang();
  const langBtn = el("langToggle");
  if (langBtn) langBtn.textContent = getLang() === "am" ? "EN" : "አማ";
}
window.toggleLang = function () {
  setLang(getLang() === "am" ? "en" : "am");
  applyStaticI18n();
  if (appState === "app") RENDERERS[currentTab]();
  else boot();
};

// ---------- Dashboard ----------
async function renderDashboard() {
  const [absentees, confessionDue, hrDue, settings] = await Promise.all([computeConsecutiveAbsences(), computeConfessionDue(), computeHrEventsDue(), getSettings()]);
  const members = await getAll("members");
  const attendance = await getAll("attendance");
  const today = todayISO();
  const todayCount = attendance.filter((a) => a.sessionDate === today).length;
  const thr = settings.absenceThreshold || 3;

  el("view").innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${members.length}</div><div class="stat-label">${t("dash.totalMembers")}</div></div>
      <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-label">${t("dash.todayAttendance")}</div></div>
      <div class="stat-card"><div class="stat-num">${absentees.length}</div><div class="stat-label">${t("dash.consecutiveAbsent", { n: thr })}</div></div>
      <div class="stat-card"><div class="stat-num">${confessionDue.length}</div><div class="stat-label">${t("dash.confessionDueStat")}</div></div>
    </div>

    <h3 class="section-title">${t("dash.callListTitle", { n: thr })}</h3>
    ${absentees.length ? `<div class="list">${absentees.map(a => `
      <div class="list-row">
        <div><b>${a.member.fullName}</b><br><span class="muted">${a.member.phone || t("dash.noPhone")}</span></div>
        <div class="badge badge-red">${t("dash.streakBadge", { n: a.streak })}</div>
      </div>`).join("")}</div>` : `<p class="muted">${t("dash.noAbsentees")}</p>`}

    <h3 class="section-title">${t("dash.confessionTitle")}</h3>
    ${confessionDue.length ? `<div class="list">${confessionDue.map(c => `
      <div class="list-row">
        <div><b>${c.member.fullName}</b><br><span class="muted">${c.monthsSince === null ? t("dash.confessionUnset") : t("dash.confessionMonthsAgo", { n: c.monthsSince })}</span></div>
        <button class="btn-small" onclick="markConfessed('${c.member.id}')">${t("dash.confessDone")}</button>
      </div>`).join("")}</div>` : `<p class="muted">${t("dash.noConfessionDue")}</p>`}

    <h3 class="section-title">${t("dash.hrTitle")}</h3>
    <div class="list">${hrDue.map(e => { const [title, note] = hrLabel(e.titleKey); return `
      <div class="list-row">
        <div><b>${title}</b><br><span class="muted">${note} ${e.nextDate ? "— " + t("dash.expected") + ": " + e.nextDate : ""}</span></div>
        <div class="row-actions">
          ${e.overdue ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
          ${e.recurrenceDays > 0 ? `<button class="btn-small" onclick="doneHrEvent('${e.id}')">${t("dash.markDone")}</button>` : ""}
        </div>
      </div>`; }).join("")}</div>
  `;
}
window.markConfessed = async (memberId) => { const m = await get("members", memberId); m.lastConfessionDate = todayISO(); m.synced = false; await put("members", m); renderDashboard(); };
window.doneHrEvent = async (id) => { await markHrEventDone(id); renderDashboard(); };

// ---------- Scan (batch queue: scan several, review, then confirm all at once) ----------
async function renderScan() {
  const members = await getAll("members");
  const progs = PROGRAM_DEFS();
  el("view").innerHTML = `
    <div class="scan-controls">
      <label>${t("scan.programLabel")}</label>
      <select id="programSelect">${progs.map(p => `<option value="${p.key}" ${p.key === scanState.program ? "selected" : ""}>${p.name}</option>`).join("")}</select>
      <button id="camToggle" class="btn-primary">${t("scan.startCamera")}</button>
    </div>
    <video id="video" playsinline style="width:100%;max-width:420px;border-radius:12px;display:none;"></video>
    <canvas id="canvas" style="display:none;"></canvas>

    <h3 class="section-title">${t("batch.title")}</h3>
    <div class="toolbar">
      <button id="confirmBatchBtn" class="btn-primary">${t("batch.confirmAll")} (<span id="batchCount">0</span>)</button>
      <button id="clearBatchBtn" class="btn-secondary">${t("batch.clear")}</button>
    </div>
    <div id="batchList" class="list"></div>

    <div id="scanFeed" class="list"></div>

    <h3 class="section-title">${t("scan.manualTitle")}</h3>
    <input id="manualSearch" placeholder="${t("scan.searchPlaceholder")}" class="text-input"/>
    <div id="manualResults" class="list"></div>
  `;
  el("programSelect").onchange = (e) => (scanState.program = e.target.value);
  el("camToggle").onclick = toggleCamera;
  el("confirmBatchBtn").onclick = confirmBatch;
  el("clearBatchBtn").onclick = () => { scanState.batch = []; renderBatchList(); };
  el("manualSearch").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q ? members.filter((m) => m.fullName.toLowerCase().includes(q)) : [];
    el("manualResults").innerHTML = filtered.slice(0, 15).map((m) => `
      <div class="list-row"><div>${m.fullName}</div><button class="btn-small" onclick="queueScan('${m.id}')">${t("scan.record")}</button></div>`).join("");
  };
  renderBatchList();
}

function renderBatchList() {
  const box = el("batchList");
  const countEl = el("batchCount");
  if (!box) return;
  if (countEl) countEl.textContent = scanState.batch.length;
  box.innerHTML = scanState.batch.length
    ? scanState.batch.map((item, i) => `
        <div class="list-row">
          <div><b>${item.fullName}</b><br><span class="muted">${item.scannedAt.toLocaleTimeString()}</span></div>
          <button class="btn-small" onclick="removeFromBatch(${i})">${t("batch.remove")}</button>
        </div>`).join("")
    : `<p class="muted">${t("batch.empty")}</p>`;
}
window.removeFromBatch = (i) => { scanState.batch.splice(i, 1); renderBatchList(); };

async function queueScan(memberId) {
  if (scanState.batch.some((b) => b.memberId === memberId)) return; // dedupe
  const m = await get("members", memberId);
  if (!m) return;
  scanState.batch.push({ memberId, fullName: m.fullName, scannedAt: new Date() });
  renderBatchList();
  if (navigator.vibrate) navigator.vibrate(40);
}
window.queueScan = queueScan;

async function confirmBatch() {
  if (!scanState.batch.length) return;
  const items = [...scanState.batch];
  scanState.batch = [];
  renderBatchList();
  for (const item of items) {
    const { status } = await recordAttendance(item.memberId, scanState.program, item.scannedAt);
    pushScanFeed({ fullName: item.fullName }, status);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = t("batch.confirmedToast", { n: items.length });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function pushScanFeed(member, status) {
  const feed = el("scanFeed");
  if (!feed) return;
  const badge = status === "late" ? `<span class="badge badge-amber">${t("scan.late")}</span>` : `<span class="badge badge-green">${t("scan.onTime")}</span>`;
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `<div><b>${member.fullName}</b><br><span class="muted">${new Date().toLocaleTimeString()}</span></div>${badge}`;
  feed.prepend(row);
  if (navigator.vibrate) navigator.vibrate(60);
}
async function toggleCamera() {
  const video = el("video"), btn = el("camToggle");
  if (scanState.streaming) {
    scanState.stream.getTracks().forEach((tr) => tr.stop());
    scanState.streaming = false;
    video.style.display = "none";
    btn.textContent = t("scan.startCamera");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanState.stream = stream;
    video.srcObject = stream;
    video.style.display = "block";
    await video.play();
    scanState.streaming = true;
    btn.textContent = t("scan.stopCamera");
    scanLoop();
  } catch (err) {
    alert(t("scan.cameraError") + ": " + err.message);
  }
}
function scanLoop() {
  const video = el("video"), canvas = el("canvas");
  if (!scanState.streaming || !video || video.readyState !== video.HAVE_ENOUGH_DATA) { if (scanState.streaming) requestAnimationFrame(scanLoop); return; }
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (code && code.data && code.data.startsWith("FTW1|")) handleQrHit(code.data);
  if (scanState.streaming) requestAnimationFrame(scanLoop);
}
async function handleQrHit(qrId) {
  const now = Date.now();
  const last = scanState.recentHits.get(qrId) || 0;
  if (now - last < 1500) return; // debounce duplicate frames, short enough for rapid batch scanning
  scanState.recentHits.set(qrId, now);
  const members = await getAll("members");
  const member = members.find((m) => m.qrId === qrId);
  if (!member) return;
  await queueScan(member.id);
}

// ---------- Members ----------
async function renderMembers() {
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  el("view").innerHTML = `
    <div class="toolbar">
      <label class="btn-primary file-btn">${t("members.importExcel")}<input type="file" id="excelInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>
      <button class="btn-secondary" id="addMemberBtn">${t("members.addMember")}</button>
      <button class="btn-secondary" id="printQrBtn">${t("members.printAllQr")}</button>
      <button class="btn-secondary" id="exportMembersBtn">${t("members.exportExcel")}</button>
    </div>
    <input id="memberSearch" class="text-input" placeholder="${t("members.searchPlaceholder")}"/>
    <div id="memberList" class="list"></div>
    <div id="printArea" class="print-only"></div>
  `;
  function draw(list) {
    const isAdmin = window.currentUserRole === "admin" || !sbClient; // no cloud = no RBAC, allow local admin actions
    el("memberList").innerHTML = list.map((m) => `
      <div class="list-row">
        <div><b>${m.fullName}</b><br><span class="muted">${m.phone || ""} ${m.category ? "· " + m.category : ""}</span></div>
        <div class="row-actions">
          <button class="btn-small" onclick="showQr('${m.id}')">${t("members.qr")}</button>
          ${isAdmin ? `<button class="btn-small" onclick="deleteMember('${m.id}')">${t("members.delete")}</button>` : ""}
        </div>
      </div>`).join("");
  }
  draw(members);
  el("memberSearch").oninput = (e) => { const q = e.target.value.toLowerCase(); draw(members.filter((m) => m.fullName.toLowerCase().includes(q))); };
  el("excelInput").onchange = async (e) => { const file = e.target.files[0]; if (!file) return; const count = await importMembersFromWorkbook(file); alert(t("members.importedCount", { n: count })); renderMembers(); };
  el("addMemberBtn").onclick = async () => {
    const name = prompt(t("members.promptName")); if (!name) return;
    const phone = prompt(t("members.promptPhone")) || "";
    const category = prompt(t("members.promptCategory")) || "";
    await addMemberManual(name, phone, category); renderMembers();
  };
  el("printQrBtn").onclick = () => printAllQr(members);
  el("exportMembersBtn").onclick = () => exportMembersExcel(members);
}
window.deleteMember = async (id) => {
  if (window.currentUserRole !== "admin" && sbClient) { alert(t("role.adminOnly")); return; }
  if (!confirm(t("members.confirmDelete"))) return;
  await del("members", id); renderMembers();
};
window.showQr = async (id) => {
  const m = await get("members", id);
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner">
      <h3>${m.fullName}</h3>
      <div id="qrBox"></div>
      <p class="muted" style="max-width:220px;">${t("members.softCopyNote")}</p>
      <div class="row-actions" style="justify-content:center;margin-top:8px;">
        <button class="btn-small" id="qrDownloadBtn">${t("members.downloadQr")}</button>
        <button class="btn-small" id="qrShareBtn">${t("members.shareQr")}</button>
      </div>
      <button class="btn-secondary" style="margin-top:10px;" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
    </div>`;
  document.body.appendChild(box);
  new QRCode(document.getElementById("qrBox"), { text: m.qrId, width: 220, height: 220 });
  el("qrDownloadBtn").onclick = () => downloadQrPng(box.querySelector("#qrBox"), m.fullName);
  el("qrShareBtn").onclick = () => shareQrPng(box.querySelector("#qrBox"), m.fullName);
};

function qrBoxToBlob(qrBoxEl) {
  return new Promise((resolve) => {
    const canvas = qrBoxEl.querySelector("canvas");
    if (canvas) { canvas.toBlob(resolve, "image/png"); return; }
    const img = qrBoxEl.querySelector("img");
    if (!img) { resolve(null); return; }
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 220; c.height = img.naturalHeight || 220;
    c.getContext("2d").drawImage(img, 0, 0);
    c.toBlob(resolve, "image/png");
  });
}
async function downloadQrPng(qrBoxEl, name) {
  const blob = await qrBoxToBlob(qrBoxEl);
  if (blob) downloadBlob(blob, `qr-${name.replace(/\s+/g, "_")}.png`);
}
async function shareQrPng(qrBoxEl, name) {
  const blob = await qrBoxToBlob(qrBoxEl);
  if (!blob) return;
  const file = new File([blob], `qr-${name.replace(/\s+/g, "_")}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) {}
  }
  downloadBlob(blob, file.name); // fallback: just download it
}

async function exportMembersExcel(members) {
  const rows = members.map((m) => ({
    Name: m.fullName, Phone: m.phone || "", Category: m.category || "",
    LastConfession: m.lastConfessionDate || "", JoinDate: m.joinDate || "", QrId: m.qrId,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Members");
  XLSX.writeFile(wb, `finote-members-${todayISO()}.xlsx`);
}

// 8 ID cards per A4 page: left half QR, right half a 3x4 photo box + name below it.
async function printAllQr(members) {
  const area = el("printArea");
  area.innerHTML = "";
  const perPage = 8;
  for (let i = 0; i < members.length; i += perPage) {
    const pageMembers = members.slice(i, i + perPage);
    const page = document.createElement("div");
    page.className = "qr-page";
    for (const m of pageMembers) {
      const card = document.createElement("div");
      card.className = "id-card";
      const qrHalf = document.createElement("div");
      qrHalf.className = "qr-half";
      card.appendChild(qrHalf);
      const infoHalf = document.createElement("div");
      infoHalf.className = "info-half";
      infoHalf.innerHTML = `<div class="photo-box"></div><div class="id-name">${m.fullName}</div><div class="id-org">ፍኖተ ጥበብ ሰ/ት/ቤት</div>`;
      card.appendChild(infoHalf);
      page.appendChild(card);
      new QRCode(qrHalf, { text: m.qrId, width: 240, height: 240 });
    }
    area.appendChild(page);
  }
  await new Promise((r) => setTimeout(r, 300));
  window.print();
}

// ---------- Settings ----------
async function renderSettings() {
  const settings = await getSettings();
  const programs = await getAll("programs");
  const session = await getSession();
  const cfg = getSupabaseConfig();
  el("view").innerHTML = `
    <h3 class="section-title">${t("settings.languageTitle")}</h3>
    <div class="toolbar">
      <button class="btn-secondary ${getLang() === "am" ? "active-lang" : ""}" id="langAm">አማርኛ</button>
      <button class="btn-secondary ${getLang() === "en" ? "active-lang" : ""}" id="langEn">English</button>
    </div>

    <h3 class="section-title">${t("settings.generalTitle")}</h3>
    <div class="form-grid">
      <label>${t("settings.defaultStart")}</label>
      <input id="s_startTime" class="text-input" value="${settings.defaultStartTime}"/>
      <label>${t("settings.grace")}</label>
      <input id="s_grace" type="number" class="text-input" value="${settings.graceMinutes}"/>
      <label>${t("settings.confessionInterval")}</label>
      <input id="s_conf" type="number" class="text-input" value="${settings.confessionIntervalMonths}"/>
      <label>${t("settings.absenceThreshold")}</label>
      <input id="s_abs" type="number" class="text-input" value="${settings.absenceThreshold}"/>
      <label>${t("settings.deviceName")}</label>
      <input id="s_device" class="text-input" value="${settings.deviceName || ""}" placeholder="${t("settings.deviceNamePlaceholder")}"/>
    </div>
    <button id="saveSettings" class="btn-primary">${t("settings.save")}</button>

    <h3 class="section-title">${t("settings.programTimesTitle")}</h3>
    <div class="list">
      ${programs.map(p => `
        <div class="list-row">
          <div><b>${p.name}</b></div>
          <div class="row-actions">
            <input class="text-input small" placeholder="HH:MM" id="pt_${p.key}" value="${p.startTime || ""}"/>
            <input class="text-input small" placeholder="min" id="pg_${p.key}" value="${p.graceMinutes || ""}"/>
          </div>
        </div>`).join("")}
    </div>
    <button id="saveProgs" class="btn-secondary">${t("settings.saveProgramTimes")}</button>

    <h3 class="section-title">${t("settings.cloudTitle")}</h3>
    ${sbClient ? `
      <p class="muted">${session ? t("settings.signedInAs") + " " + session.user.email : t("settings.notConnected")}</p>
      ${session ? `<p class="muted">${t("role.title")}: <b style="color:var(--amber)">${window.currentUserRole === "admin" ? t("role.admin") : t("role.member")}</b></p>` : ""}
      <div class="toolbar">
        ${session ? `<button id="signOutBtn" class="btn-secondary">${t("settings.signOut")}</button>` : `<button id="goAuthBtn" class="btn-secondary">${t("settings.goSignIn")}</button>`}
        <button id="disconnectBtn" class="btn-secondary">${t("settings.disconnectCloud")}</button>
      </div>
    ` : `
      <p class="muted">${t("settings.notConnected")}</p>
      <input id="cl_url" class="text-input" placeholder="${t("auth.urlPlaceholder")}" value="${cfg.url}"/>
      <input id="cl_key" class="text-input" placeholder="${t("auth.keyPlaceholder")}" value="${cfg.key}"/>
      <button id="connectBtn" class="btn-primary">${t("settings.connectCloud")}</button>
    `}

    <h3 class="section-title">${t("notif.title")}</h3>
    <p class="muted">${t("notif.desc")}</p>
    <div class="toolbar">
      <button id="notifBtn" class="btn-secondary">${(typeof Notification !== "undefined" && Notification.permission === "granted") ? t("notif.granted") : t("notif.enable")}</button>
    </div>

    <h3 class="section-title">${t("bio.title")}</h3>
    <p class="muted">${t("bio.desc")}</p>
    <div class="toolbar">
      <button id="bioBtn" class="btn-secondary">${bioIsEnabled() ? t("bio.disable") : t("bio.enable")}</button>
    </div>

    <h3 class="section-title">${t("settings.syncTitle")}</h3>
    <p class="muted" id="syncStatus">-</p>
    <div class="toolbar">
      <button id="syncBtn" class="btn-secondary">${t("settings.syncNow")}</button>
      <button id="exportJsonBtn" class="btn-secondary">${t("settings.exportJson")}</button>
      <label class="btn-secondary file-btn">${t("settings.importJson")}<input type="file" id="importJsonInput" accept=".json" style="display:none;"/></label>
      <button id="exportExcelBtn" class="btn-secondary">${t("settings.exportExcel")}</button>
    </div>
  `;
  el("langAm").onclick = () => { setLang("am"); applyStaticI18n(); renderSettings(); };
  el("langEn").onclick = () => { setLang("en"); applyStaticI18n(); renderSettings(); };
  el("saveSettings").onclick = async () => {
    await setSetting("defaultStartTime", el("s_startTime").value || "10:00");
    await setSetting("graceMinutes", Number(el("s_grace").value) || 0);
    await setSetting("confessionIntervalMonths", Number(el("s_conf").value) || 12);
    await setSetting("absenceThreshold", Number(el("s_abs").value) || 3);
    await setSetting("deviceName", el("s_device").value || "");
    alert(t("settings.saved"));
  };
  el("saveProgs").onclick = async () => {
    for (const p of programs) { p.startTime = el("pt_" + p.key).value || ""; p.graceMinutes = el("pg_" + p.key).value || ""; await put("programs", p); }
    alert(t("settings.saved"));
  };
  if (el("connectBtn")) el("connectBtn").onclick = () => { saveSupabaseConfig(el("cl_url").value.trim(), el("cl_key").value.trim()); setSkipCloud(false); boot(); };
  if (el("disconnectBtn")) el("disconnectBtn").onclick = () => { clearSupabaseConfig(); setSkipCloud(true); boot(); };
  if (el("signOutBtn")) el("signOutBtn").onclick = signOut;
  if (el("goAuthBtn")) el("goAuthBtn").onclick = () => { setSkipCloud(false); appState = "auth"; renderAuthScreen(); };
  el("notifBtn").onclick = enableNotifications;
  el("bioBtn").onclick = toggleBiometric;
  el("syncBtn").onclick = syncNow;
  el("exportJsonBtn").onclick = exportScansJSON;
  el("exportExcelBtn").onclick = exportAttendanceExcel;
  el("importJsonInput").onchange = async (e) => { const file = e.target.files[0]; if (!file) return; const { mCount, aCount } = await importScansJSON(file); alert(t("settings.importedJsonResult", { m: mCount, a: aCount })); };
}

// ---------- Local notifications (in-app reminders; not real server push) ----------
async function enableNotifications() {
  if (!("Notification" in window)) { alert(t("bio.notSupported")); return; }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    alert(t("notif.granted"));
    await setSetting("notificationsEnabled", true);
    checkAndNotify();
  } else {
    alert(t("notif.denied"));
  }
  renderSettings();
}
async function checkAndNotify() {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const [absentees, confessionDue, hrDue] = await Promise.all([computeConsecutiveAbsences(), computeConfessionDue(), computeHrEventsDue()]);
  const overdueHr = hrDue.filter((e) => e.overdue);
  const parts = [];
  if (absentees.length) parts.push(`${absentees.length} ${getLang() === "am" ? "ተከታታይ ቀሪ" : "on an absence streak"}`);
  if (confessionDue.length) parts.push(`${confessionDue.length} ${getLang() === "am" ? "ንስሃ ደርሷል" : "confession due"}`);
  if (overdueHr.length) parts.push(`${overdueHr.length} ${getLang() === "am" ? "የክፍል ማስታወሻ" : "HR reminder(s)"}`);
  if (!parts.length) return;
  const body = parts.join(" · ");
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(t("app.title"), { body, icon: "./icon-192.png", tag: "ftw-daily-check" });
    } else {
      new Notification(t("app.title"), { body, icon: "./icon-192.png" });
    }
  } catch (e) {}
}

// ---------- Biometric device-level unlock (WebAuthn platform authenticator) ----------
// NOTE: this is a *local convenience gate*, not a replacement for the Supabase
// sign-in — no server verifies the assertion. It just guards quick re-entry
// to the app on a device that has already signed in to Supabase at least once.
function bioIsEnabled() { return !!localStorage.getItem("ftw_bio_cred_id"); }
async function toggleBiometric() {
  if (bioIsEnabled()) {
    localStorage.removeItem("ftw_bio_cred_id");
    renderSettings();
    return;
  }
  if (!window.PublicKeyCredential) { alert(t("bio.notSupported")); return; }
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Finote Tsibeb Attendance" },
        user: { id: userId, name: "hr-device-user", displayName: "HR Device User" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    if (cred) {
      localStorage.setItem("ftw_bio_cred_id", btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
      alert(t("bio.enabled"));
    }
  } catch (e) {
    alert(t("bio.failed"));
  }
  renderSettings();
}
async function unlockWithBiometric() {
  const credIdB64 = localStorage.getItem("ftw_bio_cred_id");
  if (!credIdB64) return false;
  try {
    const rawId = Uint8Array.from(atob(credIdB64), (c) => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: { challenge, allowCredentials: [{ id: rawId, type: "public-key" }], userVerification: "required", timeout: 60000 },
    });
    return !!assertion;
  } catch (e) {
    return false;
  }
}

// ---------- Reports ----------
let chartInstances = [];
function destroyCharts() { chartInstances.forEach((c) => c.destroy()); chartInstances = []; }

async function renderReports() {
  const attendance = (await getAll("attendance")).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const members = await getAll("members");
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  el("view").innerHTML = `
    <div class="toolbar"><button id="repExcel" class="btn-secondary">${t("reports.downloadExcel")}</button></div>

    <h3 class="section-title">${t("charts.attendanceTrend")}</h3>
    <div class="chart-box"><canvas id="trendChart"></canvas></div>

    <h3 class="section-title">${t("charts.byProgram")}</h3>
    <div class="chart-box"><canvas id="progChart"></canvas></div>

    <h3 class="section-title">${t("reports.logTitle")}</h3>
    <div class="list">
      ${attendance.slice(0, 200).map((a) => `
        <div class="list-row">
          <div><b>${memberMap.get(a.memberId)?.fullName || "?"}</b><br><span class="muted">${progs.find(p => p.key === a.programKey)?.name || a.programKey} · ${a.sessionDate}</span></div>
          <div class="badge ${a.status === "late" ? "badge-amber" : "badge-green"}">${a.status === "late" ? t("scan.late") : t("scan.onTime")}</div>
        </div>`).join("")}
    </div>
  `;
  el("repExcel").onclick = exportAttendanceExcel;
  drawCharts(attendance, progs);
}

function drawCharts(attendance, progs) {
  destroyCharts();
  if (typeof Chart === "undefined") return;

  // Attendance trend: total scans per session date, last 12 dates
  const byDate = {};
  attendance.forEach((a) => { byDate[a.sessionDate] = (byDate[a.sessionDate] || 0) + 1; });
  const dates = Object.keys(byDate).sort().slice(-12);
  const trendCanvas = el("trendChart");
  if (dates.length && trendCanvas) {
    chartInstances.push(new Chart(trendCanvas, {
      type: "line",
      data: { labels: dates, datasets: [{ label: t("charts.attendanceTrend"), data: dates.map((d) => byDate[d]), borderColor: "#f2a33c", backgroundColor: "rgba(242,163,60,0.15)", tension: 0.3, fill: true }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#9c9187" } }, y: { ticks: { color: "#9c9187" }, beginAtZero: true } } },
    }));
  } else if (trendCanvas) {
    trendCanvas.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: t("charts.noData") }));
  }

  // By program: total scans per program, on-time vs late
  const progCanvas = el("progChart");
  if (attendance.length && progCanvas) {
    const onTime = progs.map((p) => attendance.filter((a) => a.programKey === p.key && a.status === "on-time").length);
    const late = progs.map((p) => attendance.filter((a) => a.programKey === p.key && a.status === "late").length);
    chartInstances.push(new Chart(progCanvas, {
      type: "bar",
      data: {
        labels: progs.map((p) => p.name),
        datasets: [
          { label: t("scan.onTime"), data: onTime, backgroundColor: "#4caf7d" },
          { label: t("scan.late"), data: late, backgroundColor: "#e0605a" },
        ],
      },
      options: { scales: { x: { stacked: true, ticks: { color: "#9c9187" } }, y: { stacked: true, ticks: { color: "#9c9187" }, beginAtZero: true } }, plugins: { legend: { labels: { color: "#f2ede6" } } } },
    }));
  } else if (progCanvas) {
    progCanvas.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: t("charts.noData") }));
  }
}

// ---------- Tabs ----------
const RENDERERS = { dashboard: renderDashboard, scan: renderScan, members: renderMembers, settings: renderSettings, reports: renderReports };
function setTab(tabName) {
  if (scanState.streaming) toggleCamera();
  currentTab = tabName;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  RENDERERS[tabName]();
}
window.setTab = setTab;

// ---------- Boot / auth flow ----------
async function boot() {
  applyStaticI18n();
  document.querySelector("nav.tabs").style.display = "none";

  if (skipCloudFlag()) { await enterApp(); return; }

  initSupabaseClient();
  if (!sbClient) { appState = "setup"; renderSupabaseSetup(); return; }

  const session = await getSession();
  if (session) {
    await mirrorAuthForSW(session);
    await fetchUserRole(session);
    if (bioIsEnabled()) { appState = "biolock"; renderBioLock(); return; }
    await enterApp();
    return;
  }

  if (navigator.onLine) { appState = "auth"; renderAuthScreen(); }
  else { appState = "offline-no-session"; renderOfflineNoSession(); }
}
function renderBioLock() {
  el("view").innerHTML = `
    <div class="auth-wrap">
      <h2>${t("bio.unlock")}</h2>
      <button id="bioUnlockBtn" class="btn-primary" style="width:100%;margin-bottom:10px;">${t("bio.unlock")}</button>
      <button id="bioSkipBtn" class="btn-secondary" style="width:100%;">${t("bio.skip")}</button>
    </div>
  `;
  const tryUnlock = async () => { const ok = await unlockWithBiometric(); if (ok) enterApp(); };
  el("bioUnlockBtn").onclick = tryUnlock;
  el("bioSkipBtn").onclick = () => enterApp();
  tryUnlock(); // auto-prompt immediately, buttons remain as fallback
}

async function enterApp() {
  appState = "app";
  document.querySelector("nav.tabs").style.display = "flex";
  setTab("dashboard");
  syncNow();
  checkAndNotify();
  if (!window._ftwNotifyInterval) {
    window._ftwNotifyInterval = setInterval(checkAndNotify, 30 * 60 * 1000); // every 30 min while app stays open
  }
}

async function init() {
  db = await openDB();
  await ensureDeviceId();
  await ensurePrograms();
  await ensureHrEvents();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  boot();
}
document.addEventListener("DOMContentLoaded", init);
