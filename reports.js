/* ፍኖተ ጥበብ — Reports: HR period report (Word + PowerPoint), charts,
   Reports screen, and the canvas chart fallback.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderReports.
   Stays in app.js on purpose: computeGradeStats, buildGradeNarrative,
   exportAttendanceExcel and JSON export/import (Settings uses them too).
   Depends on globals: getAll, isoDate, addMonths, todayISO, computeConsecutiveAbsences,
   computeGradeStats, buildGradeNarrative, exportAttendanceExcel, downloadBlob,
   showAlert, withButtonLoading, escapeHtml, ethLabel, gregorianToEthiopian,
   ETH_MONTH_NAMES_AM, PROGRAM_DEFS, isAdminUser, moreBackBtn, t, getLang, el,
   and the CDN libs docx, PptxGenJS, Chart. */

// ---------- HR report (period-scoped Word/.doc + PowerPoint export) ----------
async function computeHrReportData(months) {
  const end = new Date();
  const start = addMonths(end, -months);
  const startISO = isoDate(start), endISO = isoDate(end);

  const members = await getAll("members");
  const attendanceAll = await getAll("attendance");
  const attendance = attendanceAll.filter((a) => a.sessionDate >= startISO && a.sessionDate <= endISO);
  const sessionDates = [...new Set(attendance.map((a) => a.sessionDate))];
  const newMembersCount = members.filter((m) => m.joinDate && m.joinDate >= startISO && m.joinDate <= endISO).length;
  const onTime = attendance.filter((a) => a.status === "on-time").length;
  const late = attendance.filter((a) => a.status === "late").length;

  // No dedicated confession-history log is kept — approximated as members
  // whose current lastConfessionDate falls inside the period.
  const confessionsInPeriod = members.filter((m) => m.lastConfessionDate && m.lastConfessionDate >= startISO && m.lastConfessionDate <= endISO).length;

  const currentStreaks = await computeConsecutiveAbsences();
  const gradeStats = await computeGradeStats(startISO, endISO);
  const gradeNarrative = buildGradeNarrative(gradeStats.rows, getLang());

  const callRows = [];
  members.forEach((m) => {
    (m.callHistory || []).forEach((c) => {
      if (c.date >= startISO && c.date <= endISO) callRows.push({ name: m.fullName, date: c.date, reason: c.reason || "-", calledBy: c.calledBy || "" });
    });
  });
  callRows.sort((a, b) => b.date.localeCompare(a.date));

  const planItemsAll = await getAll("planItems");
  const planRows = planItemsAll.map((p) => {
    const doneInPeriod = (p.doneLog || []).filter((d) => d.date >= startISO && d.date <= endISO).length;
    let doneStr, status;
    if (!p.recurrenceDays) {
      doneStr = String(doneInPeriod);
      status = "manual";
    } else if (p.recurrenceDays <= 31) {
      doneStr = `${doneInPeriod}/${months}`;
      status = doneInPeriod >= months ? "onTrack" : "needsAttention";
    } else {
      doneStr = `${Math.min(doneInPeriod, 1)}/1`;
      status = doneInPeriod >= 1 ? "onTrack" : "needsAttention";
    }
    return { ...p, doneStr, status };
  });

  return {
    startISO, endISO, months,
    totalMembers: members.length, newMembersCount,
    sessionsHeld: sessionDates.length, totalScans: attendance.length, onTime, late,
    confessionsInPeriod, currentStreakCount: currentStreaks.length,
    gradeStats, gradeNarrative, callRows, planRows,
  };
}

function planStatusLabel(status, lang) {
  if (status === "manual") return lang === "am" ? "በእጅ የሚከታተል" : "Manual tracking";
  if (status === "onTrack") return lang === "am" ? "በጥሩ ሁኔታ" : "On track";
  return lang === "am" ? "ትኩረት ይፈልጋል" : "Needs attention";
}

