/* ፍኖተ ጥበብ — Groups tab: menu, departments, confession fathers, occupation,
   families, lost members, university students, Service Attendance.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderGroups.
   Depends on globals: getAll, get, put, del, addTombstone, syncNow, uid,
   showAlert, showConfirm, showPrompt, withButtonLoading, escapeHtml, ethLabel,
   gregorianToEthiopian, PROGRAM_DEFS, DEPT_OPTIONS, todayISO, isAdminUser,
   moreBackBtn, getDeptHeads, setDeptHead, addFamily, updateFamily,
   groupByConfessionFather, groupByOccupation, normFatherName, occupationLabel,
   loadExcuseIndex, isExcused, loadActivePunishedIds, t, getLang, el. */

// ---------- Groups tab: card menu -> Departments / Family Structure / Service Attendance / Coming soon ----------
window.toggleDeptGroup = (i) => {
  const box = el("deptGroup_" + i);
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
};
window.toggleFamilyGroup = (id) => {
  const box = el("familyGroup_" + id);
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
};
window.editDeptHead = async (encodedDept) => {
  const dept = decodeURIComponent(encodedDept);
  const lang = getLang();
  const current = (await getDeptHeads())[dept] || "";
  const name = await showPrompt(lang === "am" ? `የ${dept} ሰብሳቢ ስም` : `Chair's name for ${dept}`, current);
  if (name === null) return;
  await setDeptHead(dept, name.trim());
  renderGroups();
};

window._groupsView = window._groupsView || "menu";
function groupsBackBtn() {
  const lang = getLang();
  return `<button class="btn-secondary" onclick="window._groupsView='menu';renderGroups();" style="margin-bottom:14px;">${lang === "am" ? "← ተመለስ" : "← Back"}</button>`;
}

async function renderGroups() {
  const view = window._groupsView || "menu";
  if (view === "departments") return renderGroupsDepartments();
  if (view === "families") return renderGroupsFamilies();
  if (view === "serviceAttendance") return renderServiceAttendance();
  if (view === "lostMembers") return renderLostMembers();
  if (view === "universityStudents") return renderUniversityStudents();
  if (view === "excuses") return renderExcuses();
  if (view === "punishments") return renderPunishments();
  if (view === "advice") return renderAdvice();
  if (view === "confessionFathers") return renderGroupsConfessionFathers();
  if (view === "occupation") return renderGroupsOccupation();
  if (view === "dutyRoster") return renderDutyRoster();
  return renderGroupsMenu();
}

async function renderGroupsMenu() {
  const lang = getLang();
  const today = todayISO();
  const [members, excuses, punishments, advice, families, duty] = await Promise.all([
    getAll("members"), getAll("excuses"), getAll("punishments"), getAll("advice"), getAll("families"), getAll("dutyAssignments"),
  ]);
  const ids = new Set(members.map((m) => m.id));
  const distinct = (rows) => new Set(rows.filter((r) => ids.has(r.memberId)).map((r) => r.memberId)).size;
  const activeNow = (r) => r.startDate <= today && today <= r.endDate;
  const n = {
    dept: members.filter((m) => m.category).length,
    father: members.filter((m) => normFatherName(m.confessionFather)).length,
    families: families.length,
    lost: members.filter((m) => m.active === false).length,
    uni: members.filter((m) => m.isUniversityStudent).length,
    perm: distinct(excuses.filter(activeNow)),
    punish: distinct(punishments.filter(activeNow)),
    advised: distinct(advice),
    duty: new Set(duty.map((d) => d.date + "|" + d.kind)).size,
    employed: members.filter((m) => m.occupationStatus === "employed").length,
    students: members.filter((m) => m.occupationStatus === "student").length,
    unemployed: members.filter((m) => m.occupationStatus === "unemployed").length,
  };
  const subs = {
    departments: lang === "am" ? `${n.dept} አባላት ተመድበዋል` : `${n.dept} members assigned`,
    confessionFathers: lang === "am" ? `${n.father} አባላት ተመዝግበዋል` : `${n.father} members recorded`,
    occupation: lang === "am"
      ? `${n.employed} ሠራተኛ · ${n.students} ተማሪ · ${n.unemployed} ሥራ የሌለው`
      : `${n.employed} employed · ${n.students} students · ${n.unemployed} unemployed`,
    families: lang === "am" ? `${n.families} ቤተሰቦች` : `${n.families} families`,
    lostMembers: lang === "am" ? `${n.lost} የጠፉ` : `${n.lost} lost`,
    universityStudents: lang === "am" ? `${n.uni} ተማሪዎች` : `${n.uni} students`,
    excuses: lang === "am" ? `${n.perm} በፈቃድ ላይ` : `${n.perm} on permission now`,
    punishments: lang === "am" ? `${n.punish} በቅጣት ላይ` : `${n.punish} on punishment now`,
    advice: lang === "am" ? `${n.advised} አባላት ተመክረዋል` : `${n.advised} members advised`,
    dutyRoster: lang === "am" ? `${n.duty} የተመዘገቡ ምደባዎች` : `${n.duty} saved rosters`,
  };
  const cards = [
    { view: "departments", icon: "🏢", label: lang === "am" ? "ክፍላት" : "Departments" },
    { view: "confessionFathers", icon: "✝️", label: lang === "am" ? "የንስሐ አባት" : "Confession Fathers" },
    { view: "occupation", icon: "💼", label: lang === "am" ? "ሥራ" : "Occupation" },
    { view: "dutyRoster", icon: "📅", label: lang === "am" ? "ምደባ" : "Duty Roster" },
    { view: "families", icon: "👪", label: lang === "am" ? "የቤተሰብ መዋቅር" : "Family Structure" },
    { view: "serviceAttendance", icon: "📋", label: lang === "am" ? "የአገልግሎት አቴንዳንስ" : "Service Attendance" },
    { view: "lostMembers", icon: "🔍", label: lang === "am" ? "የጠፉ አባላት" : "Lost Members" },
    { view: "universityStudents", icon: "🎓", label: lang === "am" ? "የዩኒቨርሲቲ ተማሪዎች" : "University Students" },
    { view: "excuses", icon: "🩺", label: lang === "am" ? "ፈቃድ" : "Permissions" },
    { view: "advice", icon: "💬", label: lang === "am" ? "ምክር" : "Advice" },
    { view: "punishments", icon: "⛔", label: lang === "am" ? "ቅጣት" : "Punishments" },
  ];
  el("view").innerHTML = `
    ${moreBackBtn()}
    <h3 class="section-title">${lang === "am" ? "ቡድኖች" : "Groups"}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${cards.map((c) => `
        <div class="list-row" style="flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:26px 10px;cursor:pointer;min-height:110px;" onclick="window._groupsView='${c.view}';renderGroups();">
          <div style="font-size:2rem;">${c.icon}</div>
          <b style="margin-top:8px;">${c.label}</b>
          ${subs[c.view] ? `<span class="muted" style="margin-top:4px;">${subs[c.view]}</span>` : ""}
        </div>`).join("")}
    </div>
  `;
}

