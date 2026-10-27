/* ፍኖተ ጥበብ — Members: Excel import/export, school-portal link, Members screen,
   registration/edit modal, shared parsing helpers (pick, parseExcelDate,
   normalizeGrade, extractAddressCode).
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderMembers.
   Stays in app.js on purpose: resizeImageFile, groupByConfessionFather /
   confessionFatherKey / normFatherName, normText, occupation helpers.
   ID card code lives in idcards.js (showQr, printAllQr, downloadIdCardsDocx).
   Depends on globals: getAll, get, put, del, uid, shortId, todayISO, addTombstone,
   syncNow, isAdminUser, showAlert, showConfirm, withButtonLoading, escapeHtml,
   resizeImageFile, normText, normalizeOccupationStatus, occupationLabel,
   groupByConfessionFather, confessionFatherKey, DEPT_OPTIONS, t, getLang, el, XLSX. */

// ---------- Members ----------
async function importMembersFromWorkbook(file) {
  if (typeof XLSX === 'undefined') { await showAlert('XLSX library not loaded'); return 0; }
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  let count = 0;
  const existingList = await getAll("members");

  for (const row of rows) {
    const name = pick(row, ["ሙሉ ስም", "ስም", "Name", "Full Name", "name"]);
    if (!name) continue;
    const phone = pick(row, ["ስልክ", "ስልክ ቁጥር", "Phone", "phone"]);
    const qrId = pick(row, ["QR ID", "qrId"]);
    // Try to find existing by QR ID, then by phone, then by name
    let member = null;
    if (qrId) {
      member = existingList.find(m => m.qrId === qrId);
    }
    if (!member && phone) {
      member = existingList.find(m => m.phone === phone);
    }
    if (!member) {
      member = existingList.find(m => m.fullName.trim() === String(name).trim());
    }

    const category = pick(row, ["የሚያገለግሉበት ክፍል", "Assigned Department", "category"]);
    const gradeRaw = pick(row, ["ክፍል ደረጃ", "ክፍል", "Grade", "grade"]);
    const grade = normalizeGrade(gradeRaw);
    const confDate = parseExcelDate(pick(row, ["ንስሃ ቀን", "የመጨረሻ ንስሃ", "Last Confession", "lastConfession"]));
    const christianName = pick(row, ["የክርስትና ስም", "Christian Name", "christianName"]);
    const gender = pick(row, ["ጾታ", "Gender", "gender"]);
    const age = pick(row, ["ዕድሜ", "Age", "age"]);
    const altPhone = pick(row, ["ተለዋጭ ስልክ", "Alternate Phone", "altPhone"]);
    const address = pick(row, ["የመኖሪያ አድራሻ", "Address", "address"]);
    const confessionFather = pick(row, ["የንስሐ አባት ስም", "Confession Father", "confessionFather"]);
    const parish = pick(row, ["የሚያገለግሉበት ደብር", "Parish", "parish"]);
    const parentName = pick(row, ["የወላጅ ስም", "Parent Name", "parentName"]);
    const parentPhone = pick(row, ["የወላጅ ስልክ", "Parent Phone", "parentPhone"]);
    const educationLevel = pick(row, ["የዘመናዊ ትምህርት ደረጃ", "Education Level", "educationLevel"]);
    const spiritualEducation = pick(row, ["በመንፈሳዊ የትምህርት ደረጃ", "Spiritual Education", "spiritualEducation"]);
    const dept1 = pick(row, ["ምርጫ 1", "Preference 1", "dept1"]);
    const dept2 = pick(row, ["ምርጫ 2", "Preference 2", "dept2"]);
    const dept3 = pick(row, ["ምርጫ 3", "Preference 3", "dept3"]);
    const uniRaw = String(pick(row, ["የዩኒቨርሲቲ ተማሪ", "University Student", "isUniversityStudent"]) || "").trim().toLowerCase();
    const isUni = ["አዎ", "yes", "true", "1", "y"].includes(uniRaw);
    const jobTitleVal = normText(pick(row, ["ሙያ / ሥራ", "ሙያ", "Job", "Job Title", "jobTitle"]));
    const occStatus = normalizeOccupationStatus(pick(row, ["የሥራ ሁኔታ", "Occupation Status", "occupationStatus"])) || (jobTitleVal ? "employed" : "");

    if (!member) {
      member = {
        id: uid(), qrId: qrId || "FTW1|" + shortId(), fullName: String(name).trim(),
        phone: phone ? String(phone).trim() : "", category: category ? String(category).trim() : "", grade,
        lastConfessionDate: confDate, joinDate: todayISO(), active: true, synced: false,
        christianName: christianName ? String(christianName).trim() : "",
        gender: gender ? String(gender).trim() : "",
        age: age ? Number(age) : null,
        altPhone: altPhone ? String(altPhone).trim() : "",
        address: address ? String(address).trim() : "",
        confessionFather: confessionFather ? String(confessionFather).trim() : "",
        parish: parish ? String(parish).trim() : "",
        parentName: parentName ? String(parentName).trim() : "",
        parentPhone: parentPhone ? String(parentPhone).trim() : "",
        educationLevel: educationLevel ? String(educationLevel).trim() : "",
        spiritualEducation: spiritualEducation ? String(spiritualEducation).trim() : "",
        dept1: dept1 ? String(dept1).trim() : "",
        dept2: dept2 ? String(dept2).trim() : "",
        dept3: dept3 ? String(dept3).trim() : "",
        occupationStatus: occStatus,
        jobTitle: occStatus === "employed" ? jobTitleVal : "",
        isUniversityStudent: isUni,
      };
      existingList.push(member);
    } else {
      // Update existing member
      if (phone) member.phone = String(phone).trim();
      if (category) member.category = String(category).trim();
      if (grade !== null && !member.portalCode) member.grade = grade; // portal grade wins once linked
      if (confDate) member.lastConfessionDate = confDate;
      if (christianName) member.christianName = String(christianName).trim();
      if (gender) member.gender = String(gender).trim();
      if (age) member.age = Number(age);
      if (altPhone) member.altPhone = String(altPhone).trim();
      if (address) member.address = String(address).trim();
      if (confessionFather) member.confessionFather = String(confessionFather).trim();
      if (parish) member.parish = String(parish).trim();
      if (parentName) member.parentName = String(parentName).trim();
      if (parentPhone) member.parentPhone = String(parentPhone).trim();
      if (educationLevel) member.educationLevel = String(educationLevel).trim();
      if (spiritualEducation) member.spiritualEducation = String(spiritualEducation).trim();
      if (dept1) member.dept1 = String(dept1).trim();
      if (dept2) member.dept2 = String(dept2).trim();
      if (dept3) member.dept3 = String(dept3).trim();
      if (isUni) member.isUniversityStudent = true;
      if (occStatus) {
        member.occupationStatus = occStatus;
        member.jobTitle = occStatus === "employed" ? (jobTitleVal || member.jobTitle || "") : "";
      }
      member.synced = false;
    }
    await put("members", member);
    count++;
  }
  return count;
}