// Explicit page-content width in DXA (twentieths of a point) — ~6.5in,
// safe for both Letter and A4 with standard margins. Percentages alone
// (no explicit <w:tblGrid> column widths) render fine in Word/LibreOffice
// but collapse to near-zero width in some lightweight/mobile docx
// viewers, which apparently need real DXA numbers to size columns.
const DOCX_TABLE_DXA = 9350;

function buildDocxTable(headers, rows, widthPercents, cellFillFn) {
  const colWidths = widthPercents
    ? widthPercents.map((p) => Math.round((p / 100) * DOCX_TABLE_DXA))
    : null;
  const cellWidthOpt = (i) => (colWidths ? { size: colWidths[i], type: docx.WidthType.DXA } : undefined);

  const headerRow = new docx.TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new docx.TableCell({
      width: cellWidthOpt(i),
      shading: { fill: "F2A33C", type: docx.ShadingType.CLEAR, color: "auto" },
      children: [new docx.Paragraph({ children: [new docx.TextRun({ text: String(h), bold: true, color: "1A1410" })] })],
    })),
  });
  const bodyRows = rows.map((row, rIdx) => new docx.TableRow({
    children: row.map((cell, cIdx) => {
      const fill = cellFillFn ? cellFillFn(rIdx, cIdx) : undefined;
      return new docx.TableCell({
        width: cellWidthOpt(cIdx),
        shading: fill ? { fill, type: docx.ShadingType.CLEAR, color: "auto" } : undefined,
        children: [new docx.Paragraph({ text: String(cell ?? "") })],
      });
    }),
  }));
  return new docx.Table({
    width: { size: DOCX_TABLE_DXA, type: docx.WidthType.DXA },
    columnWidths: colWidths || undefined,
    layout: docx.TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
  });
}