// Marking someone here just sets member.active = false — the same flag
// computeConsecutiveAbsences/computeProgramSpecificAbsences/
// computeConfessionDue/computeGradeStats already filter on, so it takes
// effect everywhere calls/reminders are computed with no other changes
// needed. They still show up in the Members tab and can be re-activated
// here at any time.
async function renderLostMembers() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const pending = new Map(members.map((m) => [m.id, m.active === false]));

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "የጠፉ አባላት" : "Lost Members"}</h3>
    <p class="muted">${lang === "am"
      ? "የተመረጡ አባላት አሁን ሰንበት ትምህርት ቤት ስለማይማሩ/ስለማይመጡ ከጥሪ ዝርዝር (ተከታታይ ቀሪ ማሳሰቢያ) ውጪ ይሆናሉ።"
      : "Checked members no longer attend, so they'll be excluded from the absentee call list and related reminders."}</p>
    <p class="muted" id="lostSummary"></p>
    <input id="lostSearch" class="text-input" placeholder="${lang === "am" ? "በስም ፈልግ" : "Search by name"}">
    <div class="list" id="lostList"></div>
    <div class="toolbar" style="margin-top:12px;">
      <button id="lostSaveBtn" class="btn-primary">${t("settings.save")}</button>
    </div>
  `;

  function draw(list) {
    const lostNow = [...pending.values()].filter(Boolean).length;
    el("lostSummary").textContent = lang === "am"
      ? `የጠፉ: ${lostNow} ከ ${members.length} አባላት`
      : `Lost: ${lostNow} of ${members.length} members`;
    el("lostList").innerHTML = list.map((m) => `
      <div class="list-row">
        <label class="sel-check">
          <input type="checkbox" data-id="${m.id}" ${pending.get(m.id) ? "checked" : ""}/>
        </label>
        <div style="flex:1;">
          <b>${m.fullName}</b><br>
          <span class="muted">${m.phone || ""}${m.grade ? " · " + t("members.gradeShort", { n: m.grade }) : ""}${m.address ? " · " + m.address : ""}</span>
        </div>
        ${pending.get(m.id) ? `<span class="badge badge-red">${lang === "am" ? "የጠፋ" : "Lost"}</span>` : ""}
      </div>`).join("");
    el("lostList").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => {
        pending.set(cb.dataset.id, cb.checked);
        draw(currentList);
      };
    });
  }

  let currentList = members;
  draw(currentList);
  el("lostSearch").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    currentList = members.filter((m) => m.fullName.toLowerCase().includes(q));
    draw(currentList);
  };

  el("lostSaveBtn").onclick = async () => {
    let changedCount = 0;
    for (const m of members) {
      const shouldBeLost = pending.get(m.id);
      const currentlyLost = m.active === false;
      if (shouldBeLost !== currentlyLost) {
        m.active = !shouldBeLost;
        m.synced = false;
        await put("members", m);
        changedCount++;
      }
    }
    await showAlert(lang === "am" ? `${changedCount} አባላት ተዘምነዋል` : `${changedCount} member(s) updated`);
    renderLostMembers();
  };
}

// Marks members as university students (mostly away). Unlike Lost Members this
// does NOT make anyone inactive: they stay normal members everywhere, are
// simply not flagged on the absentee call list, and can be added to Service
// Attendance with its "Add university students" switch.
async function renderUniversityStudents() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const pending = new Map(members.map((m) => [m.id, !!m.isUniversityStudent]));
  let markedOnly = false;
  let currentList = members;

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "የዩኒቨርሲቲ ተማሪዎች" : "University Students"}</h3>
    <p class="muted">${lang === "am"
      ? "የተመረጡት አባላት የዩኒቨርሲቲ ተማሪዎች ናቸው (አብዛኛው ጊዜ ከከተማ ውጪ)። ለጥሪ ዝርዝር አይወጡም፤ በአገልግሎት አቴንዳንስ ውስጥ «የዩኒቨርሲቲ ተማሪዎችን ጨምር» ሲበራ ሁሉም ይጨመራሉ። ፕሮግራሞች ላይ ከተገኙ ግን እንደሌሎች አባላት በራስ-ሰር ይካተታሉ።"
      : "Checked members are university students (mostly away). They're not flagged on the absentee call list, and the Service Attendance \"Add university students\" switch adds all of them. If they do attend programs, they're listed automatically like any other member."}</p>
    <p class="muted" id="uniSummary"></p>
    <input id="uniSearch" class="text-input" placeholder="${lang === "am" ? "በስም ፈልግ" : "Search by name"}">
    <label class="sel-check" style="gap:8px;margin-bottom:10px;"><input type="checkbox" id="uniMarkedOnly"/> ${lang === "am" ? "የተመረጡትን ብቻ አሳይ" : "Show marked only"}</label>
    <div class="list" id="uniList"></div>
    <div class="toolbar" style="margin-top:12px;">
      <button id="uniSaveBtn" class="btn-primary">${t("settings.save")}</button>
    </div>`;

  function draw() {
    const q = el("uniSearch").value.trim().toLowerCase();
    currentList = members.filter((m) => (!q || m.fullName.toLowerCase().includes(q)) && (!markedOnly || pending.get(m.id)));
    const marked = [...pending.values()].filter(Boolean).length;
    el("uniSummary").textContent = lang === "am"
      ? `የዩኒቨርሲቲ ተማሪዎች: ${marked} ከ ${members.length} አባላት`
      : `University students: ${marked} of ${members.length} members`;
    el("uniList").innerHTML = currentList.map((m) => `
      <div class="list-row">
        <label class="sel-check">
          <input type="checkbox" data-id="${m.id}" ${pending.get(m.id) ? "checked" : ""}/>
        </label>
        <div style="flex:1;">
          <b>${escapeHtml(m.fullName)}</b><br>
          <span class="muted">${escapeHtml(m.phone || "")}${m.grade ? " · " + t("members.gradeShort", { n: m.grade }) : ""}${m.address ? " · " + escapeHtml(m.address) : ""}</span>
        </div>
        ${pending.get(m.id) ? `<span class="badge badge-amber">${lang === "am" ? "ዩኒቨርሲቲ" : "University"}</span>` : ""}
      </div>`).join("");
    el("uniList").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => { pending.set(cb.dataset.id, cb.checked); draw(); };
    });
  }

  el("uniSearch").oninput = draw;
  el("uniMarkedOnly").onchange = (e) => { markedOnly = e.target.checked; draw(); };
  el("uniSaveBtn").onclick = async () => {
    let changed = 0;
    for (const m of members) {
      const want = pending.get(m.id);
      if (want !== !!m.isUniversityStudent) {
        m.isUniversityStudent = want;
        m.synced = false;
        await put("members", m);
        changed++;
      }
    }
    await showAlert(lang === "am" ? `${changed} አባላት ተዘምነዋል` : `${changed} member(s) updated`);
    renderUniversityStudents();
  };
  draw();
}

