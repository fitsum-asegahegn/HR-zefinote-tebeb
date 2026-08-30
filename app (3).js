/* ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)
   Offline-first via IndexedDB. Supabase is optional for multi-device sync + auth. */

// ---------- Required external libraries (load via CDN) ----------
// jsQR, QRCode, XLSX, Chart.js are assumed to be loaded globally.
// If not, the app will show warnings.

// ---------- Biometric lock (WebAuthn, purely local — no server involved) ----------
// Everything else (translations, Supabase/auth, Ethiopian calendar) is
// provided by i18n.js, auth.js, and ethiopian-calendar.js, loaded before
// this file — do NOT redeclare sbClient/t/getLang/ETH_MONTH_NAMES_*/etc.
// here, it will throw "Identifier has already been declared" and stop
// this entire script from running.
//
// Uses a platform authenticator (Face/Touch ID, Windows Hello, Android
// fingerprint) purely as a local re-auth gate for opening the app. The
// challenge is generated on-device and never leaves it, and there's no
// server to verify the assertion against — this proves "same device/
// person who set it up," not a cryptographic identity. Requires a secure
// context (HTTPS or localhost).
async function bioIsSupported() {
  return !!(window.PublicKeyCredential && window.isSecureContext &&
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
}
async function bioIsEnabled() {
  const row = await get("settings", "bioCredentialId");
  return !!(row && row.value);
}
async function bioEnable() {
  if (!(await bioIsSupported())) throw new Error(getLang() === "am" ? "አይደገፍም" : "Not supported on this device.");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "ፍኖተ ጥበብ" },
      user: { id: userId, name: "local-lock", displayName: "Local Lock" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error(getLang() === "am" ? "ተሰርዟል" : "Setup was cancelled.");
  const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  await setSetting("bioCredentialId", credId);
  return true;
}
async function bioDisable() {
  await del("settings", "bioCredentialId");
}
async function unlockWithBiometric() {
  const row = await get("settings", "bioCredentialId");
  if (!row || !row.value) return true; // not enabled — nothing to unlock
  try {
    const idBytes = Uint8Array.from(atob(row.value), (c) => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: idBytes, type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch (e) {
    return false;
  }
}

// ---------- Local notifications (no push server — checked on an interval while the app is open) ----------
function notifIsSupported() { return "Notification" in window; }
async function notifIsEnabled() {
  const row = await get("settings", "notificationsEnabled");
  return !!(row && row.value);
}
async function notifEnable() {
  if (!notifIsSupported()) throw new Error(getLang() === "am" ? "አይደገፍም" : "Not supported on this device/browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(getLang() === "am" ? "ፈቃድ አልተሰጠም" : "Notification permission was denied.");
  await setSetting("notificationsEnabled", true);
}
async function notifDisable() {
  await setSetting("notificationsEnabled", false);
}
async function checkAndNotify() {
  if (!notifIsSupported() || Notification.permission !== "granted") return;
  if (!(await notifIsEnabled())) return;
  const settings = await getSettings();
  const today = todayISO();
  if (settings.lastNotifiedDate === today) return; // once a day is enough for a local reminder
  const [absentees, confessionDue, planDue] = await Promise.all([
    computeConsecutiveAbsences(), computeConfessionDue(), computePlanReminders(),
  ]);
  const overduePlan = planDue.filter((e) => e.overdue);
  const parts = [];
  if (absentees.length) parts.push(getLang() === "am" ? `${absentees.length} ተከታታይ ቀሪ` : `${absentees.length} to call`);
  if (confessionDue.length) parts.push(getLang() === "am" ? `${confessionDue.length} ንስሃ ይጠበቃል` : `${confessionDue.length} confession due`);
  if (overduePlan.length) parts.push(getLang() === "am" ? `${overduePlan.length} የዘገየ ዕቅድ` : `${overduePlan.length} plan item(s) overdue`);
  if (!parts.length) return;
  try {
    new Notification(getLang() === "am" ? "ፍኖተ ጥበብ ማስታወሻ" : "Finote reminder", { body: parts.join(" · "), tag: "finote-daily-reminder" });
    await setSetting("lastNotifiedDate", today);
  } catch (e) {}
}

// ---------- Constants ----------
const DB_NAME = "finote_attendance";
const DB_VERSION = 2;

// Note: ETH_MONTH_NAMES_AM / ETH_MONTH_NAMES_EN / gregorianToEthiopian() /
// ethLabel() / computeEthAwareNextDate() come from ethiopian-calendar.js,
// loaded before this file — do not redeclare them here.

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

// ---------- Plan Data (simplified for brevity) ----------
const DEFAULT_PLAN_MAIN = [
  { no: 1, subUnit: "የአባላት አስተዳደር", title: "አዳዲስ አባላትን መመልመልና ማቀላቀል", timing: "መስከረም–ጥቅምት", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 2, subUnit: "የአባላት መረጃ", title: "የተሳትፎ ቁጥጥር", timing: "ወርሃዊ", executor: "የአባላት መረጃ ንዑስ ክፍል", recurrenceDays: 30 },
  { no: 3, subUnit: "ምክረ አበው", title: "የንስሃና ቁርባን ሕይወት ክትትል", timing: "ወርሃዊ", executor: "ምክረ አበው ንዑስ ክፍል", recurrenceDays: 30 },
];

const DEFAULT_PLAN_INTERNAL = [
  { no: 1, subUnit: "የክፍል ውስጥ ግንኙነት", title: "ወርሃዊ የክፍል ስብሰባ", timing: "ወርሃዊ", executor: "የክፍሉ ጽ/ቤት", recurrenceDays: 30 },
];

async function ensurePlanItems() {
  const existing = await getAll("planItems");
  if (existing.length) return;
  const today = new Date();
  const seedRow = async (row, category) => {
    const ethNext = computeEthAwareNextDate(row.timing, today);
    const fallbackNext = row.recurrenceDays > 0 ? isoDate(addDays(today, 14)) : null;
    await put("planItems", {
      id: uid(), no: row.no, category, subUnit: row.subUnit, title: row.title,
      details: row.details || "", outcome: row.outcome || "", indicator: row.indicator || "",
      metricTarget: row.metricTarget || "", timing: row.timing, executor: row.executor,
      budget: row.budget || "-", recurrenceDays: row.recurrenceDays, autoMetric: row.autoMetric || null,
      nextDate: ethNext || fallbackNext, lastDone: null, doneLog: [],
    });
  };
  for (const row of DEFAULT_PLAN_MAIN) await seedRow(row, "main");
  for (const row of DEFAULT_PLAN_INTERNAL) await seedRow(row, "internal");
}

async function computePlanReminders() {
  const items = await getAll("planItems");
  const today = todayISO();
  return items.filter((e) => e.nextDate).map((e) => ({ ...e, overdue: e.nextDate <= today })).sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999"));
}

async function markPlanItemDone(id, note) {
  const e = await get("planItems", id);
  if (!e) return;
  const today = todayISO();
  e.lastDone = today;
  e.doneLog = e.doneLog || [];
  e.doneLog.push({ date: today, note: note || "" });
  const ethNext = computeEthAwareNextDate(e.timing, new Date());
  if (ethNext) e.nextDate = ethNext;
  else if (e.recurrenceDays > 0) e.nextDate = isoDate(addDays(new Date(), e.recurrenceDays));
  await put("planItems", e);
}

// ---------- Members ----------
async function importMembersFromWorkbook(file) {
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return 0; }
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
    const qrId = pick(row, ["QR ID", "qrId"]);
    // Try to find existing by QR ID, then by phone, then by name
    let member = null;
    if (qrId) {
      member = existingList.find(m => m.qrId === qrId);
    }
    if (!member && phone) {
      member = existingList.find(m => m.phone === phone);
    }
    if (!member) {
      member = existingList.find(m => m.fullName.trim() === String(name).trim());
    }

    const category = pick(row, ["የሚያገለግሉበት ክፍል", "Assigned Department", "category"]);
    const gradeRaw = pick(row, ["ክፍል ደረጃ", "ክፍል", "Grade", "grade"]);
    const grade = normalizeGrade(gradeRaw);
    const confDate = parseExcelDate(pick(row, ["ንስሃ ቀን", "የመጨረሻ ንስሃ", "Last Confession", "lastConfession"]));
    const christianName = pick(row, ["የክርስትና ስም", "Christian Name", "christianName"]);
    const gender = pick(row, ["ጾታ", "Gender", "gender"]);
    const age = pick(row, ["ዕድሜ", "Age", "age"]);
    const altPhone = pick(row, ["ተለዋጭ ስልክ", "Alternate Phone", "altPhone"]);
    const address = pick(row, ["የመኖሪያ አድራሻ", "Address", "address"]);
    const confessionFather = pick(row, ["የንስሐ አባት ስም", "Confession Father", "confessionFather"]);
    const parish = pick(row, ["የሚያገለግሉበት ደብር", "Parish", "parish"]);
    const parentName = pick(row, ["የወላጅ ስም", "Parent Name", "parentName"]);
    const parentPhone = pick(row, ["የወላጅ ስልክ", "Parent Phone", "parentPhone"]);
    const educationLevel = pick(row, ["የዘመናዊ ትምህርት ደረጃ", "Education Level", "educationLevel"]);
    const spiritualEducation = pick(row, ["በመንፈሳዊ የትምህርት ደረጃ", "Spiritual Education", "spiritualEducation"]);
    const dept1 = pick(row, ["ምርጫ 1", "Preference 1", "dept1"]);
    const dept2 = pick(row, ["ምርጫ 2", "Preference 2", "dept2"]);
    const dept3 = pick(row, ["ምርጫ 3", "Preference 3", "dept3"]);

    if (!member) {
      member = {
        id: uid(), qrId: qrId || "FTW1|" + shortId(), fullName: String(name).trim(),
        phone: phone ? String(phone).trim() : "", category: category ? String(category).trim() : "", grade,
        lastConfessionDate: confDate, joinDate: todayISO(), active: true, synced: false,
        christianName: christianName ? String(christianName).trim() : "",
        gender: gender ? String(gender).trim() : "",
        age: age ? Number(age) : null,
        altPhone: altPhone ? String(altPhone).trim() : "",
        address: address ? String(address).trim() : "",
        confessionFather: confessionFather ? String(confessionFather).trim() : "",
        parish: parish ? String(parish).trim() : "",
        parentName: parentName ? String(parentName).trim() : "",
        parentPhone: parentPhone ? String(parentPhone).trim() : "",
        educationLevel: educationLevel ? String(educationLevel).trim() : "",
        spiritualEducation: spiritualEducation ? String(spiritualEducation).trim() : "",
        dept1: dept1 ? String(dept1).trim() : "",
        dept2: dept2 ? String(dept2).trim() : "",
        dept3: dept3 ? String(dept3).trim() : "",
      };
      existingList.push(member);
    } else {
      // Update existing member
      if (phone) member.phone = String(phone).trim();
      if (category) member.category = String(category).trim();
      if (grade !== null) member.grade = grade;
      if (confDate) member.lastConfessionDate = confDate;
      if (christianName) member.christianName = String(christianName).trim();
      if (gender) member.gender = String(gender).trim();
      if (age) member.age = Number(age);
      if (altPhone) member.altPhone = String(altPhone).trim();
      if (address) member.address = String(address).trim();
      if (confessionFather) member.confessionFather = String(confessionFather).trim();
      if (parish) member.parish = String(parish).trim();
      if (parentName) member.parentName = String(parentName).trim();
      if (parentPhone) member.parentPhone = String(parentPhone).trim();
      if (educationLevel) member.educationLevel = String(educationLevel).trim();
      if (spiritualEducation) member.spiritualEducation = String(spiritualEducation).trim();
      if (dept1) member.dept1 = String(dept1).trim();
      if (dept2) member.dept2 = String(dept2).trim();
      if (dept3) member.dept3 = String(dept3).trim();
      member.synced = false;
    }
    await put("members", member);
    count++;
  }
  return count;
}

function parseExcelDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return !isNaN(d.getTime()) ? isoDate(d) : null;
  }
  if (v instanceof Date) return isoDate(v);
  const d = new Date(String(v).trim());
  return !isNaN(d.getTime()) ? isoDate(d) : null;
}