// Requires the docx library (docx@8 UMD) to be loaded globally — see index.html.
async function generateHrReportDoc(data) {
  if (typeof docx === "undefined") {
    await showAlert(getLang() === "am" ? "docx ቤተ-መጻሕፍት አልተጫነም — index.html ውስጥ ያረጋግጡ" : "docx library not loaded — check index.html.");
    return;
  }
  const lang = getLang();
  const statusFill = { onTrack: "D9F2E3", needsAttention: "FDEBD3", manual: "E8E8E8" };
  const heading = (text) => new docx.Paragraph({ text, heading: docx.HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } });

  const overviewTable = buildDocxTable(
    [lang === "am" ? "መለኪያ" : "Metric", lang === "am" ? "ውጤት" : "Value"],
    [
      [lang === "am" ? "ጠቅላላ አባላት" : "Total members", data.totalMembers],
      [lang === "am" ? "አዲስ አባላት" : "New members", data.newMembersCount],
      [lang === "am" ? "የተካሄዱ ስብሰባዎች" : "Sessions held", data.sessionsHeld],
      [lang === "am" ? "ጠቅላላ ቅኝቶች" : "Total attendance scans", `${data.totalScans} (${lang === "am" ? "በሰዓቱ" : "on-time"} ${data.onTime} / ${lang === "am" ? "ዘግይቶ" : "late"} ${data.late})`],
      [lang === "am" ? "የተመዘገበ ንስሃ" : "Confessions recorded", data.confessionsInPeriod],
      [lang === "am" ? "በአሁኑ ጊዜ ተከታታይ ቀሪ" : "Currently on absence streak", data.currentStreakCount],
    ],
    [50, 50]
  );

  const gradeBody = data.gradeStats.rows.length
    ? data.gradeStats.rows.map((r) => [`${lang === "am" ? "ክፍል " : "Grade "}${r.grade}`, r.memberCount, r.scans, `${Math.round(r.rate * 100)}%`])
    : [[lang === "am" ? "በቂ መረጃ የለም" : "Not enough data yet", "", "", ""]];
  const gradeTable = buildDocxTable(
    [lang === "am" ? "ክፍል" : "Grade", lang === "am" ? "ተማሪዎች" : "Students", lang === "am" ? "ቅኝቶች" : "Scans", lang === "am" ? "መጠን" : "Rate"],
    gradeBody, [25, 25, 25, 25]
  );

  const callBody = data.callRows.length
    ? data.callRows.map((c) => [c.name, c.date, c.reason, c.calledBy])
    : [[lang === "am" ? "የለም" : "None", "", "", ""]];
  const callTable = buildDocxTable(
    [lang === "am" ? "ስም" : "Name", lang === "am" ? "ቀን" : "Date", lang === "am" ? "ምክንያት" : "Reason", lang === "am" ? "የደወለው" : "Called by"],
    callBody, [25, 20, 30, 25]
  );

  const planBody = data.planRows.map((p) => [p.no, p.subUnit, p.title, p.metricTarget || p.timing || "-", p.doneStr, planStatusLabel(p.status, lang)]);
  const planTable = buildDocxTable(
    ["#", lang === "am" ? "ንዑስ ክፍል" : "Sub-unit", lang === "am" ? "የዕቅድ ንጥል" : "Plan item", lang === "am" ? "ዒላማ" : "Target", lang === "am" ? "የተከናወነ" : "Done", lang === "am" ? "ሁኔታ" : "Status"],
    planBody, [6, 18, 34, 18, 10, 14],
    (rIdx, cIdx) => (cIdx === 5 ? statusFill[data.planRows[rIdx].status] : undefined)
  );

  const doc = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ text: lang === "am" ? "ፍኖተ ጥበብ — ዲጂታል መገኘት" : "Finote Tibeb — Digital Attendance", heading: docx.HeadingLevel.HEADING_1 }),
        new docx.Paragraph({ text: `${data.startISO} → ${data.endISO}  ·  ${ethLabel(data.startISO)} → ${ethLabel(data.endISO)}`, spacing: { after: 200 } }),
        heading(lang === "am" ? "አጠቃላይ አፈጻጸም" : "Overall performance"),
        overviewTable,
        heading(lang === "am" ? "በደረጃ ትንተና (1-12)" : "Grade-level analysis (1-12)"),
        gradeTable,
        ...(data.gradeNarrative.length ? [new docx.Paragraph({ text: data.gradeNarrative.join(" · "), spacing: { before: 120 } })] : []),
        heading(lang === "am" ? "የቀሪ አባላት ጥሪ ምክንያቶች" : "Absentee call reasons"),
        callTable,
        heading(lang === "am" ? "በዕቅድ ላይ የተደረገ አፈጻጸም" : "Performance against the plan"),
        planTable,
      ],
    }],
  });

  const blob = await docx.Packer.toBlob(doc);
  downloadBlob(blob, `HR-report-${data.months}mo-${todayISO()}.docx`);
}

