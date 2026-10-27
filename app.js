/* ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)
   Offline-first via IndexedDB. Supabase is optional for multi-device sync + auth.

   This file is now the CORE only. Feature code lives in separate plain scripts
   (no modules, no build step), all loaded BEFORE this file in index.html:
     roster.js, discipline.js, groups.js, reports.js, idcards.js, plan.js,
     members.js, dashboard.js, scan.js, device.js, roles.js, settings.js
   Translations, Supabase/auth and the Ethiopian calendar come from i18n.js,
   auth.js and ethiopian-calendar.js — do NOT redeclare sbClient/t/getLang/
   the ETH_MONTH_NAMES arrays etc. here, it will throw "Identifier has already been
   declared" and stop this entire script from running. */

// ---------- Required external libraries (load via CDN) ----------
// jsQR, QRCode, XLSX, Chart.js are assumed to be loaded globally.
// If not, the app will show warnings.

// ---------- Constants ----------
const DB_NAME = "finote_attendance";
const DB_VERSION = 8;

// Note: ETH_MONTH_NAMES_AM / ETH_MONTH_NAMES_EN / gregorianToEthiopian() /
// ethLabel() / computeEthAwareNextDate() come from ethiopian-calendar.js,
// loaded before this file — do not redeclare them here.

function PROGRAM_DEFS() {
  return [
    { key: "timhert", name: getLang() === "am" ? "ትምህርት (Course)" : "Course (ትምህርት)" },
    { key: "mezmur", name: getLang() === "am" ? "ዝማሬ (Mezmur)" : "Mezmur (ዝማሬ)" },
    { key: "tselot", name: getLang() === "am" ? "ጸሎት (Tselot)" : "Tselot (ጸሎት)" },
    { key: "mata", name: getLang() === "am" ? "የማታ አገልግሎት" : "Evening Service" },
    { key: "kurban", name: getLang() === "am" ? "ቁርባን ማስተባበር" : "Kurban Coordination" },
    { key: "awdemihret", name: getLang() === "am" ? "የአውደ ምሕረት አገልግሎት" : "Awde Mihret Service" },
  ];
}