async function renderGroupsDepartments() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const deptHeads = await getDeptHeads();

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "በክፍል" : "By Department"}</h3>
    <p class="muted">${lang === "am"
      ? `${members.filter((m) => m.category).length} ከ ${members.length} አባላት ክፍል ተመድቦላቸዋል`
      : `${members.filter((m) => m.category).length} of ${members.length} members assigned to a department`}</p>
    <div class="list">
      ${DEPT_OPTIONS.map((dept, i) => {
        const deptMembers = members.filter((m) => m.category === dept);
        const head = deptHeads[dept] || (lang === "am" ? "(ሰብሳቢ አልተመደበም)" : "(no chair assigned)");
        return `
          <div class="list-row" style="flex-direction:column;align-items:stretch;">
            <div class="list-row" style="padding:0;cursor:pointer;" onclick="toggleDeptGroup(${i})">
              <div style="flex:1;">
                <b>${head}</b><br>
                <span class="muted">${dept} · ${lang === "am" ? "ሰብሳቢ" : "Chair"} · ${deptMembers.length} ${lang === "am" ? "አባላት" : "members"}</span>
              </div>
              <button class="btn-small" onclick="event.stopPropagation();editDeptHead('${encodeURIComponent(dept)}')">${lang === "am" ? "ሰብሳቢ ቀይር" : "Edit Chair"}</button>
            </div>
            <div id="deptGroup_${i}" class="list" style="display:none;margin-top:8px;">
              ${deptMembers.length ? deptMembers.map((m) => `
                <div class="list-row"><div>${m.fullName}${m.phone ? ` <span class="muted">· ${m.phone}</span>` : ""}</div></div>
              `).join("") : `<p class="muted">${lang === "am" ? "የተመደበ አባል የለም" : "No members assigned"}</p>`}
            </div>
          </div>`;
      }).join("")}
    </div>
  `;
}

window.toggleCfGroup = (i) => {
  const box = el("cfGroup_" + i);
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
};

// Same idea as the Departments screen: one expandable row per confession
// father with their members underneath, plus a dropdown to filter down to
// a single father (whose group then opens automatically).
async function renderGroupsConfessionFathers() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const groups = groupByConfessionFather(members);
  const filter = window._cfFilter || "";
  const shown = filter ? groups.filter((g) => g.key === filter) : groups;
  const label = (g) => g.name || (lang === "am" ? "(የንስሐ አባት አልተመዘገበም)" : "(no confession father recorded)");

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "በንስሐ አባት" : "By Confession Father"}</h3>
    <p class="muted">${lang === "am"
      ? `${groups.filter((g) => g.key !== "__none__").length} የንስሐ አባቶች · ${members.filter((m) => normFatherName(m.confessionFather)).length} ከ ${members.length} አባላት ተመዝግበዋል`
      : `${groups.filter((g) => g.key !== "__none__").length} confession fathers · ${members.filter((m) => normFatherName(m.confessionFather)).length} of ${members.length} members recorded`}</p>
    <select id="cfFilter" class="text-input">
      <option value="">${lang === "am" ? "ሁሉም የንስሐ አባቶች" : "All confession fathers"} (${groups.length})</option>
      ${groups.map((g) => `<option value="${escapeHtml(g.key)}" ${g.key === filter ? "selected" : ""}>${escapeHtml(label(g))} (${g.members.length})</option>`).join("")}
    </select>
    <div class="list">
      ${shown.length ? shown.map((g, i) => `
        <div class="list-row" style="flex-direction:column;align-items:stretch;">
          <div class="list-row" style="padding:0;cursor:pointer;" onclick="toggleCfGroup(${i})">
            <div style="flex:1;">
              <b>${escapeHtml(label(g))}</b><br>
              <span class="muted">${g.members.length} ${lang === "am" ? "አባላት" : "members"}</span>
            </div>
          </div>
          <div id="cfGroup_${i}" class="list" style="display:${filter ? "block" : "none"};margin-top:8px;">
            ${g.members.map((m) => `
              <div class="list-row"><div>${escapeHtml(m.fullName)}${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div></div>`).join("")}
          </div>
        </div>`).join("") : `<p class="muted">${lang === "am" ? "ምንም አባል የለም" : "No members"}</p>`}
    </div>
  `;
  el("cfFilter").onchange = (e) => { window._cfFilter = e.target.value; renderGroupsConfessionFathers(); };
}

