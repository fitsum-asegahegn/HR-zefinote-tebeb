/* ፍኖተ ጥበብ — Attendance Sheets (Groups -> Attendance Sheets)
   Builds an Excel workbook in the "attendance by days" layout:
     # | Name | one column per session date (✓) | Days attended
     + a "Total present per day" row, one SHEET PER PROGRAM, plus an optional
     combined sheet where each day counts once whichever program was attended.
   Only people who attended at least once appear. Records whose member no
   longer exists are skipped (the plain export shows these as "?").

   Dates you've already used for a previous report can be left out: set a
   "From" date and/or tick individual dates to skip. Both are remembered.

   Needs ExcelJS (CDN, see index.html) because the SheetJS build used elsewhere
   in the app can't write cell styles.
   Depends on globals: getAll, getSettings, setSetting, el, escapeHtml, showAlert,
   PROGRAM_DEFS, groupsBackBtn, ethShortDate, todayISO, downloadBlob,
   withButtonLoading, getLang. */

const ATT_SHEETS_DEFAULT_FROM = "2026-10-09"; // first date after the previously used Oct 3/6/7/8 sessions
const ATT_SHEET_NAMES = { timhert: "Course", mezmur: "Mezmur", tselot: "Tselot", mata: "Evening", kurban: "Kurban", awdemihret: "Awde Mihret" };
const ATT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function attDateLabel(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return ATT_MONTHS[m - 1] + " " + d;
}

// Pure (no DB / DOM): turn attendance rows into sheet descriptions.
// -> { sheets: [{ title, programKey|null, dates: [iso], people: [{ name, dates: Set }] }], skipped }
function buildAttendanceSheetsData({ attendance, members, from, to, excluded, programKeys, programNames, combined }) {
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const skip = new Set(excluded || []);
  let skipped = 0;
  const recs = [];
  for (const a of attendance) {
    if (from && a.sessionDate < from) continue;
    if (to && a.sessionDate > to) continue;
    if (skip.has(a.sessionDate)) continue;
    if (!programKeys.includes(a.programKey)) continue;
    if (!nameOf.has(a.memberId)) { skipped++; continue; }
    recs.push(a);
  }
  const makeSheet = (title, programKey, list) => {
    const dates = [...new Set(list.map((a) => a.sessionDate))].sort();
    const by = new Map();
    for (const a of list) {
      if (!by.has(a.memberId)) by.set(a.memberId, new Set());
      by.get(a.memberId).add(a.sessionDate);
    }
    const people = [...by.entries()]
      .map(([id, set]) => ({ name: nameOf.get(id), dates: set }))
      .sort((x, y) => (y.dates.size - x.dates.size) || x.name.localeCompare(y.name));
    return { title, programKey, dates, people };
  };
  const sheets = [];
  if (combined && recs.length) sheets.push(makeSheet("All programs (by day)", null, recs));
  for (const key of programKeys) {
    const list = recs.filter((a) => a.programKey === key);
    if (list.length) sheets.push(makeSheet(programNames[key] || key, key, list));
  }
  return { sheets, skipped };
}

