/* ፍኖተ ጥበብ — Permissions (ፈቃድ), Punishments (ቅጣት), Advice (ምክር) screens
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   The shared helpers loadExcuseIndex / isExcused / loadActivePunishedIds
   stay in app.js (the attendance logic uses them too).
   Depends on globals: getAll, get, put, del, uid, addTombstone, syncNow,
   showAlert, showConfirm, escapeHtml, ethLabel, PROGRAM_DEFS, todayISO,
   isoDate, addDays, addMonths, resolveCallerName, groupsBackBtn, t, getLang, el. */

// ---------- Permissions screen (ፈቃድ) ----------
window._excuseFilter = window._excuseFilter || "current";

async function renderExcuses() {
  const lang = getLang();
  const [excuses, members] = await Promise.all([getAll("excuses"), getAll("members")]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  const today = todayISO();
  const statusOf = (ex) => (ex.endDate < today ? "expired" : (ex.startDate > today ? "upcoming" : "active"));
  const statusLabel = {
    active: lang === "am" ? "በሥራ ላይ" : "Active",
    upcoming: lang === "am" ? "ይመጣል" : "Upcoming",
    expired: lang === "am" ? "አልቋል" : "Expired",
  };
  const statusBadge = { active: "badge badge-green", upcoming: "badge badge-amber", expired: "badge" };
  const statusOrder = { active: 0, upcoming: 1, expired: 2 };

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "ፈቃድ" : "Permissions"}</h3>
    <p class="muted">${lang === "am"
      ? "ከፕሮግራም በፊት ፈቃድ የጠየቁ ወይም ለረጅም ጊዜ (ለምሳሌ ለአንድ ዓመት) የተፈቀደላቸው አባላት። በፈቃዱ ጊዜ ውስጥ ያሉ ክፍለ ጊዜዎች በአገልግሎት አቴንዳንስ ሪፖርት እንደተገኙ ይቆጠራሉ፣ ለጥሪ ዝርዝርም አይወጡም።"
      : "Members who asked permission before a program, or were granted a long leave (e.g. a year). Sessions inside the permission window count as attended in the Service Attendance report, and these members won't show on the absentee call list."}</p>
    <p class="muted" id="excuseSummary"></p>
    <div class="toolbar">
      <button id="addExcuseBtn" class="btn-primary">${lang === "am" ? "+ ፈቃድ ጨምር" : "+ Add Permission"}</button>
    </div>
    <input id="excuseSearch" class="text-input" placeholder="${lang === "am" ? "በስም ፈልግ" : "Search by name"}">
    <select id="excuseFilter" class="text-input">
      <option value="current" ${window._excuseFilter === "current" ? "selected" : ""}>${lang === "am" ? "በሥራ ላይ እና የሚመጡ" : "Active & upcoming"}</option>
      <option value="expired" ${window._excuseFilter === "expired" ? "selected" : ""}>${lang === "am" ? "ያለቁ" : "Expired"}</option>
      <option value="all" ${window._excuseFilter === "all" ? "selected" : ""}>${lang === "am" ? "ሁሉም" : "All"}</option>
    </select>
    <div id="excuseList" class="list"></div>`;

  function draw() {
    const q = el("excuseSearch").value.trim().toLowerCase();
    const f = window._excuseFilter;
    const rows = excuses
      .filter((ex) => memberMap.has(ex.memberId))
      .filter((ex) => {
        const st = statusOf(ex);
        if (f === "current" && st === "expired") return false;
        if (f === "expired" && st !== "expired") return false;
        return !q || memberMap.get(ex.memberId).fullName.toLowerCase().includes(q);
      })
      .sort((a, b) => (statusOrder[statusOf(a)] - statusOrder[statusOf(b)]) || a.endDate.localeCompare(b.endDate));
    el("excuseList").innerHTML = rows.length ? rows.map((ex) => {
      const m = memberMap.get(ex.memberId);
      const st = statusOf(ex);
      const keys = ex.programKeys || [];
      const progText = keys.length
        ? keys.map((k) => (progs.find((pd) => pd.key === k) || { name: k }).name).join(", ")
        : (lang === "am" ? "ሁሉም ፕሮግራሞች" : "All programs");
      return `
        <div class="list-row" style="align-items:flex-start;">
          <div style="flex:1;">
            <b>${escapeHtml(m.fullName)}</b><br>
            <span class="muted">${ex.startDate} → ${ex.endDate} · ${ethLabel(ex.startDate)} → ${ethLabel(ex.endDate)}</span><br>
            <span class="muted">${escapeHtml(progText)}${ex.reason ? " · " + escapeHtml(ex.reason) : ""}</span>
          </div>
          <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
            <span class="${statusBadge[st]}">${statusLabel[st]}</span>
            <div class="row-actions">
              <button class="btn-small" onclick="openExcuseModal('${ex.id}')">${t("members.edit")}</button>
              <button class="btn-small" onclick="deleteExcuse('${ex.id}')">${t("members.delete")}</button>
            </div>
          </div>
        </div>`;
    }).join("") : `<p class="muted">${lang === "am" ? "ምንም ፈቃድ የለም" : "No permissions to show"}</p>`;
  }

  const exCount = (st) => new Set(excuses.filter((x) => memberMap.has(x.memberId) && statusOf(x) === st).map((x) => x.memberId)).size;
  el("excuseSummary").textContent = lang === "am"
    ? `በሥራ ላይ: ${exCount("active")} · የሚመጡ: ${exCount("upcoming")} · ያለቁ: ${exCount("expired")} (አባላት)`
    : `Active: ${exCount("active")} · Upcoming: ${exCount("upcoming")} · Finished: ${exCount("expired")} (members)`;
  el("addExcuseBtn").onclick = () => openExcuseModal();
  el("excuseSearch").oninput = draw;
  el("excuseFilter").onchange = (e) => { window._excuseFilter = e.target.value; draw(); };
  draw();
}

window.deleteExcuse = async (id) => {
  const lang = getLang();
  if (!(await showConfirm(lang === "am" ? "ይህን ፈቃድ መሰረዝ ይፈልጋሉ?" : "Delete this permission?"))) return;
  await del("excuses", id);
  await addTombstone("excuses", id);
  renderExcuses();
  syncNow();
};

window.openExcuseModal = async function (editId) {
  const ex = editId ? await get("excuses", editId) : null;
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const progs = PROGRAM_DEFS();
  const today = todayISO();
  let memberId = ex ? ex.memberId : null;
  const selectedKeys = new Set(ex ? (ex.programKeys || []) : []);

  const presets = [
    { label: lang === "am" ? "አንድ ቀን" : "1 day", fn: (s) => s },
    { label: lang === "am" ? "1 ሳምንት" : "1 week", fn: (s) => addDays(s, 6) },
    { label: lang === "am" ? "1 ወር" : "1 month", fn: (s) => addDays(addMonths(s, 1), -1) },
    { label: lang === "am" ? "3 ወር" : "3 months", fn: (s) => addDays(addMonths(s, 3), -1) },
    { label: lang === "am" ? "6 ወር" : "6 months", fn: (s) => addDays(addMonths(s, 6), -1) },
    { label: lang === "am" ? "1 ዓመት" : "1 year", fn: (s) => addDays(addMonths(s, 12), -1) },
  ];

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:500px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${ex ? (lang === "am" ? "ፈቃድ አርትዕ" : "Edit Permission") : (lang === "am" ? "ፈቃድ ጨምር" : "Add Permission")}</h3>

      <label>${lang === "am" ? "አባል" : "Member"} *</label>
      <div id="ex_memberChip"></div>
      <input id="ex_memberSearch" class="text-input" placeholder="${lang === "am" ? "ስም ፈልግ" : "Search name"}">
      <div id="ex_memberResults" class="list"></div>

      <label>${lang === "am" ? "መጀመሪያ ቀን" : "From"} *</label>
      <input id="ex_start" type="date" class="text-input" value="${ex ? ex.startDate : today}">
      <label>${lang === "am" ? "የመጨረሻ ቀን" : "To"} *</label>
      <input id="ex_end" type="date" class="text-input" value="${ex ? ex.endDate : today}">
      <div class="toolbar" id="ex_presets">
        ${presets.map((pr, i) => `<button type="button" class="btn-small" data-preset="${i}">${pr.label}</button>`).join("")}
      </div>
      <p class="muted" id="ex_ethHint" style="margin-top:-6px;"></p>

      <label>${lang === "am" ? "ፕሮግራሞች" : "Programs"}</label>
      <label class="sel-check" style="gap:8px;margin-bottom:6px;"><input type="checkbox" id="ex_all" ${selectedKeys.size === 0 ? "checked" : ""}/> ${lang === "am" ? "ሁሉም ፕሮግራሞች" : "All programs"}</label>
      <div id="ex_progs">
        ${progs.map((pd) => `<label class="sel-check" style="gap:8px;margin-bottom:6px;"><input type="checkbox" class="ex_prog" value="${pd.key}" ${selectedKeys.has(pd.key) ? "checked" : ""}/> ${pd.name}</label>`).join("")}
      </div>

      <label>${lang === "am" ? "ምክንያት" : "Reason"}</label>
      <input id="ex_reason" class="text-input" placeholder="${lang === "am" ? "ለምሳሌ ታሟል" : "e.g. sick"}" value="${ex ? escapeHtml(ex.reason || "") : ""}">

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="ex_saveBtn" class="btn-primary">${t("settings.save")}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  function renderMemberChip() {
    const m = memberId ? memberMap.get(memberId) : null;
    el("ex_memberChip").innerHTML = m
      ? `<div class="list-row"><div><b>${escapeHtml(m.fullName)}</b>${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-remove="1">✕</button></div>`
      : `<p class="muted" style="margin:4px 0;">${lang === "am" ? "አልተመረጠም" : "Not selected"}</p>`;
    if (m) el("ex_memberChip").querySelector("[data-remove]").onclick = () => { memberId = null; renderMemberChip(); };
  }
  renderMemberChip();

  let searchTimeout;
  el("ex_memberSearch").oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { el("ex_memberResults").innerHTML = ""; return; }
      const results = members.filter((m) => m.fullName.toLowerCase().includes(q)).slice(0, 10);
      el("ex_memberResults").innerHTML = results.map((m) => `
        <div class="list-row"><div>${escapeHtml(m.fullName)}${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-pick="${m.id}">${lang === "am" ? "ምረጥ" : "Pick"}</button></div>`).join("");
      el("ex_memberResults").querySelectorAll("[data-pick]").forEach((btn) => {
        btn.onclick = () => {
          memberId = btn.dataset.pick;
          el("ex_memberSearch").value = "";
          el("ex_memberResults").innerHTML = "";
          renderMemberChip();
        };
      });
    }, 200);
  };

  function updateHint() {
    const s = el("ex_start").value, e = el("ex_end").value;
    el("ex_ethHint").textContent = s && e ? `${ethLabel(s)} → ${ethLabel(e)}` : "";
  }
  el("ex_start").onchange = updateHint;
  el("ex_end").onchange = updateHint;
  updateHint();
  el("ex_presets").querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = () => {
      const s = el("ex_start").value || today;
      el("ex_start").value = s;
      el("ex_end").value = isoDate(presets[Number(btn.dataset.preset)].fn(new Date(s + "T00:00:00")));
      updateHint();
    };
  });

  function syncProgBoxes() {
    const all = el("ex_all").checked;
    box.querySelectorAll(".ex_prog").forEach((cb) => { cb.disabled = all; if (all) cb.checked = false; });
  }
  el("ex_all").onchange = syncProgBoxes;
  syncProgBoxes();

  el("ex_saveBtn").onclick = async () => {
    const startDate = el("ex_start").value, endDate = el("ex_end").value;
    if (!memberId) { await showAlert(lang === "am" ? "አባል ይምረጡ" : "Please pick a member."); return; }
    if (!startDate || !endDate || endDate < startDate) { await showAlert(lang === "am" ? "ቀኖቹን ያረጋግጡ" : "Please check the dates (end can't be before start)."); return; }
    const allPrograms = el("ex_all").checked;
    const keys = allPrograms ? [] : [...box.querySelectorAll(".ex_prog:checked")].map((cb) => cb.value);
    if (!allPrograms && !keys.length) { await showAlert(lang === "am" ? "ቢያንስ አንድ ፕሮግራም ይምረጡ" : "Pick at least one program, or tick All programs."); return; }
    const reason = el("ex_reason").value.trim();
    if (ex) {
      Object.assign(ex, { memberId, startDate, endDate, reason, programKeys: keys, synced: false });
      await put("excuses", ex);
    } else {
      await put("excuses", {
        id: uid(), memberId, startDate, endDate, reason, programKeys: keys,
        createdBy: await resolveCallerName(), createdAt: new Date().toISOString(), synced: false,
      });
    }
    box.remove();
    renderExcuses();
    syncNow();
  };
};

// ---------- Punishments screen (ቅጣት) ----------
window._punishFilter = window._punishFilter || "current";

async function renderPunishments() {
  const lang = getLang();
  const [punishments, members] = await Promise.all([getAll("punishments"), getAll("members")]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const today = todayISO();
  const statusOf = (pu) => (pu.endDate < today ? "expired" : (pu.startDate > today ? "upcoming" : "active"));
  const statusLabel = {
    active: lang === "am" ? "በቅጣት ላይ" : "Active",
    upcoming: lang === "am" ? "ይመጣል" : "Upcoming",
    expired: lang === "am" ? "አልቋል" : "Finished",
  };
  const statusBadge = { active: "badge badge-red", upcoming: "badge badge-amber", expired: "badge" };
  const statusOrder = { active: 0, upcoming: 1, expired: 2 };
  const daysLeft = (pu) => Math.round((new Date(pu.endDate + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000) + 1;

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "ቅጣት" : "Punishments"}</h3>
    <p class="muted">${lang === "am"
      ? "በቅጣት ላይ ያሉ አባላት መምጣትና መመዝገብ ይችላሉ፣ ነገር ግን ቅጣታቸው እስኪያልቅ ድረስ በአገልግሎት አቴንዳንስ ሪፖርት ውስጥ አይካተቱም።"
      : "Members on punishment can still come and be scanned, but they're left out of the Service Attendance report until their punishment period ends."}</p>
    <p class="muted" id="punishSummary"></p>
    <div class="toolbar">
      <button id="addPunishBtn" class="btn-primary">${lang === "am" ? "+ ቅጣት ጨምር" : "+ Add Punishment"}</button>
    </div>
    <input id="punishSearch" class="text-input" placeholder="${lang === "am" ? "በስም ፈልግ" : "Search by name"}">
    <select id="punishFilter" class="text-input">
      <option value="current" ${window._punishFilter === "current" ? "selected" : ""}>${lang === "am" ? "በቅጣት ላይ እና የሚመጡ" : "Active & upcoming"}</option>
      <option value="expired" ${window._punishFilter === "expired" ? "selected" : ""}>${lang === "am" ? "ያለቁ" : "Finished"}</option>
      <option value="all" ${window._punishFilter === "all" ? "selected" : ""}>${lang === "am" ? "ሁሉም" : "All"}</option>
    </select>
    <div id="punishList" class="list"></div>`;

  function draw() {
    const q = el("punishSearch").value.trim().toLowerCase();
    const f = window._punishFilter;
    const rows = punishments
      .filter((pu) => memberMap.has(pu.memberId))
      .filter((pu) => {
        const st = statusOf(pu);
        if (f === "current" && st === "expired") return false;
        if (f === "expired" && st !== "expired") return false;
        return !q || memberMap.get(pu.memberId).fullName.toLowerCase().includes(q);
      })
      .sort((a, b) => (statusOrder[statusOf(a)] - statusOrder[statusOf(b)]) || a.endDate.localeCompare(b.endDate));
    el("punishList").innerHTML = rows.length ? rows.map((pu) => {
      const m = memberMap.get(pu.memberId);
      const st = statusOf(pu);
      const left = st === "active" ? (lang === "am" ? ` · ${daysLeft(pu)} ቀን ቀርቷል` : ` · ${daysLeft(pu)} day${daysLeft(pu) === 1 ? "" : "s"} left`) : "";
      return `
        <div class="list-row" style="align-items:flex-start;">
          <div style="flex:1;">
            <b>${escapeHtml(m.fullName)}</b><br>
            <span class="muted">${pu.startDate} → ${pu.endDate} · ${ethLabel(pu.startDate)} → ${ethLabel(pu.endDate)}${left}</span>
            ${pu.reason ? `<br><span class="muted">${escapeHtml(pu.reason)}</span>` : ""}
          </div>
          <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
            <span class="${statusBadge[st]}">${statusLabel[st]}</span>
            <div class="row-actions">
              <button class="btn-small" onclick="openPunishModal('${pu.id}')">${t("members.edit")}</button>
              <button class="btn-small" onclick="deletePunishment('${pu.id}')">${t("members.delete")}</button>
            </div>
          </div>
        </div>`;
    }).join("") : `<p class="muted">${lang === "am" ? "ምንም ቅጣት የለም" : "No punishments to show"}</p>`;
  }

  const puCount = (st) => new Set(punishments.filter((x) => memberMap.has(x.memberId) && statusOf(x) === st).map((x) => x.memberId)).size;
  el("punishSummary").textContent = lang === "am"
    ? `በቅጣት ላይ: ${puCount("active")} · የሚመጡ: ${puCount("upcoming")} · ያለቁ: ${puCount("expired")} (አባላት)`
    : `Active: ${puCount("active")} · Upcoming: ${puCount("upcoming")} · Finished: ${puCount("expired")} (members)`;
  el("addPunishBtn").onclick = () => openPunishModal();
  el("punishSearch").oninput = draw;
  el("punishFilter").onchange = (e) => { window._punishFilter = e.target.value; draw(); };
  draw();
}

window.deletePunishment = async (id) => {
  const lang = getLang();
  if (!(await showConfirm(lang === "am" ? "ይህን ቅጣት መሰረዝ ይፈልጋሉ?" : "Delete this punishment?"))) return;
  await del("punishments", id);
  await addTombstone("punishments", id);
  renderPunishments();
  syncNow();
};

window.openPunishModal = async function (editId, prefillMemberId) {
  const pu = editId ? await get("punishments", editId) : null;
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const today = todayISO();
  let memberId = pu ? pu.memberId : (prefillMemberId || null);

  const presets = [
    { label: lang === "am" ? "1 ቀን" : "1 day", fn: (s) => s },
    { label: lang === "am" ? "1 ሳምንት" : "1 week", fn: (s) => addDays(s, 6) },
    { label: lang === "am" ? "1 ወር" : "1 month", fn: (s) => addDays(addMonths(s, 1), -1) },
    { label: lang === "am" ? "3 ወር" : "3 months", fn: (s) => addDays(addMonths(s, 3), -1) },
    { label: lang === "am" ? "6 ወር" : "6 months", fn: (s) => addDays(addMonths(s, 6), -1) },
    { label: lang === "am" ? "1 ዓመት" : "1 year", fn: (s) => addDays(addMonths(s, 12), -1) },
  ];

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:500px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${pu ? (lang === "am" ? "ቅጣት አርትዕ" : "Edit Punishment") : (lang === "am" ? "ቅጣት ጨምር" : "Add Punishment")}</h3>

      <label>${lang === "am" ? "አባል" : "Member"} *</label>
      <div id="pu_memberChip"></div>
      <input id="pu_memberSearch" class="text-input" placeholder="${lang === "am" ? "ስም ፈልግ" : "Search name"}">
      <div id="pu_memberResults" class="list"></div>

      <label>${lang === "am" ? "መጀመሪያ ቀን" : "From"} *</label>
      <input id="pu_start" type="date" class="text-input" value="${pu ? pu.startDate : today}">
      <label>${lang === "am" ? "የመጨረሻ ቀን" : "To"} *</label>
      <input id="pu_end" type="date" class="text-input" value="${pu ? pu.endDate : today}">
      <div class="toolbar" id="pu_presets">
        ${presets.map((pr, i) => `<button type="button" class="btn-small" data-preset="${i}">${pr.label}</button>`).join("")}
      </div>
      <label>${lang === "am" ? "ወይም የቀናት ብዛት" : "Or number of days"}</label>
      <input id="pu_days" type="number" min="1" class="text-input" placeholder="${lang === "am" ? "ለምሳሌ 10" : "e.g. 10"}">
      <p class="muted" id="pu_ethHint" style="margin-top:-6px;"></p>

      <label>${lang === "am" ? "ምክንያት" : "Reason"}</label>
      <input id="pu_reason" class="text-input" value="${pu ? escapeHtml(pu.reason || "") : ""}">

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="pu_saveBtn" class="btn-primary">${t("settings.save")}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  function renderMemberChip() {
    const m = memberId ? memberMap.get(memberId) : null;
    el("pu_memberChip").innerHTML = m
      ? `<div class="list-row"><div><b>${escapeHtml(m.fullName)}</b>${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-remove="1">✕</button></div>`
      : `<p class="muted" style="margin:4px 0;">${lang === "am" ? "አልተመረጠም" : "Not selected"}</p>`;
    if (m) el("pu_memberChip").querySelector("[data-remove]").onclick = () => { memberId = null; renderMemberChip(); };
  }
  renderMemberChip();

  let searchTimeout;
  el("pu_memberSearch").oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { el("pu_memberResults").innerHTML = ""; return; }
      const results = members.filter((m) => m.fullName.toLowerCase().includes(q)).slice(0, 10);
      el("pu_memberResults").innerHTML = results.map((m) => `
        <div class="list-row"><div>${escapeHtml(m.fullName)}${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-pick="${m.id}">${lang === "am" ? "ምረጥ" : "Pick"}</button></div>`).join("");
      el("pu_memberResults").querySelectorAll("[data-pick]").forEach((btn) => {
        btn.onclick = () => {
          memberId = btn.dataset.pick;
          el("pu_memberSearch").value = "";
          el("pu_memberResults").innerHTML = "";
          renderMemberChip();
        };
      });
    }, 200);
  };

  function updateHint() {
    const s = el("pu_start").value, e = el("pu_end").value;
    el("pu_ethHint").textContent = s && e ? `${ethLabel(s)} → ${ethLabel(e)}` : "";
  }
  el("pu_start").onchange = updateHint;
  el("pu_end").onchange = updateHint;
  updateHint();
  el("pu_presets").querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = () => {
      const s = el("pu_start").value || today;
      el("pu_start").value = s;
      el("pu_end").value = isoDate(presets[Number(btn.dataset.preset)].fn(new Date(s + "T00:00:00")));
      el("pu_days").value = "";
      updateHint();
    };
  });
  // "N days" starting from the From date (the From day counts as day 1)
  el("pu_days").oninput = (e) => {
    const n = parseInt(e.target.value, 10);
    if (!(n >= 1)) return;
    const s = el("pu_start").value || today;
    el("pu_start").value = s;
    el("pu_end").value = isoDate(addDays(new Date(s + "T00:00:00"), n - 1));
    updateHint();
  };

  el("pu_saveBtn").onclick = async () => {
    const startDate = el("pu_start").value, endDate = el("pu_end").value;
    if (!memberId) { await showAlert(lang === "am" ? "አባል ይምረጡ" : "Please pick a member."); return; }
    if (!startDate || !endDate || endDate < startDate) { await showAlert(lang === "am" ? "ቀኖቹን ያረጋግጡ" : "Please check the dates (end can't be before start)."); return; }
    const reason = el("pu_reason").value.trim();
    if (pu) {
      Object.assign(pu, { memberId, startDate, endDate, reason, synced: false });
      await put("punishments", pu);
    } else {
      await put("punishments", {
        id: uid(), memberId, startDate, endDate, reason,
        createdBy: await resolveCallerName(), createdAt: new Date().toISOString(), synced: false,
      });
    }
    box.remove();
    renderPunishments();
    syncNow();
  };
};

