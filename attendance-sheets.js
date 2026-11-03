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
   It also makes the Word "at least N days" lists for a holiday (see
   buildMinDaysLists): the holiday date ends the period, the number of session
   days D in it sets the highest list, and lists are made for D, D-1 ... 1.
   Depends on globals: getAll, getSettings, setSetting, el, escapeHtml, showAlert,
   showConfirm, PROGRAM_DEFS, groupsBackBtn, ethShortDate, ethLabel,
   gregorianToEthiopian, ETH_MONTH_NAMES_AM, isoDate, addDays, todayISO,
   downloadBlob, withButtonLoading, getLang, docx (CDN). */

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

// ---------- "At least N days" lists for a holiday (Word) ----------
// The period runs from the "From" date up to the day BEFORE the holiday. Every
// date with any attendance (in the ticked programs, minus skipped dates) is one
// session day, counted once whichever program was attended. If the period has
// D such days, one list is made for each minimum: D, D-1, ... 1 — so the
// highest list is always "attended every session day".
function buildMinDaysLists({ attendance, members, from, to, excluded, programKeys, punishedIds }) {
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const skip = new Set(excluded || []);
  const byMember = new Map();
  const days = new Set();
  let skippedDeleted = 0;
  for (const a of attendance) {
    if (from && a.sessionDate < from) continue;
    if (to && a.sessionDate > to) continue;
    if (skip.has(a.sessionDate)) continue;
    if (!programKeys.includes(a.programKey)) continue;
    if (!nameOf.has(a.memberId)) { skippedDeleted++; continue; }
    days.add(a.sessionDate);
    if (!byMember.has(a.memberId)) byMember.set(a.memberId, new Set());
    byMember.get(a.memberId).add(a.sessionDate);
  }
  let punishedLeftOut = 0;
  const people = [];
  for (const [id, set] of byMember) {
    if (punishedIds && punishedIds.has(id)) { punishedLeftOut++; continue; }
    people.push({ name: nameOf.get(id), dates: [...set].sort() });
  }
  people.sort((x, y) => (y.dates.length - x.dates.length) || x.name.localeCompare(y.name));
  const dayList = [...days].sort();
  const lists = [];
  for (let n = dayList.length; n >= 1; n--) lists.push({ n, people: people.filter((p) => p.dates.length >= n) });
  return { days: dayList, lists, skippedDeleted, punishedLeftOut };
}

function minDaysDocChildren({ title, list, notes }) {
  const NYALA = "Nyala";
  const b = { style: docx.BorderStyle.SINGLE, size: 4, color: "000000" };
  const widths = [700, 3000, 1500, 3440]; // = 8640, the text width of a Letter page with 1.25in side margins
  const cell = (text, i, bold) => new docx.TableCell({
    width: { size: widths[i], type: docx.WidthType.DXA },
    children: [new docx.Paragraph({ children: [new docx.TextRun({ text: String(text), bold: !!bold, font: NYALA })] })],
  });
  const head = new docx.TableRow({
    tableHeader: true,
    children: ["#", "ስም", "የተገኙበት ቀናት ብዛት", "የተገኙበት ቀናት"].map((h, i) => cell(h, i, true)),
  });
  const body = list.people.map((p, idx) => new docx.TableRow({
    cantSplit: true,
    children: [String(idx + 1), p.name, String(p.dates.length), p.dates.map(attDateLabel).join(", ")].map((v, i) => cell(v, i, false)),
  }));
  const out = [
    new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: title, bold: true, size: 36, font: NYALA })] }),
    new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { after: 200 }, children: [new docx.TextRun({ text: `ቢያንስ ${list.n} ቀን የተገኙ (${list.people.length})`, font: NYALA })] }),
    new docx.Table({
      width: { size: 8640, type: docx.WidthType.DXA },
      columnWidths: widths,
      layout: docx.TableLayoutType.FIXED,
      borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
      rows: [head, ...body],
    }),
  ];
  notes.forEach((t) => out.push(new docx.Paragraph({ spacing: { before: 160 }, children: [new docx.TextRun({ text: t, font: NYALA })] })));
  return out;
}