function pick(row, keys) { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return ""; }

function normalizeGrade(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return (n >= 1 && n <= 12) ? n : null;
}

async function addMemberManual(fullName, phone, category, grade, extras = {}) {
  const member = {
    id: uid(),
    qrId: "FTW1|" + shortId(),
    fullName: fullName.trim(),
    phone: (phone || "").trim(),
    category: (category || "").trim(),
    grade: normalizeGrade(grade),
    lastConfessionDate: null,
    joinDate: todayISO(),
    active: true,
    synced: false,
    christianName: extras.christianName || "",
    gender: extras.gender || "",
    age: extras.age ? Number(extras.age) : null,
    altPhone: extras.altPhone || "",
    address: extras.address || "",
    confessionFather: extras.confessionFather || "",
    parish: extras.parish || "",
    parentName: extras.parentName || "",
    parentPhone: extras.parentPhone || "",
    educationLevel: extras.educationLevel || "",
    spiritualEducation: extras.spiritualEducation || "",
    dept1: extras.dept1 || "",
    dept2: extras.dept2 || "",
    dept3: extras.dept3 || "",
  };
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

// ---------- Dashboard analytics ----------
async function computeConsecutiveAbsences() {
  const members = (await getAll("members")).filter((m) => m.active !== false);
  const attendance = await getAll("attendance");
  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))].sort().reverse();
  const settings = await getSettings();
  const threshold = Number(settings.absenceThreshold) || 3;
  const results = [];

  for (const mem of members) {
    const relevantDates = sessionDates.filter(d => !mem.joinDate || d >= mem.joinDate);
    let streak = 0;
    for (const d of relevantDates) {
      const present = attendance.some((a) => a.memberId === mem.id && a.sessionDate === d);
      if (present) break;
      streak++;
    }
    if (streak >= threshold) results.push({ member: mem, streak });
  }
  return results;
}

