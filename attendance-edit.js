/* ፍኖተ ጥበብ — Attendance records (መገኘት መዝገብ)
   Lets members/admins (NOT scanners) correct scans after the fact:
     - change the program (e.g. scanned as Course but it was Mezmur)
     - change the status (on-time / late), e.g. when the person scanning
       was late themselves and everyone got stamped "late"
   Works on one record (Edit) or many at once (tick rows -> bulk bar).

   Depends on globals: getAll, get, put, el, escapeHtml, showAlert, showConfirm,
   PROGRAM_DEFS, getProgramConfig, todayISO, ethLabel, fmtDT, getLang, t,
   moreBackBtn, resolveCallerName, withButtonLoading, syncNow, userRole.

   Sync note: an edited record keeps its id and is flagged `pendingEdit`, so
   auth.js pushes it as an UPDATE by id (a plain upsert on
   member+date+program would collide with the row's primary key when the
   program changed). */

window._attLog = window._attLog || { date: null, program: "", status: "", q: "" };

// Same rule as recordAttendance(): on-time until start + grace, measured
// against the ORIGINAL scan timestamp, but using the (new) program's start time.
async function computeStatusFor(programKey, timestampISO) {
  const cfg = await getProgramConfig(programKey);
  const at = new Date(timestampISO);
  const [h, m] = String(cfg.startTime).split(":").map(Number);
  const start = new Date(at);
  start.setHours(h || 0, m || 0, 0, 0);
  return at.getTime() <= start.getTime() + cfg.graceMinutes * 60000 ? "on-time" : "late";
}

// patch = { programKey?, status?, recompute? }
// -> { changed, unchanged, conflicts: [member names] }
async function applyAttendanceEdits(ids, patch) {
  const members = await getAll("members");
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const all = await getAll("attendance");
  const by = await resolveCallerName();
  const result = { changed: 0, unchanged: 0, conflicts: [] };

  for (const id of ids) {
    const rec = all.find((r) => r.id === id);
    if (!rec) continue;
    const newProgram = patch.programKey || rec.programKey;
    let newStatus = patch.status || rec.status;
    if (patch.programKey && patch.recompute && !patch.status) {
      newStatus = await computeStatusFor(newProgram, rec.timestamp);
    }
    if (newProgram === rec.programKey && newStatus === rec.status) { result.unchanged++; continue; }

    // unique rule: one record per member + date + program
    if (newProgram !== rec.programKey) {
      const clash = all.find((r) => r.id !== rec.id && r.memberId === rec.memberId
        && r.sessionDate === rec.sessionDate && r.programKey === newProgram);
      if (clash) { result.conflicts.push(nameOf.get(rec.memberId) || "?"); continue; }
    }

    if (!rec.edited) { rec.originalProgramKey = rec.programKey; rec.originalStatus = rec.status; }
    rec.programKey = newProgram;
    rec.status = newStatus;
    rec.edited = true;
    rec.editedBy = by;
    rec.editedAt = new Date().toISOString();
    rec.synced = false;
    rec.pendingEdit = true;
    await put("attendance", rec);
    result.changed++;
  }
  if (result.changed) syncNow();
  return result;
}

async function reportEditResult(r) {
  const am = getLang() === "am";
  let msg = am ? `${r.changed} መዝገቦች ተስተካክለዋል` : `${r.changed} record(s) updated`;
  if (r.unchanged) msg += am ? `\n${r.unchanged} ምንም አልተቀየሩም` : `\n${r.unchanged} already had those values`;
  if (r.conflicts.length) {
    msg += am
      ? `\n\n${r.conflicts.length} አልተቀየሩም — ተመሳሳይ ሰው በዚያ ፕሮግራም በዚያ ቀን ቀድሞ ተመዝግቧል:\n`
      : `\n\n${r.conflicts.length} skipped — that member already has a record for that program on that day:\n`;
    msg += r.conflicts.slice(0, 10).map(escapeHtml).join(", ");
  }
  await showAlert(msg);
}