// Shared with both the member registration modal (department preferences)
// and the Groups tab (roster grouped by assigned department).
const DEPT_OPTIONS = [
  "ትምህርትና ስልጠና ክፍል",
  "ዜማና ስነ-ጥበባት ክፍል",
  "መርኃ ግብርና ጉባኤያት ክፍል",
  "የሰው ሀብት አስተዳደር ክፍል",
  "የፋይናንስ እና ንብረት አስተዳደር ክፍል",
  "እቅድ እና ልማት ክፍል",
  "መረጃና የውስጥ ግንኙነት ክፍል",
  "የሕጻናት እና ታዳጊዎች አስተዳደር ክፍል",
  "ምግባረ ሰናይ ክፍል",
];

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
let scanState = { streaming: false, stream: null, program: "timhert", recentHits: new Map(), batch: [], torchOn: false };

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
      if (!d.objectStoreNames.contains("planItems")) {
        const s = d.createObjectStore("planItems", { keyPath: "id" });
        s.createIndex("category", "category", { unique: false });
      }
      if (!d.objectStoreNames.contains("families")) {
        d.createObjectStore("families", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("tombstones")) {
        d.createObjectStore("tombstones", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("excuses")) {
        d.createObjectStore("excuses", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("punishments")) {
        d.createObjectStore("punishments", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("advice")) {
        d.createObjectStore("advice", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("dutyAssignments")) {
        d.createObjectStore("dutyAssignments", { keyPath: "id" });
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

// One row per locally-deleted record, kept until its remote soft-delete
// succeeds (see syncNow in auth.js). Deleting is a soft-delete on the
// server so other devices can pull it and a fresh install can't
// resurrect the record.
async function addTombstone(table, recordId) {
  await put("tombstones", {
    id: table + ":" + recordId, table, recordId,
    deletedAt: new Date().toISOString(), synced: false,
  });
}

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
    else if (existing.name !== p.name) { existing.name = p.name; await put("programs", existing); }
  }
}

// ---------- Date helpers ----------
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function addMonths(d, n) { const nd = new Date(d); nd.setMonth(nd.getMonth() + n); return nd; }
function todayISO() { return isoDate(new Date()); }
function fmtDT(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------- Ethiopian time conversion (for Settings UI) ----------
function gregorianToEthiopianTime(gregorianStr) {
  if (!gregorianStr) return "";
  const [h, m] = gregorianStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return gregorianStr;
  const ethH = (h - 6 + 24) % 24;
  return `${String(ethH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function ethiopianToGregorianTime(ethiopianStr) {
  if (!ethiopianStr) return "";
  const [h, m] = ethiopianStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return ethiopianStr;
  const gregH = (h + 6) % 24;
  return `${String(gregH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  await clearCallLogIfPresent(memberId);
  if (!navigator.onLine) requestBackgroundSync();
  return { record, status };
}

async function clearCallLogIfPresent(memberId) {
  const m = await get("members", memberId);
  if (m && m.callLog) {
    m.callLog = null;
    m.synced = false;
    await put("members", m);
  }
}

function requestBackgroundSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready.then((reg) => reg.sync.register("sync-attendance")).catch(() => {});
  }
}

// ---------- Permissions / excused absences (ፈቃድ) ----------
// A permission excuses one member for a date range (a single program day
// when they asked ahead because they're sick, or a long leave like a year),
// for every program or only chosen ones. Excused dates count as "covered":
//  - absence streaks / call lists treat a covered session as not-absent
//  - Service Attendance treats a covered session as attended
// (Named "excuses" internally so it can't be confused with the role-based
// access permissions in the Roles section.)
async function loadExcuseIndex() {
  const idx = new Map();
  for (const ex of await getAll("excuses")) {
    if (!idx.has(ex.memberId)) idx.set(ex.memberId, []);
    idx.get(ex.memberId).push(ex);
  }
  return idx;
}
// programKey === null means "calendar mode" (any program counts as present
// that day), so only permissions covering ALL programs can excuse the day.
function isExcused(idx, memberId, dateISO, programKey) {
  const list = idx.get(memberId);
  if (!list) return false;
  return list.some((ex) => {
    if (dateISO < ex.startDate || dateISO > ex.endDate) return false;
    const keys = ex.programKeys || [];
    if (programKey == null) return keys.length === 0;
    return keys.length === 0 || keys.includes(programKey);
  });
}

// ---------- Punishments (ቅጣት) ----------
// A member on punishment can still come and be scanned as usual, but is left
// out of the Service Attendance report until the punishment period (start
// and end dates, both inclusive) is over. Punishment wins over permission.
async function loadActivePunishedIds() {
  const today = todayISO();
  const ids = new Set();
  for (const pu of await getAll("punishments")) {
    if (pu.startDate <= today && today <= pu.endDate) ids.add(pu.memberId);
  }
  return ids;
}

// ---------- Confession father (የንስሐ አባት) grouping ----------
// The field is free text, so group on a normalized key (trimmed, single
// spaces, case-insensitive) — "Aba Gebre" and " aba  gebre " are one father.
// Members with no confession father recorded go in the "__none__" bucket.
function normFatherName(s) { return String(s || "").trim().replace(/\s+/g, " "); }
function confessionFatherKey(s) { const n = normFatherName(s); return n ? n.toLowerCase() : "__none__"; }
// -> [{ key, name, members }] alphabetical, with the "none recorded" bucket last
function groupByConfessionFather(members) {
  const map = new Map();
  members.forEach((m) => {
    const key = confessionFatherKey(m.confessionFather);
    if (!map.has(key)) map.set(key, { key, name: key === "__none__" ? null : normFatherName(m.confessionFather), members: [] });
    map.get(key).members.push(m);
  });
  const groups = [...map.values()].filter((g) => g.key !== "__none__").sort((a, b) => a.name.localeCompare(b.name));
  if (map.has("__none__")) groups.push(map.get("__none__"));
  return groups;
}

// ---------- Occupation (ሥራ): employed / student / unemployed ----------
// Employed members also have a free-text job title. Groups are built from
// whatever titles exist, so if there are doctors there is a "Doctor" group,
// and a new title creates its own group automatically (spelling/case
// variants of the same title merge).
function normText(s) { return String(s || "").trim().replace(/\s+/g, " "); }
function normalizeOccupationStatus(v) {
  const s = normText(v).toLowerCase();
  if (!s) return "";
  if (["employed", "employee", "worker", "working", "ሠራተኛ", "ሰራተኛ", "ተቀጣሪ"].includes(s)) return "employed";
  if (["student", "ተማሪ"].includes(s)) return "student";
  if (["unemployed", "jobless", "ሥራ የሌለው", "ስራ የሌለው", "ሥራ አጥ", "ስራ አጥ"].includes(s)) return "unemployed";
  return "";
}
function occupationLabel(status, lang) {
  const labels = {
    employed: lang === "am" ? "ሠራተኛ" : "Employed",
    student: lang === "am" ? "ተማሪ" : "Student",
    unemployed: lang === "am" ? "ሥራ የሌለው" : "Unemployed",
  };
  return labels[status] || "";
}
// -> [{ key, kind: "job"|"student"|"unemployed"|"none", name, members }]
//    jobs alphabetical (employed with no title last of the jobs), then students,
//    unemployed, and members with no occupation recorded.
function groupByOccupation(members) {
  const jobs = new Map();
  const noTitle = [], students = [], unemployed = [], none = [];
  members.forEach((m) => {
    const st = m.occupationStatus || "";
    if (st === "employed") {
      const name = normText(m.jobTitle);
      if (!name) { noTitle.push(m); return; }
      const key = "job:" + name.toLowerCase();
      if (!jobs.has(key)) jobs.set(key, { key, kind: "job", name, members: [] });
      jobs.get(key).members.push(m);
    } else if (st === "student") students.push(m);
    else if (st === "unemployed") unemployed.push(m);
    else none.push(m);
  });
  const groups = [...jobs.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (noTitle.length) groups.push({ key: "job:__notitle__", kind: "job", name: null, members: noTitle });
  if (students.length) groups.push({ key: "status:student", kind: "student", name: null, members: students });
  if (unemployed.length) groups.push({ key: "status:unemployed", kind: "unemployed", name: null, members: unemployed });
  if (none.length) groups.push({ key: "status:none", kind: "none", name: null, members: none });
  return groups;
}

// ---------- Dashboard analytics ----------
async function computeConsecutiveAbsences() {
  // university students are mostly away, so they aren't flagged for calls
  // (see More -> Groups -> University Students)
  const members = (await getAll("members")).filter((m) => m.active !== false && !m.isUniversityStudent);
  const attendance = await getAll("attendance");
  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))].sort().reverse();
  const excuseIdx = await loadExcuseIndex();
  const settings = await getSettings();
  const threshold = Number(settings.absenceThreshold) || 3;
  const results = [];

  for (const mem of members) {
    const relevantDates = sessionDates.filter(d => !mem.joinDate || d >= mem.joinDate);
    let streak = 0;
    for (const d of relevantDates) {
      const present = attendance.some((a) => a.memberId === mem.id && a.sessionDate === d) || isExcused(excuseIdx, mem.id, d, null);
      if (present) break;
      streak++;
    }
    if (streak >= threshold) results.push({ member: mem, streak });
  }
  return results;
}

async function computeProgramSpecificAbsences(programKey) {
  const members = (await getAll("members")).filter((m) => m.active !== false && !m.isUniversityStudent);
  const attendance = await getAll("attendance");
  const progAttendance = attendance.filter(a => a.programKey === programKey);
  const sessionDates = [...new Set(progAttendance.map((a) => a.sessionDate))].sort().reverse();
  const excuseIdx = await loadExcuseIndex();
  const settings = await getSettings();
  const threshold = Number(settings.absenceThreshold) || 3;
  const results = [];

  for (const mem of members) {
    const relevantDates = sessionDates.filter(d => !mem.joinDate || d >= mem.joinDate);
    let streak = 0;
    for (const d of relevantDates) {
      const present = progAttendance.some((a) => a.memberId === mem.id && a.sessionDate === d) || isExcused(excuseIdx, mem.id, d, programKey);
      if (present) break;
      streak++;
    }
    if (streak >= threshold) results.push({ member: mem, streak, programKey });
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

// ---------- Grade-level analytics ----------
async function computeGradeStats(startISO, endISO) {
  const [members, attendanceAll] = await Promise.all([getAll("members"), getAll("attendance")]);
  const attendance = attendanceAll.filter((a) => a.sessionDate >= startISO && a.sessionDate <= endISO);
  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))];
  const totalSessions = sessionDates.length || 1;

  const memberGrade = new Map(members.map((m) => [m.id, m.grade]));
  const gradeMap = {};
  for (let g = 1; g <= 12; g++) gradeMap[g] = { grade: g, memberCount: 0, scans: 0, onTime: 0, late: 0 };
  members.forEach((m) => { if (m.grade >= 1 && m.grade <= 12 && m.active !== false) gradeMap[m.grade].memberCount++; });
  attendance.forEach((a) => {
    const g = memberGrade.get(a.memberId);
    if (g >= 1 && g <= 12) {
      gradeMap[g].scans++;
      if (a.status === "on-time") gradeMap[g].onTime++; else gradeMap[g].late++;
    }
  });
  const rows = Object.values(gradeMap)
    .map((r) => ({ ...r, rate: r.memberCount ? r.scans / (r.memberCount * totalSessions) : 0 }))
    .filter((r) => r.memberCount > 0)
    .sort((a, b) => b.rate - a.rate);
  return { rows, totalSessions };
}

function buildGradeNarrative(rows, lang) {
  const byGrade = {};
  rows.forEach((r) => (byGrade[r.grade] = r));
  const lines = [];
  for (let g = 1; g < 12; g++) {
    const a = byGrade[g], b = byGrade[g + 1];
    if (!a || !b || a.rate === b.rate) continue;
    const higherIsA = a.rate > b.rate;
    const higher = higherIsA ? a : b, lower = higherIsA ? b : a;
    const hp = (higher.rate * 100).toFixed(0), lp = (lower.rate * 100).toFixed(0);
    lines.push(lang === "am"
      ? `ክፍል ${higher.grade} (${hp}%) ከክፍል ${lower.grade} (${lp}%) የበለጠ ተሳትፎ አሳይተዋል`
      : `Grade ${higher.grade} (${hp}%) attended more than Grade ${lower.grade} (${lp}%)`);
  }
  return lines;
}

// ---------- JSON export/import ----------
async function exportScansJSON() {
  const attendance = await getAll("attendance");
  // the portal first-password must never end up in a backup file
  const members = (await getAll("members")).map(({ portalPassword, ...rest }) => rest);
  const excuses = await getAll("excuses");
  const punishments = await getAll("punishments");
  const advice = await getAll("advice");
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), attendance, members, excuses, punishments, advice }, null, 2)], { type: "application/json" });
  downloadBlob(blob, `finote-scans-${todayISO()}.json`);
}

