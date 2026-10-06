/* ---------- Supabase client + auth ---------- */
let sbClient = null;

function getSupabaseConfig() {
  // localStorage (set via the in-app Settings form) always wins if present,
  // so an admin can still override or reconnect to a different project.
  // Otherwise fall back to config.js, which lets a whole team skip the
  // copy-paste step entirely once it's filled in at deploy time.
  const deployCfg = window.FINOTE_CONFIG || {};
  return {
    url: localStorage.getItem("ftw_sb_url") || deployCfg.SUPABASE_URL || "",
    key: localStorage.getItem("ftw_sb_key") || deployCfg.SUPABASE_ANON_KEY || "",
  };
}
function saveSupabaseConfig(url, key) {
  localStorage.setItem("ftw_sb_url", url);
  localStorage.setItem("ftw_sb_key", key);
}
function clearSupabaseConfig() {
  localStorage.removeItem("ftw_sb_url");
  localStorage.removeItem("ftw_sb_key");
  localStorage.removeItem("ftw_skip_cloud");
  sbClient = null;
}
function initSupabaseClient() {
  const cfg = getSupabaseConfig();
  if (cfg.url && cfg.key && window.supabase) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    } catch (e) {
      sbClient = null;
    }
  } else {
    sbClient = null;
  }
}
async function getSession() {
  if (!sbClient) return null;
  try {
    const { data } = await sbClient.auth.getSession();
    return data.session || null;
  } catch (e) {
    return null;
  }
}

function skipCloudFlag() {
  return localStorage.getItem("ftw_skip_cloud") === "1";
}
function setSkipCloud(v) {
  localStorage.setItem("ftw_skip_cloud", v ? "1" : "0");
}

// ---------- Screens ----------
function renderSupabaseSetup() {
  const cfg = getSupabaseConfig();
  el("view").innerHTML = `
    <div class="auth-wrap">
      <h2>${t("auth.setupTitle")}</h2>
      <p class="muted">${t("auth.setupDesc")}</p>
      <input id="su_url" class="text-input" placeholder="${t("auth.urlPlaceholder")}" value="${cfg.url}"/>
      <input id="su_key" class="text-input" placeholder="${t("auth.keyPlaceholder")}" value="${cfg.key}"/>
      <button id="su_continue" class="btn-primary" style="width:100%;">${t("auth.continue")}</button>
    </div>
  `;
  el("su_continue").onclick = () => {
    const url = el("su_url").value.trim();
    const key = el("su_key").value.trim();
    if (!url || !key) return;
    saveSupabaseConfig(url, key);
    setSkipCloud(false);
    boot();
  };
}

function renderAuthScreen() {
  let mode = "in"; // "in" | "up"
  function draw() {
    el("view").innerHTML = `
      <div class="auth-wrap">
        <h2>${mode === "in" ? t("auth.signInTitle") : t("auth.signUpTitle")}</h2>
        <input id="a_email" class="text-input" type="email" placeholder="${t("auth.email")}"/>
        <input id="a_pass" class="text-input" type="password" placeholder="${t("auth.password")}"/>
        <div id="a_err" class="muted" style="color:var(--red);min-height:18px;"></div>
        <button id="a_submit" class="btn-primary" style="width:100%;margin-bottom:10px;">${mode === "in" ? t("auth.signInBtn") : t("auth.signUpBtn")}</button>
        <button id="a_switch" class="btn-secondary" style="width:100%;">${mode === "in" ? t("auth.switchToSignUp") : t("auth.switchToSignIn")}</button>
      </div>
    `;
    el("a_switch").onclick = () => { mode = mode === "in" ? "up" : "in"; draw(); };
    el("a_submit").onclick = async () => {
      const email = el("a_email").value.trim();
      const password = el("a_pass").value;
      const errEl = el("a_err");
      errEl.textContent = "";
      if (!email || !password) return;
      try {
        if (mode === "in") {
          const { error } = await sbClient.auth.signInWithPassword({ email, password });
          if (error) { errEl.textContent = t("auth.error") + " " + error.message; return; }
          boot();
        } else {
          const { error } = await sbClient.auth.signUp({ email, password });
          if (error) { errEl.textContent = t("auth.error") + " " + error.message; return; }
          errEl.style.color = "var(--green)";
          errEl.textContent = t("auth.signUpSuccess");
          mode = "in";
        }
      } catch (e) {
        errEl.textContent = t("auth.error") + " " + e.message;
      }
    };
  }
  draw();
}