// ---------- Advice screen (ምክር) ----------
// A log of members who made a fault and were counseled to correct it
// BEFORE any punishment. Entries are kept (not auto-expired) so repeated
// faults are visible; the "Punish" shortcut jumps to a prefilled punishment.
window._adviceFilter = window._adviceFilter || "all";

async function renderAdvice() {
  const lang = getLang();
  const [entries, members] = await Promise.all([getAll("advice"), getAll("members")]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const counts = new Map();
  entries.forEach((en) => { if (memberMap.has(en.memberId)) counts.set(en.memberId, (counts.get(en.memberId) || 0) + 1); });

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "ምክር" : "Advice"}</h3>
    <p class="muted">${lang === "am"
      ? "ከቅጣት በፊት ስህተት የሰሩ አባላትን የመከርንበት መዝገብ። የተፈጠረውን ጥፋትና የተሰጠውን ምክር እዚህ ይመዝግቡ።"
      : "A log of members who made a fault and were advised to correct it before any punishment. Record what happened and the advice given."}</p>
    <p class="muted" id="adviceSummary"></p>
    <div class="toolbar">
      <button id="addAdviceBtn" class="btn-primary">${lang === "am" ? "+ ምክር ጨምር" : "+ Add Advice"}</button>
    </div>
    <input id="adviceSearch" class="text-input" placeholder="${lang === "am" ? "በስም ፈልግ" : "Search by name"}">
    <select id="adviceFilter" class="text-input">
      <option value="all" ${window._adviceFilter === "all" ? "selected" : ""}>${lang === "am" ? "ሁሉም" : "Everyone advised"}</option>
      <option value="repeat" ${window._adviceFilter === "repeat" ? "selected" : ""}>${lang === "am" ? "ከ2 ጊዜ በላይ የተመከሩ" : "Advised 2+ times"}</option>
    </select>
    <div id="adviceList" class="list"></div>`;

  function draw() {
    const q = el("adviceSearch").value.trim().toLowerCase();
    const rows = entries
      .filter((en) => memberMap.has(en.memberId))
      .filter((en) => window._adviceFilter !== "repeat" || (counts.get(en.memberId) || 0) >= 2)
      .filter((en) => !q || memberMap.get(en.memberId).fullName.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
    el("adviceList").innerHTML = rows.length ? rows.map((en) => {
      const m = memberMap.get(en.memberId);
      const n = counts.get(en.memberId) || 1;
      return `
        <div class="list-row" style="align-items:flex-start;">
          <div style="flex:1;">
            <b>${escapeHtml(m.fullName)}</b><br>
            <span class="muted">${en.date} · ${ethLabel(en.date)}${en.advisedBy ? " · " + escapeHtml(en.advisedBy) : ""}</span>
            ${en.fault ? `<br><span class="muted"><b>${lang === "am" ? "ጥፋት" : "Fault"}:</b> ${escapeHtml(en.fault)}</span>` : ""}
            ${en.advice ? `<br><span class="muted"><b>${lang === "am" ? "ምክር" : "Advice"}:</b> ${escapeHtml(en.advice)}</span>` : ""}
          </div>
          <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
            <span class="badge ${n >= 2 ? "badge-amber" : ""}">${lang === "am" ? `${n} ጊዜ ተመክሯል` : `Advised ${n}×`}</span>
            <div class="row-actions">
              <button class="btn-small" onclick="openAdviceModal('${en.id}')">${t("members.edit")}</button>
              <button class="btn-small" onclick="deleteAdvice('${en.id}')">${t("members.delete")}</button>
            </div>
            <button class="btn-small" onclick="punishFromAdvice('${en.memberId}')">${lang === "am" ? "ቅጣት" : "Punish"}</button>
          </div>
        </div>`;
    }).join("") : `<p class="muted">${lang === "am" ? "ምንም ምክር አልተመዘገበም" : "No advice recorded"}</p>`;
  }

  const adviceRecords = entries.filter((en) => memberMap.has(en.memberId)).length;
  const repeatCount = [...counts.values()].filter((c) => c >= 2).length;
  el("adviceSummary").textContent = lang === "am"
    ? `${counts.size} አባላት ተመክረዋል · ${adviceRecords} መዝገቦች · ${repeatCount} ከ2 ጊዜ በላይ`
    : `${counts.size} members advised · ${adviceRecords} records · ${repeatCount} advised 2+ times`;
  el("addAdviceBtn").onclick = () => openAdviceModal();
  el("adviceSearch").oninput = draw;
  el("adviceFilter").onchange = (e) => { window._adviceFilter = e.target.value; draw(); };
  draw();
}

// Shortcut for when advice wasn't enough: open the punishment form with
// this member already chosen (saving it lands on the Punishments screen).
window.punishFromAdvice = (memberId) => {
  window._groupsView = "punishments";
  openPunishModal(null, memberId);
};

window.deleteAdvice = async (id) => {
  const lang = getLang();
  if (!(await showConfirm(lang === "am" ? "ይህን መዝገብ መሰረዝ ይፈልጋሉ?" : "Delete this advice record?"))) return;
  await del("advice", id);
  await addTombstone("advice", id);
  renderAdvice();
  syncNow();
};

window.openAdviceModal = async function (editId) {
  const en = editId ? await get("advice", editId) : null;
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const today = todayISO();
  let memberId = en ? en.memberId : null;
  const defaultAdviser = en ? (en.advisedBy || "") : await resolveCallerName();

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:500px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${en ? (lang === "am" ? "ምክር አርትዕ" : "Edit Advice") : (lang === "am" ? "ምክር ጨምር" : "Add Advice")}</h3>

      <label>${lang === "am" ? "አባል" : "Member"} *</label>
      <div id="ad_memberChip"></div>
      <input id="ad_memberSearch" class="text-input" placeholder="${lang === "am" ? "ስም ፈልግ" : "Search name"}">
      <div id="ad_memberResults" class="list"></div>

      <label>${lang === "am" ? "የተመከረበት ቀን" : "Date advised"} *</label>
      <input id="ad_date" type="date" class="text-input" value="${en ? en.date : today}">
      <p class="muted" id="ad_ethHint" style="margin-top:-6px;"></p>

      <label>${lang === "am" ? "ጥፋት / ስህተት" : "Fault"}</label>
      <textarea id="ad_fault" rows="3" class="text-input">${en ? escapeHtml(en.fault || "") : ""}</textarea>

      <label>${lang === "am" ? "የተሰጠ ምክር" : "Advice given"}</label>
      <textarea id="ad_advice" rows="3" class="text-input">${en ? escapeHtml(en.advice || "") : ""}</textarea>

      <label>${lang === "am" ? "የመከረው" : "Advised by"}</label>
      <input id="ad_by" class="text-input" value="${escapeHtml(defaultAdviser)}">

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="ad_saveBtn" class="btn-primary">${t("settings.save")}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  function renderMemberChip() {
    const m = memberId ? memberMap.get(memberId) : null;
    el("ad_memberChip").innerHTML = m
      ? `<div class="list-row"><div><b>${escapeHtml(m.fullName)}</b>${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-remove="1">✕</button></div>`
      : `<p class="muted" style="margin:4px 0;">${lang === "am" ? "አልተመረጠም" : "Not selected"}</p>`;
    if (m) el("ad_memberChip").querySelector("[data-remove]").onclick = () => { memberId = null; renderMemberChip(); };
  }
  renderMemberChip();

  let searchTimeout;
  el("ad_memberSearch").oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { el("ad_memberResults").innerHTML = ""; return; }
      const results = members.filter((m) => m.fullName.toLowerCase().includes(q)).slice(0, 10);
      el("ad_memberResults").innerHTML = results.map((m) => `
        <div class="list-row"><div>${escapeHtml(m.fullName)}${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div><button type="button" class="btn-small" data-pick="${m.id}">${lang === "am" ? "ምረጥ" : "Pick"}</button></div>`).join("");
      el("ad_memberResults").querySelectorAll("[data-pick]").forEach((btn) => {
        btn.onclick = () => {
          memberId = btn.dataset.pick;
          el("ad_memberSearch").value = "";
          el("ad_memberResults").innerHTML = "";
          renderMemberChip();
        };
      });
    }, 200);
  };

  function updateHint() { const d = el("ad_date").value; el("ad_ethHint").textContent = d ? ethLabel(d) : ""; }
  el("ad_date").onchange = updateHint;
  updateHint();

  el("ad_saveBtn").onclick = async () => {
    const date = el("ad_date").value;
    if (!memberId) { await showAlert(lang === "am" ? "አባል ይምረጡ" : "Please pick a member."); return; }
    if (!date) { await showAlert(lang === "am" ? "ቀን ያስገቡ" : "Please enter the date."); return; }
    const fields = {
      memberId, date,
      fault: el("ad_fault").value.trim(),
      advice: el("ad_advice").value.trim(),
      advisedBy: el("ad_by").value.trim(),
      synced: false,
    };
    if (en) {
      Object.assign(en, fields);
      await put("advice", en);
    } else {
      await put("advice", { id: uid(), createdAt: new Date().toISOString(), ...fields });
    }
    box.remove();
    renderAdvice();
    syncNow();
  };
};
