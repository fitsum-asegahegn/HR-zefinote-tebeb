/* ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)
   Offline-first via IndexedDB. Supabase is optional for multi-device sync + auth. */

// ---------- Constants ----------
const DB_NAME = "finote_attendance";
const DB_VERSION = 2;
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
// ---------- Plan (seeded exactly from የሰው ሀብት ክፍል ዕቅድ.docx) ----------
// timing text is kept verbatim for display; recurrenceDays is a practical
// heuristic for the dashboard due-date badge (Ethiopian-calendar month
// names aren't converted to exact Gregorian dates — HR can always adjust
// the cadence per item, or just use ተከናውኗል/mark-done manually).
const DEFAULT_PLAN_MAIN = [
  { no: 1, subUnit: "የአባላት አስተዳደር", title: "አዳዲስ አባላትን መመልመልና ማቀላቀል (ዲጂታል ዘመቻን ጨምሮ)", details: "ኦሪየንቴሽን ማዘጋጀት፤ በቴሌግራም/ማህበራዊ ሚዲያ/ድረ-ገጽ አዲስ አባላትን መሳብ፤ የአባላት መሠረታዊ መረጃ መሰብሰብ", outcome: "የአባላት ቁጥር እድገትና ተጨማሪ የሰው ኃይል", indicator: "የተመዘገቡ አዳዲስ አባላት ብዛት", metricTarget: "በቁጥር (ዒላማ ተቀምጦ)", timing: "መስከረም–ጥቅምት", executor: "የአባላት አስተዳደር ንዑስ ክፍል", budget: "-", recurrenceDays: 365 },
  { no: 2, subUnit: "የአባላት አስተዳደር", title: "የሰው ኃይል ድልድል ማዘጋጀት", details: "የተቀበሉ አባላትን ችሎታና ዝንባሌ መሠረት ያደረገ የአገልግሎት ምደባ ማዘጋጀት", outcome: "ትክክለኛና ውጤታማ ምደባ", indicator: "የተመደቡ አባላት ብዛት", metricTarget: "100%", timing: "ጥቅምት", executor: "የአባላት አስተዳደር ንዑስ ክፍል", budget: "-", recurrenceDays: 365 },
  { no: 3, subUnit: "የአባላት አስተዳደር", title: "የአቅም ግንባታ ስልጠና ማዘጋጀትና መስጠት", details: "ንዑስ ክፍላትን በርዕስ መመደብ፤ አሰልጣኝ መምረጥ፤ ክፍለ ጊዜ ወስኖ ስልጠና መስጠት፤ ከሌሎች ክፍላት ጋር በመተባበር", outcome: "የተሻለ ክህሎትና አቅም ያላቸው አባላት", indicator: "የተሰጡ ስልጠናዎች ብዛት", metricTarget: "100% አፈጻጸም", timing: "ነሐሴ/እንደአስፈላጊነቱ", executor: "የአባላት አስተዳደር ንዑስ ክፍል", budget: "-", recurrenceDays: 365 },
  { no: 4, subUnit: "የአባላት አስተዳደር", title: "የአመራር ማፍሪያ ሥርዓት (ንዑ.አን. ፳/3.13, 3.20)", details: "አባላትን በሥነ-ልቦናና በክህሎት ለአመራርነት ማዘጋጀት፤ ማበረታቻና ተጠያቂነት መሠረት ያደረገ አገልግሎት መተግበር", outcome: "ለቀጣይ አመራርነት የተዘጋጁ አባላት", indicator: "የተመረቁ/የሠለጠኑ ተሳታፊዎች", metricTarget: "በዓመት 1 ዙር", timing: "ግንቦት–ሰኔ", executor: "የአባላት አስተዳደር ንዑስ ክፍል", budget: "-", recurrenceDays: 365 },
  { no: 5, subUnit: "የአባላት አስተዳደር", title: "አዲስ አባላት አቀባበልና አቅጣጫ ማሳወቅ (ንዑ.አን. ፳/3.19)", details: "አዳዲስ አባላት የአገልግሎት ሕይወታቸውን እንዴት መምራት እንዳለባቸው መመሪያ መስጠት", outcome: "በትክክለኛ አቅጣጫ የገቡ አዲስ አባላት", indicator: "ኦሪየንቴሽን የወሰዱ ብዛት", metricTarget: "100%", timing: "እንደተቀላቀሉ ወዲያውኑ", executor: "የአባላት አስተዳደር ንዑስ ክፍል", budget: "-", recurrenceDays: 0 },
  { no: 6, subUnit: "የአባላት መረጃ", title: "የአባላት ፎርም ማስሞላትና መረጃ ማደራጀት", details: "ሁሉንም አባላት መረጃ ማደስ፣ ማደራጀት፤ ቅጽ ማዘጋጀትና በየጊዜው መያዝ", outcome: "የተደራጀ የአባላት ዘመናዊ መረጃ", indicator: "የተሞሉ ፎርሞች ብዛት", metricTarget: "100%", timing: "ጥቅምት፣ የካቲት፣ ከመስከረም–ነሐሴ", executor: "የአባላት መረጃ ንዑስ ክፍል", budget: "-", recurrenceDays: 91 },
  { no: 7, subUnit: "የአባላት መረጃ", title: "የተሳትፎ (ስም) ቁጥጥር", details: "በመደበኛ መርሐ ግብራት ላይ ተገኝነትን በየጊዜው መመዝገብና ማጠናቀር", outcome: "ትክክለኛ የተሳትፎ መረጃ ለውሳኔ", indicator: "የተመዘገበ ተሳትፎ መጠን", metricTarget: "ወርሃዊ ሪፖርት", timing: "ከመስከረም–ነሐሴ", executor: "የአባላት መረጃ ንዑስ ክፍል", budget: "-", recurrenceDays: 30, autoMetric: "attendanceLogged" },
  { no: 8, subUnit: "የአባላት መረጃ", title: "በየሩብ ዓመቱ የጠፉ/የራቁ አባላትን መለየትና መመለስ", details: "በመርሐግብራት የማይገኙ አባላትን መለየት፤ በስልክና ደብዳቤ መጥራት፤ ምክንያታቸውን አጥንቶ በምክር መመለስ", outcome: "አባላትን ወደ አገልግሎት መመለስ", indicator: "የተመለሱ አባላት ብዛት", metricTarget: "100%", timing: "በየሩብ ዓመቱ", executor: "የአባላት መረጃ ንዑስ ክፍል", budget: "-", recurrenceDays: 91, autoMetric: "absentees" },
  { no: 9, subUnit: "ምክረ አበው", title: "የንስሃና ቁርባን ሕይወት ክትትል", details: "አባላት ንስሃ አባት እንዲኖራቸው ማድረግ፤ የንስሃና ቁርባን ሕይወታቸውን ማጠናከር", outcome: "የተጠናከረ መንፈሳዊ ሕይወት", indicator: "የንስሃና ቁርባን ተሳትፎ መጠን", metricTarget: "100%", timing: "ከመስከረም–ነሐሴ", executor: "ምክረ አበው ንዑስ ክፍል", budget: "-", recurrenceDays: 30, autoMetric: "confession" },
  { no: 10, subUnit: "ምክረ አበው", title: "ሚስጥራዊ የምክር አገልግሎት መስመር (ንዑ.አን. ፳/3.16-3.17)", details: "ታማኝና ሚስጥር ጠባቂ የመረጃ ፍሰት መፍጠር፤ በሐዘን/በደስታ ጊዜ የሞራል ድጋፍና ምክር መስጠት", outcome: "የተደገፉ አባላት", indicator: "ምክር የተሰጣቸው አባላት ብዛት", metricTarget: "እንደአስፈላጊነቱ", timing: "ዓመቱን ሙሉ", executor: "ምክረ አበው ንዑስ ክፍል", budget: "-", recurrenceDays: 0 },
  { no: 11, subUnit: "ምክረ አበው", title: "በአባላት መካከል የሚፈጠሩ አለመግባባቶችን መፍታት", details: "አለመግባባቶች በክርስቲያናዊ ፍቅርና በምክር እንዲታረቁ ማድረግ", outcome: "የተረጋጋ የአገልግሎት ከባቢ", indicator: "የተፈቱ አለመግባባቶች ብዛት", metricTarget: "100% አፈጻጸም", timing: "እንደአስፈላጊነቱ", executor: "ምክረ አበው ንዑስ ክፍል", budget: "-", recurrenceDays: 0 },
  { no: 12, subUnit: "ህጻናትና ታዳጊ ክትትል", title: "ከሕጻናትና ታዳጊ ክፍል (አንቀጽ ፳፭) ጋር ተቀናጅቶ የአባልነት ሽግግር ክትትል", details: "ከ8ኛ ክፍል በላይ ወደ ወጣት ክፍል የሚሸጋገሩ ታዳጊዎችን፣ እንዲሁም ከ18 ዓመት በላይ ወደ መደበኛ አባልነት የሚሸጋገሩትን በጋራ ማወዳደር (ንዑ.አን. ፳/3.4-3.5 እና አንቀጽ ፯)", outcome: "ያለክፍተት የተስተካከለ የዕድሜ ደረጃ ሽግግር", indicator: "የተሸጋገሩ አባላት ብዛት", metricTarget: "100%", timing: "በየሩብ ዓመቱ", executor: "ህጻናትና ታዳጊ ክትትል ንዑስ ክፍል / ከሕጻናትና ታዳጊ ክፍል ጋር", budget: "-", recurrenceDays: 91 },
  { no: 13, subUnit: "ጽ/ቤት (አጠቃላይ)", title: "የ3 ወር አፈጻጸም ሪፖርትና መለኪያ", details: "የክፍሉን የስራ አፈጻጸም በየሦስት ወሩ መለካትና ሪፖርት ማዘጋጀት፤ ለስራ አመራር ማቅረብ፤ ክፍተት ተለይቶ የእርምት አቅጣጫ ማስቀመጥ", outcome: "ግልጽ የስራ ክንውን ግምገማ", indicator: "የቀረቡ ሪፖርቶች ብዛት", metricTarget: "4 ሪፖርቶች", timing: "ህዳር፣ የካቲት፣ ግንቦት፣ ነሐሴ", executor: "የሰው ሀብት አስተዳደር ክፍል ጽ/ቤት", budget: "-", recurrenceDays: 91 },
];
const DEFAULT_PLAN_INTERNAL = [
  { no: 1, subUnit: "የክፍል ውስጥ ግንኙነት", title: "ወርሃዊ የክፍል ስብሰባና የልምድ ልውውጥ", details: "አራቱም ንዑስ ክፍላት (የአባላት አስተዳደር፣ የአባላት መረጃ፣ ምክረ አበው፣ ህጻናትና ታዳጊ ክትትል) በወር አንድ ጊዜ ተሰብስበው የሥራ ልምዳቸውን ይለዋወጣሉ፤ ችግር ካለ በጋራ ይመክራሉ", outcome: "የተጠናከረ የውስጥ ትብብር", indicator: "የተካሄዱ ስብሰባዎች", metricTarget: "12 ስብሰባ", timing: "ወርሃዊ", executor: "የክፍሉ ጽ/ቤት", budget: "-", recurrenceDays: 30 },
  { no: 2, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ አጋፔ / ግንኙነት ቀን", details: "ለክፍሉ አባላት ብቻ የተዘጋጀ የምግብ/የህብረት ቀን፤ ከስራ ውጪ በሆነ መንፈስ እንዲተዋወቁና እንዲቀራረቡ ማድረግ", outcome: "የጠነከረ ወንድማዊ/እህታዊ ፍቅር በክፍሉ ውስጥ", indicator: "የተዘጋጁ አጋፔዎች", metricTarget: "በዓመት 2 ጊዜ", timing: "ጥር እና ሰኔ", executor: "የክፍሉ ጽ/ቤት", budget: "እንደ ዕቅድ", recurrenceDays: 182 },
  { no: 3, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ መንፈሳዊ ጉዞ", details: "የክፍሉ አባላት ብቻ ወደ ገዳም/ቅዱስ ቦታ አብረው የሚሄዱበት ጉዞ ማዘጋጀት፤ ከሥራ ግንኙነት ባለፈ መንፈሳዊና ማህበራዊ ትስስር መፍጠር", outcome: "የተጠናከረ የክፍሉ አንድነት", indicator: "የተካሄዱ ጉዞዎች", metricTarget: "በዓመት 1 ጊዜ", timing: "ክረምት", executor: "የክፍሉ ጽ/ቤት", budget: "እንደ ዕቅድ", recurrenceDays: 365 },
  { no: 4, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የውስጥ እውቅናና ማበረታቻ", details: "በየንዑስ ክፍሉ በትጋት ላገለገሉ የክፍሉ አባላት ውስጣዊ (ከቀሪው ሰ/ት/ቤት ተለይቶ) የምስጋና/የእውቅና መርሐ ግብር ማዘጋጀት", outcome: "የተነቃቃ የአገልግሎት መንፈስ በክፍሉ ውስጥ", indicator: "የተሸለሙ/የተመሰገኑ አባላት ብዛት", metricTarget: "በዓመት 1 ጊዜ", timing: "ነሐሴ (ከሪፖርት ጋር)", executor: "የክፍሉ ጽ/ቤት", budget: "-", recurrenceDays: 365 },
  { no: 5, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ ደስታ/ሐዘን መጠያየቅ", details: "ከክፍሉ አባላት አንዱ ደስታ (ሰርግ፣ ምረቃ) ወይም ሐዘን ሲያጋጥመው ክፍሉ በራሱ ተነሳሽነት (ከቤ/ክ አጠቃላይ አገልግሎት ተለይቶ) የቅርብ መጠያየቅ እንዲያደርግ ማመቻቸት", outcome: "እርስ በርስ የመደጋገፍ ልማድ", indicator: "የተደረጉ ጉብኝቶች", metricTarget: "እንደአጋጣሚው", timing: "ዓመቱን ሙሉ", executor: "የክፍሉ ጽ/ቤት", budget: "-", recurrenceDays: 0 },
];

async function ensurePlanItems() {
  const existing = await getAll("planItems");
  if (existing.length) return;
  const today = new Date();
  const seedRow = async (row, category) => {
    const ethNext = computeEthAwareNextDate(row.timing, today);
    const fallbackNext = row.recurrenceDays > 0 ? isoDate(addDays(today, 14)) : null;
    await put("planItems", {
      id: uid(), no: row.no, category, subUnit: row.subUnit, title: row.title, details: row.details,
      outcome: row.outcome, indicator: row.indicator, metricTarget: row.metricTarget, timing: row.timing,
      executor: row.executor, budget: row.budget, recurrenceDays: row.recurrenceDays, autoMetric: row.autoMetric || null,
      nextDate: ethNext || fallbackNext, lastDone: null, doneLog: [],
    });
  };
  for (const row of DEFAULT_PLAN_MAIN) await seedRow(row, "main");
  for (const row of DEFAULT_PLAN_INTERNAL) await seedRow(row, "internal");
}

function guessRecurrenceDays(timingText) {
  const s = (timingText || "").trim();
  if (/ወርሃዊ|በየወሩ|monthly/i.test(s)) return 30;
  if (/ሩብ ዓመት|quarterly/i.test(s)) return 91;
  if (/2 ጊዜ|twice/i.test(s)) return 182;
  if (/እንደአስፈላጊነቱ|እንደአጋጣሚው|as needed|as-needed/i.test(s)) return 0;
  return 365; // default: treat as an annual/seasonal item
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

// ---------- Date helpers ----------
function isoDate(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function addMonths(d, n) { const nd = new Date(d); nd.setMonth(nd.getMonth() + n); return nd; }
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
    const category = pick(row, ["ምድብ", "Category", "category"]) || "";
    const gradeRaw = pick(row, ["ክፍል ደረጃ", "ክፍል", "Grade", "grade"]);
    const grade = normalizeGrade(gradeRaw);
    const confDate = pick(row, ["ንስሃ ቀን", "የመጨረሻ ንስሃ", "Last Confession", "lastConfession"]);
    let member = existingList.find((m) => m.fullName.trim() === String(name).trim());
    if (!member) {
      member = {
        id: uid(), qrId: "FTW1|" + shortId(), fullName: String(name).trim(),
        phone: phone ? String(phone).trim() : "", category: String(category).trim(), grade,
        lastConfessionDate: parseMaybeDate(confDate), joinDate: todayISO(), active: true, synced: false,
      };
      existingList.push(member);
    } else {
      member.phone = phone ? String(phone).trim() : member.phone;
      member.category = category ? String(category).trim() : member.category;
      if (grade !== null) member.grade = grade;
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
function normalizeGrade(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return (n >= 1 && n <= 12) ? n : null;
}
async function addMemberManual(fullName, phone, category, grade) {
  const member = {
    id: uid(), qrId: "FTW1|" + shortId(), fullName: fullName.trim(), phone: (phone || "").trim(),
    category: (category || "").trim(), grade: normalizeGrade(grade),
    lastConfessionDate: null, joinDate: todayISO(), active: true, synced: false,
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

// ---------- Grade-level analytics (grades 1-12) ----------
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
function absenteeRow(a) {
  const m = a.member;
  const phoneLink = m.phone
    ? `<a href="tel:${m.phone.replace(/\s+/g, "")}" class="phone-link" onclick="event.stopPropagation();">${m.phone}</a>`
    : t("dash.noPhone");
  const log = m.callLog;
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
        <div class="badge badge-red">${t("dash.streakBadge", { n: a.streak })}</div>
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
  const [absentees, confessionDue, hrDue, settings] = await Promise.all([computeConsecutiveAbsences(), computeConfessionDue(), computePlanReminders(), getSettings()]);
  const members = await getAll("members");
  const attendance = await getAll("attendance");
  const today = todayISO();
  const todayCount = attendance.filter((a) => a.sessionDate === today).length;
  const thr = settings.absenceThreshold || 3;

  el("view").innerHTML = `
    <p class="muted" style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;margin-top:0;">📅 ${ethLabel(today)}</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${members.length}</div><div class="stat-label">${t("dash.totalMembers")}</div></div>
      <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-label">${t("dash.todayAttendance")}</div></div>
      <div class="stat-card"><div class="stat-num">${absentees.length}</div><div class="stat-label">${t("dash.consecutiveAbsent", { n: thr })}</div></div>
      <div class="stat-card"><div class="stat-num">${confessionDue.length}</div><div class="stat-label">${t("dash.confessionDueStat")}</div></div>
    </div>

    <h3 class="section-title">${t("dash.callListTitle", { n: thr })}</h3>
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
}
window.markConfessed = async (memberId) => { const m = await get("members", memberId); m.lastConfessionDate = todayISO(); m.synced = false; await put("members", m); renderDashboard(); };
window.doneHrEvent = async (id) => {
  const note = prompt(t("plan.doneNotePrompt")) || "";
  await markPlanItemDone(id, note);
  renderDashboard();
};

// ---------- Scan (batch queue: scan several, review, then confirm all at once) ----------
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
  el("manualSearch").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q ? members.filter((m) => m.fullName.toLowerCase().includes(q)) : [];
    el("manualResults").innerHTML = filtered.slice(0, 15).map((m) => `
      <div class="list-row"><div>${m.fullName}</div><button class="btn-small" onclick="queueScan('${m.id}')">${t("scan.record")}</button></div>`).join("");
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
  // Works with an external Bluetooth/USB barcode scanner too: those act like
  // a keyboard typing the code followed by Enter, so this field just needs
  // to stay focused and listen for the Enter keystroke.
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
  if (scanState.batch.some((b) => b.memberId === memberId)) return; // dedupe
  const m = await get("members", memberId);
  if (!m) return;
  scanState.batch.push({ memberId, fullName: m.fullName, scannedAt: new Date() });
  renderBatchList();
  if (navigator.vibrate) navigator.vibrate(40);
}
window.queueScan = queueScan;

// Accepts either a full QR payload ("FTW1|xxxx") or just the raw id part —
// used by the manual code-entry field, which also doubles as the input
// target for an external Bluetooth/USB barcode scanner.
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
    const isAdmin = window.currentUserRole === "admin" || !sbClient; // no cloud = no RBAC, allow local admin actions
    el("memberList").innerHTML = list.map((m) => `
      <div class="list-row">
        <label class="sel-check">
          <input type="checkbox" data-id="${m.id}" ${selected.has(m.id) ? "checked" : ""}/>
        </label>
        <div style="flex:1;"><b>${m.fullName}</b><br><span class="muted">${m.phone || ""} ${m.category ? "· " + m.category : ""} ${m.grade ? "· " + t("members.gradeShort", { n: m.grade }) : ""}</span></div>
        <div class="row-actions">
          <button class="btn-small" onclick="showQr('${m.id}')">${t("members.qr")}</button>
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
  el("excelInput").onchange = async (e) => { const file = e.target.files[0]; if (!file) return; const count = await importMembersFromWorkbook(file); alert(t("members.importedCount", { n: count })); renderMembers(); };
  el("addMemberBtn").onclick = async () => {
    const name = prompt(t("members.promptName")); if (!name) return;
    const phone = prompt(t("members.promptPhone")) || "";
    const category = prompt(t("members.promptCategory")) || "";
    const grade = prompt(t("members.promptGrade")) || "";
    await addMemberManual(name, phone, category, grade); renderMembers();
  };
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
  await del("members", id); renderMembers();
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
    Name: m.fullName, Phone: m.phone || "", Category: m.category || "", Grade: m.grade || "",
    LastConfession: m.lastConfessionDate || "", JoinDate: m.joinDate || "", QrId: m.qrId,
    CurrentlyFlaggedForCall: m.callLog && m.callLog.called ? "yes" : "",
    LastCallReason: m.callLog ? (m.callLog.reason || "") : "",
    TotalTimesCalled: (m.callHistory || []).length,
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
      ${session ? `
        <label class="muted">${t("settings.displayName")}</label>
        <input id="s_displayName" class="text-input" value="${window.currentDisplayName || ""}" placeholder="${t("settings.displayNamePlaceholder")}"/>
        <button id="saveDisplayNameBtn" class="btn-secondary" style="margin-bottom:10px;">${t("settings.saveDisplayName")}</button>
      ` : ""}
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
  if (el("saveDisplayNameBtn")) el("saveDisplayNameBtn").onclick = async () => {
    const name = el("s_displayName").value.trim();
    if (!name) return;
    const ok = await saveDisplayName(name);
    alert(ok ? t("settings.saved") : t("report.error"));
    renderSettings();
  };
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
  const [absentees, confessionDue, hrDue] = await Promise.all([computeConsecutiveAbsences(), computeConfessionDue(), computePlanReminders()]);
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

function drawCharts(attendance, progs, gradeStats) {
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

  // By grade (1-12): attendance rate = scans / (members in grade × sessions), makes uneven class sizes comparable
  const gradeCanvas = el("gradeChart");
  if (gradeStats && gradeStats.rows.length && gradeCanvas) {
    const rowsAsc = [...gradeStats.rows].sort((a, b) => a.grade - b.grade);
    chartInstances.push(new Chart(gradeCanvas, {
      type: "bar",
      data: {
        labels: rowsAsc.map((r) => (getLang() === "am" ? "ክፍል " : "Grade ") + r.grade),
        datasets: [{ label: t("charts.byGrade"), data: rowsAsc.map((r) => Math.round(r.rate * 100)), backgroundColor: "#f2a33c" }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + "%" } } },
        scales: { x: { ticks: { color: "#9c9187" } }, y: { ticks: { color: "#9c9187", callback: (v) => v + "%" }, beginAtZero: true } },
      },
    }));
  } else if (gradeCanvas) {
    gradeCanvas.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: t("charts.noData") }));
  }
}

// ---------- Plan (ዕቅድ) tab: Excel import/export + completion tracking ----------
async function importPlanFromWorkbook(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const existing = await getAll("planItems");
  let count = 0;
  for (const row of rows) {
    const title = pick(row, ["ዕቅድ/ፕሮጀክት", "ዕቅድ", "Title", "Plan", "title"]);
    if (!title) continue;
    const subUnit = pick(row, ["ንዑስ ክፍል", "Sub-unit", "SubUnit", "subUnit"]) || "";
    const details = pick(row, ["የክንውን ዝርዝር", "Details", "details"]) || "";
    const outcome = pick(row, ["ውጤት", "Outcome", "outcome"]) || "";
    const indicator = pick(row, ["አመልካች", "Indicator", "indicator"]) || "";
    const metricTarget = pick(row, ["መለኪያ", "Target", "Metric", "metricTarget"]) || "";
    const timing = pick(row, ["የክንውን ጊዜ", "Timing", "timing"]) || "";
    const executor = pick(row, ["ፈጻሚ አካል", "Executor", "executor"]) || "";
    const budget = pick(row, ["በጀት", "Budget", "budget"]) || "-";
    const category = /internal|ውስጥ/i.test(pick(row, ["ምድብ", "Category", "category"]) || "") ? "internal" : "main";
    const noRaw = pick(row, ["ተ.ቁ", "No", "no"]);
    const no = noRaw ? Number(noRaw) || (count + 1) : (count + 1);

    let item = existing.find((p) => p.title.trim() === String(title).trim() && p.subUnit === subUnit);
    if (!item) {
      item = { id: uid(), doneLog: [], lastDone: null, nextDate: null };
      existing.push(item);
    }
    Object.assign(item, {
      no, subUnit, title: String(title).trim(), details, outcome, indicator, metricTarget, timing,
      executor, budget, category, recurrenceDays: guessRecurrenceDays(timing),
    });
    const ethNext = computeEthAwareNextDate(timing, new Date());
    if (ethNext) item.nextDate = ethNext;
    else if (item.recurrenceDays > 0 && !item.nextDate) item.nextDate = isoDate(addDays(new Date(), 14));
    await put("planItems", item);
    count++;
  }
  return count;
}
async function exportPlanExcel() {
  const items = (await getAll("planItems")).sort((a, b) => (a.category === b.category ? a.no - b.no : a.category.localeCompare(b.category)));
  const rows = items.map((p) => ({
    "ተ.ቁ": p.no, "ምድብ": p.category === "internal" ? "የውስጥ ግንኙነት" : "ዋና", "ንዑስ ክፍል": p.subUnit,
    "ዕቅድ/ፕሮጀክት": p.title, "የክንውን ዝርዝር": p.details, "ውጤት": p.outcome, "አመልካች": p.indicator,
    "መለኪያ": p.metricTarget, "የክንውን ጊዜ": p.timing, "ፈጻሚ አካል": p.executor, "በጀት": p.budget,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan");
  XLSX.writeFile(wb, `finote-hr-plan-${todayISO()}.xlsx`);
}

async function renderPlan() {
  const items = await getAll("planItems");
  const main = items.filter((p) => p.category === "main").sort((a, b) => a.no - b.no);
  const internal = items.filter((p) => p.category === "internal").sort((a, b) => a.no - b.no);
  const isAdmin = window.currentUserRole === "admin" || !sbClient; // no cloud = single-device use, treat as admin

  function itemRow(p) {
    const today = todayISO();
    const overdue = p.nextDate && p.nextDate <= today;
    const lastLog = p.doneLog && p.doneLog.length ? p.doneLog[p.doneLog.length - 1] : null;
    const dueLine = p.nextDate ? `<br><span class="muted">${t("plan.nextDue")}: ${ethLabel(p.nextDate)} (${p.nextDate})</span>` : "";
    return `
      <div class="list-row" style="align-items:flex-start;">
        <div style="flex:1;">
          <b>${p.title}</b><br>
          <span class="muted">${p.timing} · ${p.executor}</span>${dueLine}<br>
          <span class="muted">${t("plan.doneLogTitle")}: ${lastLog ? lastLog.date + (lastLog.note ? " — " + lastLog.note : "") : t("plan.noDoneLog")} (${(p.doneLog || []).length}x)</span>
        </div>
        <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
          ${overdue ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
          <button class="btn-small" onclick="doPlanDone('${p.id}')">${t("plan.markDone")}</button>
          <button class="btn-small" onclick="editPlanTiming('${p.id}')">${t("plan.editTiming")}</button>
        </div>
      </div>`;
  }

  el("view").innerHTML = `
    <div class="toolbar">
      <label class="btn-primary file-btn">${t("plan.importExcel")}<input type="file" id="planExcelInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>
      <button class="btn-secondary" id="planExportBtn">${t("plan.exportExcel")}</button>
      <button class="btn-secondary" id="planResetBtn">${t("plan.resetToDefault")}</button>
    </div>

    <div class="chart-box" style="height:auto;padding:14px;">
      <h3 class="section-title" style="margin-top:0;">${t("report.title")}</h3>
      ${isAdmin ? `
        <p class="muted">${t("report.desc")}</p>
        <label class="muted">${t("report.period")}</label>
        <select id="reportPeriod" class="text-input">
          <option value="3">${t("report.period3")}</option>
          <option value="6">${t("report.period6")}</option>
          <option value="12">${t("report.period12")}</option>
        </select>
        <label class="muted">${t("report.format")}</label>
        <select id="reportFormat" class="text-input">
          <option value="both">${t("report.formatBoth")}</option>
          <option value="word">${t("report.formatWord")}</option>
          <option value="ppt">${t("report.formatPpt")}</option>
        </select>
        <button id="reportGenerateBtn" class="btn-primary" style="width:100%;">${t("report.generate")}</button>
        <p class="muted" id="reportStatus" style="min-height:16px;margin-top:8px;"></p>
      ` : `<p class="muted">${t("report.adminOnly")}</p>`}
    </div>

    <h3 class="section-title">${t("plan.mainSection")}</h3>
    <div class="list">${main.map(itemRow).join("")}</div>

    <h3 class="section-title">${t("plan.internalSection")}</h3>
    <div class="list">${internal.map(itemRow).join("")}</div>
  `;

  el("planExcelInput").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const count = await importPlanFromWorkbook(file);
    alert(t("plan.importedCount", { n: count }));
    renderPlan();
  };
  el("planExportBtn").onclick = exportPlanExcel;
  el("planResetBtn").onclick = async () => {
    if (!confirm(t("plan.resetConfirm"))) return;
    const all = await getAll("planItems");
    for (const p of all) await del("planItems", p.id);
    await ensurePlanItems();
    renderPlan();
  };
  if (el("reportGenerateBtn")) el("reportGenerateBtn").onclick = () => runReportGeneration();
}
window.doPlanDone = async (id) => { const note = prompt(t("plan.doneNotePrompt")) || ""; await markPlanItemDone(id, note); renderPlan(); };
window.editPlanTiming = async (id) => {
  const p = await get("planItems", id);
  if (!p) return;
  const timing = prompt(t("plan.editTimingPrompt"), p.timing);
  if (timing === null) return;
  const recStr = prompt(t("plan.editRecurrencePrompt"), String(p.recurrenceDays || 0));
  const recurrenceDays = recStr === null ? p.recurrenceDays : Number(recStr) || 0;
  p.timing = timing;
  p.recurrenceDays = recurrenceDays;
  const ethNext = computeEthAwareNextDate(timing, new Date());
  if (ethNext) p.nextDate = ethNext;
  else if (recurrenceDays > 0) p.nextDate = isoDate(addDays(new Date(), 14));
  else p.nextDate = null;
  await put("planItems", p);
  renderPlan();
};

// ---------- Report data + generation (client-side Word/PPT, no server) ----------
async function computeReportData(periodMonths) {
  const end = new Date();
  const start = addMonths(end, -periodMonths);
  const startISO = isoDate(start), endISO = isoDate(end);

  const [items, attendanceAll, members] = await Promise.all([getAll("planItems"), getAll("attendance"), getAll("members")]);
  const attendance = attendanceAll.filter((a) => a.sessionDate >= startISO && a.sessionDate <= endISO);
  const progs = PROGRAM_DEFS();

  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))];
  const perProgram = progs.map((p) => {
    const rows = attendance.filter((a) => a.programKey === p.key);
    return { name: p.name, total: rows.length, onTime: rows.filter((a) => a.status === "on-time").length, late: rows.filter((a) => a.status === "late").length };
  });
  const newMembers = members.filter((m) => m.joinDate && m.joinDate >= startISO && m.joinDate <= endISO);
  const confessionsInPeriod = members.filter((m) => m.lastConfessionDate && m.lastConfessionDate >= startISO && m.lastConfessionDate <= endISO);
  const absentees = await computeConsecutiveAbsences();

  const periodDays = Math.round((end - start) / 86400000);
  const planRows = items.sort((a, b) => (a.category === b.category ? a.no - b.no : a.category.localeCompare(b.category))).map((p) => {
    const logsInPeriod = (p.doneLog || []).filter((l) => l.date >= startISO && l.date <= endISO);
    const expected = p.recurrenceDays > 0 ? Math.max(1, Math.round(periodDays / p.recurrenceDays)) : null;
    let status;
    if (expected === null) status = logsInPeriod.length > 0 ? "done" : "manual";
    else status = logsInPeriod.length >= expected ? "onTrack" : (logsInPeriod.length > 0 ? "partial" : "behind");
    return { ...p, logsInPeriod, expected, status };
  });

  const gradeStats = await computeGradeStats(startISO, endISO);
  const gradeNarrative = buildGradeNarrative(gradeStats.rows, getLang());

  const callReasons = [];
  members.forEach((m) => {
    (m.callHistory || []).forEach((h) => {
      if (h.date >= startISO && h.date <= endISO) callReasons.push({ name: m.fullName, date: h.date, reason: h.reason || "", calledBy: h.calledBy || "" });
    });
  });
  callReasons.sort((a, b) => b.date.localeCompare(a.date));

  return {
    periodMonths, startISO, endISO,
    totals: {
      totalMembers: members.length, newMembers: newMembers.length, sessionsHeld: sessionDates.length,
      totalScans: attendance.length, onTime: attendance.filter((a) => a.status === "on-time").length,
      late: attendance.filter((a) => a.status === "late").length, confessionsInPeriod: confessionsInPeriod.length,
      absenteesNow: absentees.length,
    },
    perProgram, planRows, gradeStats, gradeNarrative, callReasons,
  };
}
const STATUS_LABEL = {
  am: { onTrack: "በመልካም ሁኔታ ላይ", partial: "በሂደት ላይ", behind: "ትኩረት ይሻል", done: "ተከናውኗል", manual: "በእጅ ክትትል ይደረግበት" },
  en: { onTrack: "On track", partial: "In progress", behind: "Needs attention", done: "Done", manual: "Manual tracking" },
};

async function runReportGeneration() {
  const periodMonths = Number(el("reportPeriod").value);
  const format = el("reportFormat").value;
  const statusEl = el("reportStatus");
  statusEl.textContent = t("report.generating");
  try {
    const data = await computeReportData(periodMonths);
    if (format === "word" || format === "both") await generateWordReport(data);
    if (format === "ppt" || format === "both") await generatePptReport(data);
    statusEl.textContent = t("report.done");
  } catch (e) {
    statusEl.textContent = t("report.error") + ": " + e.message;
  }
}

async function generateWordReport(data) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, HeadingLevel, AlignmentType, Packer } = window.docx;
  const lang = getLang();
  const periodLabel = t("report.period" + data.periodMonths) || `${data.periodMonths}mo`;

  function cell(text, opts = {}) {
    return new TableCell({
      width: { size: opts.width || 2000, type: WidthType.DXA },
      shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!opts.bold, size: 16 })] })],
    });
  }
  const header = new TableRow({
    tableHeader: true,
    children: ["#", "Sub-unit", "Plan item", "Target", "Done in period", "Status"].map((h) => cell(h, { bold: true, shade: "D9C7A3" })),
  });
  const rows = data.planRows.map((p) => new TableRow({
    children: [
      cell(p.no), cell(p.subUnit), cell(p.title, { width: 3500 }), cell(p.metricTarget),
      cell(p.logsInPeriod.length + (p.expected ? ` / ${p.expected}` : "")),
      cell(STATUS_LABEL[lang][p.status] || p.status),
    ],
  }));

  const gradeHeader = new TableRow({
    tableHeader: true,
    children: [lang === "am" ? "ክፍል" : "Grade", lang === "am" ? "የተማሪ ብዛት" : "Students", lang === "am" ? "ቅኝት" : "Scans", lang === "am" ? "መጠን" : "Rate"].map((h) => cell(h, { bold: true, shade: "D9C7A3" })),
  });
  const gradeRowsAsc = [...data.gradeStats.rows].sort((a, b) => a.grade - b.grade);
  const gradeTableRows = gradeRowsAsc.map((r) => new TableRow({
    children: [cell((lang === "am" ? "ክፍል " : "Grade ") + r.grade), cell(r.memberCount), cell(r.scans), cell(Math.round(r.rate * 100) + "%")],
  }));

  const callHeader = new TableRow({
    tableHeader: true,
    children: [lang === "am" ? "ስም" : "Name", lang === "am" ? "ቀን" : "Date", lang === "am" ? "ምክንያት" : "Reason", lang === "am" ? "የደወለው" : "Called by"].map((h) => cell(h, { bold: true, shade: "D9C7A3" })),
  });
  const callTableRows = data.callReasons.map((c) => new TableRow({
    children: [cell(c.name), cell(c.date), cell(c.reason || "-", { width: 3500 }), cell(c.calledBy || "-")],
  }));

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t("app.title") })] }),
        new Paragraph({ children: [new TextRun({ text: `${periodLabel}  ·  ${data.startISO} → ${data.endISO}  (${ethLabel(data.startISO)} → ${ethLabel(data.endISO)})`, italics: true })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: lang === "am" ? "አጠቃላይ አፈጻጸም" : "Overall performance" })] }),
        new Paragraph({ text: `${lang === "am" ? "አጠቃላይ አባላት" : "Total members"}: ${data.totals.totalMembers}` }),
        new Paragraph({ text: `${lang === "am" ? "አዲስ አባላት" : "New members"}: ${data.totals.newMembers}` }),
        new Paragraph({ text: `${lang === "am" ? "የተካሄዱ መርሐ ግብራት" : "Sessions held"}: ${data.totals.sessionsHeld}` }),
        new Paragraph({ text: `${lang === "am" ? "አጠቃላይ ቅኝቶች" : "Total attendance scans"}: ${data.totals.totalScans} (${lang === "am" ? "በሰዓቱ" : "on-time"} ${data.totals.onTime} / ${lang === "am" ? "ዘግይቷል" : "late"} ${data.totals.late})` }),
        new Paragraph({ text: `${lang === "am" ? "የተከናወነ ንስሃ" : "Confessions recorded"}: ${data.totals.confessionsInPeriod}` }),
        new Paragraph({ text: `${lang === "am" ? "አሁን ላይ ተከታታይ ቀሪ አባላት" : "Currently on absence streak"}: ${data.totals.absenteesNow}` }),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: lang === "am" ? "በክፍል ደረጃ ትንተና (1-12)" : "Grade-level analysis (1-12)" })] }),
        new Table({ width: { size: 7000, type: WidthType.DXA }, rows: [gradeHeader, ...gradeTableRows] }),
        new Paragraph({ text: "" }),
        ...(data.gradeNarrative.length ? data.gradeNarrative.map((line) => new Paragraph({ text: "• " + line })) : [new Paragraph({ text: lang === "am" ? "በቂ መረጃ የለም" : "Not enough data yet" })]),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: lang === "am" ? "የቀሪ አባላት ጥሪ ምክንያቶች" : "Absentee call reasons" })] }),
        data.callReasons.length
          ? new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [callHeader, ...callTableRows] })
          : new Paragraph({ text: lang === "am" ? "በዚህ ጊዜ ውስጥ የተመዘገበ ጥሪ የለም" : "No calls logged in this period" }),
        new Paragraph({ text: "" }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: lang === "am" ? "በዕቅድ መሠረት አፈጻጸም" : "Performance against the plan" })] }),
        new Table({ width: { size: 10000, type: WidthType.DXA }, rows: [header, ...rows] }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `HR-report-${data.periodMonths}mo-${todayISO()}.docx`);
}

