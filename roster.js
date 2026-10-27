/* ፍኖተ ጥበብ — Duty roster (ምደባ)
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   Depends on globals from db/app code: getAll, put, del, get, addTombstone,
   getSettings, setSetting, isoDate, isExcused, loadExcuseIndex, resolveCallerName,
   syncNow, showAlert, showConfirm, withButtonLoading, escapeHtml, el, t, getLang,
   gregorianToEthiopian, ethLabel, groupsBackBtn, uid.
   Do NOT redeclare HR_DEPT / TREND_PROGRAMS anywhere else. */

// ---------- Duty roster (ምደባ) ----------
// Weekly Sunday Kurban-coordination list (women + men, with one coordinator
// from the HR department) and Monday Awde Mihret service (2 prayer openers,
// a singer, a stage leader). People are picked from the attendance trend of
// Course, Tselot and Mezmur, and rotated fairly using the saved history so
// nobody is assigned every week.
const HR_DEPT = "የሰው ሀብት አስተዳደር ክፍል";
const TREND_PROGRAMS = ["timhert", "tselot", "mezmur"];

function dutyGenderOf(m) {
  const g = String(m.gender || "").trim().toLowerCase();
  if (["ወንድ", "male", "m"].includes(g)) return "M";
  if (["ሴት", "female", "f"].includes(g)) return "F";
  return "";
}
function dutyDayDiff(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

// Attendance rate per member for each of Course/Tselot/Mezmur from startISO
// on (earlier scans were tests). A session counts only if it happened after
// the member joined; an excused session counts as attended.
function computeTrendStats({ members, attendance, excuseIdx, startISO }) {
  const sessions = {}, present = {};
  for (const k of TREND_PROGRAMS) { sessions[k] = new Set(); present[k] = new Map(); }
  for (const a of attendance) {
    if (!sessions[a.programKey]) continue;
    if (startISO && a.sessionDate < startISO) continue;
    sessions[a.programKey].add(a.sessionDate);
    if (!present[a.programKey].has(a.memberId)) present[a.programKey].set(a.memberId, new Set());
    present[a.programKey].get(a.memberId).add(a.sessionDate);
  }
  const stats = new Map();
  for (const m of members) {
    const rates = {}, vals = [];
    for (const k of TREND_PROGRAMS) {
      const dates = [...sessions[k]].filter((d) => !m.joinDate || d >= m.joinDate);
      if (!dates.length) { rates[k] = null; continue; }
      const mine = present[k].get(m.id) || new Set();
      const ok = dates.filter((d) => mine.has(d) || isExcused(excuseIdx, m.id, d, k)).length;
      rates[k] = ok / dates.length;
      vals.push(rates[k]);
    }
    rates.overall = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    stats.set(m.id, rates);
  }
  const sessionCounts = {};
  for (const k of TREND_PROGRAMS) sessionCounts[k] = sessions[k].size;
  return { stats, sessionCounts };
}

// Pure function (no DB access) so it can be tested. history = saved
// assignments [{date, memberId}]. Picking order within a role: people who
// haven't served for the longest first, then fewest total assignments, then
// best attendance, then random. Anyone who served within the rest window is
// skipped (relaxed with a warning only if there aren't enough rested people).
function buildDutyRoster({ members, stats, history, excuseIdx, punishments, sundayISO, mondayISO, perGroup = 5, minRate = 0.6, restWeeks = 1, rng = Math.random }) {
  const warnings = [];
  const hist = history.filter((h) => h.date !== sundayISO && h.date !== mondayISO); // those two dates are being replaced
  // optional `role` limits the history to one role (e.g. only past coordinator turns)
  const countsFor = (role) => {
    const map = new Map();
    hist.forEach((h) => { if (!role || h.role === role) map.set(h.memberId, (map.get(h.memberId) || 0) + 1); });
    return map;
  };
  const lastBefore = (targetISO, role) => {
    const map = new Map();
    hist.forEach((h) => {
      if (role && h.role !== role) return;
      if (h.date < targetISO && (!map.has(h.memberId) || h.date > map.get(h.memberId))) map.set(h.memberId, h.date);
    });
    return map;
  };
  const punishedOn = (id, iso) => punishments.some((x) => x.memberId === id && x.startDate <= iso && iso <= x.endDate);
  const blockDays = restWeeks > 0 ? restWeeks * 7 + 1 : -1;
  const chosen = new Set();

  // sortRole: rotate by turns in that specific role (HR coordinators take turns
  // being coordinator even if they also served as students); the rest rule still
  // looks at ALL roles so nobody serves two weeks running.
  function pick(n, { targetISO, programKey, rateKey, pool, sortRole, avoid }) {
    if (n <= 0) return { picked: [], relaxed: 0, short: 0 };
    const last = lastBefore(targetISO);
    const lastSort = sortRole ? lastBefore(targetISO, sortRole) : last;
    const counts = countsFor(sortRole);
    const jitter = new Map();
    const eligible = pool.filter((m) => {
      if (m.active === false || chosen.has(m.id)) return false;
      if (isExcused(excuseIdx, m.id, targetISO, programKey)) return false;
      if (punishedOn(m.id, targetISO)) return false;
      const r = stats.get(m.id) ? stats.get(m.id)[rateKey] : null;
      return r != null && r >= minRate;
    });
    eligible.forEach((m) => jitter.set(m.id, rng()));
    const since = (m) => (last.has(m.id) ? dutyDayDiff(last.get(m.id), targetISO) : Infinity);
    const sinceSort = (m) => (lastSort.has(m.id) ? dutyDayDiff(lastSort.get(m.id), targetISO) : Infinity);
    const cmp = (a, b) => ((avoid && avoid.has(a.id) ? 1 : 0) - (avoid && avoid.has(b.id) ? 1 : 0)) || (sinceSort(b) - sinceSort(a)) || ((counts.get(a.id) || 0) - (counts.get(b.id) || 0))
      || (stats.get(b.id)[rateKey] - stats.get(a.id)[rateKey]) || (jitter.get(a.id) - jitter.get(b.id));
    const rested = eligible.filter((m) => since(m) > blockDays).sort(cmp);
    const recent = eligible.filter((m) => since(m) <= blockDays).sort(cmp);
    const picked = rested.slice(0, n);
    let relaxed = 0;
    if (picked.length < n) { const more = recent.slice(0, n - picked.length); relaxed = more.length; picked.push(...more); }
    picked.forEach((m) => chosen.add(m.id));
    return { picked, relaxed, short: n - picked.length };
  }

  // --- Sunday: coordinator from the HR department, then women and men ---
  const hrPool = members.filter((m) => m.category === HR_DEPT);
  // HR members already take coordinator turns, so they are only used for other
  // roles when there aren't enough other eligible people (keeps their turns free).
  const avoid = new Set(hrPool.map((m) => m.id));
  let coordinator = null;
  if (!hrPool.length) warnings.push("No members are assigned to the HR department, so no coordinator was chosen.");
  else {
    const r = pick(1, { targetISO: sundayISO, programKey: "kurban", rateKey: "overall", pool: hrPool, sortRole: "coordinator" });
    coordinator = r.picked[0] || null;
    if (!coordinator) warnings.push("No HR member is eligible to coordinate (attendance, permission or punishment).");
    else if (r.relaxed) warnings.push(`${coordinator.fullName} coordinated recently — no other eligible HR member had rested.`);
  }
  let coordGender = coordinator ? (dutyGenderOf(coordinator) || "F") : "";
  if (coordinator && !dutyGenderOf(coordinator)) warnings.push(`${coordinator.fullName} has no gender recorded, so is listed with the women.`);
  const noGender = members.filter((m) => m.active !== false && !dutyGenderOf(m) && stats.get(m.id) && stats.get(m.id).overall != null && stats.get(m.id).overall >= minRate).length;
  if (noGender) warnings.push(`${noGender} well-attending member(s) have no gender recorded and were skipped for the Kurban lists.`);
  const lists = { F: [], M: [] };
  for (const g of ["F", "M"]) {
    const need = perGroup - (coordinator && coordGender === g ? 1 : 0);
    const r = pick(need, { targetISO: sundayISO, programKey: "kurban", rateKey: "overall", pool: members.filter((m) => dutyGenderOf(m) === g), avoid });
    lists[g] = r.picked;
    const label = g === "F" ? "women" : "men";
    if (r.short > 0) warnings.push(`Only ${r.picked.length + (coordinator && coordGender === g ? 1 : 0)} of ${perGroup} ${label} are eligible for Kurban coordination.`);
    if (r.relaxed) warnings.push(`${r.relaxed} of the ${label} served recently — not enough rested members.`);
  }

  // --- Monday: singer (Mezmur trend), stage leader (Course trend), prayer openers (Tselot trend) ---
  const monday = (n, rateKey, what) => {
    const r = pick(n, { targetISO: mondayISO, programKey: "awdemihret", rateKey, pool: members, avoid });
    if (r.short > 0) warnings.push(`Not enough eligible members for ${what} (${r.picked.length} of ${n}).`);
    if (r.relaxed) warnings.push(`${what}: ${r.relaxed} person(s) served recently — not enough rested members.`);
    return r.picked;
  };
  const singer = monday(1, "mezmur", "the singer")[0] || null;
  const stage = monday(1, "timhert", "the stage leader")[0] || null;
  const prayer = monday(2, "tselot", "the prayer openers");

  return { women: lists.F, men: lists.M, coordinator, coordGender, prayer, singer, stage, warnings };
}

function ethDutyShort(iso) {
  const e = gregorianToEthiopian(new Date(iso + "T00:00:00"));
  return `${e.day}/${e.month}/${String(e.year).slice(-2)}`;
}
function ethDutyFull(iso) {
  const e = gregorianToEthiopian(new Date(iso + "T00:00:00"));
  return `${String(e.day).padStart(2, "0")}/${String(e.month).padStart(2, "0")}/${e.year}`;
}
// Copy-paste text in the same shape as the channel template.
function formatDutyText(r, { sundayISO, mondayISO, time, phone }) {
  const coordId = r.coordinator ? r.coordinator.id : null;
  const women = r.coordinator && r.coordGender === "F" ? [...r.women, r.coordinator] : r.women;
  const men = r.coordinator && r.coordGender === "M" ? [...r.men, r.coordinator] : r.men;
  const L = (list) => list.map((m, i) => `    \t${i + 1}.${m.fullName}${m.id === coordId ? " (አስተባባሪ)" : ""}`).join("\n");
  return [
    `እሁድ ${ethDutyShort(sundayISO)} ቁርባን አስተባባሪ ተማሪዎች`,
    L(women), "", L(men), "",
    `ማሳሰቢያ፦ መገኛ ሰዓት ${time} ነው አቴንዳስ አለው መቅረት አይቻልም የማትችሉ ሰው ቀይሩ ወንዶች ወንድ ተኩ ሴቶችም ሴት ነው መተካት የሚቻለው ቅሬታ ካለ የሰው ሀብት አስተዳደሩን አናግሩ`,
    `ለማስፈቀድ ${phone} በዚህ ደውላቹ አሳውቁ`,
    `መልካም አዳር።`, "", "",
    `ሰኞ በ ${ethDutyFull(mondayISO)} ዓ.ም የ አውደ ምሕረት ጸሎት ከፋቾች:`,
    ...r.prayer.map((m) => ` \t${m.fullName}`),
    `መዝሙር ዘማሪ: ${r.singer ? r.singer.fullName : "—"}`,
    `መድረክ መሪ: ${r.stage ? r.stage.fullName : "—"}`,
    `መገኘት መትችሉ ካላችሁ ሰው ተኩ።`,
  ].join("\n");
}

async function replaceDutyGroup(date, kind) {
  const all = await getAll("dutyAssignments");
  for (const r of all.filter((x) => x.date === date && x.kind === kind)) {
    await del("dutyAssignments", r.id);
    await addTombstone("duty_assignments", r.id);
  }
}
// Saving is what makes next week's rotation fair, so it replaces whatever was
// saved before for those two dates.
async function saveDutyRoster({ roster, sundayISO, mondayISO }) {
  const by = await resolveCallerName();
  await replaceDutyGroup(sundayISO, "kurban");
  await replaceDutyGroup(mondayISO, "awde");
  const add = async (date, kind, role, m) => {
    if (!m) return;
    await put("dutyAssignments", { id: uid(), date, kind, role, memberId: m.id, createdBy: by, createdAt: new Date().toISOString(), synced: false });
  };
  if (roster.coordinator) await add(sundayISO, "kurban", "coordinator", roster.coordinator);
  for (const m of [...roster.women, ...roster.men]) await add(sundayISO, "kurban", "student", m);
  for (const m of roster.prayer) await add(mondayISO, "awde", "prayer", m);
  await add(mondayISO, "awde", "singer", roster.singer);
  await add(mondayISO, "awde", "stage", roster.stage);
  syncNow();
}

window.deleteDutyGroup = async (date, kind) => {
  const lang = getLang();
  if (!(await showConfirm(lang === "am" ? "ይህን ምደባ ከመዝገብ መሰረዝ ይፈልጋሉ?" : "Remove this roster from the history?"))) return;
  await replaceDutyGroup(date, kind);
  renderDutyRoster();
  syncNow();
};

async function renderDutyRoster() {
  const lang = getLang();
  const am = lang === "am";
  const settings = await getSettings();
  const attendanceAll = await getAll("attendance");
  const scansByDate = new Map();
  attendanceAll.forEach((a) => scansByDate.set(a.sessionDate, (scansByDate.get(a.sessionDate) || 0) + 1));
  const dates = [...scansByDate.keys()].sort();
  const nextDow = (dow) => { const d = new Date(); d.setHours(0, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow); return isoDate(d); };
  const sv = (key, fallback) => (settings[key] !== undefined && settings[key] !== "" ? settings[key] : fallback);
  window._dutyRoster = null;

  el("view").innerHTML = `
    ${groupsBackBtn()}
    <h3 class="section-title">${am ? "ምደባ" : "Duty Roster"}</h3>
    <p class="muted">${am
      ? "የቁርባን ማስተባበር (እሁድ) እና የአውደ ምሕረት አገልግሎት (ሰኞ) ምደባ። ከትምህርት፣ ጸሎትና ዝማሬ የመገኘት አዝማሚያ ተመርጦ፣ ማንም በየሳምንቱ እንዳይመደብ በተራ ይመደባል። አስተባባሪው ከሰው ሀብት ክፍል አባላት ይመረጣል።"
      : "Sunday Kurban coordination and Monday Awde Mihret service. People are picked from the Course, Tselot and Mezmur attendance trend and rotated so nobody is assigned every week. The coordinator comes from the HR department members."}</p>

    <label>${am ? "እሁድ (ቁርባን ማስተባበር)" : "Sunday (Kurban coordination)"}</label>
    <input id="dr_sunday" type="date" class="text-input" value="${nextDow(0)}">
    <label>${am ? "ሰኞ (አውደ ምሕረት)" : "Monday (Awde Mihret)"}</label>
    <input id="dr_monday" type="date" class="text-input" value="${nextDow(1)}">
    <p class="muted" id="dr_ethHint" style="margin-top:-6px;"></p>

    <label>${am ? "መገኘት መቁጠር የሚጀምረው ከ" : "Count attendance starting from"}</label>
    <select id="dr_start" class="text-input">
      <option value="">${am ? "ሁሉም ክፍለ ጊዜዎች" : "All sessions"}</option>
      ${dates.map((d) => `<option value="${d}" ${d === sv("rosterStartDate", "") ? "selected" : ""}>${d} · ${ethLabel(d)} · ${scansByDate.get(d)} ${am ? "ቅኝቶች" : "scans"}</option>`).join("")}
    </select>
    <p class="muted" style="margin-top:-6px;">${am ? "የመጀመሪያውን እውነተኛ ክፍለ ጊዜ ይምረጡ — ከዚያ በፊት ያሉ የሙከራ ቅኝቶች አይቆጠሩም።" : "Pick the first real session — earlier test scans are ignored."}</p>

    <label>${am ? "በእያንዳንዱ ዝርዝር ውስጥ ያሉ ተማሪዎች (አስተባባሪን ጨምሮ)" : "Students per list (coordinator included)"}</label>
    <input id="dr_perGroup" type="number" min="1" max="15" class="text-input" value="${sv("rosterPerGroup", 5)}">
    <label>${am ? "ዝቅተኛ የመገኘት መጠን %" : "Minimum attendance %"}</label>
    <input id="dr_minRate" type="number" min="0" max="100" class="text-input" value="${sv("rosterMinRate", 60)}">
    <label>${am ? "በተመደቡ መካከል የእረፍት ሳምንታት" : "Rest weeks between assignments"}</label>
    <select id="dr_rest" class="text-input">
      ${[0, 1, 2, 3].map((n) => `<option value="${n}" ${String(sv("rosterRestWeeks", 1)) === String(n) ? "selected" : ""}>${n}</option>`).join("")}
    </select>
    <label>${am ? "መገኛ ሰዓት" : "Meeting time"}</label>
    <input id="dr_time" class="text-input" value="${escapeHtml(sv("rosterTime", "12:30"))}">
    <label>${am ? "ለማስፈቀድ ስልክ" : "Phone for permission"}</label>
    <input id="dr_phone" class="text-input" value="${escapeHtml(sv("rosterPhone", "0966016340"))}">

    <button id="dr_generate" class="btn-primary" style="width:100%;margin-bottom:12px;">${am ? "ምደባ አውጣ" : "Generate roster"}</button>
    <div id="dr_warn"></div>
    <div id="dr_result" style="display:none;">
      <textarea id="dr_out" rows="24" class="text-input" style="font-family:inherit;"></textarea>
      <div class="toolbar">
        <button id="dr_copySave" class="btn-primary">${am ? "ቅዳ እና መዝግብ" : "Copy & save"}</button>
        <button id="dr_copy" class="btn-secondary">${am ? "ቅዳ ብቻ" : "Copy only"}</button>
        <button id="dr_regen" class="btn-secondary">${am ? "እንደገና አውጣ" : "Regenerate"}</button>
      </div>
      <p class="muted">${am ? "«ቅዳ እና መዝግብ» ማስቀመጥ የሚቀጥለው ሳምንት ምደባ ፍትሃዊ እንዲሆን ያደርጋል። ጽሑፉን ከቀየሩት መዝገቡ የሚያሳየው ከተፈጠረው ምደባ ነው።" : "\"Copy & save\" records these assignments so next week's rotation stays fair. If you edit the text, the saved history still reflects the generated roster."}</p>
      <details id="dr_details"><summary class="muted">${am ? "ለምን እነዚህ ሰዎች?" : "Why these people?"}</summary><div class="list" id="dr_why" style="margin-top:8px;"></div></details>
    </div>

    <h3 class="section-title">${am ? "የተመዘገቡ ምደባዎች" : "Saved rosters"}</h3>
    <div class="list" id="dr_history"></div>`;

  const updateHint = () => {
    const s = el("dr_sunday").value, m = el("dr_monday").value;
    el("dr_ethHint").textContent = [s && `${am ? "እሁድ" : "Sun"} ${ethLabel(s)}`, m && `${am ? "ሰኞ" : "Mon"} ${ethLabel(m)}`].filter(Boolean).join(" · ");
  };
  el("dr_sunday").onchange = updateHint;
  el("dr_monday").onchange = updateHint;
  updateHint();

  async function drawHistory() {
    const [rows, members] = await Promise.all([getAll("dutyAssignments"), getAll("members")]);
    const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
    const groups = new Map();
    rows.forEach((r) => { const k = r.date + "|" + r.kind; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const list = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 16);
    el("dr_history").innerHTML = list.length ? list.map(([k, rs]) => {
      const [date, kind] = k.split("|");
      const names = (role) => rs.filter((r) => r.role === role).map((r) => escapeHtml(nameOf.get(r.memberId) || "?")).join(", ");
      const body = kind === "kurban"
        ? `${am ? "አስተባባሪ" : "Coordinator"}: ${names("coordinator") || "—"}<br>${am ? "ተማሪዎች" : "Students"}: ${names("student") || "—"}`
        : `${am ? "ጸሎት" : "Prayer"}: ${names("prayer") || "—"}<br>${am ? "ዘማሪ" : "Singer"}: ${names("singer") || "—"} · ${am ? "መድረክ መሪ" : "Stage"}: ${names("stage") || "—"}`;
      return `
        <div class="list-row" style="align-items:flex-start;">
          <div style="flex:1;">
            <b>${kind === "kurban" ? (am ? "እሁድ ቁርባን" : "Sunday Kurban") : (am ? "ሰኞ አውደ ምሕረት" : "Monday Awde Mihret")}</b> · <span class="muted">${date} · ${ethLabel(date)}</span><br>
            <span class="muted">${body}</span>
          </div>
          <button class="btn-small" onclick="deleteDutyGroup('${date}','${kind}')">${t("members.delete")}</button>
        </div>`;
    }).join("") : `<p class="muted">${am ? "ገና ምንም ምደባ አልተመዘገበም" : "No rosters saved yet"}</p>`;
  }
  await drawHistory();

  async function generate() {
    const sundayISO = el("dr_sunday").value, mondayISO = el("dr_monday").value;
    if (!sundayISO || !mondayISO) { await showAlert(am ? "ቀኖቹን ያስገቡ" : "Please pick both dates."); return; }
    const startISO = el("dr_start").value;
    const perGroup = Math.min(15, Math.max(1, parseInt(el("dr_perGroup").value, 10) || 5));
    const minPct = Math.min(100, Math.max(0, Number(el("dr_minRate").value) || 0));
    const restWeeks = Math.min(3, Math.max(0, parseInt(el("dr_rest").value, 10) || 0));
    const time = el("dr_time").value.trim() || "12:30";
    const phone = el("dr_phone").value.trim();
    await setSetting("rosterStartDate", startISO);
    await setSetting("rosterPerGroup", perGroup);
    await setSetting("rosterMinRate", minPct);
    await setSetting("rosterRestWeeks", restWeeks);
    await setSetting("rosterTime", time);
    await setSetting("rosterPhone", phone);

    const [members, attendance, excuseIdx, punishments, history] = await Promise.all([
      getAll("members"), getAll("attendance"), loadExcuseIndex(), getAll("punishments"), getAll("dutyAssignments"),
    ]);
    const { stats, sessionCounts } = computeTrendStats({ members, attendance, excuseIdx, startISO });
    const total = TREND_PROGRAMS.reduce((sum, k) => sum + sessionCounts[k], 0);
    el("dr_result").style.display = "none";
    if (!total) {
      el("dr_warn").innerHTML = `<p class="muted" style="color:var(--amber);">⚠ ${am ? "ከተመረጠው ቀን ጀምሮ የትምህርት፣ ጸሎት ወይም ዝማሬ መገኘት አልተገኘም።" : "No Course, Tselot or Mezmur attendance found from that date."}</p>`;
      return;
    }
    const roster = buildDutyRoster({ members, stats, history, excuseIdx, punishments, sundayISO, mondayISO, perGroup, minRate: minPct / 100, restWeeks });
    window._dutyRoster = { roster, sundayISO, mondayISO };
    const info = `${am ? "የተቆጠሩ ክፍለ ጊዜዎች" : "Sessions counted"}: ${am ? "ትምህርት" : "Course"} ${sessionCounts.timhert} · ${am ? "ጸሎት" : "Tselot"} ${sessionCounts.tselot} · ${am ? "ዝማሬ" : "Mezmur"} ${sessionCounts.mezmur}`;
    el("dr_warn").innerHTML = `<p class="muted">${info}</p>` + roster.warnings.map((w) => `<p class="muted" style="color:var(--amber);">⚠ ${escapeHtml(w)}</p>`).join("");
    el("dr_out").value = formatDutyText(roster, { sundayISO, mondayISO, time, phone });

    const lastServed = new Map();
    history.forEach((h) => { if (!lastServed.has(h.memberId) || h.date > lastServed.get(h.memberId)) lastServed.set(h.memberId, h.date); });
    const pct = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
    const picks = [
      ...(roster.coordinator ? [[am ? "አስተባባሪ" : "Coordinator", roster.coordinator]] : []),
      ...[...roster.women, ...roster.men].map((m) => [am ? "ተማሪ" : "Student", m]),
      ...roster.prayer.map((m) => [am ? "ጸሎት" : "Prayer", m]),
      ...(roster.singer ? [[am ? "ዘማሪ" : "Singer", roster.singer]] : []),
      ...(roster.stage ? [[am ? "መድረክ መሪ" : "Stage", roster.stage]] : []),
    ];
    el("dr_why").innerHTML = picks.map(([role, m]) => {
      const s = stats.get(m.id) || {};
      return `<div class="list-row"><div><b>${escapeHtml(m.fullName)}</b> <span class="muted">· ${role}</span><br><span class="muted">${am ? "ትምህርት" : "Course"} ${pct(s.timhert)} · ${am ? "ጸሎት" : "Tselot"} ${pct(s.tselot)} · ${am ? "ዝማሬ" : "Mezmur"} ${pct(s.mezmur)} · ${am ? "ለመጨረሻ ጊዜ" : "last served"}: ${lastServed.get(m.id) || (am ? "በጭራሽ" : "never")}</span></div></div>`;
    }).join("");
    el("dr_result").style.display = "block";
  }

  async function copyOut() {
    const text = el("dr_out").value;
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { try { el("dr_out").select(); return document.execCommand("copy"); } catch (e2) { return false; } }
  }
  const toast = (msg) => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); };

  el("dr_generate").onclick = (e) => withButtonLoading(e.currentTarget, am ? "በማውጣት ላይ..." : "Generating...", generate);
  el("dr_regen").onclick = (e) => withButtonLoading(e.currentTarget, am ? "በማውጣት ላይ..." : "Generating...", generate);
  el("dr_copy").onclick = async () => toast((await copyOut()) ? (am ? "ተቀድቷል" : "Copied") : (am ? "መቅዳት አልተቻለም — ጽሑፉን ይምረጡና ይቅዱ" : "Couldn't copy — select the text and copy it"));
  el("dr_copySave").onclick = async () => {
    if (!window._dutyRoster) return;
    await saveDutyRoster(window._dutyRoster);
    const copied = await copyOut();
    toast(copied ? (am ? "ተቀድቶ ተመዝግቧል" : "Copied & saved") : (am ? "ተመዝግቧል (መቅዳት አልተቻለም)" : "Saved (couldn't copy — select the text and copy it)"));
    await drawHistory();
  };
}