async function importScansJSON(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  let mCount = 0, aCount = 0;
  const tombIds = new Set((await getAll("tombstones")).map((x) => x.recordId));
  if (data.members) for (const m of data.members) {
    if (tombIds.has(m.id)) continue; // don't resurrect deleted members from an old backup
    const existing = await get("members", m.id);
    if (!existing) { await put("members", m); mCount++; }
  }
  if (data.attendance) for (const a of data.attendance) { const existing = await get("attendance", a.id); if (!existing) { await put("attendance", a); aCount++; } }
  const excuseTombIds = new Set((await getAll("tombstones")).filter((x) => x.table === "excuses").map((x) => x.recordId));
  if (data.excuses) for (const ex of data.excuses) {
    if (excuseTombIds.has(ex.id)) continue;
    const existing = await get("excuses", ex.id);
    if (!existing) await put("excuses", ex);
  }
  const punishTombIds = new Set((await getAll("tombstones")).filter((x) => x.table === "punishments").map((x) => x.recordId));
  if (data.punishments) for (const pu of data.punishments) {
    if (punishTombIds.has(pu.id)) continue;
    const existing = await get("punishments", pu.id);
    if (!existing) await put("punishments", pu);
  }
  const adviceTombIds = new Set((await getAll("tombstones")).filter((x) => x.table === "advice").map((x) => x.recordId));
  if (data.advice) for (const ad of data.advice) {
    if (adviceTombIds.has(ad.id)) continue;
    const existing = await get("advice", ad.id);
    if (!existing) await put("advice", ad);
  }
  return { mCount, aCount };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Center-crops to the target aspect ratio (matching the printed ID card's
// photo box) and re-encodes as compressed JPEG, so a photo taken straight
// from a phone camera doesn't end up as several MB sitting in IndexedDB
// and getting pushed through Supabase sync on every edit.
function resizeImageFile(file, maxW = 300, maxH = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const targetRatio = maxW / maxH;
        const srcRatio = img.width / img.height;
        let sx, sy, sw, sh;
        if (srcRatio > targetRatio) {
          sh = img.height; sw = sh * targetRatio; sx = (img.width - sw) / 2; sy = 0;
        } else {
          sw = img.width; sh = sw / targetRatio; sx = 0; sy = (img.height - sh) / 2;
        }
        const canvas = document.createElement("canvas");
        canvas.width = maxW; canvas.height = maxH;
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, maxW, maxH);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function exportAttendanceExcel() {
  if (typeof XLSX === 'undefined') { await showAlert('XLSX library not loaded'); return; }
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

// ---------- Department chairs (heads) ----------
async function getDeptHeads() {
  const row = await get("settings", "deptHeads");
  return (row && row.value) || {};
}
async function setDeptHead(dept, name) {
  const heads = await getDeptHeads();
  heads[dept] = name;
  await setSetting("deptHeads", heads);
}

// ---------- Family structure ----------
// Father/mother/first son/children are all existing member records —
// families only store references (ids) plus a free-text address code the
// admin used to cluster them, since neighborhood grouping from house
// numbers (e.g. 456/01 relating to 454, 440, 485) isn't a fixed numeric
// rule and has to stay a human judgment call, not an auto-computed one.
async function addFamily(data) {
  const fam = {
    id: uid(),
    fatherId: data.fatherId || null,
    motherId: data.motherId || null,
    firstSonId: data.firstSonId || null,
    childrenIds: data.childrenIds || [],
    addressCode: data.addressCode || "",
    lastMeetingDate: null,
    meetingLog: [],
    synced: false,
  };
  await put("families", fam);
  return fam;
}
async function updateFamily(id, patch) {
  const fam = await get("families", id);
  if (!fam) return;
  Object.assign(fam, patch, { synced: false });
  await put("families", fam);
}
window.deleteFamily = async (id) => {
  if (!isAdminUser()) { await showAlert(t("role.adminOnly")); return; }
  if (!(await showConfirm(getLang() === "am" ? "ይህን ቤተሰብ መሰረዝ ይፈልጋሉ?" : "Delete this family?"))) return;
  const row = await get("families", id);
  if (row) await del("families", id);
  await addTombstone("families", id);
  if (typeof RENDERERS !== "undefined" && RENDERERS[currentTab]) RENDERERS[currentTab]();
  syncNow();
};
window.markFamilyMet = async (id) => {
  const fam = await get("families", id);
  if (!fam) return;
  const today = todayISO();
  fam.lastMeetingDate = today;
  fam.meetingLog = fam.meetingLog || [];
  fam.meetingLog.push({ date: today });
  fam.synced = false;
  await put("families", fam);
  if (typeof RENDERERS !== "undefined" && RENDERERS[currentTab]) RENDERERS[currentTab]();
};
async function computeFamilyMeetingsDue() {
  const families = await getAll("families");
  const today = new Date();
  return families.filter((f) => f.fatherId || f.motherId).filter((f) => {
    if (!f.lastMeetingDate) return true;
    const last = new Date(f.lastMeetingDate);
    const monthsSince = (today.getFullYear() - last.getFullYear()) * 12 + (today.getMonth() - last.getMonth());
    return monthsSince >= 1;
  });
}

// ---------- UI helpers ----------
function el(id) { return document.getElementById(id); }

// ---------- In-app dialogs (replace native alert/confirm/prompt) ----------
// Reuses the existing .modal / .modal-inner / .btn-primary / .btn-secondary
// classes so these match the rest of the app instead of looking like a
// browser-native popup. Each returns a Promise so call sites just `await`
// them where they used to call the native function directly.
function showAlert(message, opts = {}) {
  return new Promise((resolve) => {
    const lang = getLang();
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `
      <div class="modal-inner" style="max-width:340px;">
        ${opts.title ? `<h3>${opts.title}</h3>` : ""}
        <p style="white-space:pre-wrap;">${message}</p>
        <button class="btn-primary" id="dlg_ok" style="width:100%;">${lang === "am" ? "እሺ" : "OK"}</button>
      </div>`;
    document.body.appendChild(box);
    const close = () => { box.remove(); resolve(); };
    box.querySelector("#dlg_ok").onclick = close;
    box.onclick = (e) => { if (e.target === box) close(); };
  });
}

function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const lang = getLang();
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `
      <div class="modal-inner" style="max-width:340px;">
        ${opts.title ? `<h3>${opts.title}</h3>` : ""}
        <p style="white-space:pre-wrap;">${message}</p>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button class="btn-secondary" id="dlg_cancel" style="flex:1;">${opts.cancelLabel || (lang === "am" ? "ይቅር" : "Cancel")}</button>
          <button class="btn-primary" id="dlg_ok" style="flex:1;${opts.danger ? "background:var(--red);" : ""}">${opts.okLabel || (lang === "am" ? "እሺ" : "OK")}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = (val) => { box.remove(); resolve(val); };
    box.querySelector("#dlg_ok").onclick = () => close(true);
    box.querySelector("#dlg_cancel").onclick = () => close(false);
  });
}

function showPrompt(message, defaultValue = "", opts = {}) {
  return new Promise((resolve) => {
    const lang = getLang();
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `
      <div class="modal-inner" style="max-width:360px;text-align:left;">
        ${opts.title ? `<h3 style="text-align:center;">${opts.title}</h3>` : ""}
        <p style="text-align:center;">${message}</p>
        <input id="dlg_input" class="text-input" value="${defaultValue ? String(defaultValue).replace(/"/g, "&quot;") : ""}" placeholder="${opts.placeholder || ""}"/>
        <div style="display:flex;gap:10px;margin-top:6px;">
          <button class="btn-secondary" id="dlg_cancel" style="flex:1;">${lang === "am" ? "ይቅር" : "Cancel"}</button>
          <button class="btn-primary" id="dlg_ok" style="flex:1;">${lang === "am" ? "እሺ" : "OK"}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const input = box.querySelector("#dlg_input");
    input.focus();
    const close = (val) => { box.remove(); resolve(val); };
    box.querySelector("#dlg_ok").onclick = () => close(input.value);
    box.querySelector("#dlg_cancel").onclick = () => close(null);
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); close(input.value); } };
  });
}