async function generatePptReport(data) {
  const lang = getLang();
  const periodLabel = t("report.period" + data.periodMonths) || `${data.periodMonths}mo`;
  const pptx = new PptxGenJS();
  pptx.defineSlideMaster({ title: "MASTER", background: { color: "14110F" } });

  const s1 = pptx.addSlide({ masterName: "MASTER" });
  s1.addText(t("app.title"), { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 32, bold: true, color: "F2A33C" });
  s1.addText(`${periodLabel}  ·  ${data.startISO} → ${data.endISO}  (${ethLabel(data.startISO)} → ${ethLabel(data.endISO)})`, { x: 0.5, y: 2.8, w: 9, h: 0.6, fontSize: 14, color: "F2EDE6" });

  const s2 = pptx.addSlide({ masterName: "MASTER" });
  s2.addText(lang === "am" ? "አጠቃላይ አፈጻጸም" : "Overall performance", { x: 0.4, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: "F2A33C" });
  const bullets = [
    `${lang === "am" ? "አጠቃላይ አባላት" : "Total members"}: ${data.totals.totalMembers}`,
    `${lang === "am" ? "አዲስ አባላት" : "New members"}: ${data.totals.newMembers}`,
    `${lang === "am" ? "የተካሄዱ መርሐ ግብራት" : "Sessions held"}: ${data.totals.sessionsHeld}`,
    `${lang === "am" ? "አጠቃላይ ቅኝቶች" : "Total scans"}: ${data.totals.totalScans} (${data.totals.onTime} ${lang === "am" ? "በሰዓቱ" : "on-time"} / ${data.totals.late} ${lang === "am" ? "ዘግይቷል" : "late"})`,
    `${lang === "am" ? "የተከናወነ ንስሃ" : "Confessions recorded"}: ${data.totals.confessionsInPeriod}`,
    `${lang === "am" ? "አሁን ተከታታይ ቀሪ" : "Currently on absence streak"}: ${data.totals.absenteesNow}`,
  ];
  s2.addText(bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, color: "F2EDE6", fontSize: 16 } })), { x: 0.5, y: 1.1, w: 9, h: 4 });

  const s3 = pptx.addSlide({ masterName: "MASTER" });
  s3.addText(lang === "am" ? "በፕሮግራም የመገኘት መጠን" : "Attendance by program", { x: 0.4, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: "F2A33C" });
  const progRows = [[
    { text: lang === "am" ? "ፕሮግራም" : "Program", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
    { text: lang === "am" ? "በሰዓቱ" : "On-time", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
    { text: lang === "am" ? "ዘግይቷል" : "Late", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
  ]].concat(data.perProgram.map((p) => [
    { text: p.name, options: { color: "F2EDE6" } },
    { text: String(p.onTime), options: { color: "4CAF7D" } },
    { text: String(p.late), options: { color: "E0605A" } },
  ]));
  s3.addTable(progRows, { x: 0.5, y: 1.1, w: 9, fontSize: 14, border: { type: "solid", color: "332C26" } });

  const s4 = pptx.addSlide({ masterName: "MASTER" });
  s4.addText(lang === "am" ? "በክፍል ደረጃ ትንተና (1-12)" : "Grade-level analysis (1-12)", { x: 0.4, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: "F2A33C" });
  const gradeRowsAsc = [...data.gradeStats.rows].sort((a, b) => a.grade - b.grade);
  s4.addChart(pptx.ChartType.bar, [{
    name: lang === "am" ? "የተሳትፎ መጠን %" : "Attendance rate %",
    labels: gradeRowsAsc.map((r) => (lang === "am" ? "ክፍል " : "Gr.") + r.grade),
    values: gradeRowsAsc.map((r) => Math.round(r.rate * 100)),
  }], { x: 0.4, y: 1.0, w: 9.2, h: 3.0, chartColors: ["F2A33C"], catAxisLabelColor: "9C9187", valAxisLabelColor: "9C9187", showTitle: false });
  if (data.gradeNarrative.length) {
    s4.addText(data.gradeNarrative.slice(0, 5).map((l) => ({ text: l, options: { bullet: true, breakLine: true, color: "F2EDE6", fontSize: 12 } })), { x: 0.4, y: 4.2, w: 9.2, h: 1.6 });
  }

  // call-reasons slide(s) — chunk into pages of 12 rows so text stays legible
  if (data.callReasons.length) {
    const chunkSize = 12;
    for (let i = 0; i < data.callReasons.length; i += chunkSize) {
      const chunk = data.callReasons.slice(i, i + chunkSize);
      const sc = pptx.addSlide({ masterName: "MASTER" });
      sc.addText(lang === "am" ? "የቀሪ አባላት ጥሪ ምክንያቶች" : "Absentee call reasons", { x: 0.4, y: 0.3, w: 9, h: 0.6, fontSize: 22, bold: true, color: "F2A33C" });
      const callTbl = [[
        { text: lang === "am" ? "ስም" : "Name", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
        { text: lang === "am" ? "ቀን" : "Date", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
        { text: lang === "am" ? "ምክንያት" : "Reason", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
      ]].concat(chunk.map((c) => [
        { text: c.name, options: { color: "F2EDE6", fontSize: 11 } },
        { text: c.date, options: { color: "F2EDE6", fontSize: 11 } },
        { text: c.reason || "-", options: { color: "F2EDE6", fontSize: 11 } },
      ]));
      sc.addTable(callTbl, { x: 0.4, y: 1.0, w: 9.2, fontSize: 11, border: { type: "solid", color: "332C26" } });
    }
  }

  // one slide per sub-unit with plan item status
  const subUnits = [...new Set(data.planRows.map((p) => p.subUnit))];
  for (const su of subUnits) {
    const rowsForUnit = data.planRows.filter((p) => p.subUnit === su);
    const slide = pptx.addSlide({ masterName: "MASTER" });
    slide.addText(su, { x: 0.4, y: 0.3, w: 9, h: 0.6, fontSize: 22, bold: true, color: "F2A33C" });
    const tbl = [[
      { text: lang === "am" ? "ዕቅድ" : "Item", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
      { text: lang === "am" ? "ክንውን" : "Done", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
      { text: lang === "am" ? "ሁኔታ" : "Status", options: { bold: true, fill: "3A2C15", color: "F2A33C" } },
    ]].concat(rowsForUnit.map((p) => [
      { text: p.title, options: { color: "F2EDE6", fontSize: 11 } },
      { text: `${p.logsInPeriod.length}${p.expected ? "/" + p.expected : ""}`, options: { color: "F2EDE6", fontSize: 11 } },
      { text: STATUS_LABEL[lang][p.status] || p.status, options: { color: p.status === "behind" ? "E0605A" : p.status === "onTrack" ? "4CAF7D" : "F2A33C", fontSize: 11 } },
    ]));
    slide.addTable(tbl, { x: 0.4, y: 1.0, w: 9.2, fontSize: 11, border: { type: "solid", color: "332C26" } });
  }

  pptx.writeFile({ fileName: `HR-report-${data.periodMonths}mo-${todayISO()}.pptx` });
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
    await fetchDisplayName(session);
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
  await ensurePlanItems();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  boot();
}
document.addEventListener("DOMContentLoaded", init);
