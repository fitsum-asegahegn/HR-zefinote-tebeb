/* ፍኖተ ጥበብ — Dashboard: absentee call list, confession due, family meetings,
   plan reminders, call logging.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderDashboard.
   Analytics stay in app.js: computeConsecutiveAbsences,
   computeProgramSpecificAbsences, computeConfessionDue, computeFamilyMeetingsDue.
   Depends on globals: getAll, get, put, getSettings, getSession, todayISO, isoDate,
   addDays, ethLabel, computePlanReminders, markPlanItemDone, showPrompt,
   PROGRAM_DEFS, setTab, t, getLang, el. */

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
  const reason = (await showPrompt(t("dash.callReasonPrompt"))) || "";
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
    const progKeys = PROGRAM_DEFS().map((pd) => pd.key);
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

  const [confessionDue, hrDueAll, settings] = await Promise.all([computeConfessionDue(), computePlanReminders(), getSettings()]);
  // computePlanReminders() returns every item that has ANY next date set
  // (used elsewhere too, e.g. notifications, which filter it themselves) —
  // the dashboard should only surface items actually due now, so marking
  // one Done (which pushes its next date into the future) makes it
  // disappear from here, the same way absentee/confession items do.
  const hrLookaheadCutoff = isoDate(addDays(new Date(), 15));
  const hrDue = hrDueAll.filter((e) => e.nextDate && e.nextDate <= hrLookaheadCutoff);
  const members = await getAll("members");
  const attendance = await getAll("attendance");
  const today = todayISO();
  const todayCount = attendance.filter((a) => a.sessionDate === today).length;
  const thr = settings.absenceThreshold || 3;
  const lang = getLang();

  const families = await getAll("families");
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const childToFamily = new Map();
  families.forEach((f) => {
    if (f.firstSonId) childToFamily.set(f.firstSonId, f);
    (f.childrenIds || []).forEach((cid) => childToFamily.set(cid, f));
  });
  const familyMeetingsDue = await computeFamilyMeetingsDue();
  function familyContactLine(f) {
    const father = f.fatherId ? memberMap.get(f.fatherId) : null;
    const mother = f.motherId ? memberMap.get(f.motherId) : null;
    const part = (label, m) => m ? `${label}: ${m.fullName}${m.phone ? ` <a href="tel:${m.phone.replace(/\s+/g, "")}" onclick="event.stopPropagation();">${m.phone}</a>` : ""}` : "";
    return [part(lang === "am" ? "አባት" : "Father", father), part(lang === "am" ? "እናት" : "Mother", mother)].filter(Boolean).join(" · ");
  }

  const filterOptions = [
    { value: "allCalendar", label: t("dash.filterAllCalendar") },
    { value: "allPrograms", label: t("dash.filterAllPrograms") },
    { value: "timhert", label: t("dash.filterCourse") },
    { value: "mezmur", label: t("dash.filterMezmur") },
    { value: "tselot", label: t("dash.filterTselot") },
    ...PROGRAM_DEFS().filter((pd) => !["timhert", "mezmur", "tselot"].includes(pd.key)).map((pd) => ({ value: pd.key, label: pd.name })),
  ];

  let statLabel;
  if (currentFilter === "allCalendar") {
    statLabel = t("dash.consecutiveAbsent", { n: thr });
  } else {
    statLabel = t("dash.filteredAbsent");
  }

  const summaryStyle = "cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;";

  el("view").innerHTML = `
    <p class="muted" style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;margin-top:0;">📅 ${ethLabel(today)}</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${members.length}</div><div class="stat-label">${t("dash.totalMembers")}</div></div>
      <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-label">${t("dash.todayAttendance")}</div></div>
      <div class="stat-card"><div class="stat-num">${absentees.length}</div><div class="stat-label">${statLabel}</div></div>
      <div class="stat-card"><div class="stat-num">${confessionDue.length}</div><div class="stat-label">${t("dash.confessionDueStat")}</div></div>
    </div>

    <details class="dash-section" open>
      <summary style="${summaryStyle}">${t("dash.callListTitle", { n: thr })} (${absentees.length})</summary>
      <div class="toolbar" style="margin-top:10px;">
        <label class="muted" style="font-size:0.78rem;">${t("dash.filterLabel")}</label>
        <select id="absenceFilter" class="text-input" style="width:auto;flex:1;">
          ${filterOptions.map(o => `<option value="${o.value}" ${o.value===currentFilter?'selected':''}>${o.label}</option>`).join('')}
        </select>
      </div>
      ${absentees.length ? `<div class="list">${absentees.map(a => absenteeRow(a)).join("")}</div>` : `<p class="muted">${t("dash.noAbsentees")}</p>`}
    </details>

    <details class="dash-section">
      <summary style="${summaryStyle}">${t("dash.confessionTitle")} (${confessionDue.length})</summary>
      ${confessionDue.length ? `<div class="list">${confessionDue.map(c => {
        const fam = childToFamily.get(c.member.id);
        const contactLine = fam ? familyContactLine(fam) : "";
        return `
        <div class="list-row">
          <div><b>${c.member.fullName}</b><br><span class="muted">${c.monthsSince === null ? t("dash.confessionUnset") : t("dash.confessionMonthsAgo", { n: c.monthsSince })}</span>${contactLine ? `<br><span class="muted">${contactLine}</span>` : ""}</div>
          <button class="btn-small" onclick="markConfessed('${c.member.id}')">${t("dash.confessDone")}</button>
        </div>`;
      }).join("")}</div>` : `<p class="muted">${t("dash.noConfessionDue")}</p>`}
    </details>

    <details class="dash-section" open>
      <summary style="${summaryStyle}">${(lang === "am" ? "ወርሃዊ የቤተሰብ ስብሰባ" : "Monthly Family Meetings")} (${familyMeetingsDue.length})</summary>
      ${familyMeetingsDue.length ? `<div class="list">${familyMeetingsDue.map(f => {
        const line = familyContactLine(f);
        return `
        <div class="list-row">
          <div>${line || (lang === "am" ? "(ያልተሟላ ቤተሰብ)" : "(incomplete family)")}</div>
          <button class="btn-small" onclick="markFamilyMet('${f.id}')">${lang === "am" ? "ተገናኝተዋል" : "Met"}</button>
        </div>`;
      }).join("")}</div>` : `<p class="muted">${lang === "am" ? "ሁሉም ቤተሰቦች ተገናኝተዋል" : "All families are up to date"}</p>`}
    </details>

    <details class="dash-section">
      <summary style="${summaryStyle}">${t("dash.hrTitle")} (${hrDue.length})</summary>
      <div class="list">${hrDue.map(e => `
        <div class="list-row">
          <div><b>${e.title}</b><br><span class="muted">${e.subUnit} ${e.nextDate ? "— " + t("dash.expected") + ": " + ethLabel(e.nextDate) + " (" + e.nextDate + ")" : ""}</span></div>
          <div class="row-actions">
            ${e.overdue ? `<span class="badge badge-amber">${t("dash.due")}</span>` : ""}
            <button class="btn-small" onclick="doneHrEvent('${e.id}')">${t("dash.markDone")}</button>
          </div>
        </div>`).join("")}</div>
      <p class="muted" style="margin-top:6px;"><a href="#" onclick="setTab('plan');return false;" style="color:var(--amber);">${t("dash.viewFullPlan")}</a></p>
    </details>
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
  const note = (await showPrompt(t("plan.doneNotePrompt"))) || "";
  await markPlanItemDone(id, note);
  renderDashboard();
};