// ---------- Button loading state (for slow actions: report generation, sync) ----------
// Disables the button and swaps its label while fn() runs, then always
// restores it — so a slow tap gets visible feedback instead of looking
// like nothing happened, and can't be double-tapped while in flight.
async function withButtonLoading(btn, loadingLabel, fn) {
  if (!btn) return fn();
  const originalLabel = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.textContent = loadingLabel;
  try {
    return await fn();
  } finally {
    btn.disabled = wasDisabled;
    btn.textContent = originalLabel;
  }
}

function applyStaticI18n() {
  el("headerTitle").textContent = t("app.title");
  el("headerSub").textContent = t("app.subtitle");
  el("headerMotto").textContent = t("app.motto");
  document.querySelectorAll(".tab-btn").forEach((b) => {
    if (b.dataset.tab === "more") return; // no i18n.js entry for this yet — labeled explicitly below
    b.querySelector(".lbl").textContent = t("nav." + b.dataset.tab);
  });
  const moreBtn = document.querySelector('.tab-btn[data-tab="more"]');
  if (moreBtn) {
    const lbl = moreBtn.querySelector(".lbl");
    if (lbl) lbl.textContent = getLang() === "am" ? "ተጨማሪ" : "More";
  }
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

// ---------- Tabs ----------
const RENDERERS = { dashboard: renderDashboard, scan: renderScan, members: renderMembers, plan: renderPlan, groups: renderGroups, settings: renderSettings, reports: renderReports, more: renderMoreMenu, users: renderUsers };

// Reports, Groups, and Settings no longer have their own bottom-nav
// button — they're reached through "More" — so the More tab stays
// visually active while any of them is open.
const MORE_SUB_TABS = ["reports", "groups", "settings", "users"];
function moreBackBtn() {
  const lang = getLang();
  return `<button class="btn-secondary" onclick="setTab('more')" style="margin-bottom:14px;">${lang === "am" ? "← ተጨማሪ" : "← More"}</button>`;
}
function renderMoreMenu() {
  const lang = getLang();
  const items = [
    { tab: "reports", icon: "📊", label: lang === "am" ? "ሪፖርት" : "Reports" },
    { tab: "groups", icon: "👪", label: lang === "am" ? "ቡድኖች" : "Groups" },
    { tab: "users", icon: "🔑", label: lang === "am" ? "ተጠቃሚዎች" : "Users" },
    { tab: "settings", icon: "⚙️", label: lang === "am" ? "ቅንብር" : "Settings" },
  ].filter((it) => canAccessTab(it.tab));
  el("view").innerHTML = `
    <h3 class="section-title">${lang === "am" ? "ተጨማሪ" : "More"}</h3>
    <div class="list">
      ${items.map((it) => `
        <div class="list-row" style="cursor:pointer;" onclick="setTab('${it.tab}')">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:1.3rem;">${it.icon}</span>
            <b>${it.label}</b>
          </div>
          <span class="muted">›</span>
        </div>`).join("")}
    </div>
  `;
}

function setTab(tabName) {
  if (!canAccessTab(tabName)) tabName = defaultTabForRole();
  if (scanState.streaming) toggleCamera();
  currentTab = tabName;
  if (tabName === "groups") window._groupsView = "menu";
  const activeTab = MORE_SUB_TABS.includes(tabName) ? "more" : tabName;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
  RENDERERS[tabName]();
}
window.setTab = setTab;

// ---------- Boot / auth ----------
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
    await fetchDisplayName(session);
    if (userRole() === "pending") { appState = "pending"; renderPendingScreen(); return; }
    if ((await bioIsEnabled()) && sessionStorage.getItem("ftw_bio_unlocked") !== "1") {
      appState = "biolock"; renderBioLock(); return;
    }
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
      <p id="bioLockErr" class="muted" style="color:var(--red);min-height:18px;"></p>
      <button id="bioSignOutBtn" class="btn-secondary" style="width:100%;">${getLang() === "am" ? "ውጣ" : "Sign Out"}</button>
    </div>
  `;
  const tryUnlock = async () => {
    const ok = await unlockWithBiometric();
    if (ok) {
      sessionStorage.setItem("ftw_bio_unlocked", "1");
      enterApp();
    } else {
      const errEl = el("bioLockErr");
      if (errEl) errEl.textContent = getLang() === "am" ? "አልተሳካም — እንደገና ይሞክሩ" : "Unlock failed — try again";
    }
  };
  el("bioUnlockBtn").onclick = tryUnlock;
  // No "skip" option here on purpose — that would let anyone bypass the
  // lock just by tapping past it. Sign Out is the only fallback for a
  // stuck lock, since it forces real re-authentication with Supabase
  // rather than silently walking around this screen.
  el("bioSignOutBtn").onclick = signOut;
  tryUnlock();
}

async function enterApp() {
  appState = "app";
  document.querySelector("nav.tabs").style.display = "flex";
  applyRoleUI();
  setTab(defaultTabForRole());
  syncNow();
  checkAndNotify();
  if (!window._ftwNotifyInterval) {
    window._ftwNotifyInterval = setInterval(checkAndNotify, 30 * 60 * 1000);
  }
}

async function init() {
  try {
    db = await openDB();
    await ensureDeviceId();
    await ensurePrograms();
    await ensurePlanItems();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
    await boot();
  } catch (err) {
    console.error("Init error:", err);
    const lang = getLang();
    el("view").innerHTML = `
      <div class="auth-wrap">
        <h2>${lang === "am" ? "የመክፈቻ ስህተት" : "Startup Error"}</h2>
        <p class="muted">${lang === "am"
          ? "መተግበሪያውን መክፈት አልተቻለም። ይህ ብዙ ጊዜ የሚከሰተው ገና ሙሉ በሙሉ ሳይጫን መተግበሪያውን ከመስመር ውጭ ሆነው ሲከፍቱ ነው። እባክዎ ኢንተርኔት ካለበት ቦታ አንድ ጊዜ ይክፈቱት፣ ከዚያ ከመስመር ውጭም ይሰራል።"
          : "The app couldn't start. This usually happens when it's opened offline before it has ever fully loaded once. Please open it with an internet connection at least once — after that it will work offline too."}</p>
        <p class="muted" style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${err.message}</p>
        <button class="btn-primary" onclick="location.reload()">${lang === "am" ? "እንደገና ሞክር" : "Try Again"}</button>
      </div>`;
  }
}
document.addEventListener("DOMContentLoaded", init);

// Last-resort safety net: if something throws after boot (e.g. inside an
// un-awaited button handler elsewhere in the app) and #view ends up empty
// as a result, surface a visible way to recover instead of leaving a
// silent blank screen.
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled error:", e.reason);
  const view = el("view");
  if (view && !view.innerHTML.trim()) {
    const lang = getLang();
    view.innerHTML = `
      <div class="auth-wrap">
        <h2>${lang === "am" ? "ችግር ተፈጥሯል" : "Something went wrong"}</h2>
        <button class="btn-primary" onclick="location.reload()">${lang === "am" ? "እንደገና ሞክር" : "Try Again"}</button>
      </div>`;
  }
});

// Note: renderSupabaseSetup() / renderAuthScreen() / renderOfflineNoSession()
// are defined in auth.js — don't redeclare them here (that would silently
// shadow the real sign-in UI with an empty stub).