async function downloadMinDaysDocs({ result, holidayName, oneFile }) {
  const am = getLang() === "am";
  if (typeof docx === "undefined") {
    await showAlert(am ? "docx ቤተ-መጻሕፍት አልተጫነም — ኢንተርኔት ያረጋግጡ" : "The Word library isn't loaded — check your connection and reopen the app.");
    return false;
  }
  const title = holidayName ? `የ${holidayName} የአገልግሎት አቴንዳንስ` : "የአገልግሎት አቴንዳንስ";
  const notes = [];
  if (result.skippedDeleted) notes.push(`ማሳሰቢያ: ${result.skippedDeleted} የተሰረዙ አባላት መዝገቦች አልተካተቱም።`);
  if (result.punishedLeftOut) notes.push(`ማሳሰቢያ: ${result.punishedLeftOut} አባላት በቅጣት ላይ ስለሆኑ አልተካተቱም።`);
  const props = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 } } };
  const mk = (lists) => new docx.Document({
    styles: { default: { document: { run: { font: "Nyala" } } } },
    sections: lists.map((list) => ({ properties: props, children: minDaysDocChildren({ title, list, notes }) })),
  });
  if (oneFile) {
    downloadBlob(await docx.Packer.toBlob(mk(result.lists)), `Attendance_min_days_${todayISO()}.docx`);
  } else {
    for (const list of result.lists) {
      downloadBlob(await docx.Packer.toBlob(mk([list])), `Attendance_min_${list.n}_day${list.n === 1 ? "" : "s"}.docx`);
      await new Promise((r) => setTimeout(r, 600)); // let the browser accept each download
    }
  }
  return true;
}