// Requires pptxgenjs to be loaded globally (see index.html) — a well
// supported, purely client-side .pptx generator with native chart/shape
// support, used here instead of static images so charts stay editable.
async function generateHrReportPptx(data) {
  if (typeof PptxGenJS === "undefined") {
    await showAlert(getLang() === "am" ? "PptxGenJS አልተጫነም" : "PptxGenJS library not loaded — add the CDN script tag to index.html.");
    return;
  }
  const lang = getLang();
  const BG = "14110F", CARD = "221D19", BORDER = "332C26";
  const AMBER = "F2A33C", AMBER_DIM = "8A5C22", INK = "1A1410";
  const TEXT = "F2EDE6", MUTED = "9C9187", GREEN = "4CAF7D", RED = "E0605A", BLUE = "5DADE2", GRAY = "6B6B6B";

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "FTW", width: 10, height: 5.63 });
  pptx.layout = "FTW";
  const headerOpts = { bold: true, color: INK, fill: { color: AMBER } };
  const bodyOpts = { color: TEXT, fill: { color: CARD } };
  const tblBorder = { type: "solid", color: BORDER, pt: 0.5 };

  // ---- Title slide ----
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: BG };
  titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.35, w: 10, h: 0.035, fill: { color: AMBER } });
  titleSlide.addText(lang === "am" ? "ፍኖተ ጥበብ" : "Finote Tibeb", { x: 0.5, y: 1.35, w: 9, h: 0.9, fontSize: 38, bold: true, color: AMBER, align: "center" });
  titleSlide.addText(lang === "am" ? "ዲጂታል መገኘት — የ HR ሪፖርት" : "Digital Attendance — HR Report", { x: 0.5, y: 2.5, w: 9, h: 0.55, fontSize: 18, color: TEXT, align: "center" });
  titleSlide.addText(`${data.startISO} → ${data.endISO}`, { x: 0.5, y: 3.15, w: 9, h: 0.45, fontSize: 13, color: MUTED, align: "center" });
  titleSlide.addText(`${ethLabel(data.startISO)} → ${ethLabel(data.endISO)}`, { x: 0.5, y: 3.55, w: 9, h: 0.4, fontSize: 11, color: AMBER_DIM, align: "center" });

  // ---- KPI overview slide (colored cards, not a plain table) ----
  const overviewSlide = pptx.addSlide();
  overviewSlide.background = { color: BG };
  overviewSlide.addText(lang === "am" ? "አጠቃላይ አፈጻጸም" : "Overall Performance", { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 24, bold: true, color: AMBER });
  const kpis = [
    { label: lang === "am" ? "ጠቅላላ አባላት" : "Total Members", value: data.totalMembers, color: AMBER },
    { label: lang === "am" ? "አዲስ አባላት" : "New Members", value: data.newMembersCount, color: GREEN },
    { label: lang === "am" ? "የተካሄዱ ስብሰባዎች" : "Sessions Held", value: data.sessionsHeld, color: BLUE },
    { label: lang === "am" ? "ጠቅላላ ቅኝቶች" : "Total Scans", value: data.totalScans, color: AMBER },
    { label: lang === "am" ? "የተመዘገበ ንስሃ" : "Confessions Recorded", value: data.confessionsInPeriod, color: GREEN },
    { label: lang === "am" ? "ተከታታይ ቀሪ" : "On Absence Streak", value: data.currentStreakCount, color: RED },
  ];
  const cardW = 2.9, cardH = 1.7, gapX = 0.25, gapY = 0.25, startX = 0.4, startY = 1.0;
  kpis.forEach((k, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX), y = startY + row * (cardH + gapY);
    overviewSlide.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: CARD }, line: { color: k.color, width: 1.5 } });
    overviewSlide.addText(String(k.value), { x, y: y + 0.22, w: cardW, h: 0.8, fontSize: 34, bold: true, color: k.color, align: "center" });
    overviewSlide.addText(k.label, { x: x + 0.1, y: y + 1.05, w: cardW - 0.2, h: 0.5, fontSize: 11, color: TEXT, align: "center" });
  });
  overviewSlide.addText(`${lang === "am" ? "በሰዓቱ" : "On-time"} ${data.onTime} / ${lang === "am" ? "ዘግይቶ" : "Late"} ${data.late}`, { x: 0.4, y: startY + 2 * (cardH + gapY) + 0.05, w: 9.2, h: 0.4, fontSize: 12, color: MUTED, align: "center" });

  // ---- Attendance breakdown: doughnut chart ----
  const attSlide = pptx.addSlide();
  attSlide.background = { color: BG };
  attSlide.addText(lang === "am" ? "የተሳትፎ ትንተና" : "Attendance Breakdown", { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 24, bold: true, color: AMBER });
  if (data.totalScans > 0) {
    attSlide.addChart(pptx.ChartType.doughnut, [{
      name: lang === "am" ? "ሁኔታ" : "Status",
      labels: [lang === "am" ? "በሰዓቱ" : "On-time", lang === "am" ? "ዘግይቶ" : "Late"],
      values: [data.onTime, data.late],
    }], {
      x: 2.2, y: 0.95, w: 5.6, h: 4.3,
      chartColors: [GREEN, RED],
      showLegend: true, legendPos: "b", legendColor: TEXT,
      showValue: true, showPercent: true, dataLabelColor: INK, dataLabelFontSize: 12,
      chartArea: { fill: { color: BG } }, plotArea: { fill: { color: BG } },
    });
  } else {
    attSlide.addText(lang === "am" ? "በቂ መረጃ የለም" : "Not enough data yet", { x: 0.4, y: 2.5, w: 9.2, h: 0.5, fontSize: 16, color: MUTED, align: "center" });
  }

  // ---- Grade-level analysis: bar chart ----
  const gradeSlide = pptx.addSlide();
  gradeSlide.background = { color: BG };
  gradeSlide.addText(lang === "am" ? "በደረጃ ትንተና" : "Grade-Level Analysis", { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 24, bold: true, color: AMBER });
  if (data.gradeStats.rows.length) {
    const rowsAsc = [...data.gradeStats.rows].sort((a, b) => a.grade - b.grade);
    gradeSlide.addChart(pptx.ChartType.bar, [{
      name: lang === "am" ? "መጠን" : "Attendance Rate",
      labels: rowsAsc.map((r) => `${lang === "am" ? "ክፍል " : "Gr "}${r.grade}`),
      values: rowsAsc.map((r) => Math.round(r.rate * 100)),
    }], {
      x: 0.4, y: 0.9, w: 9.2, h: 3.9,
      chartColors: [AMBER],
      showValue: true, dataLabelColor: TEXT, dataLabelFontSize: 10,
      catAxisLabelColor: TEXT, valAxisLabelColor: TEXT, valAxisTitle: "%",
      showLegend: false,
      chartArea: { fill: { color: BG } }, plotArea: { fill: { color: BG } },
    });
    if (data.gradeNarrative.length) {
      gradeSlide.addText(data.gradeNarrative.join("  ·  "), { x: 0.4, y: 4.95, w: 9.2, h: 0.5, fontSize: 10, italic: true, color: MUTED });
    }
  } else {
    gradeSlide.addText(lang === "am" ? "በቂ መረጃ የለም" : "Not enough data yet", { x: 0.4, y: 2.5, w: 9.2, h: 0.5, fontSize: 16, color: MUTED, align: "center" });
  }

  // ---- Absentee call reasons ----
  const callSlide = pptx.addSlide();
  callSlide.background = { color: BG };
  callSlide.addText(lang === "am" ? "የቀሪ አባላት ጥሪ ምክንያቶች" : "Absentee Call Reasons", { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 24, bold: true, color: AMBER });
  const callTableRows = [[
    { text: lang === "am" ? "ስም" : "Name", options: headerOpts }, { text: lang === "am" ? "ቀን" : "Date", options: headerOpts },
    { text: lang === "am" ? "ምክንያት" : "Reason", options: headerOpts }, { text: lang === "am" ? "የደወለው" : "Called by", options: headerOpts },
  ]];
  data.callRows.slice(0, 12).forEach((c) => callTableRows.push([
    { text: c.name, options: bodyOpts }, { text: c.date, options: bodyOpts }, { text: c.reason, options: bodyOpts }, { text: c.calledBy, options: bodyOpts },
  ]));
  if (!data.callRows.length) callTableRows.push([{ text: lang === "am" ? "የለም" : "None", options: { ...bodyOpts, colspan: 4 } }]);
  callSlide.addTable(callTableRows, { x: 0.4, y: 0.9, w: 9.2, fontSize: 11, border: tblBorder, autoPage: false });
  if (data.callRows.length > 12) {
    callSlide.addText(lang === "am" ? `+ ${data.callRows.length - 12} ተጨማሪ...` : `+ ${data.callRows.length - 12} more...`, { x: 0.4, y: 5.15, fontSize: 10, italic: true, color: MUTED });
  }

  // ---- Plan performance, color-coded by status ----
  const statusColors = { onTrack: GREEN, needsAttention: RED, manual: GRAY };
  const planChunks = [];
  for (let i = 0; i < data.planRows.length; i += 9) planChunks.push(data.planRows.slice(i, i + 9));
  planChunks.forEach((chunk, idx) => {
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    slide.addText(
      (lang === "am" ? "በዕቅድ ላይ የተደረገ አፈጻጸም" : "Performance Against the Plan") + (planChunks.length > 1 ? ` (${idx + 1}/${planChunks.length})` : ""),
      { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 20, bold: true, color: AMBER }
    );
    const rows = [[
      { text: "#", options: headerOpts }, { text: lang === "am" ? "ንዑስ ክፍል" : "Sub-unit", options: headerOpts },
      { text: lang === "am" ? "የዕቅድ ንጥል" : "Plan item", options: headerOpts }, { text: lang === "am" ? "የተከናወነ" : "Done", options: headerOpts },
      { text: lang === "am" ? "ሁኔታ" : "Status", options: headerOpts },
    ]];
    chunk.forEach((p) => {
      const statusColor = statusColors[p.status] || GRAY;
      rows.push([
        { text: String(p.no), options: bodyOpts }, { text: p.subUnit, options: bodyOpts }, { text: p.title, options: bodyOpts }, { text: p.doneStr, options: bodyOpts },
        { text: planStatusLabel(p.status, lang), options: { bold: true, color: INK, fill: { color: statusColor } } },
      ]);
    });
    slide.addTable(rows, { x: 0.3, y: 0.85, w: 9.4, colW: [0.4, 1.8, 4.2, 1.0, 2.0], fontSize: 9, border: tblBorder, autoPage: false });
  });

  await pptx.writeFile({ fileName: `HR-report-${data.months}mo-${todayISO()}.pptx` });
}

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
  const lang = getLang();
  const isAdmin = isAdminUser();
  const earliestDate = attendance.length ? attendance.reduce((min, a) => (a.sessionDate < min ? a.sessionDate : min), attendance[0].sessionDate) : todayISO();
  const gradeStats = await computeGradeStats(earliestDate, todayISO());
  const gradeNarrative = buildGradeNarrative(gradeStats.rows, getLang());

  el("view").innerHTML = `
    ${moreBackBtn()}
    <div class="toolbar"><button id="repExcel" class="btn-secondary">${t("reports.downloadExcel")}</button></div>

    ${isAdmin ? `
    <h3 class="section-title">${lang === "am" ? "የ HR ሪፖርት አመንጭ" : "Generate HR Report"}</h3>
    <div class="toolbar">
      <select id="hrReportPeriod" class="text-input" style="width:auto;flex:1;">
        <option value="3">${lang === "am" ? "3 ወር" : "3 Months"}</option>
        <option value="6">${lang === "am" ? "6 ወር" : "6 Months"}</option>
        <option value="12">${lang === "am" ? "ዓመታዊ" : "Yearly"}</option>
      </select>
    </div>
    <div class="toolbar">
      <button id="hrReportWordBtn" class="btn-secondary">Word</button>
      <button id="hrReportPptxBtn" class="btn-secondary">PowerPoint</button>
      <button id="hrReportBothBtn" class="btn-primary">${lang === "am" ? "ሁለቱንም" : "Both"}</button>
    </div>` : ""}

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

  if (isAdmin) {
    const runHrReport = async (which, btn) => {
      const loadingLabel = lang === "am" ? "በማመንጨት ላይ..." : "Generating...";
      await withButtonLoading(btn, loadingLabel, async () => {
        const months = Number(el("hrReportPeriod").value);
        const data = await computeHrReportData(months);
        if (which === "word" || which === "both") await generateHrReportDoc(data);
        if (which === "pptx" || which === "both") await generateHrReportPptx(data);
      });
    };
    el("hrReportWordBtn").onclick = (e) => runHrReport("word", e.currentTarget);
    el("hrReportPptxBtn").onclick = (e) => runHrReport("pptx", e.currentTarget);
    el("hrReportBothBtn").onclick = (e) => runHrReport("both", e.currentTarget);
  }
}

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
