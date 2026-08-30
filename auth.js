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
  el("o_skip").onclick = () => enterApp();
}

async function signOut() {
  if (sbClient) {
    try { await sbClient.auth.signOut(); } catch (e) {}
  }
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
window.currentUserRole = "member";
async function fetchUserRole(session) {
  if (!sbClient || !session) { window.currentUserRole = "member"; return; }
  try {
    const { data } = await sbClient.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle();
    window.currentUserRole = (data && data.role) || "member";
  } catch (e) {
    window.currentUserRole = "member"; // fail-safe: never assume admin
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

// ---------- Cloud sync (Supabase tables: members, attendance, hr_events) ----------
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

async function syncNow() {
  const statusEl = el("syncStatus");
  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };

  if (!sbClient) { setStatus(t("sync.noCloud")); return; }
  if (!navigator.onLine) { setStatus(t("sync.offline")); return; }
  const session = await getSession();
  if (!session) { setStatus(t("sync.notSignedIn")); return; }

  setStatus(t("sync.working"));
  try {
    // push members
    const members = await getAll("members");
    const pendingMembers = members.filter((m) => !m.synced);
    if (pendingMembers.length) {
      const { error } = await sbClient.from("members").upsert(pendingMembers.map(mapMemberToRemote));
      if (!error) for (const m of pendingMembers) { m.synced = true; await put("members", m); }
    }
    // push attendance
    const attendance = await getAll("attendance");
    const pendingAtt = attendance.filter((a) => !a.synced);
    if (pendingAtt.length) {
      const { error } = await sbClient.from("attendance")
        .upsert(pendingAtt.map((a) => mapAttendanceToRemote(a, session.user.id)), { onConflict: "member_id,session_date,program_key" });
      if (!error) for (const a of pendingAtt) { a.synced = true; await put("attendance", a); }
    }
    // pull remote changes
    const settings = await getSettings();
    const since = settings.lastPulledAt || "1970-01-01T00:00:00Z";
    const { data: remoteMembers } = await sbClient.from("members").select("*").gt("updated_at", since);
    if (remoteMembers) {
      for (const rm of remoteMembers) {
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
    await setSetting("lastPulledAt", new Date().toISOString());
    setStatus(t("sync.done"));
  } catch (err) {
    setStatus(t("sync.error"));
  }
}
window.addEventListener("online", () => syncNow());