window.toggleOccGroup = (i) => {
  const box = el("occGroup_" + i);
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
};

// One expandable row per job title (employed), plus Students, Unemployed and
// "not recorded" — same layout as the Departments / Confession Fathers
// screens, with a dropdown to filter down to one group.
async function renderGroupsOccupation() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const groups = groupByOccupation(members);
  const filter = window._occFilter || "";
  const jobGroups = groups.filter((g) => g.kind === "job");
  const sizeOf = (kind) => (groups.find((g) => g.kind === kind) || { members: [] }).members.length;
  const employedTotal = jobGroups.reduce((sum, g) => sum + g.members.length, 0);
  const label = (g) => {
    if (g.kind === "job") return g.name || (lang === "am" ? "ሠራተኛ (ሙያ ያልተመዘገበ)" : "Employed (no job title)");
    if (g.kind === "none") return lang === "am" ? "(አልተመዘገበም)" : "(not recorded)";
    return occupationLabel(g.kind, lang);
  };
  const kindText = (g) => (g.kind === "job" ? occupationLabel("employed", lang) : "");

  let shown = groups;
  if (filter === "status:employed") shown = jobGroups;
  else if (filter) shown = groups.filter((g) => g.key === filter);

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "በሥራ" : "By Occupation"}</h3>
    <p class="muted">${lang === "am"
      ? `ሠራተኛ: ${employedTotal} (${jobGroups.filter((g) => g.name).length} የሥራ ዓይነቶች) · ተማሪ: ${sizeOf("student")} · ሥራ የሌለው: ${sizeOf("unemployed")} · ያልተመዘገበ: ${sizeOf("none")}`
      : `Employed: ${employedTotal} (${jobGroups.filter((g) => g.name).length} job types) · Students: ${sizeOf("student")} · Unemployed: ${sizeOf("unemployed")} · Not recorded: ${sizeOf("none")}`}</p>
    <select id="occFilter" class="text-input">
      <option value="">${lang === "am" ? "ሁሉም" : "Everyone"}</option>
      <option value="status:employed" ${filter === "status:employed" ? "selected" : ""}>${lang === "am" ? "ሠራተኛ — ሁሉም ሥራዎች" : "Employed — all jobs"} (${employedTotal})</option>
      <option value="status:student" ${filter === "status:student" ? "selected" : ""}>${occupationLabel("student", lang)} (${sizeOf("student")})</option>
      <option value="status:unemployed" ${filter === "status:unemployed" ? "selected" : ""}>${occupationLabel("unemployed", lang)} (${sizeOf("unemployed")})</option>
      <option value="status:none" ${filter === "status:none" ? "selected" : ""}>${lang === "am" ? "ያልተመዘገበ" : "Not recorded"} (${sizeOf("none")})</option>
      ${jobGroups.length ? `<optgroup label="${lang === "am" ? "የሥራ ዓይነቶች" : "Jobs"}">
        ${jobGroups.map((g) => `<option value="${escapeHtml(g.key)}" ${g.key === filter ? "selected" : ""}>${escapeHtml(label(g))} (${g.members.length})</option>`).join("")}
      </optgroup>` : ""}
    </select>
    <div class="list">
      ${shown.length ? shown.map((g, i) => `
        <div class="list-row" style="flex-direction:column;align-items:stretch;">
          <div class="list-row" style="padding:0;cursor:pointer;" onclick="toggleOccGroup(${i})">
            <div style="flex:1;">
              <b>${escapeHtml(label(g))}</b><br>
              <span class="muted">${g.members.length} ${lang === "am" ? "አባላት" : "members"}${kindText(g) ? " · " + kindText(g) : ""}</span>
            </div>
          </div>
          <div id="occGroup_${i}" class="list" style="display:${filter ? "block" : "none"};margin-top:8px;">
            ${g.members.map((m) => `
              <div class="list-row"><div>${escapeHtml(m.fullName)}${m.phone ? ` <span class="muted">· ${escapeHtml(m.phone)}</span>` : ""}</div></div>`).join("")}
          </div>
        </div>`).join("") : `<p class="muted">${lang === "am" ? "ምንም አባል የለም" : "No members"}</p>`}
    </div>
  `;
  el("occFilter").onchange = (e) => { window._occFilter = e.target.value; renderGroupsOccupation(); };
}

async function renderGroupsFamilies() {
  const lang = getLang();
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const families = await getAll("families");

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${lang === "am" ? "የቤተሰብ መዋቅር" : "Family Structure"}</h3>
    <div class="toolbar">
      <button id="addFamilyBtn" class="btn-primary">${lang === "am" ? "ቤተሰብ ጨምር" : "Add Family"}</button>
      <button id="exportFamiliesBtn" class="btn-secondary">${lang === "am" ? "ኤክሴል አውርድ" : "Export Excel"}</button>
    </div>
    <div class="list">
      ${families.length ? families.map((f) => {
        const father = f.fatherId ? memberMap.get(f.fatherId) : null;
        const mother = f.motherId ? memberMap.get(f.motherId) : null;
        const firstSon = f.firstSonId ? memberMap.get(f.firstSonId) : null;
        const children = (f.childrenIds || []).map((id) => memberMap.get(id)).filter(Boolean);
        return `
          <div class="list-row" style="flex-direction:column;align-items:stretch;">
            <div class="list-row" style="padding:0;cursor:pointer;" onclick="toggleFamilyGroup('${f.id}')">
              <div style="flex:1;">
                <b>${father ? father.fullName : (lang === "am" ? "(አባት አልተመደበም)" : "(no father)")} ${lang === "am" ? "እና" : "&"} ${mother ? mother.fullName : (lang === "am" ? "(እናት አልተመደበም)" : "(no mother)")}</b><br>
                <span class="muted">${f.addressCode ? f.addressCode + " · " : ""}${children.length + (firstSon ? 1 : 0)} ${lang === "am" ? "ልጆች" : "children"}</span>
              </div>
              <div class="row-actions">
                <button class="btn-small" onclick="event.stopPropagation();openFamilyModal('${f.id}')">${t("members.edit")}</button>
                <button class="btn-small" onclick="event.stopPropagation();deleteFamily('${f.id}')">${t("members.delete")}</button>
              </div>
            </div>
            <div id="familyGroup_${f.id}" class="list" style="display:none;margin-top:8px;">
              ${firstSon ? `<div class="list-row"><div><b>${lang === "am" ? "የበኩር ልጅ" : "First Son"}:</b> ${firstSon.fullName}</div></div>` : ""}
              ${children.length ? children.map((c) => `<div class="list-row"><div>${c.fullName}</div></div>`).join("") : (!firstSon ? `<p class="muted">${lang === "am" ? "ልጆች አልተመደቡም" : "No children assigned"}</p>` : "")}
            </div>
          </div>`;
      }).join("") : `<p class="muted">${lang === "am" ? "ገና ቤተሰብ አልተመዘገበም" : "No families added yet"}</p>`}
    </div>
  `;

  el("addFamilyBtn").onclick = () => openFamilyModal();
  el("exportFamiliesBtn").onclick = () => exportFamiliesExcel(families, memberMap);
}