// ---------- School portal link ----------
// The portal (temehert-kefel-portal) exports "Students" with: Student ID |
// Student name | Grade | Section | First password. Importing links each row to an
// HR member (by portal ID, else by exact name) and stores portalCode,
// portalPassword (blank once the student changed it) and the portal's grade.
// These two fields stay on this device only: they are not synced to Supabase
// and portalPassword is stripped from the JSON backup.
const normName = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

async function importPortalList(file) {
  if (typeof XLSX === "undefined") { await showAlert("XLSX library not loaded"); return null; }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" })
    .filter((r) => String(r["Student ID"] || r["Student name"] || "").trim());

  const members = await getAll("members");
  const byCode = new Map(members.filter((m) => m.portalCode).map((m) => [m.portalCode.toUpperCase(), m]));
  const byName = new Map(), hrDup = new Set();
  members.forEach((m) => {
    const k = normName(m.fullName);
    if (byName.has(k)) hrDup.add(k); else byName.set(k, m);
  });
  const portalCount = new Map();
  rows.forEach((r) => { const k = normName(r["Student name"]); portalCount.set(k, (portalCount.get(k) || 0) + 1); });

  let linked = 0;
  const unmatched = [], ambiguous = [], seen = new Set();
  for (const r of rows) {
    const code = String(r["Student ID"] || "").trim().toUpperCase();
    const name = String(r["Student name"] || "").trim();
    let m = code ? byCode.get(code) : null;
    if (!m) {
      const k = normName(name);
      if (hrDup.has(k) || portalCount.get(k) > 1) { ambiguous.push(`${name} (${code})`); continue; }
      m = byName.get(k);
    }
    if (!m) { unmatched.push(name || code); continue; }
    if (seen.has(m.id)) { ambiguous.push(`${name} (${code})`); continue; }

    const g = normalizeGrade(r["Grade"]);
    m.portalCode = code;
    if (g) m.grade = g;                                              // portal grade wins
    m.portalPassword = String(r["First password"] || "").trim();     // blank = student already changed it; clears any stale one
    m.synced = false;
    await put("members", m);
    seen.add(m.id); linked++;
  }
  return { linked, unmatched, ambiguous, notInPortal: members.filter((m) => !seen.has(m.id)).length };
}

function parseExcelDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return !isNaN(d.getTime()) ? isoDate(d) : null;
  }
  if (v instanceof Date) return isoDate(v);
  const d = new Date(String(v).trim());
  return !isNaN(d.getTime()) ? isoDate(d) : null;
}

function pick(row, keys) { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return ""; }

function normalizeGrade(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return (n >= 1 && n <= 12) ? n : null;
}

// Pulls the first run of 3+ digits out of an address string and takes its
// first 3 digits as the neighborhood code — e.g. "ኮዬ 435/17" -> 435.
// Used to bucket members into 100-wide ranges (400 -> 400-499) since
// nearby house numbers roughly cluster by neighborhood.
// House numbers in this data are consistently written as "NNN/NN" (e.g.
// "435/17"). Some addresses also have a block/site prefix number before
// the word ቤት/ብ that is NOT the house code (e.g. "400ቤት 457/11" — the
// real code is 457, not 400), and a few have a smaller sub-city/woreda
// code before the real one (e.g. "10/90  262/07" — the real code is
// 262). So: only consider numbers sitting directly against a slash (the
// house-code format), and when more than one appears, prefer the one
// with more digits, since real house codes run 3 digits while prefix
// codes tend to be 1-2. Falls back to any bare digit run only when the
// address has no slash pattern at all (e.g. a plain "116").
function extractAddressCode(address) {
  if (!address) return null;
  const str = String(address);
  const slashMatches = [...str.matchAll(/(\d+)\s*\//g)];
  if (slashMatches.length) {
    slashMatches.sort((a, b) => b[1].length - a[1].length);
    return parseInt(slashMatches[0][1].slice(0, 3), 10);
  }
  const match = str.match(/\d{2,}/);
  if (!match) return null;
  return parseInt(match[0].slice(0, 3), 10);
}

async function addMemberManual(fullName, phone, category, grade, extras = {}) {
  const member = {
    id: uid(),
    qrId: "FTW1|" + shortId(),
    fullName: fullName.trim(),
    phone: (phone || "").trim(),
    category: (category || "").trim(),
    grade: normalizeGrade(grade),
    lastConfessionDate: null,
    joinDate: todayISO(),
    active: true,
    synced: false,
    christianName: extras.christianName || "",
    gender: extras.gender || "",
    age: extras.age ? Number(extras.age) : null,
    altPhone: extras.altPhone || "",
    address: extras.address || "",
    confessionFather: extras.confessionFather || "",
    parish: extras.parish || "",
    parentName: extras.parentName || "",
    parentPhone: extras.parentPhone || "",
    educationLevel: extras.educationLevel || "",
    spiritualEducation: extras.spiritualEducation || "",
    dept1: extras.dept1 || "",
    dept2: extras.dept2 || "",
    dept3: extras.dept3 || "",
    photo: extras.photo || null,
    occupationStatus: extras.occupationStatus || "",
    jobTitle: extras.jobTitle || "",
    portalCode: (extras.portalCode || "").toUpperCase(),
  };
  await put("members", member);
  return member;
}

// ---------- Members ----------
async function renderMembers() {
  const members = (await getAll("members")).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const selected = new Set();
  const confessionFatherGroups = groupByConfessionFather(members);

  el("view").innerHTML = `
    <div class="toolbar">
      <label class="btn-primary file-btn">${t("members.importExcel")}<input type="file" id="excelInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>
      <button class="btn-secondary" id="addMemberBtn">${t("members.addMember")}</button>
      <button class="btn-secondary" id="exportMembersBtn">${t("members.exportExcel")}</button>
      <label class="btn-secondary file-btn">${getLang() === "am" ? "ከፖርታል አስመጣ" : "Import portal list"}<input type="file" id="portalInput" accept=".xlsx,.xls,.csv" style="display:none;"/></label>
    </div>
    <div class="toolbar">
      <button class="btn-secondary" id="printQrBtn">${t("members.printAllQr")}</button>
      <button class="btn-primary" id="printSelectedBtn">${t("members.printSelected")} (<span id="selCount">0</span>)</button>
      <button class="btn-secondary" id="selectAllBtn">${t("members.selectAllShown")}</button>
      <button class="btn-secondary" id="clearSelBtn">${t("members.clearSelection")}</button>
    </div>
    <div class="toolbar">
      <button class="btn-secondary" id="docxAllBtn">${getLang() === "am" ? "ሁሉንም መታወቂያ በWord አውርድ" : "⬇ All IDs (Word)"}</button>
      <button class="btn-secondary" id="docxSelectedBtn">${getLang() === "am" ? "የተመረጡትን በWord አውርድ" : "⬇ Selected IDs (Word)"}</button>
      <button class="btn-primary" id="docxPhotoBtn">${getLang() === "am" ? "ፎቶ ያላቸውን በWord አውርድ" : "⬇ IDs with photos (Word)"} (${members.filter((m) => m.photo).length})</button>
    </div>
    <input id="memberSearch" class="text-input" placeholder="${t("members.searchPlaceholder")}"/>
    <select id="gradeFilter" class="text-input">
      <option value="">${t("members.allGrades")}</option>
      ${Array.from({ length: 12 }, (_, i) => i + 1).map((g) => `<option value="${g}">${t("members.gradeShort", { n: g })}</option>`).join("")}
    </select>
    <div class="toolbar" style="margin-bottom:0;">
      <select id="confessionFatherFilter" class="text-input">
        <option value="">${getLang() === "am" ? "ሁሉም የንስሐ አባቶች" : "All confession fathers"}</option>
        ${confessionFatherGroups.map((g) => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.name || (getLang() === "am" ? "(አልተመዘገበም)" : "(none recorded)"))} (${g.members.length})</option>`).join("")}
      </select>
    </div>
    <div class="toolbar" style="margin-bottom:0;">
      <select id="photoFilter" class="text-input">
        <option value="">${getLang() === "am" ? "ፎቶ ያለውም የሌለውም" : "Photo: all"}</option>
        <option value="with">${getLang() === "am" ? "ፎቶ ያላቸው" : "With photo"} (${members.filter((m) => m.photo).length})</option>
        <option value="without">${getLang() === "am" ? "ፎቶ የሌላቸው" : "Without photo"} (${members.filter((m) => !m.photo).length})</option>
      </select>
    </div>
    <input id="areaCodeFilter" type="number" class="text-input" placeholder="${getLang() === "am" ? "የቦታ ኮድ (ለምሳሌ 400)" : "Area code (e.g. 400)"}">
    <p class="muted" id="areaCodeCount" style="display:none;margin-top:-6px;"></p>
    <div id="memberList" class="list"></div>
    <div id="printArea" class="print-only"></div>
  `;

  let lastShown = members;

  function updateSelCount() { el("selCount").textContent = selected.size; }

  function draw(list) {
    lastShown = list;
    const isAdmin = isAdminUser();
    el("memberList").innerHTML = list.map((m) => `
      <div class="list-row">
        <label class="sel-check">
          <input type="checkbox" data-id="${m.id}" ${selected.has(m.id) ? "checked" : ""}/>
        </label>
        ${m.photo
          ? `<img src="${m.photo}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex:0 0 auto;">`
          : `<div style="width:36px;height:36px;border-radius:8px;background:var(--bg2);border:1px solid var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;font-size:0.85rem;flex:0 0 auto;">${(m.fullName || "?").trim().charAt(0).toUpperCase()}</div>`}
        <div style="flex:1;">
          <b>${m.fullName}</b><br>
          <span class="muted">
            ${m.phone || ""}
            ${m.category ? "· " + m.category : ""}
            ${m.grade ? "· " + t("members.gradeShort", { n: m.grade }) : ""}
            ${m.christianName ? "· የክርስትና ስም: " + m.christianName : ""}
            ${m.address ? "· " + m.address : ""}
            ${m.portalCode ? "· " + escapeHtml(m.portalCode) : ""}
          </span>
        </div>
        <div class="row-actions">
          <button class="btn-small" onclick="showQr('${m.id}')">${t("members.qr")}</button>
          <button class="btn-small" onclick="openRegistrationModal('${m.id}')">${t("members.edit")}</button>
          ${isAdmin ? `<button class="btn-small" onclick="deleteMember('${m.id}')">${t("members.delete")}</button>` : ""}
        </div>
      </div>`).join("");

    el("memberList").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
        updateSelCount();
      };
    });
  }

  function applyFilters() {
    const lang = getLang();
    const q = el("memberSearch").value.toLowerCase();
    const g = el("gradeFilter").value;
    const areaBaseRaw = el("areaCodeFilter").value;
    const countEl = el("areaCodeCount");
    const cf = el("confessionFatherFilter").value;
    const ph = el("photoFilter").value;
    let filtered = members.filter((m) => m.fullName.toLowerCase().includes(q) && (g === "" || String(m.grade) === g) && (cf === "" || confessionFatherKey(m.confessionFather) === cf) && (ph === "" || (ph === "with" ? !!m.photo : !m.photo)));
    if (areaBaseRaw !== "") {
      const base = Number(areaBaseRaw);
      const upper = base + 99;
      filtered = filtered.filter((m) => {
        const code = extractAddressCode(m.address);
        return code !== null && code >= base && code <= upper;
      });
      countEl.style.display = "";
      countEl.textContent = lang === "am"
        ? `${filtered.length} አባላት ከ${base}-${upper} አካባቢ ውስጥ`
        : `${filtered.length} member(s) in the ${base}-${upper} range`;
    } else {
      countEl.style.display = "none";
    }
    draw(filtered);
  }

  draw(members);
  el("memberSearch").oninput = applyFilters;
  el("gradeFilter").onchange = applyFilters;
  el("confessionFatherFilter").onchange = applyFilters;
  el("photoFilter").onchange = applyFilters;
  el("areaCodeFilter").oninput = applyFilters;

  el("excelInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const count = await importMembersFromWorkbook(file);
    await showAlert(t("members.importedCount", { n: count }));
    renderMembers();
  };

  el("portalInput").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    const am = getLang() === "am";
    const r = await importPortalList(file);
    if (!r) return;
    const list = (a) => (a.length ? "\n" + a.slice(0, 10).map(escapeHtml).join(", ") : "");
    await showAlert(
      `${am ? "የተገናኙ" : "Linked"}: ${r.linked}` +
      `\n${am ? "በሰው ሀብት ውስጥ ያልተገኙ" : "Not found in HR"}: ${r.unmatched.length}${list(r.unmatched)}` +
      `\n${am ? "ተመሳሳይ ስም (ተዘለዋል)" : "Same-name conflicts (skipped)"}: ${r.ambiguous.length}${list(r.ambiguous)}` +
      `\n${am ? "በፖርታል ውስጥ የሌሉ የሰው ሀብት አባላት" : "HR members with no portal record"}: ${r.notInPortal}`
    );
    renderMembers();
  };

  el("addMemberBtn").onclick = () => openRegistrationModal();
  el("printQrBtn").onclick = (e) => printAllQr(members, e.currentTarget);
  el("printSelectedBtn").onclick = async (e) => {
    const btn = e.currentTarget; // grab it before any await (currentTarget is cleared afterwards)
    if (!selected.size) { await showAlert(t("members.noneSelected")); return; }
    const chosen = members.filter((m) => selected.has(m.id));
    printAllQr(chosen, btn);
  };

  el("selectAllBtn").onclick = () => {
    lastShown.forEach((m) => selected.add(m.id));
    draw(lastShown);
    updateSelCount();
  };

  el("clearSelBtn").onclick = () => {
    selected.clear();
    draw(lastShown);
    updateSelCount();
  };

  el("exportMembersBtn").onclick = () => exportMembersExcel(members);

  const preparingLabel = getLang() === "am" ? "በማዘጋጀት ላይ..." : "Preparing...";
  el("docxAllBtn").onclick = (e) => withButtonLoading(e.currentTarget, preparingLabel, () => downloadIdCardsDocx(members, e.currentTarget));
  el("docxSelectedBtn").onclick = async (e) => {
    if (!selected.size) { await showAlert(t("members.noneSelected")); return; }
    const chosen = members.filter((m) => selected.has(m.id));
    await withButtonLoading(e.currentTarget, preparingLabel, () => downloadIdCardsDocx(chosen, e.currentTarget));
  };
  el("docxPhotoBtn").onclick = async (e) => {
    const withPhoto = members.filter((m) => m.photo);
    if (!withPhoto.length) { await showAlert(getLang() === "am" ? "ፎቶ ያለው አባል የለም" : "No members have a photo yet."); return; }
    await withButtonLoading(e.currentTarget, preparingLabel, () => downloadIdCardsDocx(withPhoto, e.currentTarget, "with-photos"));
  };
}

window.deleteMember = async (id) => {
  if (!isAdminUser()) { await showAlert(t("role.adminOnly")); return; }
  if (!(await showConfirm(t("members.confirmDelete")))) return;
  await del("members", id);
  await addTombstone("members", id);
  renderMembers();
  syncNow();
};

async function exportMembersExcel(members) {
  if (typeof XLSX === 'undefined') { await showAlert('XLSX library not loaded'); return; }
  const rows = members.map((m) => ({
    "ሙሉ ስም": m.fullName,
    "የክርስትና ስም": m.christianName || "",
    "ጾታ": m.gender || "",
    "ዕድሜ": m.age || "",
    "ስልክ": m.phone || "",
    "ተለዋጭ ስልክ": m.altPhone || "",
    "የመኖሪያ አድራሻ": m.address || "",
    "የንስሐ አባት ስም": m.confessionFather || "",
    "የሚያገለግሉበት ደብር": m.parish || "",
    "የወላጅ ስም": m.parentName || "",
    "የወላጅ ስልክ": m.parentPhone || "",
    "የዘመናዊ ትምህርት ደረጃ": m.educationLevel || "",
    "በመንፈሳዊ የትምህርት ደረጃ": m.spiritualEducation || "",
    "ክፍል ደረጃ": m.grade || "",
    "የሚያገለግሉበት ክፍል": m.category || "",
    "ምርጫ 1": m.dept1 || "",
    "ምርጫ 2": m.dept2 || "",
    "ምርጫ 3": m.dept3 || "",
    "የሥራ ሁኔታ": occupationLabel(m.occupationStatus, "am"),
    "የዩኒቨርሲቲ ተማሪ": m.isUniversityStudent ? "አዎ" : "",
    "ሙያ / ሥራ": m.jobTitle || "",
    "የመጨረሻ ንስሃ ቀን": m.lastConfessionDate || "",
    "የተቀላቀሉበት ቀን": m.joinDate || "",
    "QR ID": m.qrId,
    "በአሁኑ ጊዜ ለጥሪ ተመዝግቧል": m.callLog && m.callLog.called ? "አዎ" : "",
    "የመጨረሻ ጥሪ ምክንያት": m.callLog ? (m.callLog.reason || "") : "",
    "ጠቅላላ ጥሪ ቁጥር": (m.callHistory || []).length,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Members");
  XLSX.writeFile(wb, `finote-members-${todayISO()}.xlsx`);
}

// ---------- Registration Modal ----------
window.openRegistrationModal = async function(editId) {
  const member = editId ? await get("members", editId) : null;
  const isEdit = !!member;
  const deptOptions = DEPT_OPTIONS;
  // existing job titles, offered as suggestions so the same job is spelled the same way
  const existingJobs = [...new Set((await getAll("members")).map((x) => normText(x.jobTitle)).filter(Boolean))].sort();

  const deptSelect = (name, selected) => `
    <select id="${name}" class="text-input">
      <option value="">---</option>
      ${deptOptions.map(d => `<option value="${d}" ${d===selected?'selected':''}>${d}</option>`).join('')}
    </select>`;

  const sectionTitle = (text, first) => `<div style="color:var(--amber);font-weight:700;font-size:0.85rem;margin:${first ? "4" : "20"}px 0 8px;${first ? "" : "border-top:1px solid var(--border);padding-top:16px;"}">${text}</div>`;

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner" style="max-width:500px;max-height:90vh;overflow-y:auto;text-align:left;">
      <h3>${isEdit ? t("members.editMember") : t("members.addMember")}</h3>
      <form id="regForm">
        ${sectionTitle(getLang() === "am" ? "የግል መረጃ" : "Personal", true)}
        <label>${getLang() === "am" ? "ፎቶ" : "Photo"}</label>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <img id="f_photoPreview" src="${member?.photo || ""}" style="width:64px;height:85px;object-fit:cover;border-radius:6px;border:1px solid var(--border);background:var(--bg2);${member?.photo ? "" : "display:none;"}">
          <div id="f_photoPlaceholder" style="width:64px;height:85px;border-radius:6px;border:1px dashed var(--border);display:${member?.photo ? "none" : "flex"};align-items:center;justify-content:center;color:var(--muted);font-size:0.65rem;text-align:center;">${getLang() === "am" ? "ምንም" : "None"}</div>
          <div>
            <label class="btn-secondary file-btn" style="display:inline-flex;">${getLang() === "am" ? "ፎቶ ምረጥ" : "Choose Photo"}<input type="file" id="f_photoInput" accept="image/*" style="display:none;"></label>
            <button type="button" class="btn-small" id="f_photoRemove" style="margin-left:6px;${member?.photo ? "" : "display:none;"}">${getLang() === "am" ? "አስወግድ" : "Remove"}</button>
          </div>
        </div>
        <label>${t("members.fullName")} *</label>
        <input id="f_fullName" class="text-input" value="${member?.fullName||''}" required>
        <label>${t("members.christianName")}</label>
        <input id="f_christianName" class="text-input" value="${member?.christianName||''}">
        <label>${t("members.gender")}</label>
        <select id="f_gender" class="text-input">
          <option value="">---</option>
          <option value="ወንድ" ${member?.gender==='ወንድ'?'selected':''}>ወንድ</option>
          <option value="ሴት" ${member?.gender==='ሴት'?'selected':''}>ሴት</option>
        </select>
        <label>${t("members.age")}</label>
        <input id="f_age" type="number" class="text-input" value="${member?.age||''}">

        ${sectionTitle(getLang() === "am" ? "የመገናኛ አድራሻ" : "Contact")}
        <label>${t("members.phone")}</label>
        <input id="f_phone" class="text-input" value="${member?.phone||''}">
        <label>${t("members.altPhone")}</label>
        <input id="f_altPhone" class="text-input" value="${member?.altPhone||''}">
        <label>${t("members.address")}</label>
        <input id="f_address" class="text-input" value="${member?.address||''}">

        ${sectionTitle(getLang() === "am" ? "የቤተሰብ መረጃ" : "Family")}
        <label>${t("members.parentName")}</label>
        <input id="f_parentName" class="text-input" value="${member?.parentName||''}">
        <label>${t("members.parentPhone")}</label>
        <input id="f_parentPhone" class="text-input" value="${member?.parentPhone||''}">

        ${sectionTitle(getLang() === "am" ? "የቤተክርስቲያን መረጃ" : "Church")}
        <label>${t("members.confessionFather")}</label>
        <input id="f_confessionFather" class="text-input" value="${member?.confessionFather||''}">
        <label>${t("members.parish")}</label>
        <input id="f_parish" class="text-input" value="${member?.parish||''}">
        <label>${t("members.educationLevel")}</label>
        <input id="f_educationLevel" class="text-input" value="${member?.educationLevel||''}">
        <label>${t("members.spiritualEducation")}</label>
        <input id="f_spiritualEducation" class="text-input" value="${member?.spiritualEducation||''}">
        <label>${t("members.grade")}</label>
        <input id="f_grade" type="number" class="text-input" placeholder="1-12" value="${member?.grade||''}" ${member?.portalCode ? "disabled" : ""}>
        <label>${getLang() === "am" ? "የፖርታል መታወቂያ" : "Portal ID"}</label>
        <input id="f_portalCode" class="text-input" placeholder="FTS/27/0142" value="${escapeHtml(member?.portalCode || "")}">

        ${sectionTitle(getLang() === "am" ? "የሥራ ሁኔታ" : "Occupation")}
        <label>${getLang() === "am" ? "የሥራ ሁኔታ" : "Status"}</label>
        <select id="f_occStatus" class="text-input">
          <option value="">---</option>
          <option value="employed" ${member?.occupationStatus === "employed" ? "selected" : ""}>${occupationLabel("employed", getLang())}</option>
          <option value="student" ${member?.occupationStatus === "student" ? "selected" : ""}>${occupationLabel("student", getLang())}</option>
          <option value="unemployed" ${member?.occupationStatus === "unemployed" ? "selected" : ""}>${occupationLabel("unemployed", getLang())}</option>
        </select>
        <div id="f_jobWrap" style="display:${member?.occupationStatus === "employed" ? "block" : "none"};">
          <label>${getLang() === "am" ? "ሙያ / የሥራ ዓይነት (ለምሳሌ ዶክተር)" : "Job / profession (e.g. Doctor)"}</label>
          <input id="f_jobTitle" class="text-input" list="f_jobList" value="${escapeHtml(member?.jobTitle || "")}">
          <datalist id="f_jobList">${existingJobs.map((j) => `<option value="${escapeHtml(j)}"></option>`).join("")}</datalist>
        </div>

        ${sectionTitle(getLang() === "am" ? "የክፍል ምደባ" : "Department")}
        <label>${t("members.assignedDept")}</label>
        ${deptSelect('f_assignedDept', member?.category)}
        <label>${t("members.deptPref1")}</label>
        ${deptSelect('f_dept1', member?.dept1)}
        <label>${t("members.deptPref2")}</label>
        ${deptSelect('f_dept2', member?.dept2)}
        <label>${t("members.deptPref3")}</label>
        ${deptSelect('f_dept3', member?.dept3)}
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button type="submit" class="btn-primary">${isEdit ? t("members.update") : t("members.save")}</button>
          <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(box);

  let photoDataUrl = member?.photo || null;
  el("f_occStatus").onchange = () => { el("f_jobWrap").style.display = el("f_occStatus").value === "employed" ? "block" : "none"; };
  el("f_photoInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photoDataUrl = await resizeImageFile(file, 300, 400);
      el("f_photoPreview").src = photoDataUrl;
      el("f_photoPreview").style.display = "";
      el("f_photoPlaceholder").style.display = "none";
      el("f_photoRemove").style.display = "";
    } catch (err) {
      await showAlert(getLang() === "am" ? "ፎቶውን ማንበብ አልተቻለም" : "Couldn't read that photo.");
    }
  };
  el("f_photoRemove").onclick = () => {
    photoDataUrl = null;
    el("f_photoInput").value = "";
    el("f_photoPreview").style.display = "none";
    el("f_photoPlaceholder").style.display = "flex";
    el("f_photoRemove").style.display = "none";
  };

  box.querySelector("#regForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      fullName: el("f_fullName").value.trim(),
      christianName: el("f_christianName").value.trim(),
      gender: el("f_gender").value,
      age: el("f_age").value ? Number(el("f_age").value) : null,
      phone: el("f_phone").value.trim(),
      altPhone: el("f_altPhone").value.trim(),
      address: el("f_address").value.trim(),
      confessionFather: el("f_confessionFather").value.trim(),
      parish: el("f_parish").value.trim(),
      parentName: el("f_parentName").value.trim(),
      parentPhone: el("f_parentPhone").value.trim(),
      educationLevel: el("f_educationLevel").value.trim(),
      spiritualEducation: el("f_spiritualEducation").value.trim(),
      grade: el("f_grade").value.trim(),
      portalCode: el("f_portalCode").value.trim().toUpperCase(),
      category: el("f_assignedDept").value.trim(),
      dept1: el("f_dept1").value,
      dept2: el("f_dept2").value,
      dept3: el("f_dept3").value,
      photo: photoDataUrl,
      occupationStatus: el("f_occStatus").value,
      jobTitle: el("f_occStatus").value === "employed" ? normText(el("f_jobTitle").value) : "",
    };

    if (!data.fullName) { await showAlert(t("members.fullNameRequired")); return; }
    if (data.portalCode) {
      const clash = (await getAll("members")).find((x) => x.id !== (member && member.id) && (x.portalCode || "").toUpperCase() === data.portalCode);
      if (clash) { await showAlert((getLang() === "am" ? "ይህ የፖርታል መታወቂያ ቀድሞ ለ" : "That portal ID is already linked to ") + escapeHtml(clash.fullName)); return; }
    }

    if (isEdit) {
      const m = await get("members", member.id);
      if (!m) { await showAlert("Member not found"); return; }

      m.fullName = data.fullName;
      m.christianName = data.christianName;
      m.gender = data.gender;
      m.age = data.age;
      m.phone = data.phone;
      m.altPhone = data.altPhone;
      m.address = data.address;
      m.confessionFather = data.confessionFather;
      m.parish = data.parish;
      m.parentName = data.parentName;
      m.parentPhone = data.parentPhone;
      m.educationLevel = data.educationLevel;
      m.spiritualEducation = data.spiritualEducation;
      m.grade = data.grade ? normalizeGrade(data.grade) : null;
      if ((m.portalCode || "") !== data.portalCode) m.portalPassword = ""; // a different ID can't keep the old first password
      m.portalCode = data.portalCode;
      m.category = data.category;
      m.dept1 = data.dept1;
      m.dept2 = data.dept2;
      m.dept3 = data.dept3;
      m.photo = data.photo;
      m.occupationStatus = data.occupationStatus;
      m.jobTitle = data.jobTitle;
      m.synced = false;

      await put("members", m);
    } else {
      await addMemberManual(
        data.fullName,
        data.phone,
        data.category,
        data.grade,
        data
      );
    }
    box.remove();
    renderMembers();
  };
};