function renderOfflineNoSession() {
  el("view").innerHTML = `
    <div class="auth-wrap">
      <h2>${t("auth.signInTitle")}</h2>
      <p class="muted">${t("auth.offlineNoSession")}</p>
      <button id="o_retry" class="btn-primary" style="width:100%;margin-bottom:10px;">${t("auth.tryAgainOnline")}</button>
      <button id="o_skip" class="btn-secondary" style="width:100%;">${t("auth.useOfflineAnyway")}</button>
    </div>
  `;
  el("o_retry").onclick = () => boot();
  el("o_skip").onclick = () => { window.currentUserRole = "member"; enterApp(); };
}

async function signOut() {
  if (sbClient) {
    try { await sbClient.auth.signOut(); } catch (e) {}
  }
  sessionStorage.removeItem("ftw_bio_unlocked");
  boot();
}
window.signOut = signOut;

// ---------- Mirror auth into IndexedDB for the service worker's background sync ----------
async function mirrorAuthForSW(session) {
  if (!session) return;
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.key) return;
  try {
    await setSetting("sbUrlMirror", cfg.url);
    await setSetting("sbKeyMirror", cfg.key);
    await setSetting("sbAccessTokenMirror", session.access_token);
  } catch (e) {}
}

// ---------- Role-based access control (client-side reflection of DB role) ----------
// Roles: pending (just signed up, no access) < scanner (attendance only,
// names visible) < member (day-to-day HR work) < admin. Real enforcement is
// the RLS policies in supabase-schema.sql; this only drives the UI.
const ROLE_NAMES = ["pending", "scanner", "member", "admin"];
window.currentUserRole = "pending";
async function fetchUserRole(session) {
  if (!sbClient || !session) { window.currentUserRole = "pending"; return; }
  const cacheKey = "ftw_role_" + session.user.id;
  try {
    const { data, error } = await sbClient.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const role = data && ROLE_NAMES.includes(data.role) ? data.role : "pending";
    window.currentUserRole = role;
    try { localStorage.setItem(cacheKey, role); } catch (e) {}
  } catch (e) {
    // Couldn't reach the server (e.g. offline): reuse the last role this
    // device saw for this user; if there never was one, least privilege.
    const cached = localStorage.getItem(cacheKey);
    window.currentUserRole = ROLE_NAMES.includes(cached) ? cached : "pending";
  }
}

// ---------- Display name (separate table from roles — see supabase-schema.sql) ----------
window.currentDisplayName = "";
async function fetchDisplayName(session) {
  if (!sbClient || !session) { window.currentDisplayName = ""; return; }
  try {
    const { data } = await sbClient.from("profiles").select("display_name").eq("user_id", session.user.id).maybeSingle();
    window.currentDisplayName = (data && data.display_name) || "";
  } catch (e) {
    window.currentDisplayName = "";
  }
}
async function saveDisplayName(name) {
  const session = await getSession();
  if (!sbClient || !session) return false;
  try {
    const { error } = await sbClient.from("profiles").upsert({ user_id: session.user.id, display_name: name.trim() });
    if (!error) { window.currentDisplayName = name.trim(); return true; }
    return false;
  } catch (e) {
    return false;
  }
}
window.saveDisplayName = saveDisplayName;