function colLetter(n) { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

async function downloadAttendanceSheetsXlsx(data, { ethHeaders, from, to }) {
  const am = getLang() === "am";
  if (typeof ExcelJS === "undefined") {
    await showAlert(am ? "ExcelJS ቤተ-መጻሕፍት አልተጫነም — ኢንተርኔት ያረጋግጡ እና መተግበሪያውን እንደገና ይክፈቱ" : "The Excel library isn't loaded — check your connection and reopen the app.");
    return false;
  }
  const wb = new ExcelJS.Workbook();
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const font = (o = {}) => ({ name: "Arial", size: 11, ...o });
  const note = `Source: Finote attendance app. Period: ${from ? attDateLabel(from) : "start"} – ${to ? attDateLabel(to) : "today"}.`
    + (data.skipped ? ` ${data.skipped} record(s) of members that no longer exist were skipped.` : "");

  for (const sh of data.sheets) {
    const ws = wb.addWorksheet(sh.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    const n = sh.dates.length, last = 2 + n + 1;
    const head = ws.getRow(1);
    const heads = ["#", "Name", ...sh.dates.map((d) => (ethHeaders ? attDateLabel(d) + "\n" + ethShortDate(d) : attDateLabel(d))), "Days attended"];
    heads.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: !!ethHeaders };
      c.border = border;
    });
    head.height = ethHeaders ? 30 : 15;

    sh.people.forEach((p, idx) => {
      const r = idx + 2;
      const row = ws.getRow(r);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = p.name;
      sh.dates.forEach((d, i) => { if (p.dates.has(d)) row.getCell(3 + i).value = "✓"; });
      row.getCell(last).value = { formula: `COUNTA(C${r}:${colLetter(2 + n)}${r})`, result: p.dates.size };
      for (let c = 1; c <= last; c++) {
        const cell = row.getCell(c);
        cell.font = font(c === last ? { bold: true } : {});
        cell.border = border;
        cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical: "middle" };
      }
      row.height = 15;
    });

    const tr = sh.people.length + 2;
    const total = ws.getRow(tr);
    total.getCell(2).value = "Total present per day";
    sh.dates.forEach((d, i) => {
      const L = colLetter(3 + i);
      total.getCell(3 + i).value = { formula: `COUNTA(${L}2:${L}${tr - 1})`, result: sh.people.filter((p) => p.dates.has(d)).length };
    });
    total.getCell(last).value = { formula: `SUM(${colLetter(last)}2:${colLetter(last)}${tr - 1})`, result: sh.people.reduce((s, p) => s + p.dates.size, 0) };
    for (let c = 1; c <= last; c++) {
      const cell = total.getCell(c);
      cell.font = font({ bold: true });
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
      cell.border = border;
      cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical: "bottom" };
    }
    total.height = 15;

    const nc = ws.getRow(tr + 2).getCell(2);
    nc.value = note + (sh.programKey === null ? " Each day counts once, whichever program the person attended." : "");
    nc.font = font({ size: 9, italic: true });

    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 34;
    for (let i = 0; i < n; i++) ws.getColumn(3 + i).width = 10;
    ws.getColumn(last).width = 15;
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `attendance-by-program-${todayISO()}.xlsx`);
  return true;
}