async function renderAttendanceSheets() {
  const am = getLang() === "am";
  const [attendance, members, punishments, settings] = await Promise.all([getAll("attendance"), getAll("members"), getAll("punishments"), getSettings()]);
  const progs = PROGRAM_DEFS();
  const programNames = {};
  progs.forEach((p) => { programNames[p.key] = ATT_SHEET_NAMES[p.key] || p.name; });
  const withData = progs.filter((p) => attendance.some((a) => a.programKey === p.key));

  const st = window._attSheets = window._attSheets || {};
  if (st.from === undefined) st.from = settings.attSheetsFrom !== undefined ? settings.attSheetsFrom : ATT_SHEETS_DEFAULT_FROM;
  if (st.holiday === undefined) st.holiday = "";
  if (st.holidayName === undefined) st.holidayName = "";
  if (!st.excluded) st.excluded = Array.isArray(settings.attSheetsExcluded) ? settings.attSheetsExcluded : [];
  if (!st.programs) st.programs = withData.map((p) => p.key);
  if (st.combined === undefined) st.combined = true;
  if (st.eth === undefined) st.eth = false;
  if (st.oneFile === undefined) st.oneFile = false;
  if (st.skipPunished === undefined) st.skipPunished = true;

  // the period ends the day before the holiday (or today when no holiday is set)
  const periodEnd = () => (st.holiday ? isoDate(addDays(new Date(st.holiday + "T00:00:00"), -1)) : todayISO());
  const ethName = (iso) => {
    const e = gregorianToEthiopian(new Date(iso + "T00:00:00"));
    return `${ETH_MONTH_NAMES_AM[e.month]} ${e.day}`;
  };

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${am ? "የመገኘት ሉሆች እና ዝርዝሮች" : "Attendance Sheets & Lists"}</h3>
    <p class="muted">${am
      ? "ከቀደመው በዓል በኋላ ያሉ ቀናትን ይምረጡ። የበዓሉን ቀን ሲያስገቡ ጊዜው እስከ ዋዜማው ይቆጠራል፣ የክፍለ-ጊዜ ቀናት ብዛት (D) ይታወቃል፣ ከዚያም ለ D፣ D-1 … 1 ቀን ዝርዝሮች ይሠራሉ።"
      : "Pick the days since the previous holiday. Enter the holiday date and the period is counted up to the day before it; the app finds how many session days (D) there were and makes lists for D, D-1 … 1 days."}</p>

    <label>${am ? "ከዚህ ቀን ጀምሮ (የቀደመው በዓል ቀን)" : "From date (the previous holiday)"}</label>
    <input id="as_from" type="date" class="text-input" value="${st.from || ""}">
    <label>${am ? "የበዓሉ ቀን (ጊዜው እስከ ዋዜማው ይቆጠራል)" : "Holiday date (period ends the day before)"}</label>
    <input id="as_holiday" type="date" class="text-input" value="${st.holiday || ""}">
    <p class="muted" id="as_period" style="margin-top:-6px;"></p>

    <details style="margin-bottom:10px;">
      <summary class="muted" id="as_exSummary" style="cursor:pointer;"></summary>
      <div id="as_dates" style="margin-top:8px;"></div>
    </details>

    <label>${am ? "ፕሮግራሞች" : "Programs"}</label>
    ${withData.length ? withData.map((p) => `
      <label class="sel-check" style="gap:8px;margin-bottom:6px;">
        <input type="checkbox" class="as_prog" value="${p.key}" ${st.programs.includes(p.key) ? "checked" : ""}/> ${escapeHtml(p.name)}
      </label>`).join("") : `<p class="muted">${am ? "ገና መገኘት አልተመዘገበም" : "No attendance recorded yet"}</p>`}

    <h3 class="section-title">${am ? "Excel ሉሆች" : "Excel sheets"}</h3>
    <label class="sel-check" style="gap:8px;margin:0 0 6px;">
      <input type="checkbox" id="as_combined" ${st.combined ? "checked" : ""}/> ${am ? "የሁሉም ፕሮግራሞች ሉህ ጨምር (ቀን በአንድ ጊዜ ይቆጠራል)" : "Add a combined sheet (each day counts once, any program)"}
    </label>
    <label class="sel-check" style="gap:8px;margin-bottom:12px;">
      <input type="checkbox" id="as_eth" ${st.eth ? "checked" : ""}/> ${am ? "የኢትዮጵያ ቀን በራስጌ ላይ ጨምር" : "Show the Ethiopian date under each header"}
    </label>
    <div id="as_preview" class="list" style="margin-bottom:12px;"></div>
    <button id="as_download" class="btn-primary" style="width:100%;" disabled>${am ? "Excel አውርድ" : "Download Excel"}</button>

    <h3 class="section-title">${am ? "የ Word ዝርዝሮች (ቢያንስ N ቀን)" : "Word lists (at least N days)"}</h3>
    <label>${am ? "የበዓሉ ስም (ርዕስ)" : "Holiday name (title)"}</label>
    <input id="as_hname" class="text-input" value="${escapeHtml(st.holidayName)}" placeholder="${am ? "ለምሳሌ ጥቅምት 22" : "e.g. ጥቅምት 22"}">
    <p class="muted" id="as_wordInfo"></p>
    <div id="as_wordList" class="list" style="margin-bottom:10px;"></div>
    <label class="sel-check" style="gap:8px;margin-bottom:6px;">
      <input type="checkbox" id="as_punish" ${st.skipPunished ? "checked" : ""}/> ${am ? "በቅጣት ላይ ያሉ አባላትን አታካትት (በበዓሉ ቀን)" : "Leave out members on punishment (on the holiday date)"}
    </label>
    <label class="sel-check" style="gap:8px;margin-bottom:12px;">
      <input type="checkbox" id="as_oneFile" ${st.oneFile ? "checked" : ""}/> ${am ? "ሁሉንም በአንድ ፋይል (ገጽ በገጽ)" : "Everything in one file (one page group per list)"}
    </label>
    <button id="as_word" class="btn-primary" style="width:100%;" disabled>${am ? "Word ፋይሎችን አውርድ" : "Download Word files"}</button>`;

  const params = () => ({
    attendance, members, from: st.from || "", to: periodEnd(), excluded: st.excluded,
    programKeys: withData.map((p) => p.key).filter((k) => st.programs.includes(k)), programNames, combined: st.combined,
  });
  const punishedIds = () => new Set(!st.skipPunished || !st.holiday ? [] :
    punishments.filter((p) => p.startDate <= st.holiday && st.holiday <= p.endDate).map((p) => p.memberId));

  function drawDates() {
    const from = st.from || "", to = periodEnd();
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
  let words = { days: [], lists: [], skippedDeleted: 0, punishedLeftOut: 0 };
  function refresh(redrawDates = true) {
    if (redrawDates) drawDates();
    const to = periodEnd();
    el("as_period").textContent = `${st.from ? attDateLabel(st.from) : (am ? "መጀመሪያ" : "start")} → ${attDateLabel(to)}`
      + (st.holiday ? ` · ${am ? "በዓል" : "holiday"}: ${ethLabel(st.holiday)}` : "");

    data = buildAttendanceSheetsData(params());
    el("as_preview").innerHTML = data.sheets.length ? data.sheets.map((s) => `
      <div class="list-row"><div><b>${escapeHtml(s.title)}</b><br><span class="muted">${s.people.length} ${am ? "ሰዎች" : "people"} · ${s.dates.length} ${am ? "ቀናት" : "date(s)"}: ${s.dates.map(attDateLabel).join(", ")}</span></div></div>`).join("")
      + (data.skipped ? `<p class="muted">${am ? `${data.skipped} የተሰረዙ አባላት መዝገቦች ተዘለዋል` : `${data.skipped} record(s) of deleted members will be skipped`}</p>` : "")
      : `<p class="muted">${am ? "በተመረጡት መስፈርቶች ምንም መገኘት የለም" : "No attendance matches these settings"}</p>`;
    el("as_download").disabled = !data.sheets.length;

    words = buildMinDaysLists({ ...params(), punishedIds: punishedIds() });
    if (!st.holiday) {
      el("as_wordInfo").textContent = am ? "የዝርዝሮቹን ቀናት ብዛት ለማወቅ የበዓሉን ቀን ያስገቡ።" : "Enter the holiday date above to work out the lists.";
      el("as_wordList").innerHTML = "";
    } else if (!words.days.length) {
      el("as_wordInfo").textContent = am ? "በዚህ ጊዜ ውስጥ ምንም መገኘት የለም" : "No attendance in this period.";
      el("as_wordList").innerHTML = "";
    } else {
      const D = words.days.length;
      el("as_wordInfo").textContent = am
        ? `${D} የክፍለ-ጊዜ ቀናት (${words.days.map(attDateLabel).join(", ")}) → ለ ${D} ... 1 ቀን ${D} ዝርዝሮች`
        : `${D} session day${D === 1 ? "" : "s"} (${words.days.map(attDateLabel).join(", ")}) → ${D} list${D === 1 ? "" : "s"}, from ${D} down to 1 day`;
      el("as_wordList").innerHTML = words.lists.map((l) => `
        <div class="list-row"><div><b>${am ? `ቢያንስ ${l.n} ቀን` : `At least ${l.n} day${l.n === 1 ? "" : "s"}`}</b></div><span class="badge badge-green">${l.people.length}</span></div>`).join("")
        + (words.punishedLeftOut ? `<p class="muted">${am ? `${words.punishedLeftOut} በቅጣት ላይ ያሉ አባላት አልተካተቱም` : `${words.punishedLeftOut} member(s) on punishment left out`}</p>` : "");
    }
    el("as_word").disabled = !st.holiday || !words.days.length;
  }

  el("as_from").onchange = async (e) => { st.from = e.target.value; await setSetting("attSheetsFrom", st.from); refresh(); };
  el("as_holiday").onchange = (e) => {
    st.holiday = e.target.value;
    if (st.holiday && (!st.holidayName || st.autoName)) { st.holidayName = ethName(st.holiday); st.autoName = true; el("as_hname").value = st.holidayName; }
    refresh();
  };
  el("as_hname").oninput = (e) => { st.holidayName = e.target.value; st.autoName = false; };
  el("view").querySelectorAll(".as_prog").forEach((cb) => {
    cb.onchange = () => { st.programs = [...el("view").querySelectorAll(".as_prog:checked")].map((x) => x.value); refresh(false); };
  });
  el("as_combined").onchange = (e) => { st.combined = e.target.checked; refresh(false); };
  el("as_eth").onchange = (e) => { st.eth = e.target.checked; };
  el("as_punish").onchange = (e) => { st.skipPunished = e.target.checked; refresh(false); };
  el("as_oneFile").onchange = (e) => { st.oneFile = e.target.checked; };
  el("as_download").onclick = (e) => withButtonLoading(e.currentTarget, am ? "በማዘጋጀት ላይ..." : "Preparing...", () =>
    downloadAttendanceSheetsXlsx(data, { ethHeaders: st.eth, from: st.from, to: periodEnd() }));
  el("as_word").onclick = async (e) => {
    const ok = await withButtonLoading(e.currentTarget, am ? "በማዘጋጀት ላይ..." : "Preparing...", () =>
      downloadMinDaysDocs({ result: words, holidayName: st.holidayName.trim(), oneFile: st.oneFile }));
    if (!ok) return;
    // the next period starts from this holiday
    if (await showConfirm(am
      ? `የሚቀጥለው ጊዜ ከዚህ በዓል ቀን (${st.holiday}) እንዲጀምር ይደረግ? እነዚህ ቀናት በሚቀጥለው ዝርዝር አይካተቱም።`
      : `Start the next period from this holiday (${st.holiday})? The days used here won't be counted again.`,
      { okLabel: am ? "አዎ" : "Yes", cancelLabel: am ? "አይ" : "No" })) {
      st.from = st.holiday; st.holiday = ""; st.holidayName = ""; st.autoName = false;
      await setSetting("attSheetsFrom", st.from);
      renderAttendanceSheets();
    }
  };
  refresh();
}
