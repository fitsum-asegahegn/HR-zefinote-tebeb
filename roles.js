/* ፍኖተ ጥበብ — Roles & permissions: role helpers, tab access, pending-approval
   screen, and the admin Users screen. Also holds escapeHtml, a shared helper
   used by most other files.
   Extracted verbatim from settings.js/app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderUsers.
   Used at call time by other files: userRole, isAdminUser, canAccessTab,
   defaultTabForRole, roleLabel, applyRoleUI, onRoleChanged, escapeHtml,
   TAB_ACCESS, VALID_ROLES.
   Depends on globals: sbClient, getSession, signOut, boot, setTab, currentTab,
   appState, moreBackBtn, showAlert, showConfirm, getLang, t, el. */

// ---------- Roles & permissions ----------
// pending -> no access (waiting for an admin to approve the sign-up)
// scanner -> attendance only: the Scan tab (names visible) + Settings
// member  -> everything day-to-day (no deletes, no reports/plan admin, no user management)
// admin   -> everything
// Offline-only mode (no Supabase configured) treats everyone as a member,
// never an admin. The real enforcement is the RLS policies in
// supabase-schema.sql; everything here only decides what the UI shows.
const VALID_ROLES = ["pending", "scanner", "member", "admin"];
const TAB_ACCESS = {
  dashboard: ["member", "admin"],
  scan: ["scanner", "member", "admin"],
  members: ["member", "admin"],
  plan: ["member", "admin"],
  groups: ["member", "admin"],
  reports: ["member", "admin"],
  settings: ["scanner", "member", "admin"],
  more: ["scanner", "member", "admin"],
  users: ["admin"],
};
function userRole() {
  if (!sbClient) return "member";
  const r = window.currentUserRole;
  return VALID_ROLES.includes(r) ? r : "pending";
}
function isAdminUser() { return userRole() === "admin"; }
function canAccessTab(tab) { return (TAB_ACCESS[tab] || []).includes(userRole()); }
function defaultTabForRole() { return userRole() === "scanner" ? "scan" : "dashboard"; }
function roleLabel(role, lang) {
  const labels = {
    pending: lang === "am" ? "በመጠባበቅ ላይ" : "Pending",
    scanner: lang === "am" ? "ስካነር" : "Scanner",
    member: lang === "am" ? "አባል" : "Member",
    admin: lang === "am" ? "አስተዳዳሪ" : "Admin",
  };
  return labels[role] || role;
}
// Hide bottom-nav buttons this role can't open (e.g. a scanner only keeps Scan + More).
function applyRoleUI() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.style.display = canAccessTab(b.dataset.tab) ? "" : "none";
  });
}
// Called from syncNow() when the server says this user's role changed.
function onRoleChanged() {
  if (userRole() === "pending") { boot(); return; }
  applyRoleUI();
  if (appState === "app") setTab(currentTab); // setTab re-checks access
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPendingScreen() {
  const lang = getLang();
  el("view").innerHTML = `
    <div class="auth-wrap">
      <h2>${lang === "am" ? "ፈቃድ በመጠበቅ ላይ" : "Waiting for approval"}</h2>
      <p class="muted">${lang === "am"
        ? "መለያዎ ተፈጥሯል፣ ነገር ግን አስተዳዳሪ እስኪያጸድቅ ድረስ ምንም መረጃ ማየት አይችሉም። እባክዎ አስተዳዳሪውን ያነጋግሩ።"
        : "Your account was created, but you can't see any data until an admin approves it. Please contact your HR admin."}</p>
      <button id="pendingRetry" class="btn-primary" style="width:100%;margin-bottom:10px;">${lang === "am" ? "እንደገና ፈትሽ" : "Check again"}</button>
      <button id="pendingSignOut" class="btn-secondary" style="width:100%;">${lang === "am" ? "ውጣ" : "Sign Out"}</button>
    </div>`;
  el("pendingRetry").onclick = () => boot();
  el("pendingSignOut").onclick = signOut;
}

// Admin-only: approve new sign-ups and change roles (needs to be online —
// roles live in Supabase, not in local storage).
async function renderUsers() {
  const lang = getLang();
  el("view").innerHTML = `
    ${moreBackBtn()}
    <h3 class="section-title">${lang === "am" ? "ተጠቃሚዎች" : "Users"}</h3>
    <p class="muted" id="usersStatus">${lang === "am" ? "በመጫን ላይ..." : "Loading..."}</p>
    <div class="list" id="usersList"></div>`;
  const status = el("usersStatus");
  if (!isAdminUser() || !sbClient) { status.textContent = t("role.adminOnly"); return; }
  if (!navigator.onLine) { status.textContent = lang === "am" ? "ተጠቃሚዎችን ለማስተዳደር ኢንተርኔት ያስፈልጋል" : "You need to be online to manage users."; return; }

  const session = await getSession();
  const [rolesRes, profRes] = await Promise.all([
    sbClient.from("user_roles").select("user_id, role"),
    sbClient.from("profiles").select("user_id, display_name, email"),
  ]);
  if (rolesRes.error) { status.textContent = (lang === "am" ? "ስህተት: " : "Error: ") + rolesRes.error.message; return; }
  const prof = new Map((profRes.data || []).map((x) => [x.user_id, x]));
  const order = { pending: 0, scanner: 1, member: 2, admin: 3 };
  const rows = [...rolesRes.data].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  const myId = session && session.user ? session.user.id : null;

  status.textContent = lang === "am"
    ? "አዲስ ተመዝጋቢዎች 'በመጠባበቅ ላይ' ናቸው — ሚና ይመድቡላቸው።"
    : "New sign-ups start as Pending — assign them a role.";
  el("usersList").innerHTML = rows.map((r) => {
    const pf = prof.get(r.user_id) || {};
    const isSelf = r.user_id === myId;
    const name = pf.display_name || pf.email || r.user_id.slice(0, 8);
    return `
      <div class="list-row" style="align-items:flex-start;">
        <div style="flex:1;">
          <b>${escapeHtml(name)}</b>${isSelf ? ` <span class="muted">(${lang === "am" ? "እርስዎ" : "you"})</span>` : ""}<br>
          <span class="muted">${escapeHtml(pf.email || "")}</span>
        </div>
        <div class="row-actions" style="flex-direction:column;align-items:flex-end;gap:6px;">
          <select id="role_${r.user_id}" class="text-input" style="width:auto;margin:0;" ${isSelf ? "disabled" : ""}>
            ${VALID_ROLES.map((role) => `<option value="${role}" ${role === r.role ? "selected" : ""}>${roleLabel(role, lang)}</option>`).join("")}
          </select>
          ${isSelf ? "" : `<button class="btn-small" onclick="saveUserRole('${r.user_id}')">${t("settings.save")}</button>`}
        </div>
      </div>`;
  }).join("");
}

window.saveUserRole = async (userId) => {
  if (!isAdminUser()) return;
  const lang = getLang();
  const sel = el("role_" + userId);
  if (!sel) return;
  const role = sel.value;
  if (!VALID_ROLES.includes(role)) return;
  if (role === "admin" && !(await showConfirm(lang === "am" ? "ይህን ሰው አስተዳዳሪ ማድረግ ይፈልጋሉ? ሁሉንም ነገር መሰረዝና ማስተዳደር ይችላል።" : "Make this person an admin? They'll be able to delete records and manage users."))) return;
  const { data, error } = await sbClient.from("user_roles").update({ role }).eq("user_id", userId).select();
  if (error || !data || !data.length) {
    await showAlert((lang === "am" ? "አልተሳካም: " : "Couldn't update: ") + (error ? error.message : "no row changed"));
    return;
  }
  renderUsers();
};
