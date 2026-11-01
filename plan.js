/* ፍኖተ ጥበብ — Plan (ዕቅድ): default plan data, reminders, Plan screen,
   Excel import/export, printable plan report.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderPlan.
   Depends on globals: getAll, get, put, del, uid, pick, parseExcelDate, isoDate,
   addDays, todayISO, computeEthAwareNextDate, ethLabel, isAdminUser,
   showAlert, showConfirm, showPrompt, withButtonLoading, el, t, getLang, XLSX. */

// ---------- Plan Data ----------
// recurrenceDays semantics used by the HR report (see computeHrReportData):
//   30            -> monthly cadence; period target = number of months in the report
//   >30           -> any other real cadence (quarterly/biannual/annual/one-off); period target is a flat 1
//   0             -> reactive/ongoing item with no fixed schedule; reported as a raw count, "Manual tracking"
const DEFAULT_PLAN_MAIN = [
  { no: 1, subUnit: "የአባላት አስተዳደር", title: "አዳዲስ አባላትን መመልመልና ማቀላቀል (ዲጂታል ዘመቻን ጨምሮ)", timing: "መስከረም–ጥቅምት", metricTarget: "በቁጥር (ዒላማ ተቀምጦ)", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 2, subUnit: "የአባላት አስተዳደር", title: "የሰው ኃይል ድልድል ማዘጋጀት", timing: "ዓመታዊ", metricTarget: "100%", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 3, subUnit: "የአባላት አስተዳደር", title: "የአቅም ግንባታ ስልጠና ማዘጋጀትና መስጠት", timing: "ዓመታዊ", metricTarget: "100% አፈጻጸም", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 4, subUnit: "የአባላት አስተዳደር", title: "የአመራር ማፍሪያ ሥርዓት (ንዑ.አን. ፳/3.13, 3.20)", timing: "ዓመታዊ", metricTarget: "በዓመት 1 ዙር", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 5, subUnit: "የአባላት አስተዳደር", title: "አዲስ አባላት አቀባበልና አቅጣጫ ማሳወቅ (ንዑ.አን. ፳/3.19)", timing: "እንደአጋጣሚው", metricTarget: "100%", executor: "የአባላት አስተዳደር ንዑስ ክፍል", recurrenceDays: 0 },
  { no: 6, subUnit: "የአባላት መረጃ", title: "የአባላት ፎርም ማስሞላትና መረጃ ማደራጀት", timing: "ዓመታዊ", metricTarget: "100%", executor: "የአባላት መረጃ ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 7, subUnit: "የአባላት መረጃ", title: "የተሳትፎ (ስም) ቁጥጥር", timing: "ወርሃዊ", metricTarget: "ወርሃዊ ሪፖርት", executor: "የአባላት መረጃ ንዑስ ክፍል", recurrenceDays: 30 },
  { no: 8, subUnit: "የአባላት መረጃ", title: "በየሩብ ዓመቱ የጠፉ/የራቁ አባላትን መለየትና መመለስ", timing: "በየሩብ ዓመቱ", metricTarget: "100%", executor: "የአባላት መረጃ ንዑስ ክፍል", recurrenceDays: 90 },
  { no: 9, subUnit: "ምክረ አበው", title: "የንስሃና ቁርባን ሕይወት ክትትል", timing: "ወርሃዊ", metricTarget: "100%", executor: "ምክረ አበው ንዑስ ክፍል", recurrenceDays: 30 },
  { no: 10, subUnit: "ምክረ አበው", title: "ሚስጥራዊ የምክር አገልግሎት መስመር (ንዑ.አን. ፳/3.16-3.17)", timing: "እንደአስፈላጊነቱ", metricTarget: "እንደአስፈላጊነቱ", executor: "ምክረ አበው ንዑስ ክፍል", recurrenceDays: 0 },
  { no: 11, subUnit: "ምክረ አበው", title: "በአባላት መካከል የሚፈጠሩ አለመግባባቶችን መፍታት", timing: "እንደአስፈላጊነቱ", metricTarget: "100% አፈጻጸም", executor: "ምክረ አበው ንዑስ ክፍል", recurrenceDays: 0 },
  { no: 12, subUnit: "ህጻናትና ታዳጊ ክትትል", title: "ከሕጻናትና ታዳጊ ክፍል (አንቀጽ ፳፭) ጋር ተቀናጅቶ የአባልነት ሽግግር ክትትል", timing: "ዓመታዊ", metricTarget: "100%", executor: "ህጻናትና ታዳጊ ክትትል ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 13, subUnit: "ጽ/ቤት (አጠቃላይ)", title: "የ3 ወር አፈጻጸም ሪፖርትና መለኪያ", timing: "በየሩብ ዓመቱ", metricTarget: "4 ሪፖርቶች", executor: "ጽ/ቤት", recurrenceDays: 90 },
];

const DEFAULT_PLAN_INTERNAL = [
  { no: 1, subUnit: "የክፍል ውስጥ ግንኙነት", title: "ወርሃዊ የክፍል ስብሰባና የልምድ ልውውጥ", timing: "ወርሃዊ", metricTarget: "12 ስብሰባ", executor: "የክፍል ውስጥ ግንኙነት ንዑስ ክፍል", recurrenceDays: 30 },
  { no: 2, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ አጋፔ / ግንኙነት ቀን", timing: "በዓመት 2 ጊዜ", metricTarget: "በዓመት 2 ጊዜ", executor: "የክፍል ውስጥ ግንኙነት ንዑስ ክፍል", recurrenceDays: 182 },
  { no: 3, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ መንፈሳዊ ጉዞ", timing: "በዓመት 1 ጊዜ", metricTarget: "በዓመት 1 ጊዜ", executor: "የክፍል ውስጥ ግንኙነት ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 4, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የውስጥ እውቅናና ማበረታቻ", timing: "በዓመት 1 ጊዜ", metricTarget: "በዓመት 1 ጊዜ", executor: "የክፍል ውስጥ ግንኙነት ንዑስ ክፍል", recurrenceDays: 365 },
  { no: 5, subUnit: "የክፍል ውስጥ ግንኙነት", title: "የክፍል ውስጥ ደስታ/ሐዘን መጠያየቅ", timing: "እንደአጋጣሚው", metricTarget: "እንደአጋጣሚው", executor: "የክፍል ውስጥ ግንኙነት ንዑስ ክፍል", recurrenceDays: 0 },
];


// Children's department plan (ሕጻናት ክፍል ዕቅድ). Seeded on every device but only
// shown to the children's-department role (see planVisibleToRole). `indicator`
// is the unit (በፐርሰንት = percent / በቁጥር = count) and `metricTarget` the plan.
// fixedCadence: schedule from recurrenceDays, ignoring the month text.
const DEFAULT_PLAN_CHILDREN = [
  { no: 1, subUnit: "", title: "መረጃ ማደራጀት", details: "ፎርም ማዘጋጀት; እንዲሞሉ ማድረግ", indicator: "በፐርሰንት", metricTarget: "80%", timing: "ከመስከረም-ህዳር", executor: "ህፃናት ክፍል ከ የሰው ሀብት አስተዳደር ክፍል ጋር በመተባበር", budget: "2000", recurrenceDays: 365 },
  { no: 2, subUnit: "", title: "መንፈሳዊ ፊልም እና መንፈሳዊ ጨዋታ ማሳየት", details: "ታሪኮችን መፈለግ; የታሪክ አባት ማዘጋጀት; መንፈሳዊ ፊልም ማሳየት; መንፈሳዊ ጨዋታ ማዘጋጀት", indicator: "በፐርሰንት", metricTarget: "80%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል", budget: "-", recurrenceDays: 365 },
  { no: 3, subUnit: "", title: "የቁርባን መርሀግብር ማዘጋጀት", details: "ጊዜ መመደብ; ቦታ ማዘጋጀት; ትምህርት መስጠት; ከንስሐ አባት ጋር ማገናኘት", indicator: "በቁጥር", metricTarget: "4", timing: "ጥቅምት 22, ጥር 30, መጋቢት 29, ግንቦት 1", executor: "ህፃናት ክፍል", budget: "-", recurrenceDays: 91 },
  { no: 4, subUnit: "", title: "የጠፉ አባላትን መፈለግ", details: "አቴንዳስ መከታተል; ደውሎ ምክንያት መጠየቅ; ደብዳቤ መላክ; ቤት ድረስ መሄድ", indicator: "በፐርሰንት", metricTarget: "70%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል", budget: "500", recurrenceDays: 365 },
  { no: 5, subUnit: "", title: "ስርዓተ ትምህርት እና የአብነት ትምህርት በተገቢ ሁኔታ መስጠቱን መቆጣጠር", details: "ትምህርት መሰጠቱን መቆጣጠር; ስልጠና መሰጠቱን መቆጣጠር; መምህራንን መገምገም; የተማሩትን ትምህርት ተግባራዊ ልምምድ በመስጠት መከታተል; መምህራንን ማስመደብ; ጊዜ ማመቻቸት", indicator: "በፐርሰንት", metricTarget: "90%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል ከ ትምህርት እና ስልጠና ክፍል ጋር በመተባበር", budget: "-", recurrenceDays: 365 },
  { no: 6, subUnit: "", title: "መዝሙር እና ኪነጥበብ ስራዎችን በተገቢ ሁኔታ መስጠቱን መቆጣጠር", details: "የአመቱን መዝሙራት በወቅታቸው መጠናቱን መቆጣጠር; የንግስ ወረቦች መጠናቱን መቆጣጠር; የኪነጥበብ ስራዎች በወቅታቸው እየተሰሩ መሆኑን መቆጣጠር", indicator: "በፐርሰንት", metricTarget: "90%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል ከ ዜማ እና ስነጥበብ ክፍል ጋር በመተባበር", budget: "-", recurrenceDays: 365 },
  { no: 7, subUnit: "", title: "አባላትን በ ቤተሰብ ማደራጀት", details: "አባት እና እናት መመደብ; በወር አንዴ እንዲሰበሰቡ ማድረግ", indicator: "በፐርሰንት", metricTarget: "80%", timing: "ከህዳር-የካቲት", executor: "ህፃናት ክፍል ከሰው ሀብት አስተዳደር ክፍል ጋር በመተባበር", budget: "-", recurrenceDays: 365 },
  { no: 8, subUnit: "", title: "መንፈሳዊ ቦታዎችን እንዲጎበኙ ሁኔታዎችን ማመቻቸት", details: "ከሚመለከተው ክፍል ጋር በመሆን መንፈሳዊ ቦታዎችን እንዲጎበኙ ማድረግ", indicator: "በቁጥር", metricTarget: "2", timing: "የካቲት 21, ሐምሌ 25", executor: "ህፃናት ክፍል ከ መረጃ እና የውስጥ ግንኙነት ክፍል ጋር በመተባበር", budget: "1000", recurrenceDays: 182 },
  { no: 9, subUnit: "", title: "ከወላጆች ጋር ትስስር መፍጠር", details: "ኮሚውኒኬሽን ቡክ እንዲዘጋጅ ማድረግ; በየ 3 ወሩ የውይይት መርሀግብር ማዘጋጀት; የ ስነምግባር እና የዕለት ተዕለት ለውጣቸውን መከታተል", indicator: "በፐርሰንት", metricTarget: "80%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል ከመርሀግብር እና ጉባዔያት ክፍል ጋር በመተባበር", budget: "1500", recurrenceDays: 365 },
  { no: 10, subUnit: "", title: "የተለያዩ መርሀግብሮችን ማዘጋጀት", details: "የውይይት መድረኮችን ማዘጋጀት; የልደት፣የሰንበት ት/ቤቱን የልደት መርሀግብር ማዘጋጀት; ለመርሀግብሩ ሚሆኑ ስራዎችን የሚመለከተው ክፍል ማዘጋጀቱን መቆጣጠር; ንግስ ወይም መርሀግብር ካለፈ በኋላ ግምገማ በማድረግ የመፍትሄ ሀሳቦችን ማስቀመጥ", indicator: "በቁጥር", metricTarget: "5", timing: "መስከረም 23, ታህሳስ 25, ጥር 9, ነሀሴ 23, ነሀሴ 29", executor: "ህፃናት ክፍል ከ መርሀግብርና ጉባዔያት እና ከዜማናስነጥበብ ክፍል ጋር በመተባበር", budget: "3000", recurrenceDays: 91 },
  { no: 11, subUnit: "", title: "ወርሀዊ መዋጮ መሰብሰብ", details: "ከህፃናት መሰብሰብ; ከአባላት መሰብሰብ; የተሰበሰበውን ብር ለሚመለከተው ክፍል ማስረከብ", indicator: "በቁጥር", metricTarget: "12", timing: "12 ጊዜ", executor: "ህፃናት ክፍል ከ ሂሳብና ንብረት ክፍል ጋር በመተባበር", budget: "-", recurrenceDays: 30, fixedCadence: true },
  { no: 12, subUnit: "", title: "ስብሰባ ማድረግ", details: "ከአባላት ጋር በመነጋገር በወሩ መጨረሻ መሰብሰብ", indicator: "በፐርሰንት", metricTarget: "80%", timing: "ከመስከረም-ነሀሴ", executor: "ህፃናት ክፍል", budget: "-", recurrenceDays: 30, fixedCadence: true },
  { no: 13, subUnit: "", title: "ልምድ ልውውጥ ማድረግ", details: "ቦታ መምረጥ; ደብዳቤ መላክ", indicator: "በቁጥር", metricTarget: "1", timing: "የካቲት 28", executor: "ህፃናት ክፍል", budget: "200", recurrenceDays: 365 },
  { no: 14, subUnit: "", title: "የ 2020 ዕቅድ ማቀድ", details: "የ2019 እቅድን መሰረት በማድረግ ማቀድ; ክፍተቶችን ለመድፈን መፍትሄ በመፈለግ ማቀድ", indicator: "በቁጥር", metricTarget: "1", timing: "ነሀሴ", executor: "ህፃናት ክፍል", budget: "-", recurrenceDays: 365 },
];

// ---------- Due-date calculation ----------
// On top of the month-level scheduling in ethiopian-calendar.js this understands
//   "ጥቅምት 22, ጥር 30"  -> the exact days (Ethiopian calendar)
//   "ከመስከረም-ነሀሴ"     -> a range starting with ከ: due at the END of the last month
// and treats the spelling ነሀሴ like ነሐሴ.
function normalizeEthText(s) { return String(s || "").replace(/ነሀሴ/g, "ነሐሴ"); }
function planNextDate(timing, fromDate) {
  const text = normalizeEthText(timing);
  const names = Object.keys(ETH_MONTH_MAP).sort((a, b) => b.length - a.length).join("|");
  const fromMid = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const fromEthYear = gregorianToEthiopian(fromDate).year;
  const nextAfter = (list) => {
    const c = [];
    for (const y of [fromEthYear, fromEthYear + 1]) for (const [m, d] of list) c.push(ethiopianToGregorian(y, m, d));
    c.sort((a, b) => a - b);
    const hit = c.find((x) => x > fromMid);
    return hit ? isoDate(hit) : null;
  };
  const pairs = [...text.matchAll(new RegExp("(" + names + ")\\s*(\\d{1,2})", "g"))]
    .map((m) => [ETH_MONTH_MAP[m[1]], parseInt(m[2], 10)])
    .filter(([mo, d]) => d >= 1 && d <= (mo === 13 ? 6 : 30));
  if (pairs.length) return nextAfter(pairs);
  const range = new RegExp("ከ\\s*(" + names + ")\\s*[-\u2013\u2014]\\s*(" + names + ")").exec(text);
  if (range) { const mo = ETH_MONTH_MAP[range[2]]; return nextAfter([[mo, mo === 13 ? 5 : 30]]); }
  return computeEthAwareNextDate(text, fromDate);
}
// Only items of the current role's plan are shown/used: the children's
// department sees its own plan; everyone else sees the HR plan.
function planVisibleToRole(p) {
  return isChildrenRole() ? p.category === "children" : p.category !== "children";
}

async function ensurePlanItems() {
  const existing = await getAll("planItems");
  const existingKeys = new Set(existing.map((e) => e.category + "|" + e.title));
  const today = new Date();
  const seedRow = async (row, category) => {
    if (existingKeys.has(category + "|" + row.title)) return; // already present — don't touch its progress
    // "on or after today" (so an event dated today still shows up): look from yesterday
    const ethNext = row.fixedCadence ? null : planNextDate(row.timing, addDays(today, -1));
    const fallbackNext = row.recurrenceDays > 0 ? isoDate(addDays(today, 14)) : null;
    await put("planItems", {
      id: uid(), no: row.no, category, subUnit: row.subUnit, title: row.title,
      details: row.details || "", outcome: row.outcome || "", indicator: row.indicator || "",
      metricTarget: row.metricTarget || "", timing: row.timing, executor: row.executor,
      budget: row.budget || "-", recurrenceDays: row.recurrenceDays, fixedCadence: !!row.fixedCadence, autoMetric: row.autoMetric || null,
      nextDate: ethNext || fallbackNext, lastDone: null, doneLog: [],
    });
  };
  for (const row of DEFAULT_PLAN_MAIN) await seedRow(row, "main");
  for (const row of DEFAULT_PLAN_INTERNAL) await seedRow(row, "internal");
  for (const row of DEFAULT_PLAN_CHILDREN) await seedRow(row, "children");
}

async function computePlanReminders() {
  const items = (await getAll("planItems")).filter(planVisibleToRole);
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
  // Done ahead of time? Then the next due date is the one AFTER the current
  // due date, not the same one again.
  const base = e.nextDate && e.nextDate > today ? new Date(e.nextDate + "T00:00:00") : new Date();
  const ethNext = e.fixedCadence ? null : planNextDate(e.timing, base);
  if (ethNext) e.nextDate = ethNext;
  else if (e.recurrenceDays > 0) e.nextDate = isoDate(addDays(new Date(), e.recurrenceDays));
  await put("planItems", e);
}

// ---------- Plan ----------
async function renderPlan() {
  const planItems = (await getAll("planItems")).filter(planVisibleToRole);
  const lang = getLang();
  const categories = isChildrenRole()
    ? [{ key: "children", label: lang === "am" ? "የሕጻናት ክፍል ዕቅድ" : "Children's department plan" }]
    : [
        { key: "main", label: t("plan.mainCategory") },
        { key: "internal", label: t("plan.internalCategory") },
      ];
  const isAdmin = isAdminUser();

  el("view").innerHTML = `
    <div class="toolbar">
      <button id="exportPlanBtn" class="btn-secondary">${t("plan.exportExcel")}</button>
      ${isAdmin ? `<label class="btn-secondary file-btn">${lang === "am" ? "ዕቅድ አስመጣ" : "Import Plan"}<input type="file" id="planImportInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>` : ""}
      ${isAdmin ? `<button id="generateReportBtn" class="btn-primary">${lang === "am" ? "ሪፖርት አዘጋጅ" : "Generate Report"}</button>` : ""}
    </div>
    ${isAdmin ? `
    <div class="toolbar">
      <button id="resetPlanBtn" class="btn-secondary" style="color:var(--red);border-color:var(--red);">${lang === "am" ? "ወደ መጀመሪያው ዕቅድ መልስ" : "Reset to Original Plan"}</button>
    </div>` : ""}

    ${categories.map(cat => `
      <h3 class="section-title">${cat.label}</h3>
      <div class="list">
        ${planItems.filter(p => p.category === cat.key).map(p => `
          <div class="list-row">
            <div style="flex:1;">
              <b>${p.no}. ${p.title}</b><br>
              <span class="muted">${[p.subUnit, p.timing].filter(Boolean).join(" · ")}</span><br>
              ${p.indicator ? `<span class="muted">${lang === "am" ? "ዒላማ" : "Target"}: ${p.indicator} ${p.metricTarget || ""}${p.budget && p.budget !== "-" ? " · " + (lang === "am" ? "በጀት" : "Budget") + ": " + p.budget : ""}</span><br>` : ""}
              ${p.details ? `<span class="muted">${p.details}</span><br>` : ""}
              ${p.category === "children" && p.executor ? `<span class="muted">${p.executor}</span><br>` : ""}
              ${p.nextDate ? `<span class="muted">${t("plan.next")}: ${ethLabel(p.nextDate)} (${p.nextDate})</span>` : ""}
            </div>
            <div class="row-actions">
              ${p.nextDate && p.nextDate <= todayISO() ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
              <button class="btn-small" onclick="openPlanItemModal('${p.id}')">${t("members.edit")}</button>
              <button class="btn-small" onclick="markPlanDone('${p.id}')">${t("plan.markDone")}</button>
            </div>
          </div>`).join("")}
      </div>
    `).join("")}
  `;

  el("exportPlanBtn").onclick = () => exportPlanExcel(planItems);
  const reportBtn = el("generateReportBtn");
  if (reportBtn) {
    reportBtn.onclick = () => withButtonLoading(reportBtn, lang === "am" ? "በማመንጨት ላይ..." : "Generating...", () => generatePlanReport(planItems));
  }
  const importInput = el("planImportInput");
  if (importInput) {
    importInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const count = await importPlanExcel(file);
      await showAlert(lang === "am" ? `${count} የዕቅድ ንጥሎች ገብተዋል/ዘምነዋል` : `${count} plan item(s) imported/updated`);
      renderPlan();
    };
  }
  const resetBtn = el("resetPlanBtn");
  if (resetBtn) resetBtn.onclick = () => resetPlanToDefault();
}

window.markPlanDone = async (id) => {
  const note = (await showPrompt(t("plan.doneNotePrompt"))) || "";
  await markPlanItemDone(id, note);
  renderPlan();
};

// Edit a plan item's details, including its due date — previously only
// auto-computed via recurrenceDays when marked done, now directly editable.
window.openPlanItemModal = async function (id) {
  const item = await get("planItems", id);
  if (!item) return;
  const lang = getLang();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:460px;text-align:left;">
      <h3>${lang === "am" ? "የዕቅድ ንጥል አርትዕ" : "Edit Plan Item"}</h3>
      <label>${lang === "am" ? "ንዑስ ክፍል" : "Sub-unit"}</label>
      <input id="pi_subUnit" class="text-input" value="${item.subUnit || ""}">
      <label>${lang === "am" ? "ርዕስ" : "Title"}</label>
      <input id="pi_title" class="text-input" value="${item.title || ""}">
      <label>${lang === "am" ? "አስፈጻሚ" : "Executor"}</label>
      <input id="pi_executor" class="text-input" value="${item.executor || ""}">
      <label>${lang === "am" ? "ዒላማ" : "Target"}</label>
      <input id="pi_metricTarget" class="text-input" value="${item.metricTarget || ""}">
      <label>${lang === "am" ? "የጊዜ ገደብ" : "Timing"}</label>
      <input id="pi_timing" class="text-input" value="${item.timing || ""}">
      <label>${lang === "am" ? "የድግግሞሽ ቀናት (0 = በእጅ የሚከታተል)" : "Recurrence days (0 = manual tracking)"}</label>
      <input id="pi_recurrenceDays" type="number" min="0" class="text-input" value="${item.recurrenceDays || 0}">
      <label>${lang === "am" ? "ቀጣይ ቀን (ማብቂያ)" : "Next due date"}</label>
      <input id="pi_nextDate" type="date" class="text-input" value="${item.nextDate || ""}">
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button id="pi_saveBtn" class="btn-primary">${t("members.update")}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  el("pi_saveBtn").onclick = async () => {
    item.subUnit = el("pi_subUnit").value.trim();
    item.title = el("pi_title").value.trim();
    item.executor = el("pi_executor").value.trim();
    item.metricTarget = el("pi_metricTarget").value.trim();
    item.timing = el("pi_timing").value.trim() || item.timing || "";
    item.recurrenceDays = Number(el("pi_recurrenceDays").value) || 0;
    item.nextDate = el("pi_nextDate").value || null;
    await put("planItems", item);
    box.remove();
    renderPlan();
  };
};

// Wipes all plan items and re-seeds from DEFAULT_PLAN_MAIN/DEFAULT_PLAN_INTERNAL
// — discards every edit and every "done" history. Admin-only, confirmed.
window.resetPlanToDefault = async () => {
  const lang = getLang();
  const ok = await showConfirm(
    lang === "am"
      ? "ይህ ሁሉንም የዕቅድ ንጥሎች ወደ መጀመሪያው ቅንብር ይመልሳል እና ሁሉንም እድገት (የተጠናቀቁ ቀኖች) ያጠፋል። እርግጠኛ ነዎት?"
      : "This resets every plan item back to its original defaults and erases all progress (done dates). Are you sure?",
    { danger: true, okLabel: lang === "am" ? "እሺ፣ ዳግም አስጀምር" : "Yes, Reset" }
  );
  if (!ok) return;
  const existing = (await getAll("planItems")).filter(planVisibleToRole);
  for (const item of existing) await del("planItems", item.id);
  await ensurePlanItems();
  renderPlan();
};

async function exportPlanExcel(planItems) {
  if (typeof XLSX === 'undefined') { await showAlert('XLSX library not loaded'); return; }
  const rows = planItems.map(p => ({
    "ተ.ቁ": p.no,
    "ክፍል (main/internal)": p.category,
    "ንዑስ ክፍል": p.subUnit,
    "ርዕስ": p.title,
    "ዝርዝር": p.details || "",
    "ውጤት": p.outcome || "",
    "መለኪያ": p.indicator || "",
    "ዒላማ": p.metricTarget || "",
    "ጊዜ": p.timing,
    "አስፈጻሚ": p.executor,
    "በጀት": p.budget || "-",
    "የድግግሞሽ ቀናት": p.recurrenceDays || 0,
    "ቀጣይ ቀን": p.nextDate || "",
    "የመጨረሻ መከናወን": p.lastDone || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan");
  XLSX.writeFile(wb, `finote-plan-${todayISO()}.xlsx`);
}

// Upserts by (category + title), matching the same identity key
// ensurePlanItems() uses — a row whose category+title matches an existing
// item updates it in place (keeping its doneLog/id); anything unmatched
// is added as a new item.
async function importPlanExcel(file) {
  if (typeof XLSX === 'undefined') { await showAlert('XLSX library not loaded'); return 0; }
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const existing = await getAll("planItems");
  let count = 0;
  for (const row of rows) {
    const title = String(pick(row, ["ርዕስ", "አብይ ተግባር", "Title", "title"])).trim();
    if (!title) continue;
    const categoryRaw = String(pick(row, ["ክፍል (main/internal)", "ክፍል", "Category", "category"])).trim().toLowerCase();
    const category = categoryRaw === "internal" ? "internal" : (categoryRaw === "children" ? "children" : "main");
    const existingItem = existing.find((p) => p.category === category && p.title === title);
    const item = existingItem || {
      id: uid(), category, no: existing.filter((p) => p.category === category).length + 1,
      details: "", outcome: "", indicator: "", budget: "-", autoMetric: null, lastDone: null, doneLog: [],
    };
    item.title = title;
    item.subUnit = String(pick(row, ["ንዑስ ክፍል", "Sub-unit", "subUnit"])).trim() || item.subUnit || "";
    item.executor = String(pick(row, ["አስፈጻሚ", "ፈጻሚ አካል", "Executor", "executor"])).trim() || item.executor || "";
    item.metricTarget = String(pick(row, ["ዒላማ", "እቅድ", "Target", "metricTarget"])).trim() || item.metricTarget || "";
    item.timing = String(pick(row, ["ጊዜ", "የጊዜ ገደብ", "Timing", "timing"])).trim() || item.metricTarget || item.timing || "";
    const details = pick(row, ["ዝርዝር", "ዝርዝር ተግባር", "Details"]); if (details) item.details = String(details).trim();
    const outcome = pick(row, ["ውጤት", "Outcome"]); if (outcome) item.outcome = String(outcome).trim();
    const indicator = pick(row, ["መለኪያ", "Indicator"]); if (indicator) item.indicator = String(indicator).trim();
    const budget = pick(row, ["በጀት", "Budget"]); if (budget) item.budget = String(budget).trim();
    const recurrenceDays = pick(row, ["የድግግሞሽ ቀናት", "Recurrence Days", "recurrenceDays"]);
    if (recurrenceDays !== "") item.recurrenceDays = Number(recurrenceDays) || 0;
    const nextDate = pick(row, ["ቀጣይ ቀን", "Next Date", "nextDate"]);
    if (nextDate) item.nextDate = parseExcelDate(nextDate) || String(nextDate).trim();
    const lastDone = pick(row, ["የመጨረሻ መከናወን", "Last Done", "lastDone"]);
    if (lastDone) item.lastDone = parseExcelDate(lastDone) || String(lastDone).trim();
    await put("planItems", item);
    if (!existingItem) existing.push(item);
    count++;
  }
  return count;
}

// Admin-only printable summary report — separate from the raw Excel export
// above. Opens a new tab with a formatted table per category plus a
// completed/overdue count, then triggers the browser print dialog.
async function generatePlanReport(planItems) {
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
    await showAlert(lang === "am" ? "ብቅ-ባይ ማገጃ እባክዎ ይፍቀዱ" : "Please allow pop-ups to generate the report.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