async function renderAttendanceLog() {
  const am = getLang() === "am";
  const state = window._attLog;
  const [attendance, members] = await Promise.all([getAll("attendance"), getAll("members")]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  const progName = (k) => (progs.find((p) => p.key === k) || { name: k }).name;
  const dates = [...new Set(attendance.map((a) => a.sessionDate))].sort().reverse();
  if (state.date === null) state.date = dates[0] || "";
  const selected = new Set();
  let shown = [];

  el("view").innerHTML = `
    ${moreBackBtn()}
    <h3 class="section-title">${am ? "የመገኘት መዝገብ" : "Attendance Records"}</h3>
    <p class="muted">${am
      ? "ከስካን በኋላ ፕሮግራም ወይም «በሰዓቱ/ዘግይቷል» ሁኔታን ያስተካክሉ። አንድ ሰው ለማስተካከል «አርም» ይጫኑ፣ ብዙዎችን ለማስተካከል ምልክት አድርገው ከላይ ያለውን ይጠቀሙ።"
      : "Fix the program or the on-time/late status after scanning. Tap Edit for one person, or tick several rows and use the bulk bar."}</p>

    <select id="al_date" class="text-input">
      <option value="">${am ? "ሁሉም ቀናት" : "All dates"}</option>
      ${dates.map((d) => `<option value="${d}" ${d === state.date ? "selected" : ""}>${d} · ${ethLabel(d)}</option>`).join("")}
    </select>
    <div class="toolbar" style="margin-bottom:0;">
      <select id="al_prog" class="text-input">
        <option value="">${am ? "ሁሉም ፕሮግራሞች" : "All programs"}</option>
        ${progs.map((p) => `<option value="${p.key}" ${p.key === state.program ? "selected" : ""}>${p.name}</option>`).join("")}
      </select>
    </div>
    <div class="toolbar" style="margin-bottom:0;">
      <select id="al_status" class="text-input">
        <option value="">${am ? "ሁሉም ሁኔታዎች" : "All statuses"}</option>
        <option value="on-time" ${state.status === "on-time" ? "selected" : ""}>${t("scan.onTime")}</option>
        <option value="late" ${state.status === "late" ? "selected" : ""}>${t("scan.late")}</option>
      </select>
    </div>
    <input id="al_q" class="text-input" placeholder="${t("members.searchPlaceholder")}" value="${escapeHtml(state.q)}">
    <p class="muted" id="al_summary"></p>

    <div class="toolbar">
      <button id="al_selAll" class="btn-secondary">${t("members.selectAllShown")}</button>
      <button id="al_selNone" class="btn-secondary">${t("members.clearSelection")}</button>
    </div>
    <div class="list-row" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:12px;">
      <b>${am ? "የተመረጡትን አስተካክል" : "Bulk edit selected"} (<span id="al_selCount">0</span>)</b>
      <div class="toolbar" style="margin:0;">
        <select id="al_bulkProg" class="text-input" style="flex:1;margin:0;">
          ${progs.map((p) => `<option value="${p.key}">${p.name}</option>`).join("")}
        </select>
        <button id="al_applyProg" class="btn-primary">${am ? "ፕሮግራም ቀይር" : "Set program"}</button>
      </div>
      <label class="sel-check" style="gap:8px;"><input type="checkbox" id="al_recompute" checked/> <span class="muted">${am ? "«በሰዓቱ/ዘግይቷል»ን ከአዲሱ ፕሮግራም ሰዓት አንጻር እንደገና አስላ" : "Recalculate on-time/late using the new program's start time"}</span></label>
      <div class="toolbar" style="margin:0;">
        <select id="al_bulkStatus" class="text-input" style="flex:1;margin:0;">
          <option value="on-time">${t("scan.onTime")}</option>
          <option value="late">${t("scan.late")}</option>
        </select>
        <button id="al_applyStatus" class="btn-primary">${am ? "ሁኔታ ቀይር" : "Set status"}</button>
      </div>
    </div>

    <div id="al_list" class="list"></div>`;

  const updateSel = () => { el("al_selCount").textContent = selected.size; };

  function draw() {
    const q = state.q.trim().toLowerCase();
    shown = attendance
      .filter((a) => memberMap.has(a.memberId))
      .filter((a) => !state.date || a.sessionDate === state.date)
      .filter((a) => !state.program || a.programKey === state.program)
      .filter((a) => !state.status || a.status === state.status)
      .filter((a) => !q || memberMap.get(a.memberId).fullName.toLowerCase().includes(q))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const late = shown.filter((a) => a.status === "late").length;
    el("al_summary").textContent = am
      ? `${shown.length} መዝገቦች · ${shown.length - late} በሰዓቱ · ${late} ዘግይተዋል`
      : `${shown.length} records · ${shown.length - late} on time · ${late} late`;
    const LIMIT = 300;
    el("al_list").innerHTML = shown.length ? shown.slice(0, LIMIT).map((a) => {
      const m = memberMap.get(a.memberId);
      return `
        <div class="list-row">
          <label class="sel-check"><input type="checkbox" data-id="${a.id}" ${selected.has(a.id) ? "checked" : ""}/></label>
          <div style="flex:1;">
            <b>${escapeHtml(m.fullName)}</b><br>
            <span class="muted">${escapeHtml(progName(a.programKey))} · ${a.sessionDate} · ${new Date(a.timestamp).toLocaleTimeString()}${a.edited ? " · ✎" : ""}</span>
          </div>
          <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
            <span class="badge ${a.status === "late" ? "badge-amber" : "badge-green"}">${a.status === "late" ? t("scan.late") : t("scan.onTime")}</span>
            <button class="btn-small" onclick="openAttendanceEditModal('${a.id}')">${t("members.edit")}</button>
          </div>
        </div>`;
    }).join("") + (shown.length > LIMIT ? `<p class="muted">${am ? `የመጀመሪያዎቹ ${LIMIT} ብቻ ታይተዋል — በቀን ወይም በስም ያጣሩ` : `Showing the first ${LIMIT} — filter by date or name to narrow down`}</p>` : "")
      : `<p class="muted">${am ? "ምንም መዝገብ የለም" : "No records match"}</p>`;
    el("al_list").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => { if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id); updateSel(); };
    });
    updateSel();
  }

  el("al_date").onchange = (e) => { state.date = e.target.value; draw(); };
  el("al_prog").onchange = (e) => { state.program = e.target.value; draw(); };
  el("al_status").onchange = (e) => { state.status = e.target.value; draw(); };
  el("al_q").oninput = (e) => { state.q = e.target.value; draw(); };
  el("al_selAll").onclick = () => { shown.slice(0, 300).forEach((a) => selected.add(a.id)); draw(); };
  el("al_selNone").onclick = () => { selected.clear(); draw(); };

  const needSel = async () => {
    if (selected.size) return true;
    await showAlert(am ? "ቢያንስ አንድ መዝገብ ይምረጡ" : "Tick at least one record first.");
    return false;
  };
  el("al_applyProg").onclick = async (e) => {
    if (!(await needSel())) return;
    const programKey = el("al_bulkProg").value;
    const recompute = el("al_recompute").checked;
    if (!(await showConfirm(am ? `${selected.size} መዝገቦች ወደ «${progName(programKey)}» ይቀየሩ?` : `Move ${selected.size} record(s) to "${progName(programKey)}"?`))) return;
    const r = await withButtonLoading(e.currentTarget, "...", () => applyAttendanceEdits([...selected], { programKey, recompute }));
    await reportEditResult(r);
    renderAttendanceLog();
  };
  el("al_applyStatus").onclick = async (e) => {
    if (!(await needSel())) return;
    const status = el("al_bulkStatus").value;
    const label = status === "late" ? t("scan.late") : t("scan.onTime");
    if (!(await showConfirm(am ? `${selected.size} መዝገቦች ወደ «${label}» ይቀየሩ?` : `Set ${selected.size} record(s) to "${label}"?`))) return;
    const r = await withButtonLoading(e.currentTarget, "...", () => applyAttendanceEdits([...selected], { status }));
    await reportEditResult(r);
    renderAttendanceLog();
  };

  draw();
}