async function computeProgramSpecificAbsences(programKey) {
  const members = (await getAll("members")).filter((m) => m.active !== false);
  const attendance = await getAll("attendance");
  const progAttendance = attendance.filter(a => a.programKey === programKey);
  const sessionDates = [...new Set(progAttendance.map((a) => a.sessionDate))].sort().reverse();
  const settings = await getSettings();
  const threshold = Number(settings.absenceThreshold) || 3;
  const results = [];

  for (const mem of members) {
    const relevantDates = sessionDates.filter(d => !mem.joinDate || d >= mem.joinDate);
    let streak = 0;
    for (const d of relevantDates) {
      const present = progAttendance.some((a) => a.memberId === mem.id && a.sessionDate === d);
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
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
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
  el("headerMotto").textContent = t("app.motto");
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
function absenteeRow(a) {
  const m = a.member;
  const phoneLink = m.phone
    ? `<a href="tel:${m.phone.replace(/\s+/g, "")}" class="phone-link" onclick="event.stopPropagation();">${m.phone}</a>`
    : t("dash.noPhone");
  const log = m.callLog;

  let badgeText = t("dash.streakBadge", { n: a.streak });
  if (a.programKey) {
    const prog = PROGRAM_DEFS().find(p => p.key === a.programKey);
    if (prog) {
      const shortName = prog.name.replace(/ \([^)]*\)/, '');
      badgeText = `${a.streak} ${t("dash.streakShort")} ${shortName}`;
    }
  }

  return `
    <div class="list-row" style="align-items:flex-start;">
      <div style="flex:1;">
        <b>${m.fullName}</b><br>
        <span class="muted">${phoneLink}</span>
        ${log && log.called
          ? `<br><span class="muted">${t("dash.calledBy", { who: log.calledBy || "?", date: log.calledAt })}${log.reason ? " — " + log.reason : ""}</span>`
          : ""}
      </div>
      <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
        <div class="badge badge-red">${badgeText}</div>
        ${log && log.called
          ? `<span class="badge badge-green">${t("dash.alreadyCalled")}</span><button class="btn-small" onclick="uncallMember('${m.id}')">${t("dash.undoCall")}</button>`
          : `<button class="btn-small" onclick="callMember('${m.id}')">${t("dash.markCalled")}</button>`}
      </div>
    </div>`;
}

window.callMember = async (memberId) => {
  const reason = prompt(t("dash.callReasonPrompt")) || "";
  const m = await get("members", memberId);
  if (!m) return;
  const calledBy = await resolveCallerName();
  const calledAt = todayISO();
  m.callLog = { called: true, reason, calledBy, calledAt };
  m.callHistory = m.callHistory || [];
  m.callHistory.push({ date: calledAt, reason, calledBy });
  m.synced = false;
  await put("members", m);
  renderDashboard();
};

async function resolveCallerName() {
  if (window.currentDisplayName) return window.currentDisplayName;
  const settings = await getSettings();
  if (settings.deviceName) return settings.deviceName;
  const session = await getSession();
  if (session && session.user && session.user.email) return session.user.email;
  return settings.deviceId || "";
}

window.uncallMember = async (memberId) => {
  const m = await get("members", memberId);
  if (!m) return;
  m.callLog = null;
  m.synced = false;
  await put("members", m);
  renderDashboard();
};

async function renderDashboard() {
  const currentFilter = window._absenceFilter || "allCalendar";
  let absentees;

  if (currentFilter === "allCalendar") {
    absentees = await computeConsecutiveAbsences();
  } else if (currentFilter === "allPrograms") {
    const progKeys = ["timhert", "mezmur", "tselot"];
    const allResults = [];
    for (const key of progKeys) {
      const results = await computeProgramSpecificAbsences(key);
      allResults.push(...results);
    }
    const seen = new Set();
    absentees = allResults.filter(a => {
      if (seen.has(a.member.id)) return false;
      seen.add(a.member.id);
      return true;
    });
  } else {
    absentees = await computeProgramSpecificAbsences(currentFilter);
  }

  const [confessionDue, hrDue, settings] = await Promise.all([computeConfessionDue(), computePlanReminders(), getSettings()]);
  const members = await getAll("members");
  const attendance = await getAll("attendance");
  const today = todayISO();
  const todayCount = attendance.filter((a) => a.sessionDate === today).length;
  const thr = settings.absenceThreshold || 3;

  const filterOptions = [
    { value: "allCalendar", label: t("dash.filterAllCalendar") },
    { value: "allPrograms", label: t("dash.filterAllPrograms") },
    { value: "timhert", label: t("dash.filterCourse") },
    { value: "mezmur", label: t("dash.filterMezmur") },
    { value: "tselot", label: t("dash.filterTselot") },
  ];

  let statLabel;
  if (currentFilter === "allCalendar") {
    statLabel = t("dash.consecutiveAbsent", { n: thr });
  } else {
    statLabel = t("dash.filteredAbsent");
  }

  el("view").innerHTML = `
    <p class="muted" style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;margin-top:0;">📅 ${ethLabel(today)}</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${members.length}</div><div class="stat-label">${t("dash.totalMembers")}</div></div>
      <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-label">${t("dash.todayAttendance")}</div></div>
      <div class="stat-card"><div class="stat-num">${absentees.length}</div><div class="stat-label">${statLabel}</div></div>
      <div class="stat-card"><div class="stat-num">${confessionDue.length}</div><div class="stat-label">${t("dash.confessionDueStat")}</div></div>
    </div>

    <h3 class="section-title">${t("dash.callListTitle", { n: thr })}</h3>
    <div class="toolbar" style="margin-top:10px;">
      <label class="muted" style="font-size:0.78rem;">${t("dash.filterLabel")}</label>
      <select id="absenceFilter" class="text-input" style="width:auto;flex:1;">
        ${filterOptions.map(o => `<option value="${o.value}" ${o.value===currentFilter?'selected':''}>${o.label}</option>`).join('')}
      </select>
    </div>
    ${absentees.length ? `<div class="list">${absentees.map(a => absenteeRow(a)).join("")}</div>` : `<p class="muted">${t("dash.noAbsentees")}</p>`}

    <h3 class="section-title">${t("dash.confessionTitle")}</h3>
    ${confessionDue.length ? `<div class="list">${confessionDue.map(c => `
      <div class="list-row">
        <div><b>${c.member.fullName}</b><br><span class="muted">${c.monthsSince === null ? t("dash.confessionUnset") : t("dash.confessionMonthsAgo", { n: c.monthsSince })}</span></div>
        <button class="btn-small" onclick="markConfessed('${c.member.id}')">${t("dash.confessDone")}</button>
      </div>`).join("")}</div>` : `<p class="muted">${t("dash.noConfessionDue")}</p>`}

    <h3 class="section-title">${t("dash.hrTitle")}</h3>
    <div class="list">${hrDue.map(e => `
      <div class="list-row">
        <div><b>${e.title}</b><br><span class="muted">${e.subUnit} ${e.nextDate ? "— " + t("dash.expected") + ": " + ethLabel(e.nextDate) + " (" + e.nextDate + ")" : ""}</span></div>
        <div class="row-actions">
          ${e.overdue ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
          <button class="btn-small" onclick="doneHrEvent('${e.id}')">${t("dash.markDone")}</button>
        </div>
      </div>`).join("")}</div>
    <p class="muted" style="margin-top:6px;"><a href="#" onclick="setTab('plan');return false;" style="color:var(--amber);">${t("dash.viewFullPlan")}</a></p>
  `;

  const filterEl = el("absenceFilter");
  if (filterEl) {
    filterEl.onchange = (e) => {
      window._absenceFilter = e.target.value;
      renderDashboard();
    };
  }
}

window.markConfessed = async (memberId) => {
  const m = await get("members", memberId);
  m.lastConfessionDate = todayISO();
  m.synced = false;
  await put("members", m);
  renderDashboard();
};

window.doneHrEvent = async (id) => {
  const note = prompt(t("plan.doneNotePrompt")) || "";
  await markPlanItemDone(id, note);
  renderDashboard();
};

// ---------- Scan ----------
async function renderScan() {
  const members = await getAll("members");
  const progs = PROGRAM_DEFS();
  el("view").innerHTML = `
    <div class="scan-controls">
      <label>${t("scan.programLabel")}</label>
      <select id="programSelect">${progs.map(p => `<option value="${p.key}" ${p.key === scanState.program ? "selected" : ""}>${p.name}</option>`).join("")}</select>
      <button id="camToggle" class="btn-primary">${t("scan.startCamera")}</button>
      <button id="torchToggle" class="btn-secondary" style="display:none;">💡 ${t("scan.torch")}</button>
    </div>
    <div class="video-wrap" id="videoWrap" style="display:none;">
      <video id="video" playsinline></video>
      <div class="scan-reticle"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span></div>
    </div>
    <p class="muted" id="scanStatus" style="display:none;">● ${t("scan.readyStatus")}</p>
    <canvas id="canvas" style="display:none;"></canvas>

    <h3 class="section-title">${t("batch.title")}</h3>
    <div class="toolbar">
      <button id="confirmBatchBtn" class="btn-primary">${t("batch.confirmAll")} (<span id="batchCount">0</span>)</button>
      <button id="clearBatchBtn" class="btn-secondary">${t("batch.clear")}</button>
    </div>
    <div id="batchList" class="list"></div>

    <div id="scanFeed" class="list"></div>

    <h3 class="section-title">${t("scan.codeEntryTitle")}</h3>
    <div class="scan-controls">
      <input id="codeEntry" placeholder="${t("scan.codeEntryPlaceholder")}" class="text-input" style="margin-bottom:0;flex:1;" autocomplete="off"/>
      <button id="codeEntryBtn" class="btn-primary">${t("scan.find")}</button>
    </div>

    <h3 class="section-title">${t("scan.manualTitle")}</h3>
    <input id="manualSearch" placeholder="${t("scan.searchPlaceholder")}" class="text-input"/>
    <div id="manualResults" class="list"></div>
  `;

  el("programSelect").onchange = (e) => (scanState.program = e.target.value);
  el("camToggle").onclick = toggleCamera;
  el("torchToggle").onclick = toggleTorch;
  el("confirmBatchBtn").onclick = confirmBatch;
  el("clearBatchBtn").onclick = () => { scanState.batch = []; renderBatchList(); };

  // Debounced search
  let searchTimeout;
  el("manualSearch").oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? members.filter((m) => m.fullName.toLowerCase().includes(q)) : [];
      el("manualResults").innerHTML = filtered.slice(0, 15).map((m) => `
        <div class="list-row"><div>${m.fullName}</div><button class="btn-small" onclick="queueScan('${m.id}')">${t("scan.record")}</button></div>`).join("");
    }, 200);
  };

  async function submitCodeEntry() {
    const input = el("codeEntry");
    const raw = input.value.trim();
    if (!raw) return;
    const ok = await queueScanByQrText(raw);
    if (!ok) alert(t("scan.codeNotFound"));
    input.value = "";
    input.focus();
  }

  el("codeEntryBtn").onclick = submitCodeEntry;
  el("codeEntry").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitCodeEntry(); } };
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
  if (scanState.batch.some((b) => b.memberId === memberId)) return;
  const m = await get("members", memberId);
  if (!m) return;
  scanState.batch.push({ memberId, fullName: m.fullName, scannedAt: new Date() });
  renderBatchList();
  if (navigator.vibrate) navigator.vibrate(40);
}
window.queueScan = queueScan;