// ---------- Cloud sync (Supabase tables: members, attendance, hr_events, families, dept_heads) ----------
function mapMemberToRemote(m) {
  return {
    id: m.id, full_name: m.fullName, phone: m.phone || null, category: m.category || null, grade: m.grade || null,
    qr_id: m.qrId, last_confession_date: m.lastConfessionDate, join_date: m.joinDate, active: m.active !== false,
    call_log: m.callLog || null, call_history: m.callHistory || [],
    christian_name: m.christianName || null, gender: m.gender || null, age: m.age ?? null,
    alt_phone: m.altPhone || null, address: m.address || null, confession_father: m.confessionFather || null,
    parish: m.parish || null, parent_name: m.parentName || null, parent_phone: m.parentPhone || null,
    education_level: m.educationLevel || null, spiritual_education: m.spiritualEducation || null,
    dept1: m.dept1 || null, dept2: m.dept2 || null, dept3: m.dept3 || null,
    photo: m.photo || null,
    occupation_status: m.occupationStatus || null, job_title: m.jobTitle || null,
    is_university_student: !!m.isUniversityStudent,
  };
}
function mapRemoteToMember(r) {
  return {
    id: r.id, fullName: r.full_name, phone: r.phone || "", category: r.category || "", grade: r.grade || null,
    qrId: r.qr_id, lastConfessionDate: r.last_confession_date, joinDate: r.join_date,
    active: r.active !== false, callLog: r.call_log || null, callHistory: r.call_history || [], synced: true,
    christianName: r.christian_name || "", gender: r.gender || "", age: r.age ?? null,
    altPhone: r.alt_phone || "", address: r.address || "", confessionFather: r.confession_father || "",
    parish: r.parish || "", parentName: r.parent_name || "", parentPhone: r.parent_phone || "",
    educationLevel: r.education_level || "", spiritualEducation: r.spiritual_education || "",
    dept1: r.dept1 || "", dept2: r.dept2 || "", dept3: r.dept3 || "",
    photo: r.photo || null,
    occupationStatus: r.occupation_status || "", jobTitle: r.job_title || "",
    isUniversityStudent: r.is_university_student === true,
  };
}
function mapAttendanceToRemote(a, userId) {
  return {
    id: a.id, member_id: a.memberId, program_key: a.programKey, session_date: a.sessionDate,
    ts: a.timestamp, status: a.status, device_id: a.deviceId, created_by: userId || null,
  };
}
function mapRemoteToAttendance(r) {
  return {
    id: r.id, memberId: r.member_id, programKey: r.program_key, sessionDate: r.session_date,
    timestamp: r.ts, status: r.status, deviceId: r.device_id, synced: true,
  };
}
function mapFamilyToRemote(f) {
  return {
    id: f.id, father_id: f.fatherId || null, mother_id: f.motherId || null, first_son_id: f.firstSonId || null,
    children_ids: f.childrenIds || [], address_code: f.addressCode || null,
    last_meeting_date: f.lastMeetingDate || null, meeting_log: f.meetingLog || [],
  };
}
function mapRemoteToFamily(r) {
  return {
    id: r.id, fatherId: r.father_id || null, motherId: r.mother_id || null, firstSonId: r.first_son_id || null,
    childrenIds: r.children_ids || [], addressCode: r.address_code || "",
    lastMeetingDate: r.last_meeting_date || null, meetingLog: r.meeting_log || [], synced: true,
  };
}

function mapExcuseToRemote(e) {
  return {
    id: e.id, member_id: e.memberId, start_date: e.startDate, end_date: e.endDate,
    reason: e.reason || null, program_keys: e.programKeys || [], created_by_name: e.createdBy || null,
  };
}
function mapRemoteToExcuse(r) {
  return {
    id: r.id, memberId: r.member_id, startDate: r.start_date, endDate: r.end_date,
    reason: r.reason || "", programKeys: r.program_keys || [], createdBy: r.created_by_name || "", synced: true,
  };
}

function mapPunishmentToRemote(x) {
  return {
    id: x.id, member_id: x.memberId, start_date: x.startDate, end_date: x.endDate,
    reason: x.reason || null, created_by_name: x.createdBy || null,
  };
}
function mapRemoteToPunishment(r) {
  return {
    id: r.id, memberId: r.member_id, startDate: r.start_date, endDate: r.end_date,
    reason: r.reason || "", createdBy: r.created_by_name || "", synced: true,
  };
}

function mapAdviceToRemote(x) {
  return {
    id: x.id, member_id: x.memberId, advised_on: x.date,
    fault: x.fault || null, advice: x.advice || null, advised_by: x.advisedBy || null,
  };
}
function mapRemoteToAdvice(r) {
  return {
    id: r.id, memberId: r.member_id, date: r.advised_on,
    fault: r.fault || "", advice: r.advice || "", advisedBy: r.advised_by || "", synced: true,
  };
}

function mapDutyToRemote(x) {
  return { id: x.id, duty_date: x.date, kind: x.kind, role: x.role, member_id: x.memberId, created_by_name: x.createdBy || null };
}
function mapRemoteToDuty(r) {
  return { id: r.id, date: r.duty_date, kind: r.kind, role: r.role, memberId: r.member_id, createdBy: r.created_by_name || "", synced: true };
}