window.openAttendanceEditModal = async function (id) {
  const rec = await get("attendance", id);
  if (!rec) return;
  const am = getLang() === "am";
  const member = await get("members", rec.memberId);
  const progs = PROGRAM_DEFS();

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:420px;text-align:left;">
      <h3 style="text-align:center;">${escapeHtml(member ? member.fullName : "?")}</h3>
      <p class="muted" style="text-align:center;">${rec.sessionDate} · ${ethLabel(rec.sessionDate)} · ${am ? "የተቃኘበት" : "scanned"} ${new Date(rec.timestamp).toLocaleTimeString()}</p>
      <label class="muted">${am ? "ፕሮግራም" : "Program"}</label>
      <select id="ae_prog" class="text-input">
        ${progs.map((p) => `<option value="${p.key}" ${p.key === rec.programKey ? "selected" : ""}>${p.name}</option>`).join("")}
      </select>
      <label class="muted">${am ? "ሁኔታ" : "Status"}</label>
      <select id="ae_status" class="text-input">
        <option value="on-time" ${rec.status === "on-time" ? "selected" : ""}>${t("scan.onTime")}</option>
        <option value="late" ${rec.status === "late" ? "selected" : ""}>${t("scan.late")}</option>
      </select>
      <p class="muted" id="ae_hint"></p>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button class="btn-secondary" style="flex:1;" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
        <button id="ae_save" class="btn-primary" style="flex:1;">${t("settings.save")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  // Changing the program recalculates the status from the original scan time
  // against that program's start time; the status box can still be overridden.
  el("ae_prog").onchange = async () => {
    const s = await computeStatusFor(el("ae_prog").value, rec.timestamp);
    el("ae_status").value = s;
    el("ae_hint").textContent = am
      ? `ከአዲሱ ፕሮግራም ሰዓት አንጻር ተሰልቷል: ${s === "late" ? t("scan.late") : t("scan.onTime")} (መቀየር ይችላሉ)`
      : `Recalculated for the new program: ${s === "late" ? t("scan.late") : t("scan.onTime")} (you can override)`;
  };

  el("ae_save").onclick = async () => {
    const programKey = el("ae_prog").value;
    const status = el("ae_status").value;
    const r = await applyAttendanceEdits([id], { programKey, status });
    box.remove();
    if (r.conflicts.length || !r.changed) await reportEditResult(r);
    if (typeof currentTab !== "undefined" && currentTab === "attendance") renderAttendanceLog();
  };
};