async function queueScanByQrText(raw) {
  const qrId = raw.startsWith("FTW1|") ? raw : "FTW1|" + raw;
  const members = await getAll("members");
  const member = members.find((m) => m.qrId === qrId || m.qrId === raw);
  if (!member) return false;
  await queueScan(member.id);
  return true;
}

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
  const video = el("video"), btn = el("camToggle"), wrap = el("videoWrap"), status = el("scanStatus"), torchBtn = el("torchToggle");

  if (scanState.streaming) {
    scanState.stream.getTracks().forEach((tr) => tr.stop());
    scanState.streaming = false;
    scanState.torchOn = false;
    wrap.style.display = "none";
    status.style.display = "none";
    torchBtn.style.display = "none";
    torchBtn.classList.remove("active-lang");
    btn.textContent = t("scan.startCamera");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert(t("scan.cameraError") + ": " + t("scan.cameraNotSupported"));
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanState.stream = stream;
    video.srcObject = stream;
    wrap.style.display = "block";
    status.style.display = "block";
    await video.play();
    scanState.streaming = true;
    btn.textContent = t("scan.stopCamera");
    scanLoop();

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      torchBtn.style.display = "inline-flex";
    }
  } catch (err) {
    alert(t("scan.cameraError") + ": " + err.message);
  }
}

async function toggleTorch() {
  if (!scanState.stream) return;
  const track = scanState.stream.getVideoTracks()[0];
  if (!track) return;
  scanState.torchOn = !scanState.torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: scanState.torchOn }] });
    el("torchToggle").classList.toggle("active-lang", scanState.torchOn);
  } catch (e) {
    scanState.torchOn = false;
  }
}

function scanLoop() {
  const video = el("video"), canvas = el("canvas");
  if (!scanState.streaming || !video || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    if (scanState.streaming) requestAnimationFrame(scanLoop);
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // jsQR must be loaded globally
  if (typeof jsQR === 'undefined') {
    console.warn('jsQR not loaded');
    if (scanState.streaming) requestAnimationFrame(scanLoop);
    return;
  }
  const code = jsQR(imageData.data, imageData.width, imageData.height);

  if (code && code.data && code.data.startsWith("FTW1|")) handleQrHit(code.data);
  if (scanState.streaming) requestAnimationFrame(scanLoop);
}

async function handleQrHit(qrId) {
  const now = Date.now();
  const last = scanState.recentHits.get(qrId) || 0;
  if (now - last < 1500) return;
  scanState.recentHits.set(qrId, now);

  if (scanState.recentHits.size > 50) {
    const cutoff = now - 10000;
    for (const [key, value] of scanState.recentHits) {
      if (value < cutoff) scanState.recentHits.delete(key);
    }
  }

  const members = await getAll("members");
  const member = members.find((m) => m.qrId === qrId);
  if (!member) return;
  await queueScan(member.id);
}

// ---------- Members ----------
async function renderMembers() {
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const selected = new Set();

  el("view").innerHTML = `
    <div class="toolbar">
      <label class="btn-primary file-btn">${t("members.importExcel")}<input type="file" id="excelInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>
      <button class="btn-secondary" id="addMemberBtn">${t("members.addMember")}</button>
      <button class="btn-secondary" id="exportMembersBtn">${t("members.exportExcel")}</button>
    </div>
    <div class="toolbar">
      <button class="btn-secondary" id="printQrBtn">${t("members.printAllQr")}</button>
      <button class="btn-primary" id="printSelectedBtn">${t("members.printSelected")} (<span id="selCount">0</span>)</button>
      <button class="btn-secondary" id="selectAllBtn">${t("members.selectAllShown")}</button>
      <button class="btn-secondary" id="clearSelBtn">${t("members.clearSelection")}</button>
    </div>
    <input id="memberSearch" class="text-input" placeholder="${t("members.searchPlaceholder")}"/>
    <select id="gradeFilter" class="text-input">
      <option value="">${t("members.allGrades")}</option>
      ${Array.from({ length: 12 }, (_, i) => i + 1).map((g) => `<option value="${g}">${t("members.gradeShort", { n: g })}</option>`).join("")}
    </select>
    <div id="memberList" class="list"></div>
    <div id="printArea" class="print-only"></div>
  `;

  let lastShown = members;

  function updateSelCount() { el("selCount").textContent = selected.size; }

  function draw(list) {
    lastShown = list;
    const isAdmin = window.currentUserRole === "admin" || !sbClient;
    el("memberList").innerHTML = list.map((m) => `
      <div class="list-row">
        <label class="sel-check">
          <input type="checkbox" data-id="${m.id}" ${selected.has(m.id) ? "checked" : ""}/>
        </label>
        <div style="flex:1;">
          <b>${m.fullName}</b><br>
          <span class="muted">
            ${m.phone || ""}
            ${m.category ? "· " + m.category : ""}
            ${m.grade ? "· " + t("members.gradeShort", { n: m.grade }) : ""}
            ${m.christianName ? "· የክርስትና ስም: " + m.christianName : ""}
          </span>
        </div>
        <div class="row-actions">
          <button class="btn-small" onclick="showQr('${m.id}')">${t("members.qr")}</button>
          <button class="btn-small" onclick="openRegistrationModal('${m.id}')">${t("members.edit")}</button>
          ${isAdmin ? `<button class="btn-small" onclick="deleteMember('${m.id}')">${t("members.delete")}</button>` : ""}
        </div>
      </div>`).join("");

    el("memberList").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
        updateSelCount();
      };
    });
  }

  function applyFilters() {
    const q = el("memberSearch").value.toLowerCase();
    const g = el("gradeFilter").value;
    draw(members.filter((m) => m.fullName.toLowerCase().includes(q) && (g === "" || String(m.grade) === g)));
  }

  draw(members);
  el("memberSearch").oninput = applyFilters;
  el("gradeFilter").onchange = applyFilters;

  el("excelInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const count = await importMembersFromWorkbook(file);
    alert(t("members.importedCount", { n: count }));
    renderMembers();
  };

  el("addMemberBtn").onclick = () => openRegistrationModal();
  el("printQrBtn").onclick = () => printAllQr(members);
  el("printSelectedBtn").onclick = () => {
    if (!selected.size) { alert(t("members.noneSelected")); return; }
    const chosen = members.filter((m) => selected.has(m.id));
    printAllQr(chosen);
  };

  el("selectAllBtn").onclick = () => {
    lastShown.forEach((m) => selected.add(m.id));
    draw(lastShown);
    updateSelCount();
  };

  el("clearSelBtn").onclick = () => {
    selected.clear();
    draw(lastShown);
    updateSelCount();
  };

  el("exportMembersBtn").onclick = () => exportMembersExcel(members);
}

window.deleteMember = async (id) => {
  if (window.currentUserRole !== "admin" && sbClient) { alert(t("role.adminOnly")); return; }
  if (!confirm(t("members.confirmDelete"))) return;
  await del("members", id);
  renderMembers();
};