async function syncNow() {
  const statusEl = el("syncStatus");
  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };

  if (!sbClient) { setStatus(t("sync.noCloud")); return; }
  if (!navigator.onLine) { setStatus(t("sync.offline")); return; }
  const session = await getSession();
  if (!session) { setStatus(t("sync.notSignedIn")); return; }

  // Re-check the role on every sync so a promotion/demotion takes effect
  // without waiting for the next sign-in.
  const roleBefore = window.currentUserRole;
  await fetchUserRole(session);
  const role = window.currentUserRole;
  if (role !== roleBefore && typeof onRoleChanged === "function") onRoleChanged();
  if (role === "pending") {
    setStatus(getLang() === "am" ? "የአስተዳዳሪ ፈቃድ በመጠበቅ ላይ" : "Waiting for admin approval");
    return;
  }
  // scanners only record attendance (and read member names); the DB
  // rejects their writes to everything else, so don't even try.
  const canWrite = role === "member" || role === "admin";

  setStatus(t("sync.working"));
  try {
    if (canWrite) {
      // push deletes first. Deleting is a soft-delete on the server
      // (deleted_at set) rather than a hard DELETE, so every other device
      // can learn about it through the normal incremental pull below, and a
      // fresh install can't resurrect the record. Only admins can set
      // deleted_at (enforced by a DB trigger, see supabase-schema.sql).
      const pendingTombs = (await getAll("tombstones")).filter((x) => !x.synced);
      for (const tomb of pendingTombs) {
        const { error } = await sbClient.from(tomb.table)
          .update({ deleted_at: tomb.deletedAt }).eq("id", tomb.recordId);
        if (!error) { tomb.synced = true; await put("tombstones", tomb); }
      }

      // push members
      const members = await getAll("members");
      const pendingMembers = members.filter((m) => !m.synced);
      if (pendingMembers.length) {
        const { error } = await sbClient.from("members").upsert(pendingMembers.map(mapMemberToRemote));
        if (!error) for (const m of pendingMembers) { m.synced = true; await put("members", m); }
      }
      // push permissions (after members, since each references a member)
      const excuses = await getAll("excuses");
      const pendingExcuses = excuses.filter((x) => !x.synced);
      if (pendingExcuses.length) {
        const { error } = await sbClient.from("excuses").upsert(pendingExcuses.map(mapExcuseToRemote));
        if (!error) for (const x of pendingExcuses) { x.synced = true; await put("excuses", x); }
      }
      // push punishments
      const punishments = await getAll("punishments");
      const pendingPunish = punishments.filter((x) => !x.synced);
      if (pendingPunish.length) {
        const { error } = await sbClient.from("punishments").upsert(pendingPunish.map(mapPunishmentToRemote));
        if (!error) for (const x of pendingPunish) { x.synced = true; await put("punishments", x); }
      }
      // push advice records
      const adviceAll = await getAll("advice");
      const pendingAdvice = adviceAll.filter((x) => !x.synced);
      if (pendingAdvice.length) {
        const { error } = await sbClient.from("advice").upsert(pendingAdvice.map(mapAdviceToRemote));
        if (!error) for (const x of pendingAdvice) { x.synced = true; await put("advice", x); }
      }
      // push duty roster history (keeps the rotation fair across devices)
      const dutyAll = await getAll("dutyAssignments");
      const pendingDuty = dutyAll.filter((x) => !x.synced);
      if (pendingDuty.length) {
        const { error } = await sbClient.from("duty_assignments").upsert(pendingDuty.map(mapDutyToRemote));
        if (!error) for (const x of pendingDuty) { x.synced = true; await put("dutyAssignments", x); }
      }
    }
    // push attendance (all roles)
    const attendance = await getAll("attendance");
    const pendingAtt = attendance.filter((a) => !a.synced);
    if (pendingAtt.length) {
      const { error } = await sbClient.from("attendance")
        .upsert(pendingAtt.map((a) => mapAttendanceToRemote(a, session.user.id)), { onConflict: "member_id,session_date,program_key" });
      if (!error) for (const a of pendingAtt) { a.synced = true; await put("attendance", a); }
    }
    if (canWrite) {
      // push families
      const families = await getAll("families");
      const pendingFamilies = families.filter((f) => !f.synced);
      if (pendingFamilies.length) {
        const { error } = await sbClient.from("families").upsert(pendingFamilies.map(mapFamilyToRemote));
        if (!error) for (const f of pendingFamilies) { f.synced = true; await put("families", f); }
      }
      // push + pull department chairs — small table, always synced in full
      // rather than tracked with a per-key dirty flag (see getDeptHeads/setDeptHead in app.js)
      const deptHeads = await getDeptHeads();
      const deptHeadRows = Object.entries(deptHeads).map(([dept, head_name]) => ({ dept, head_name }));
      if (deptHeadRows.length) {
        await sbClient.from("dept_heads").upsert(deptHeadRows);
      }
      const { data: remoteDeptHeads } = await sbClient.from("dept_heads").select("*");
      if (remoteDeptHeads) {
        const mergedHeads = { ...deptHeads };
        remoteDeptHeads.forEach((r) => { mergedHeads[r.dept] = r.head_name; });
        await setSetting("deptHeads", mergedHeads);
      }
    }

    // pull remote changes (members + attendance for every role)
    const settings = await getSettings();
    const since = settings.lastPulledAt || "1970-01-01T00:00:00Z";
    const { data: remoteMembers } = await sbClient.from("members").select("*").gt("updated_at", since);
    if (remoteMembers) {
      for (const rm of remoteMembers) {
        // Soft-deleted remotely: drop any local copy and never re-add it
        // (this is also what keeps a fresh install from resurrecting it).
        if (rm.deleted_at) { await del("members", rm.id); continue; }
        // Merge into the existing local record instead of replacing it
        // wholesale — mapRemoteToMember() (or a future column we forget
        // to map) shouldn't be able to silently wipe local fields it
        // doesn't know about.
        const existing = await get("members", rm.id);
        const mapped = mapRemoteToMember(rm);
        await put("members", existing ? { ...existing, ...mapped } : mapped);
      }
    }
    const { data: remoteAtt } = await sbClient.from("attendance").select("*").gt("updated_at", since);
    if (remoteAtt) for (const ra of remoteAtt) await put("attendance", mapRemoteToAttendance(ra));
    const pullStartedAt = new Date().toISOString();
    if (canWrite) {
      // Families have their own watermark: a scanner never pulls them, so
      // if that person is later promoted to member they must still get the
      // full history instead of only changes since the shared timestamp.
      const sinceFam = settings.lastPulledFamiliesAt || "1970-01-01T00:00:00Z";
      const { data: remoteFamilies } = await sbClient.from("families").select("*").gt("updated_at", sinceFam);
      if (remoteFamilies) {
        for (const rf of remoteFamilies) {
          if (rf.deleted_at) { await del("families", rf.id); continue; }
          const existing = await get("families", rf.id);
          const mapped = mapRemoteToFamily(rf);
          await put("families", existing ? { ...existing, ...mapped } : mapped);
        }
      }
      await setSetting("lastPulledFamiliesAt", pullStartedAt);

      // permissions: own watermark for the same reason as families
      const sinceEx = settings.lastPulledExcusesAt || "1970-01-01T00:00:00Z";
      const { data: remoteExcuses } = await sbClient.from("excuses").select("*").gt("updated_at", sinceEx);
      if (remoteExcuses) {
        for (const rx of remoteExcuses) {
          if (rx.deleted_at) { await del("excuses", rx.id); continue; }
          const existing = await get("excuses", rx.id);
          const mapped = mapRemoteToExcuse(rx);
          await put("excuses", existing ? { ...existing, ...mapped } : mapped);
        }
        await setSetting("lastPulledExcusesAt", pullStartedAt);
      }

      const sincePu = settings.lastPulledPunishmentsAt || "1970-01-01T00:00:00Z";
      const { data: remotePunish } = await sbClient.from("punishments").select("*").gt("updated_at", sincePu);
      if (remotePunish) {
        for (const rp of remotePunish) {
          if (rp.deleted_at) { await del("punishments", rp.id); continue; }
          const existing = await get("punishments", rp.id);
          const mapped = mapRemoteToPunishment(rp);
          await put("punishments", existing ? { ...existing, ...mapped } : mapped);
        }
        await setSetting("lastPulledPunishmentsAt", pullStartedAt);
      }

      const sinceAd = settings.lastPulledAdviceAt || "1970-01-01T00:00:00Z";
      const { data: remoteAdvice } = await sbClient.from("advice").select("*").gt("updated_at", sinceAd);
      if (remoteAdvice) {
        for (const ra of remoteAdvice) {
          if (ra.deleted_at) { await del("advice", ra.id); continue; }
          const existing = await get("advice", ra.id);
          const mapped = mapRemoteToAdvice(ra);
          await put("advice", existing ? { ...existing, ...mapped } : mapped);
        }
        await setSetting("lastPulledAdviceAt", pullStartedAt);
      }

      const sinceDuty = settings.lastPulledDutyAt || "1970-01-01T00:00:00Z";
      const { data: remoteDuty } = await sbClient.from("duty_assignments").select("*").gt("updated_at", sinceDuty);
      if (remoteDuty) {
        for (const rd of remoteDuty) {
          if (rd.deleted_at) { await del("dutyAssignments", rd.id); continue; }
          const existing = await get("dutyAssignments", rd.id);
          const mapped = mapRemoteToDuty(rd);
          await put("dutyAssignments", existing ? { ...existing, ...mapped } : mapped);
        }
        await setSetting("lastPulledDutyAt", pullStartedAt);
      }
    }
    await setSetting("lastPulledAt", pullStartedAt);
    setStatus(t("sync.done"));
  } catch (err) {
    setStatus(t("sync.error"));
  }
}
window.addEventListener("online", () => syncNow());