async function renderAttendanceSheets() {
  const am = getLang() === "am";
  const [attendance, members, settings] = await Promise.all([getAll("attendance"), getAll("members"), getSettings()]);
  const progs = PROGRAM_DEFS();
  const programNames = {};
  progs.forEach((p) => { programNames[p.key] = ATT_SHEET_NAMES[p.key] || p.name; });
  const withData = progs.filter((p) => attendance.some((a) => a.programKey === p.key));

  const st = window._attSheets = window._attSheets || {};
  if (st.from === undefined) st.from = settings.attSheetsFrom !== undefined ? settings.attSheetsFrom : ATT_SHEETS_DEFAULT_FROM;
  if (st.to === undefined) st.to = "";
  if (!st.excluded) st.excluded = Array.isArray(settings.attSheetsExcluded) ? settings.attSheetsExcluded : [];
  if (!st.programs) st.programs = withData.map((p) => p.key);
  if (st.combined === undefined) st.combined = true;
  if (st.eth === undefined) st.eth = false;

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${am ? "የመገኘት ሉሆች (Excel)" : "Attendance Sheets (Excel)"}</h3>
    <p class="muted">${am
      ? "ለእያንዳንዱ ፕሮግራም አንድ ሉህ፦ ስም በረድፍ፣ ቀናት በአምድ (✓)፣ የተገኙበት ቀናት ብዛት እና የየቀኑ ድምር። ቀደም ሲል ለሪፖርት የተጠቀሙባቸውን ቀናት መዝለል ይችላሉ።"
      : "One sheet per program: names down the side, a ✓ under each date attended, days attended, and a total per day. You can skip dates you've already used for an earlier report."}</p>

    <label>${am ? "ከዚህ ቀን ጀምሮ" : "From date"}</label>
    <input id="as_from" type="date" class="text-input" value="${st.from || ""}">
    <label>${am ? "እስከዚህ ቀን" : "To date (empty = today)"}</label>
    <input id="as_to" type="date" class="text-input" value="${st.to || ""}">

    <details style="margin-bottom:10px;">
      <summary class="muted" id="as_exSummary" style="cursor:pointer;"></summary>
      <div id="as_dates" style="margin-top:8px;"></div>
    </details>

    <label>${am ? "ፕሮግራሞች" : "Programs"}</label>
    ${withData.length ? withData.map((p) => `
      <label class="sel-check" style="gap:8px;margin-bottom:6px;">
        <input type="checkbox" class="as_prog" value="${p.key}" ${st.programs.includes(p.key) ? "checked" : ""}/> ${escapeHtml(p.name)}
      </label>`).join("") : `<p class="muted">${am ? "ገና መገኘት አልተመዘገበም" : "No attendance recorded yet"}</p>`}
    <label class="sel-check" style="gap:8px;margin:10px 0 6px;">
      <input type="checkbox" id="as_combined" ${st.combined ? "checked" : ""}/> ${am ? "የሁሉም ፕሮግራሞች ሉህ ጨምር (ቀን በአንድ ጊዜ ይቆጠራል)" : "Add a combined sheet (each day counts once, any program)"}
    </label>
    <label class="sel-check" style="gap:8px;margin-bottom:12px;">
      <input type="checkbox" id="as_eth" ${st.eth ? "checked" : ""}/> ${am ? "የኢትዮጵያ ቀን በራስጌ ላይ ጨምር" : "Show the Ethiopian date under each header"}
    </label>

    <div id="as_preview" class="list" style="margin-bottom:12px;"></div>
    <button id="as_download" class="btn-primary" style="width:100%;" disabled>${am ? "Excel አውርድ" : "Download Excel"}</button>`;

  const params = () => ({
    attendance, members, from: st.from || "", to: st.to || todayISO(), excluded: st.excluded,
    programKeys: withData.map((p) => p.key).filter((k) => st.programs.includes(k)), programNames, combined: st.combined,
  });

  function drawDates() {
    const from = st.from || "", to = st.to || todayISO();
    const counts = new Map();
    attendance.forEach((a) => {
      if ((from && a.sessionDate < from) || a.sessionDate > to) return;
      if (!counts.has(a.sessionDate)) counts.set(a.sessionDate, new Set());
      counts.get(a.sessionDate).add(a.memberId);
    });
    const list = [...counts.keys()].sort();
    el("as_exSummary").textContent = am
      ? `ቀናትን ዝለል (${st.excluded.filter((d) => counts.has(d)).length} ተዘልለዋል · ${list.length} ቀናት በክልሉ)`
      : `Skip specific dates (${st.excluded.filter((d) => counts.has(d)).length} skipped · ${list.length} dates in range)`;
    el("as_dates").innerHTML = list.length ? list.map((d) => `
      <label class="sel-check" style="gap:8px;margin-bottom:6px;">
        <input type="checkbox" class="as_ex" value="${d}" ${st.excluded.includes(d) ? "checked" : ""}/>
        <span>${d} <span class="muted">· ${ethLabel(d)} · ${counts.get(d).size} ${am ? "ሰዎች" : "people"}</span></span>
      </label>`).join("") : `<p class="muted">${am ? "በዚህ ክልል ቀን የለም" : "No dates in this range"}</p>`;
    el("as_dates").querySelectorAll(".as_ex").forEach((cb) => {
      cb.onchange = async () => {
        st.excluded = [...el("as_dates").querySelectorAll(".as_ex:checked")].map((x) => x.value)
          .concat(st.excluded.filter((d) => !counts.has(d)));
        await setSetting("attSheetsExcluded", st.excluded);
        refresh(false);
      };
    });
  }

  let data = { sheets: [], skipped: 0 };
  function refresh(redrawDates = true) {
    if (redrawDates) drawDates();
    data = buildAttendanceSheetsData(params());
    el("as_preview").innerHTML = data.sheets.length ? data.sheets.map((s) => `
      <div class="list-row"><div><b>${escapeHtml(s.title)}</b><br><span class="muted">${s.people.length} ${am ? "ሰዎች" : "people"} · ${s.dates.length} ${am ? "ቀናት" : "date(s)"}: ${s.dates.map(attDateLabel).join(", ")}</span></div></div>`).join("")
      + (data.skipped ? `<p class="muted">${am ? `${data.skipped} የተሰረዙ አባላት መዝገቦች ተዘለዋል` : `${data.skipped} record(s) of deleted members will be skipped`}</p>` : "")
      : `<p class="muted">${am ? "በተመረጡት መስፈርቶች ምንም መገኘት የለም" : "No attendance matches these settings"}</p>`;
    el("as_download").disabled = !data.sheets.length;
  }

  el("as_from").onchange = async (e) => { st.from = e.target.value; await setSetting("attSheetsFrom", st.from); refresh(); };
  el("as_to").onchange = (e) => { st.to = e.target.value; refresh(); };
  el("view").querySelectorAll(".as_prog").forEach((cb) => {
    cb.onchange = () => { st.programs = [...el("view").querySelectorAll(".as_prog:checked")].map((x) => x.value); refresh(false); };
  });
  el("as_combined").onchange = (e) => { st.combined = e.target.checked; refresh(false); };
  el("as_eth").onchange = (e) => { st.eth = e.target.checked; };
  el("as_download").onclick = (e) => withButtonLoading(e.currentTarget, am ? "በማዘጋጀት ላይ..." : "Preparing...", () =>
    downloadAttendanceSheetsXlsx(data, { ethHeaders: st.eth, from: st.from, to: st.to }));
  refresh();
}