// ---------- Service Attendance (የአገልግሎት አቴንዳንስ) ----------
// Eligibility rule (per program with n > 0): a member qualifies if they
// attended — or were excused on — at least n of that program's SELECTED
// days (no days selected = all days that program has been held). They must
// pass every program with n > 0, and match a selected grade if any grades
// are checked. "Add university students" adds every marked student on top.
const SVC_PROGRAMS = ["timhert", "tselot", "mezmur", "mata", "kurban", "awdemihret"];

// -> { programKey: [{ date, count }] } newest first; count = distinct members present that day
function svcSessionDays(attendance) {
  const byProg = {};
  for (const a of attendance) {
    if (!SVC_PROGRAMS.includes(a.programKey)) continue;
    const m = (byProg[a.programKey] = byProg[a.programKey] || new Map());
    if (!m.has(a.sessionDate)) m.set(a.sessionDate, new Set());
    m.get(a.sessionDate).add(a.memberId);
  }
  const out = {};
  for (const k of SVC_PROGRAMS) {
    out[k] = byProg[k]
      ? [...byProg[k].entries()].map(([date, set]) => ({ date, count: set.size })).sort((a, b) => b.date.localeCompare(a.date))
      : [];
  }
  return out;
}

// reqs = { mezmur: { n: 1, dates: [] /* empty = all days */ }, ... }
// A member qualifies for a program if they attended (or were excused on)
// at least n of that program's selected days; every program with n > 0 must pass.
async function computeServiceAttendanceEligible({ reqs, grades, includeUniversity = false }) {
  const members = (await getAll("members")).filter((m) => m.active !== false);
  const attendance = await getAll("attendance");
  const byGrade = grades && grades.length ? members.filter((m) => grades.includes(m.grade)) : members;
  const days = svcSessionDays(attendance);
  const excuseIdx = await loadExcuseIndex();

  const present = new Set(attendance.map((a) => a.memberId + "|" + a.programKey + "|" + a.sessionDate));
  const active = SVC_PROGRAMS.filter((k) => reqs[k] && reqs[k].n > 0);

  const results = byGrade.filter((mem) => {
    let viaPermission = false;
    const ok = active.every((key) => {
      const { n, dates } = reqs[key];
      const pool = (dates && dates.length ? dates : days[key].map((d) => d.date));
      if (pool.length < n) return false;
      let attended = 0, excused = 0;
      for (const d of pool) {
        if (present.has(mem.id + "|" + key + "|" + d)) attended++;
        else if (isExcused(excuseIdx, mem.id, d, key)) excused++;
      }
      if (attended + excused < n) return false;
      if (attended < n) viaPermission = true;
      return true;
    });
    if (ok) mem._viaPermission = viaPermission;
    return ok;
  });

  if (includeUniversity) {
    const have = new Set(results.map((m) => m.id));
    for (const mem of members) {
      if (mem.isUniversityStudent && !have.has(mem.id)) { mem._addedUniversity = true; results.push(mem); }
    }
  }
  const punishedIds = await loadActivePunishedIds();
  const finalList = results.filter((mem) => !punishedIds.has(mem.id));
  finalList.sort((a, b) => a.fullName.localeCompare(b.fullName));
  finalList.punishedCount = results.length - finalList.length;
  return finalList;
}

function ethShortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  const eth = gregorianToEthiopian(d);
  return `${String(eth.day).padStart(2, "0")}/${String(eth.month).padStart(2, "0")}/${eth.year}`;
}