window.showQr = async (id) => {
  const m = await get("members", id);
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner">
      <h3>${m.fullName}</h3>
      ${m.grade ? `<p class="muted" style="margin-top:-8px;">${t("members.gradeShort", { n: m.grade })}</p>` : ""}
      <div id="qrBox"></div>
      <p class="muted" style="max-width:220px;">${t("members.softCopyNote")}</p>
      <div class="row-actions" style="justify-content:center;margin-top:8px;">
        <button class="btn-small" id="qrDownloadBtn">${t("members.downloadQr")}</button>
        <button class="btn-small" id="qrShareBtn">${t("members.shareQr")}</button>
      </div>
      <button class="btn-secondary" style="margin-top:10px;" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
    </div>`;
  document.body.appendChild(box);
  if (typeof QRCode === 'undefined') {
    alert('QRCode library not loaded');
    return;
  }
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
  downloadBlob(blob, file.name);
}

async function exportMembersExcel(members) {
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
  const rows = members.map((m) => ({
    "ሙሉ ስም": m.fullName,
    "የክርስትና ስም": m.christianName || "",
    "ጾታ": m.gender || "",
    "ዕድሜ": m.age || "",
    "ስልክ": m.phone || "",
    "ተለዋጭ ስልክ": m.altPhone || "",
    "የመኖሪያ አድራሻ": m.address || "",
    "የንስሐ አባት ስም": m.confessionFather || "",
    "የሚያገለግሉበት ደብር": m.parish || "",
    "የወላጅ ስም": m.parentName || "",
    "የወላጅ ስልክ": m.parentPhone || "",
    "የዘመናዊ ትምህርት ደረጃ": m.educationLevel || "",
    "በመንፈሳዊ የትምህርት ደረጃ": m.spiritualEducation || "",
    "ክፍል ደረጃ": m.grade || "",
    "የሚያገለግሉበት ክፍል": m.category || "",
    "ምርጫ 1": m.dept1 || "",
    "ምርጫ 2": m.dept2 || "",
    "ምርጫ 3": m.dept3 || "",
    "የመጨረሻ ንስሃ ቀን": m.lastConfessionDate || "",
    "የተቀላቀሉበት ቀን": m.joinDate || "",
    "QR ID": m.qrId,
    "በአሁኑ ጊዜ ለጥሪ ተመዝግቧል": m.callLog && m.callLog.called ? "አዎ" : "",
    "የመጨረሻ ጥሪ ምክንያት": m.callLog ? (m.callLog.reason || "") : "",
    "ጠቅላላ ጥሪ ቁጥር": (m.callHistory || []).length,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Members");
  XLSX.writeFile(wb, `finote-members-${todayISO()}.xlsx`);
}

async function printAllQr(members) {
  if (typeof QRCode === 'undefined') { alert('QRCode library not loaded'); return; }
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
      infoHalf.innerHTML = `<div class="photo-box"></div><div class="id-name">${m.fullName}</div><div class="id-org">${m.grade ? t("members.gradeShort", { n: m.grade }) + " · " : ""}ፍኖተ ጥበብ ሰ/ት/ቤት</div>`;
      card.appendChild(infoHalf);
      page.appendChild(card);
      new QRCode(qrHalf, { text: m.qrId, width: 240, height: 240 });
    }
    area.appendChild(page);
  }
  await new Promise((r) => setTimeout(r, 300));
  window.print();
}

// ---------- Registration Modal ----------
window.openRegistrationModal = async function(editId) {
  const member = editId ? await get("members", editId) : null;
  const isEdit = !!member;
  const deptOptions = [
    "ትምህርትና ስልጠና ክፍል",
    "ዜማና ስነ-ጥበባት ክፍል",
    "መርኃ ግብርና ጉባኤያት ክፍል",
    "የሰው ሀብት አስተዳደር ክፍል",
    "የፋይናንስ እና ንብረት አስተዳደር ክፍል",
    "እቅድ እና ልማት ክፍል",
    "መረጃና የውስጥ ግንኙነት ክፍል",
    "የሕጻናት እና ታዳጊዎች አስተዳደር ክፍል",
    "ምግባረ ሰናይ ክፍል"
  ];

  const deptSelect = (name, selected) => `
    <select id="${name}" class="text-input">
      <option value="">---</option>
      ${deptOptions.map(d => `<option value="${d}" ${d===selected?'selected':''}>${d}</option>`).join('')}
    </select>`;

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:500px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${isEdit ? t("members.editMember") : t("members.addMember")}</h3>
      <form id="regForm">
        <label>${t("members.fullName")} *</label>
        <input id="f_fullName" class="text-input" value="${member?.fullName||''}" required>
        <label>${t("members.christianName")}</label>
        <input id="f_christianName" class="text-input" value="${member?.christianName||''}">
        <label>${t("members.gender")}</label>
        <select id="f_gender" class="text-input">
          <option value="">---</option>
          <option value="ወንድ" ${member?.gender==='ወንድ'?'selected':''}>ወንድ</option>
          <option value="ሴት" ${member?.gender==='ሴት'?'selected':''}>ሴት</option>
        </select>
        <label>${t("members.age")}</label>
        <input id="f_age" type="number" class="text-input" value="${member?.age||''}">
        <label>${t("members.phone")}</label>
        <input id="f_phone" class="text-input" value="${member?.phone||''}">
        <label>${t("members.altPhone")}</label>
        <input id="f_altPhone" class="text-input" value="${member?.altPhone||''}">
        <label>${t("members.address")}</label>
        <input id="f_address" class="text-input" value="${member?.address||''}">
        <label>${t("members.confessionFather")}</label>
        <input id="f_confessionFather" class="text-input" value="${member?.confessionFather||''}">
        <label>${t("members.parish")}</label>
        <input id="f_parish" class="text-input" value="${member?.parish||''}">
        <label>${t("members.parentName")}</label>
        <input id="f_parentName" class="text-input" value="${member?.parentName||''}">
        <label>${t("members.parentPhone")}</label>
        <input id="f_parentPhone" class="text-input" value="${member?.parentPhone||''}">
        <label>${t("members.educationLevel")}</label>
        <input id="f_educationLevel" class="text-input" value="${member?.educationLevel||''}">
        <label>${t("members.spiritualEducation")}</label>
        <input id="f_spiritualEducation" class="text-input" value="${member?.spiritualEducation||''}">
        <label>${t("members.grade")}</label>
        <input id="f_grade" type="number" class="text-input" placeholder="1-12" value="${member?.grade||''}">
        <label>${t("members.assignedDept")}</label>
        <input id="f_assignedDept" class="text-input" value="${member?.category||''}" placeholder="${t("members.assignedDeptPlaceholder")}">
        <label>${t("members.deptPref1")}</label>
        ${deptSelect('f_dept1', member?.dept1)}
        <label>${t("members.deptPref2")}</label>
        ${deptSelect('f_dept2', member?.dept2)}
        <label>${t("members.deptPref3")}</label>
        ${deptSelect('f_dept3', member?.dept3)}
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button type="submit" class="btn-primary">${isEdit ? t("members.update") : t("members.save")}</button>
          <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(box);

  box.querySelector("#regForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      fullName: el("f_fullName").value.trim(),
      christianName: el("f_christianName").value.trim(),
      gender: el("f_gender").value,
      age: el("f_age").value ? Number(el("f_age").value) : null,
      phone: el("f_phone").value.trim(),
      altPhone: el("f_altPhone").value.trim(),
      address: el("f_address").value.trim(),
      confessionFather: el("f_confessionFather").value.trim(),
      parish: el("f_parish").value.trim(),
      parentName: el("f_parentName").value.trim(),
      parentPhone: el("f_parentPhone").value.trim(),
      educationLevel: el("f_educationLevel").value.trim(),
      spiritualEducation: el("f_spiritualEducation").value.trim(),
      grade: el("f_grade").value.trim(),
      category: el("f_assignedDept").value.trim(),
      dept1: el("f_dept1").value,
      dept2: el("f_dept2").value,
      dept3: el("f_dept3").value,
    };

    if (!data.fullName) { alert(t("members.fullNameRequired")); return; }

    if (isEdit) {
      const m = await get("members", member.id);
      if (!m) { alert("Member not found"); return; }

      m.fullName = data.fullName;
      m.christianName = data.christianName;
      m.gender = data.gender;
      m.age = data.age;
      m.phone = data.phone;
      m.altPhone = data.altPhone;
      m.address = data.address;
      m.confessionFather = data.confessionFather;
      m.parish = data.parish;
      m.parentName = data.parentName;
      m.parentPhone = data.parentPhone;
      m.educationLevel = data.educationLevel;
      m.spiritualEducation = data.spiritualEducation;
      m.grade = data.grade ? normalizeGrade(data.grade) : null;
      m.category = data.category;
      m.dept1 = data.dept1;
      m.dept2 = data.dept2;
      m.dept3 = data.dept3;
      m.synced = false;

      await put("members", m);
    } else {
      await addMemberManual(
        data.fullName,
        data.phone,
        data.category,
        data.grade,
        data
      );
    }
    box.remove();
    renderMembers();
  };
};

// ---------- Reports ----------
let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach((c) => { try { c.destroy(); } catch (e) {} });
  chartInstances = [];
}

function drawNoDataMessage(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#9c9187";
  ctx.font = "14px 'Noto Sans Ethiopic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function drawCharts(attendance, progs, gradeStats) {
  destroyCharts();

  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (getLang() === 'am') {
      const eth = gregorianToEthiopian(d);
      return `${eth.day} ${ETH_MONTH_NAMES_AM[eth.month]}`;
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  // ---- Attendance trend ----
  const trendCanvas = el("trendChart");
  if (trendCanvas) {
    const byDate = {};
    attendance.forEach(a => { byDate[a.sessionDate] = (byDate[a.sessionDate] || 0) + 1; });
    const sortedDates = Object.keys(byDate).sort();

    if (!sortedDates.length) {
      drawNoDataMessage(trendCanvas, t("charts.noData"));
    } else {
      const labels = sortedDates.map(d => formatDateLabel(d));
      const data = sortedDates.map(d => byDate[d]);

      if (typeof Chart !== 'undefined') {
        const ctx = trendCanvas.getContext('2d');
        const chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: t('charts.attendanceTrend'),
              data: data,
              borderColor: '#f2a33c',
              backgroundColor: 'rgba(242,163,60,0.15)',
              tension: 0.3,
              fill: true,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.parsed.y} ${getLang() === 'am' ? 'ቅኝት' : 'scans'}`
                }
              }
            },
            scales: {
              x: {
                ticks: { color: '#9c9187', maxRotation: 45 },
                grid: { color: 'rgba(255,255,255,0.06)' }
              },
              y: {
                ticks: { color: '#9c9187', beginAtZero: true },
                grid: { color: 'rgba(255,255,255,0.06)' }
              }
            }
          }
        });
        chartInstances.push(chart);
      } else if (typeof FinoteCharts !== 'undefined') {
        FinoteCharts.drawLineChart(trendCanvas, labels, data, { noDataText: t('charts.noData') });
      }
    }
  }

  // ---- By program ----
  const progCanvas = el("progChart");
  if (progCanvas) {
    const onTime = progs.map(p => attendance.filter(a => a.programKey === p.key && a.status === "on-time").length);
    const late = progs.map(p => attendance.filter(a => a.programKey === p.key && a.status === "late").length);
    const labels = progs.map(p => p.name);
    const total = onTime.reduce((a,b)=>a+b,0) + late.reduce((a,b)=>a+b,0);

    if (total === 0) {
      drawNoDataMessage(progCanvas, t("charts.noData"));
    } else if (typeof Chart !== 'undefined') {
      const ctx = progCanvas.getContext('2d');
      chartInstances.push(new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: t('scan.onTime'), data: onTime, backgroundColor: '#4caf7d' },
            { label: t('scan.late'), data: late, backgroundColor: '#e0605a' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, ticks: { color: '#9c9187' } },
            y: { stacked: true, ticks: { color: '#9c9187' }, beginAtZero: true }
          },
          plugins: {
            legend: { labels: { color: '#f2ede6' } }
          }
        }
      }));
    } else if (typeof FinoteCharts !== 'undefined') {
      FinoteCharts.drawBarChart(progCanvas, labels,
        [{ label: t('scan.onTime'), values: onTime, color: '#4caf7d' },
         { label: t('scan.late'), values: late, color: '#e0605a' }],
        { stacked: true, noDataText: t('charts.noData') }
      );
    }
  }

  // ---- By grade ----
  const gradeCanvas = el("gradeChart");
  if (gradeCanvas) {
    if (gradeStats && gradeStats.rows.length && typeof Chart !== 'undefined') {
      const rowsAsc = [...gradeStats.rows].sort((a,b) => a.grade - b.grade);
      const labels = rowsAsc.map(r => (getLang() === "am" ? "ክፍል " : "Grade ") + r.grade);
      const values = rowsAsc.map(r => Math.round(r.rate * 100));
      const ctx = gradeCanvas.getContext('2d');
      chartInstances.push(new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: t('charts.byGrade'),
            data: values,
            backgroundColor: '#f2a33c'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.parsed.y}%`
              }
            }
          },
          scales: {
            x: { ticks: { color: '#9c9187' } },
            y: { ticks: { color: '#9c9187', callback: (v) => v + '%' }, beginAtZero: true, max: 100 }
          }
        }
      }));
    } else {
      drawNoDataMessage(gradeCanvas, t("charts.noData"));
    }
  }
}

async function renderReports() {
  const attendance = (await getAll("attendance")).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const members = await getAll("members");
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  const earliestDate = attendance.length ? attendance.reduce((min, a) => (a.sessionDate < min ? a.sessionDate : min), attendance[0].sessionDate) : todayISO();
  const gradeStats = await computeGradeStats(earliestDate, todayISO());
  const gradeNarrative = buildGradeNarrative(gradeStats.rows, getLang());

  el("view").innerHTML = `
    <div class="toolbar"><button id="repExcel" class="btn-secondary">${t("reports.downloadExcel")}</button></div>

    <h3 class="section-title">${t("charts.attendanceTrend")}</h3>
    <div class="chart-box"><canvas id="trendChart"></canvas></div>

    <h3 class="section-title">${t("charts.byProgram")}</h3>
    <div class="chart-box"><canvas id="progChart"></canvas></div>

    <h3 class="section-title">${t("charts.byGrade")}</h3>
    <div class="chart-box"><canvas id="gradeChart"></canvas></div>
    ${gradeNarrative.length ? `<div class="list">${gradeNarrative.map((l) => `<div class="list-row"><div class="muted">${l}</div></div>`).join("")}</div>` : `<p class="muted">${t("charts.noData")}</p>`}

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
  drawCharts(attendance, progs, gradeStats);
}

// ---------- Plan ----------
async function renderPlan() {
  const planItems = await getAll("planItems");
  const categories = [
    { key: "main", label: t("plan.mainCategory") },
    { key: "internal", label: t("plan.internalCategory") },
  ];
  const isAdmin = window.currentUserRole === "admin" || !sbClient;

  el("view").innerHTML = `
    <div class="toolbar">
      <button id="exportPlanBtn" class="btn-secondary">${t("plan.exportExcel")}</button>
      ${isAdmin ? `<button id="generateReportBtn" class="btn-primary">${getLang() === "am" ? "ሪፖርት አዘጋጅ" : "Generate Report"}</button>` : ""}
    </div>

    ${categories.map(cat => `
      <h3 class="section-title">${cat.label}</h3>
      <div class="list">
        ${planItems.filter(p => p.category === cat.key).map(p => `
          <div class="list-row">
            <div style="flex:1;">
              <b>${p.no}. ${p.title}</b><br>
              <span class="muted">${p.subUnit} · ${p.timing}</span><br>
              ${p.nextDate ? `<span class="muted">${t("plan.next")}: ${ethLabel(p.nextDate)} (${p.nextDate})</span>` : ""}
            </div>
            <div class="row-actions">
              ${p.nextDate && p.nextDate <= todayISO() ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
              <button class="btn-small" onclick="markPlanDone('${p.id}')">${t("plan.markDone")}</button>
            </div>
          </div>`).join("")}
      </div>
    `).join("")}
  `;

  el("exportPlanBtn").onclick = () => exportPlanExcel(planItems);
  const reportBtn = el("generateReportBtn");
  if (reportBtn) reportBtn.onclick = () => generatePlanReport(planItems);
}

window.markPlanDone = async (id) => {
  const note = prompt(t("plan.doneNotePrompt")) || "";
  await markPlanItemDone(id, note);
  renderPlan();
};

async function exportPlanExcel(planItems) {
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
  const rows = planItems.map(p => ({
    "ተ.ቁ": p.no,
    "ንዑስ ክፍል": p.subUnit,
    "ርዕስ": p.title,
    "ዝርዝር": p.details || "",
    "ውጤት": p.outcome || "",
    "መለኪያ": p.indicator || "",
    "ዒላማ": p.metricTarget || "",
    "ጊዜ": p.timing,
    "አስፈጻሚ": p.executor,
    "በጀት": p.budget || "-",
    "ቀጣይ ቀን": p.nextDate || "",
    "የመጨረሻ መከናወን": p.lastDone || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan");
  XLSX.writeFile(wb, `finote-plan-${todayISO()}.xlsx`);
}

// Admin-only printable summary report — separate from the raw Excel export
// above. Opens a new tab with a formatted table per category plus a
// completed/overdue count, then triggers the browser print dialog.
function generatePlanReport(planItems) {
  const today = todayISO();
  const categories = [
    { key: "main", label: t("plan.mainCategory") },
    { key: "internal", label: t("plan.internalCategory") },
  ];
  const doneCount = planItems.filter((p) => p.lastDone).length;
  const overdueCount = planItems.filter((p) => p.nextDate && p.nextDate <= today).length;
  const lang = getLang();

  const tableFor = (cat) => `
    <h2>${cat.label}</h2>
    <table>
      <tr>
        <th>#</th>
        <th>${lang === "am" ? "ርዕስ" : "Title"}</th>
        <th>${lang === "am" ? "ንዑስ ክፍል" : "Sub-unit"}</th>
        <th>${lang === "am" ? "አስፈጻሚ" : "Executor"}</th>
        <th>${lang === "am" ? "ቀጣይ ቀን" : "Next Due"}</th>
        <th>${lang === "am" ? "የመጨረሻ መከናወን" : "Last Done"}</th>
        <th>${lang === "am" ? "ሁኔታ" : "Status"}</th>
      </tr>
      ${planItems.filter((p) => p.category === cat.key).map((p) => `
        <tr>
          <td>${p.no}</td>
          <td>${p.title}</td>
          <td>${p.subUnit}</td>
          <td>${p.executor}</td>
          <td>${p.nextDate || "-"}</td>
          <td>${p.lastDone || "-"}</td>
          <td>${p.nextDate && p.nextDate <= today ? (lang === "am" ? "ዘግይቷል" : "Overdue") : (lang === "am" ? "በጊዜ" : "On Track")}</td>
        </tr>`).join("")}
    </table>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${lang === "am" ? "የዕቅድ ሪፖርት" : "Plan Report"} — ${today}</title>
<style>
  body { font-family: 'Noto Sans Ethiopic', Arial, sans-serif; padding: 24px; color: #222; }
  h1 { margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 28px; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #eee; }
</style>
</head><body>
  <h1>${lang === "am" ? "የዕቅድ ሪፖርት" : "Plan Report"}</h1>
  <p>${today} · ${lang === "am" ? "የተጠናቀቁ" : "Completed"}: ${doneCount}/${planItems.length} · ${lang === "am" ? "የዘገዩ" : "Overdue"}: ${overdueCount}</p>
  ${categories.map(tableFor).join("")}
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert(lang === "am" ? "ብቅ-ባይ ማገጃ እባክዎ ይፍቀዱ" : "Please allow pop-ups to generate the report.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ---------- Settings ----------
async function renderSettings() {
  const settings = await getSettings();
  const programs = await getAll("programs");
  const session = await getSession();
  const cfg = getSupabaseConfig();
  const notifOn = await notifIsEnabled();
  const notifSupported = notifIsSupported();
  const bioOn = await bioIsEnabled();
  const bioSupported = await bioIsSupported();
  const lang = getLang();

  function displayTime(gregTime) {
    if (getLang() === 'am' && gregTime) {
      return gregorianToEthiopianTime(gregTime);
    }
    return gregTime || '';
  }

  el("view").innerHTML = `
    <h3 class="section-title">${t("settings.languageTitle")}</h3>
    <div class="toolbar">
      <button class="btn-secondary ${getLang() === "am" ? "active-lang" : ""}" id="langAm">አማርኛ</button>
      <button class="btn-secondary ${getLang() === "en" ? "active-lang" : ""}" id="langEn">English</button>
    </div>

    <h3 class="section-title">${lang === "am" ? "መለያ" : "Account"}</h3>
    <p class="muted">
      ${lang === "am" ? "ደረጃ" : "Role"}:
      <b>${window.currentUserRole === "admin" ? (lang === "am" ? "አስተዳዳሪ" : "Admin") : (lang === "am" ? "አባል" : "Member")}</b>
      ${window.currentDisplayName ? " · " + window.currentDisplayName : ""}
    </p>
    ${sbClient
      ? `<button id="signOutBtn" class="btn-secondary">${lang === "am" ? "ውጣ" : "Sign Out"}</button>`
      : `<p class="muted">${lang === "am" ? "ያለ ደመና ሁነታ እየሰሩ ነው" : "Running without cloud sync"}</p>`}

    <h3 class="section-title">${t("settings.generalTitle")}</h3>
    <div class="form-grid">
      <label>${t("settings.defaultStart")}</label>
      <input id="s_startTime" class="text-input" placeholder="${getLang() === 'am' ? 'ለምሳሌ ከቀኑ 6:00 = 0, 12:00 = 6, ምሽቱ 6:00 = 12 ይተይቡ' : 'e.g. 6AM=0, 12PM=6, 6PM=12'}" value="${displayTime(settings.defaultStartTime)}"/>
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
            <input class="text-input small" placeholder="${getLang() === 'am' ? 'ሰዓት' : 'HH:MM'}" id="pt_${p.key}" value="${displayTime(p.startTime)}"/>
            <input class="text-input small" placeholder="min" id="pg_${p.key}" value="${p.graceMinutes || ''}"/>
          </div>
        </div>`).join("")}
    </div>
    <button id="saveProgs" class="btn-secondary">${t("settings.saveProgramTimes")}</button>

    <h3 class="section-title">${lang === "am" ? "ማሳወቂያዎች" : "Notifications"}</h3>
    <p class="muted">${lang === "am" ? "በዚህ መሳሪያ ላይ ብቻ የሚታዩ የአካባቢ ማስታወሻዎች ናቸው (ማዕከላዊ push አገልጋይ የለም)።" : "Local reminders shown only on this device — there's no push server behind these."}</p>
    ${notifSupported
      ? `<div class="toolbar"><button id="notifToggleBtn" class="btn-secondary">${notifOn ? (lang === "am" ? "ማሳወቂያዎችን አጥፋ" : "Disable Reminders") : (lang === "am" ? "ማሳወቂያዎችን አብራ" : "Enable Reminders")}</button></div>`
      : `<p class="muted">${lang === "am" ? "በዚህ መሣሪያ/አሳሽ ማሳወቂያ አይደገፍም" : "Notifications aren't supported on this device/browser."}</p>`}

    <h3 class="section-title">${lang === "am" ? "የባዮሜትሪክ መቆለፊያ" : "Biometric Lock"}</h3>
    <p class="muted">${lang === "am" ? "መተግበሪያውን በሚከፍቱበት ጊዜ በዚህ መሣሪያ ላይ በጣት አሻራ/በፊት ማወቂያ እንዲቆለፍ ያድርጉ።" : "Require this device's fingerprint/face unlock to open the app."}</p>
    ${bioSupported
      ? `<div class="toolbar"><button id="bioToggleBtn" class="btn-secondary">${bioOn ? (lang === "am" ? "መቆለፊያውን አጥፋ" : "Disable Lock") : (lang === "am" ? "መቆለፊያውን አብራ" : "Enable Lock")}</button></div>`
      : `<p class="muted">${lang === "am" ? "በዚህ መሣሪያ ላይ አይደገፍም" : "Not supported on this device."}</p>`}

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

  const signOutBtn = el("signOutBtn");
  if (signOutBtn) signOutBtn.onclick = signOut;

  const notifBtn = el("notifToggleBtn");
  if (notifBtn) {
    notifBtn.onclick = async () => {
      if (notifOn) {
        await notifDisable();
      } else {
        try {
          await notifEnable();
          checkAndNotify();
        } catch (e) {
          alert(e.message);
        }
      }
      renderSettings();
    };
  }

  const bioBtn = el("bioToggleBtn");
  if (bioBtn) {
    bioBtn.onclick = async () => {
      if (bioOn) {
        await bioDisable();
      } else {
        try {
          await bioEnable();
        } catch (e) {
          alert(e.message);
        }
      }
      renderSettings();
    };
  }

  el("saveSettings").onclick = async () => {
    let startTime = el("s_startTime").value || "10:00";
    if (getLang() === "am" && startTime) startTime = ethiopianToGregorianTime(startTime);
    await setSetting("defaultStartTime", startTime);
    await setSetting("graceMinutes", Number(el("s_grace").value) || 0);
    await setSetting("confessionIntervalMonths", Number(el("s_conf").value) || 12);
    await setSetting("absenceThreshold", Number(el("s_abs").value) || 3);
    await setSetting("deviceName", el("s_device").value || "");
    alert(t("settings.saved"));
  };

  el("saveProgs").onclick = async () => {
    for (const p of programs) {
      let startTime = el("pt_" + p.key).value || "";
      if (getLang() === "am" && startTime) startTime = ethiopianToGregorianTime(startTime);
      p.startTime = startTime;
      p.graceMinutes = el("pg_" + p.key).value || "";
      await put("programs", p);
    }
    alert(t("settings.saved"));
  };

  el("syncBtn").onclick = syncNow;
  el("exportJsonBtn").onclick = exportScansJSON;
  el("exportExcelBtn").onclick = exportAttendanceExcel;

  el("importJsonInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { mCount, aCount } = await importScansJSON(file);
    alert(t("settings.importedJsonResult", { m: mCount, a: aCount }));
  };
}

// ---------- Tabs ----------
const RENDERERS = { dashboard: renderDashboard, scan: renderScan, members: renderMembers, plan: renderPlan, settings: renderSettings, reports: renderReports };

function setTab(tabName) {
  if (scanState.streaming) toggleCamera();
  currentTab = tabName;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
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
    if (await bioIsEnabled()) { appState = "biolock"; renderBioLock(); return; }
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
  tryUnlock();
}

async function enterApp() {
  appState = "app";
  document.querySelector("nav.tabs").style.display = "flex";
  setTab("dashboard");
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
    boot();
  } catch (err) {
    console.error("Init error:", err);
    el("view").innerHTML = `<div class="auth-wrap"><h2>Error</h2><p>${err.message}</p></div>`;
  }
}
document.addEventListener("DOMContentLoaded", init);

// ---------- charts.js fallback ----------
window.FinoteCharts = (function() {
  function fcSetupCanvas(canvas) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: w, height: h };
  }

  function fcNiceMax(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const norm = v / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function fcDrawAxes(ctx, w, h, pad, maxVal, opts) {
    ctx.strokeStyle = "#332c26";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (maxVal / steps) * i;
      const y = h - pad.bottom - (h - pad.top - pad.bottom) * (maxVal ? v / maxVal : 0);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#9c9187";
      ctx.fillText((opts && opts.percent ? Math.round(v) + "%" : String(Math.round(v))), pad.left - 6, y);
    }
  }

  function fcDrawXLabels(ctx, labels, pad, w, h) {
    ctx.fillStyle = "#9c9187";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const innerW = w - pad.left - pad.right;
    const n = labels.length || 1;
    const maxLabels = 12;
    let indices = labels.map((_, i) => i);
    if (n > maxLabels) {
      const step = Math.ceil(n / maxLabels);
      indices = labels.map((_, i) => i).filter((_, i) => i % step === 0);
      if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
    }
    indices.forEach((i) => {
      const label = String(labels[i]);
      const x = pad.left + (innerW * (i + 0.5)) / n;
      ctx.fillText(label, x, h - pad.bottom + 6);
    });
  }

  function fcNoData(canvas, text) {
    const { ctx, width: w, height: h } = fcSetupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#9c9187";
    ctx.font = "13px 'Noto Sans Ethiopic', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const words = text.split(" ");
    let line = "", cy = 8;
    const maxWidth = w - 16;
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, 8, cy);
        line = word;
        cy += 16;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, 8, cy);
  }

  function fcDrawLineChart(canvas, labels, values, opts = {}) {
    const { ctx, width: w, height: h } = fcSetupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!values.length) return fcNoData(canvas, opts.noDataText || "");
    const pad = { left: 34, right: 10, top: 10, bottom: 22 };
    const maxVal = fcNiceMax(Math.max(...values, 1));
    fcDrawAxes(ctx, w, h, pad, maxVal);
    fcDrawXLabels(ctx, labels, pad, w, h);
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const n = values.length;
    const pts = values.map((v, i) => ({
      x: pad.left + (innerW * (i + 0.5)) / n,
      y: h - pad.bottom - innerH * (maxVal ? v / maxVal : 0),
    }));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h - pad.bottom);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, h - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(242,163,60,0.15)";
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "#f2a33c";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#f2a33c";
    pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
  }

  function fcDrawBarChart(canvas, labels, datasets, opts = {}) {
    const { ctx, width: w, height: h } = fcSetupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!labels.length || !datasets.length) return fcNoData(canvas, opts.noDataText || "");
    const pad = { left: 34, right: 10, top: opts.legend ? 22 : 10, bottom: 22 };
    const n = labels.length;
    let maxVal;
    if (opts.percent) {
      maxVal = 100;
    } else if (opts.stacked) {
      const totals = labels.map((_, i) => datasets.reduce((s, d) => s + (d.values[i] || 0), 0));
      maxVal = fcNiceMax(Math.max(...totals, 1));
    } else {
      maxVal = fcNiceMax(Math.max(...datasets.flatMap((d) => d.values), 1));
    }
    fcDrawAxes(ctx, w, h, pad, maxVal, opts);
    fcDrawXLabels(ctx, labels, pad, w, h);
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const groupW = innerW / n;
    const dsCount = datasets.length;
    const barGap = 3;
    const barW = opts.stacked ? groupW * 0.55 : (groupW * 0.72) / dsCount;

    labels.forEach((_, i) => {
      let stackedY = h - pad.bottom;
      datasets.forEach((ds, di) => {
        const v = ds.values[i] || 0;
        const barH = innerH * (maxVal ? v / maxVal : 0);
        let x;
        if (opts.stacked) {
          x = pad.left + groupW * i + (groupW - barW) / 2;
        } else {
          const totalW = dsCount * barW + (dsCount - 1) * barGap;
          x = pad.left + groupW * i + (groupW - totalW) / 2 + di * (barW + barGap);
        }
        const y = opts.stacked ? stackedY - barH : h - pad.bottom - barH;
        ctx.fillStyle = ds.color;
        ctx.fillRect(x, y, Math.max(1, barW), Math.max(0, barH));
        if (opts.stacked) stackedY -= barH;
      });
    });

    if (opts.legend) {
      let lx = pad.left;
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      datasets.forEach((ds) => {
        ctx.fillStyle = ds.color;
        ctx.fillRect(lx, 4, 10, 10);
        ctx.fillStyle = "#f2ede6";
        ctx.fillText(ds.label, lx + 14, 9);
        lx += 14 + ctx.measureText(ds.label).width + 16;
      });
    }
  }

  return {
    drawLineChart: fcDrawLineChart,
    drawBarChart: fcDrawBarChart
  };
})();

// Note: renderSupabaseSetup() / renderAuthScreen() / renderOfflineNoSession()
// are defined in auth.js — don't redeclare them here (that would silently
// shadow the real sign-in UI with an empty stub).