async function renderServiceAttendance() {
  const lang = getLang(), am = lang === "am";
  const [allMembers, attendance] = await Promise.all([getAll("members"), getAll("attendance")]);
  const uniMarked = allMembers.filter((m) => m.isUniversityStudent && m.active !== false).length;
  const progs = PROGRAM_DEFS().filter((p) => SVC_PROGRAMS.includes(p.key));
  const days = svcSessionDays(attendance);

  const state = window._svcAttn2 || { reqs: {}, includeUni: false, grades: [], holiday: "" };
  window._svcAttn2 = state;
  progs.forEach((p) => {
    const r = (state.reqs[p.key] = state.reqs[p.key] || { n: 0, dates: [] });
    const valid = new Set(days[p.key].map((d) => d.date));
    r.dates = r.dates.filter((d) => valid.has(d));
  });

  const progBlock = (p) => {
    const r = state.reqs[p.key];
    const list = days[p.key];
    return `
      <div class="list-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-bottom:8px;">
        <label style="margin:0;"><b>${p.name}</b> <span class="muted">· ${am ? "ቢያንስ ስንት ቀን" : "minimum days attended"}</span></label>
        <input id="svc_n_${p.key}" type="number" min="0" class="text-input" style="margin-bottom:0;" value="${r.n}">
        <details>
          <summary class="muted" id="svc_sum_${p.key}" style="cursor:pointer;"></summary>
          ${list.length ? `
            <label class="sel-check" style="gap:8px;margin:8px 0;">
              <input type="checkbox" id="svc_all_${p.key}"/> <b>${am ? "ሁሉም ቀናት" : "All days"}</b> <span class="muted">(${list.length})</span>
            </label>
            ${list.map((d) => `
              <label class="sel-check" style="gap:8px;margin-bottom:6px;">
                <input type="checkbox" class="svc_day_${p.key}" value="${d.date}" ${r.dates.includes(d.date) ? "checked" : ""}/>
                <span>${d.date} <span class="muted">· ${ethLabel(d.date)} · ${d.count} ${am ? "ተገኝተዋል" : "present"}</span></span>
              </label>`).join("")}`
          : `<p class="muted">${am ? "ገና መገኘት አልተመዘገበም" : "No attendance recorded yet"}</p>`}
        </details>
      </div>`;
  };

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${am ? "የአገልግሎት አቴንዳንስ" : "Service Attendance"}</h3>
    <p class="muted">${am
      ? "ለእያንዳንዱ ፕሮግራም ቀናቱን ይምረጡ (ወይም ሁሉም)፣ ከዚያ አባሉ ቢያንስ በስንት ቀን መገኘት እንዳለበት ያስገቡ። 0 ማለት ፕሮግራሙ አይቆጠርም።"
      : "For each program pick the days (or All), then enter the minimum number of those days a member must have attended. 0 = program not used."}</p>

    ${progs.map(progBlock).join("")}

    <label>${am ? "ክፍል (ብዙ ምረጫ)" : "Grade (multi-select)"}</label>
    <div class="toolbar" id="svc_grades">
      ${Array.from({ length: 12 }, (_, i) => i + 1).map((g) => `
        <button type="button" class="btn-secondary ${state.grades.includes(g) ? "active-lang" : ""}" data-grade="${g}" style="padding:6px 11px;">${g}</button>`).join("")}
    </div>

    <label class="sel-check" style="gap:8px;margin:12px 0 4px;"><input type="checkbox" id="svc_uni" ${state.includeUni ? "checked" : ""}/> ${am ? "የዩኒቨርሲቲ ተማሪዎችን ጨምር" : "Add university students"} (${uniMarked})</label>

    <label>${am ? "የምን አመታዊ በዓል ነው?" : "Which annual holiday is this?"}</label>
    <input id="svc_holiday" class="text-input" placeholder="${am ? "ለምሳሌ የመድኃኔዓለም" : "e.g. Medhanialem"}" value="${escapeHtml(state.holiday)}">

    <p class="muted" id="svc_count">${am ? "መስፈርቶቹን ይሙሉ..." : "Fill in the criteria..."}</p>
    <button id="svc_generateBtn" class="btn-primary" style="width:100%;" disabled>${am ? "ሪፖርት አመንጭ" : "Generate Report"}</button>
  `;

  let eligible = [];
  const updateSummary = (key) => {
    const r = state.reqs[key], total = days[key].length;
    const label = r.dates.length
      ? `${am ? "የተመረጡ ቀናት" : "Selected days"}: ${r.dates.length}/${total}`
      : `${am ? "ሁሉም ቀናት" : "All days"} (${total})`;
    el("svc_sum_" + key).textContent = label;
    const all = el("svc_all_" + key);
    if (all) all.checked = r.dates.length === 0;
  };

  const refreshCount = async () => {
    state.holiday = el("svc_holiday").value;
    state.includeUni = el("svc_uni").checked;
    eligible = await computeServiceAttendanceEligible({ reqs: state.reqs, grades: state.grades, includeUniversity: state.includeUni });
    const viaCount = eligible.filter((m) => m._viaPermission).length;
    const addedUni = eligible.filter((m) => m._addedUniversity).length;
    const heldBack = eligible.punishedCount || 0;
    el("svc_count").textContent = (am
      ? `በመስፈርቶቹ መሠረት ${eligible.length} ብቁ አባላት አሉ`
      : `There ${eligible.length === 1 ? "is" : "are"} ${eligible.length} member${eligible.length === 1 ? "" : "s"} eligible according to the criteria`)
      + (viaCount ? (am ? ` (${viaCount} በፈቃድ)` : ` (${viaCount} by permission)`) : "")
      + (addedUni ? (am ? ` · ${addedUni} የዩኒቨርሲቲ ተማሪዎች ተጨምረዋል` : ` · ${addedUni} university students added`) : "")
      + (heldBack ? (am ? ` · ${heldBack} በቅጣት ላይ ስለሆኑ አልተካተቱም` : ` · ${heldBack} left out (on punishment)`) : "");
    el("svc_generateBtn").disabled = !state.holiday.trim() || eligible.length === 0;
  };

  progs.forEach((p) => {
    const key = p.key, r = state.reqs[key];
    el("svc_n_" + key).oninput = (e) => { r.n = Math.max(0, Number(e.target.value) || 0); refreshCount(); };
    const all = el("svc_all_" + key);
    if (all) all.onchange = () => {
      if (all.checked) { r.dates = []; el("view").querySelectorAll(".svc_day_" + key).forEach((cb) => (cb.checked = false)); }
      updateSummary(key); refreshCount();
    };
    el("view").querySelectorAll(".svc_day_" + key).forEach((cb) => {
      cb.onchange = () => {
        r.dates = [...el("view").querySelectorAll(".svc_day_" + key + ":checked")].map((x) => x.value);
        updateSummary(key); refreshCount();
      };
    });
    updateSummary(key);
  });

  el("svc_grades").querySelectorAll("[data-grade]").forEach((btn) => {
    btn.onclick = () => {
      const g = Number(btn.dataset.grade), idx = state.grades.indexOf(g);
      if (idx === -1) state.grades.push(g); else state.grades.splice(idx, 1);
      btn.classList.toggle("active-lang");
      refreshCount();
    };
  });
  el("svc_holiday").oninput = refreshCount;
  el("svc_uni").onchange = refreshCount;
  el("svc_generateBtn").onclick = () => {
    if (!eligible.length) return;
    const btn = el("svc_generateBtn");
    withButtonLoading(btn, am ? "በማመንጨት ላይ..." : "Generating...", () => generateServiceAttendanceReport(eligible, state.holiday.trim()));
  };
  await refreshCount();
}

// Two-column, top-to-bottom numbered roster for printing/checking names
// off at the door. CSS `column-fill: auto` fills column 1 top-to-bottom
// before starting column 2, and the browser's print pagination continues
// that same two-column pattern onto further pages automatically once one
// page's columns are full — no manual per-page row counting needed.
async function generateServiceAttendanceReport(members, holiday) {
  const lang = getLang();
  const title = `${holiday} ${lang === "am" ? "አገልግሎት አቴንዳንስ" : "Service Attendance"}`;
  const dateStr = ethShortDate(todayISO());
  const rows = members.map((m, i) => `<div class="svc-row">${i + 1}. ${m.fullName}</div>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: 'Noto Sans Ethiopic', Arial, sans-serif; color: #222; margin: 0; padding: 14mm 10mm; position: relative; }
  .date-stamp { position: absolute; top: 8mm; right: 10mm; font-size: 11px; color: #555; }
  h1 { font-size: 18px; margin: 0 0 14mm; text-align: center; }
  .cols { column-count: 2; column-gap: 14mm; column-fill: auto; }
  .svc-row { break-inside: avoid; font-size: 13px; padding: 3px 0; border-bottom: 1px solid #eee; }
</style>
</head><body>
  <div class="date-stamp">${dateStr}</div>
  <h1>${title}</h1>
  <div class="cols">${rows}</div>
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

async function exportFamiliesExcel(families, memberMap) {
  if (typeof XLSX === "undefined") { await showAlert("XLSX library not loaded"); return; }
  const rows = families.map((f) => {
    const father = f.fatherId ? memberMap.get(f.fatherId) : null;
    const mother = f.motherId ? memberMap.get(f.motherId) : null;
    const firstSon = f.firstSonId ? memberMap.get(f.firstSonId) : null;
    const children = (f.childrenIds || []).map((id) => memberMap.get(id)).filter(Boolean);
    return {
      "አባት": father?.fullName || "", "የአባት ስልክ": father?.phone || "",
      "እናት": mother?.fullName || "", "የእናት ስልክ": mother?.phone || "",
      "የበኩር ልጅ": firstSon?.fullName || "",
      "ሌሎች ልጆች": children.map((c) => c.fullName).join(", "),
      "የአድራሻ ኮድ": f.addressCode || "",
      "የመጨረሻ ስብሰባ": f.lastMeetingDate || "",
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Families");
  XLSX.writeFile(wb, `finote-families-${todayISO()}.xlsx`);
}

// Add/edit family modal — father/mother/first-son are single-pick search
// boxes, children is a multi-pick list. Typing in any search box filters
// by name OR address substring; the address-code field above them narrows
// every search to that code too, so an admin can type "456" and manually
// eyeball which nearby-but-not-identical addresses (454, 440, 485, ...)
// belong to the same neighborhood — that judgment call stays manual on
// purpose, see the comment above addFamily().
window.openFamilyModal = async function (editId) {
  const family = editId ? await get("families", editId) : null;
  const isEdit = !!family;
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const lang = getLang();

  let fatherId = family?.fatherId || null;
  let motherId = family?.motherId || null;
  let firstSonId = family?.firstSonId || null;
  let childrenIds = family ? [...(family.childrenIds || [])] : [];

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:520px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${isEdit ? (lang === "am" ? "ቤተሰብ አርትዕ" : "Edit Family") : (lang === "am" ? "ቤተሰብ ጨምር" : "Add Family")}</h3>
      <label>${lang === "am" ? "የአድራሻ ኮድ (ለማጣራት)" : "Address code (for filtering)"}</label>
      <input id="fam_addrFilter" class="text-input" placeholder="${lang === "am" ? "ለምሳሌ 456" : "e.g. 456"}" value="${family?.addressCode || ""}">

      <label>${lang === "am" ? "አባት" : "Father"}</label>
      <div id="fam_fatherChip"></div>
      <input id="fam_fatherSearch" class="text-input" placeholder="${lang === "am" ? "ስም ወይም አድራሻ ይፈልጉ" : "Search name or address"}">
      <div id="fam_fatherResults" class="list"></div>

      <label>${lang === "am" ? "እናት" : "Mother"}</label>
      <div id="fam_motherChip"></div>
      <input id="fam_motherSearch" class="text-input" placeholder="${lang === "am" ? "ስም ወይም አድራሻ ይፈልጉ" : "Search name or address"}">
      <div id="fam_motherResults" class="list"></div>

      <label>${lang === "am" ? "የበኩር ልጅ" : "First Son"}</label>
      <div id="fam_sonChip"></div>
      <input id="fam_sonSearch" class="text-input" placeholder="${lang === "am" ? "ስም ወይም አድራሻ ይፈልጉ" : "Search name or address"}">
      <div id="fam_sonResults" class="list"></div>

      <label>${lang === "am" ? "ሌሎች ልጆች" : "Other Children"}</label>
      <div id="fam_childrenChips"></div>
      <input id="fam_childrenSearch" class="text-input" placeholder="${lang === "am" ? "ስም ወይም አድራሻ ይፈልጉ" : "Search name or address"}">
      <div id="fam_childrenResults" class="list"></div>

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="fam_saveBtn" class="btn-primary">${lang === "am" ? "አስቀምጥ" : "Save"}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  function matchesFilter(m, q) {
    const addrFilter = el("fam_addrFilter").value.trim();
    const qq = q.toLowerCase();
    const nameMatch = !qq || m.fullName.toLowerCase().includes(qq) || (m.address || "").toLowerCase().includes(qq);
    const addrMatch = !addrFilter || (m.address || "").includes(addrFilter);
    return nameMatch && addrMatch;
  }

  function renderChip(containerId, id, onRemove) {
    const m = id ? memberMap.get(id) : null;
    el(containerId).innerHTML = m
      ? `<div class="list-row"><div><b>${m.fullName}</b>${m.address ? ` <span class="muted">· ${m.address}</span>` : ""}</div><button class="btn-small" data-remove="1">✕</button></div>`
      : `<p class="muted" style="margin:4px 0;">${lang === "am" ? "አልተመረጠም" : "Not selected"}</p>`;
    if (m) el(containerId).querySelector("[data-remove]").onclick = onRemove;
  }

  function renderChildrenChips() {
    el("fam_childrenChips").innerHTML = childrenIds.length
      ? childrenIds.map((id) => {
          const m = memberMap.get(id);
          return m ? `<div class="list-row"><div>${m.fullName}${m.address ? ` <span class="muted">· ${m.address}</span>` : ""}</div><button class="btn-small" data-remove-child="${id}">✕</button></div>` : "";
        }).join("")
      : `<p class="muted" style="margin:4px 0;">${lang === "am" ? "ገና የለም" : "None yet"}</p>`;
    el("fam_childrenChips").querySelectorAll("[data-remove-child]").forEach((btn) => {
      btn.onclick = () => { childrenIds = childrenIds.filter((x) => x !== btn.dataset.removeChild); renderChildrenChips(); };
    });
  }

  function wireSingleSearch(searchId, resultsId, chipId, setCurrent) {
    let timeout;
    el(searchId).oninput = (e) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const q = e.target.value.trim();
        if (!q) { el(resultsId).innerHTML = ""; return; }
        const results = members.filter((m) => matchesFilter(m, q)).slice(0, 10);
        el(resultsId).innerHTML = results.map((m) => `
          <div class="list-row"><div>${m.fullName}${m.address ? ` <span class="muted">· ${m.address}</span>` : ""}</div><button class="btn-small" data-pick="${m.id}">${lang === "am" ? "ምረጥ" : "Pick"}</button></div>
        `).join("");
        el(resultsId).querySelectorAll("[data-pick]").forEach((btn) => {
          btn.onclick = () => {
            setCurrent(btn.dataset.pick);
            el(searchId).value = "";
            el(resultsId).innerHTML = "";
            renderChip(chipId, btn.dataset.pick, () => { setCurrent(null); renderChip(chipId, null); });
          };
        });
      }, 200);
    };
  }

  renderChip("fam_fatherChip", fatherId, () => { fatherId = null; renderChip("fam_fatherChip", null); });
  renderChip("fam_motherChip", motherId, () => { motherId = null; renderChip("fam_motherChip", null); });
  renderChip("fam_sonChip", firstSonId, () => { firstSonId = null; renderChip("fam_sonChip", null); });
  renderChildrenChips();

  wireSingleSearch("fam_fatherSearch", "fam_fatherResults", "fam_fatherChip", (id) => { fatherId = id; });
  wireSingleSearch("fam_motherSearch", "fam_motherResults", "fam_motherChip", (id) => { motherId = id; });
  wireSingleSearch("fam_sonSearch", "fam_sonResults", "fam_sonChip", (id) => { firstSonId = id; });

  let childTimeout;
  el("fam_childrenSearch").oninput = (e) => {
    clearTimeout(childTimeout);
    childTimeout = setTimeout(() => {
      const q = e.target.value.trim();
      if (!q) { el("fam_childrenResults").innerHTML = ""; return; }
      const results = members.filter((m) => matchesFilter(m, q) && !childrenIds.includes(m.id)).slice(0, 10);
      el("fam_childrenResults").innerHTML = results.map((m) => `
        <div class="list-row"><div>${m.fullName}${m.address ? ` <span class="muted">· ${m.address}</span>` : ""}</div><button class="btn-small" data-add="${m.id}">+</button></div>
      `).join("");
      el("fam_childrenResults").querySelectorAll("[data-add]").forEach((btn) => {
        btn.onclick = () => {
          if (!childrenIds.includes(btn.dataset.add)) childrenIds.push(btn.dataset.add);
          renderChildrenChips();
          el("fam_childrenSearch").value = "";
          el("fam_childrenResults").innerHTML = "";
        };
      });
    }, 200);
  };

  el("fam_saveBtn").onclick = async () => {
    const addressCode = el("fam_addrFilter").value.trim();
    if (isEdit) {
      await updateFamily(family.id, { fatherId, motherId, firstSonId, childrenIds, addressCode });
    } else {
      await addFamily({ fatherId, motherId, firstSonId, childrenIds, addressCode });
    }
    box.remove();
    renderGroups();
  };
};
