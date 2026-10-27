/* ፍኖተ ጥበብ — Scan tab: camera QR scanning, batch queue, code entry,
   manual name search.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderScan.
   Stays in app.js: the shared `scanState` object (declared with `let` there,
   visible to this file at call time), recordAttendance and the attendance rules.
   Depends on globals: getAll, get, scanState, recordAttendance, showAlert, el,
   t, jsQR (CDN). */

// ---------- Scan ----------
async function renderScan() {
  const members = await getVisibleMembers();
  const progs = PROGRAM_DEFS();
  el("view").innerHTML = `
    <div class="scan-controls">
      <label>${t("scan.programLabel")}</label>
      <select id="programSelect">${progs.map(p => `<option value="${p.key}" ${p.key === scanState.program ? "selected" : ""}>${p.name}</option>`).join("")}</select>
      <button id="camToggle" class="btn-primary">${t("scan.startCamera")}</button>
      <button id="torchToggle" class="btn-secondary" style="display:none;">💡 ${t("scan.torch")}</button>
    </div>
    <div class="video-wrap" id="videoWrap" style="display:none;">
      <video id="video" playsinline></video>
      <div class="scan-reticle"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span></div>
    </div>
    <p class="muted" id="scanStatus" style="display:none;">● ${t("scan.readyStatus")}</p>
    <canvas id="canvas" style="display:none;"></canvas>

    <h3 class="section-title">${t("batch.title")}</h3>
    <div class="toolbar">
      <button id="confirmBatchBtn" class="btn-primary">${t("batch.confirmAll")} (<span id="batchCount">0</span>)</button>
      <button id="clearBatchBtn" class="btn-secondary">${t("batch.clear")}</button>
    </div>
    <div id="batchList" class="list"></div>

    <div id="scanFeed" class="list"></div>

    <h3 class="section-title">${t("scan.codeEntryTitle")}</h3>
    <div class="scan-controls">
      <input id="codeEntry" placeholder="${t("scan.codeEntryPlaceholder")}" class="text-input" style="margin-bottom:0;flex:1;" autocomplete="off"/>
      <button id="codeEntryBtn" class="btn-primary">${t("scan.find")}</button>
    </div>

    <h3 class="section-title">${t("scan.manualTitle")}</h3>
    <input id="manualSearch" placeholder="${t("scan.searchPlaceholder")}" class="text-input"/>
    <div id="manualResults" class="list"></div>
  `;

  el("programSelect").onchange = (e) => (scanState.program = e.target.value);
  el("camToggle").onclick = toggleCamera;
  el("torchToggle").onclick = toggleTorch;
  el("confirmBatchBtn").onclick = confirmBatch;
  el("clearBatchBtn").onclick = () => { scanState.batch = []; renderBatchList(); };

  // Debounced search
  let searchTimeout;
  el("manualSearch").oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? members.filter((m) => m.fullName.toLowerCase().includes(q)) : [];
      el("manualResults").innerHTML = filtered.slice(0, 15).map((m) => `
        <div class="list-row"><div>${m.fullName}</div><button class="btn-small" onclick="queueScan('${m.id}')">${t("scan.record")}</button></div>`).join("");
    }, 200);
  };

  async function submitCodeEntry() {
    const input = el("codeEntry");
    const raw = input.value.trim();
    if (!raw) return;
    const ok = await queueScanByQrText(raw);
    if (!ok) await showAlert(t("scan.codeNotFound"));
    input.value = "";
    input.focus();
  }

  el("codeEntryBtn").onclick = submitCodeEntry;
  el("codeEntry").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitCodeEntry(); } };
  renderBatchList();
}

function renderBatchList() {
  const box = el("batchList");
  const countEl = el("batchCount");
  if (!box) return;
  if (countEl) countEl.textContent = scanState.batch.length;
  box.innerHTML = scanState.batch.length
    ? scanState.batch.map((item, i) => `
        <div class="list-row">
          <div><b>${item.fullName}</b><br><span class="muted">${item.scannedAt.toLocaleTimeString()}</span></div>
          <button class="btn-small" onclick="removeFromBatch(${i})">${t("batch.remove")}</button>
        </div>`).join("")
    : `<p class="muted">${t("batch.empty")}</p>`;
}

window.removeFromBatch = (i) => { scanState.batch.splice(i, 1); renderBatchList(); };

async function queueScan(memberId) {
  if (scanState.batch.some((b) => b.memberId === memberId)) return;
  const m = await get("members", memberId);
  if (!m) return;
  scanState.batch.push({ memberId, fullName: m.fullName, scannedAt: new Date() });
  renderBatchList();
  if (navigator.vibrate) navigator.vibrate(40);
}
window.queueScan = queueScan;

async function queueScanByQrText(raw) {
  const qrId = raw.startsWith("FTW1|") ? raw : "FTW1|" + raw;
  const members = await getVisibleMembers();
  const member = members.find((m) => m.qrId === qrId || m.qrId === raw);
  if (!member) return false;
  await queueScan(member.id);
  return true;
}

// Warns when the chosen program is one that has never (2+ times) been held on
// this weekday while other programs have — the classic "forgot to switch from
// Course to Mezmur" mistake. Returns the usual program keys, or null if fine.
async function usualProgramsIfMismatch(programKey, atDate) {
  const dow = atDate.getDay(), today = isoDate(atDate);
  const datesByProg = new Map();
  for (const a of await getAll("attendance")) {
    if (a.sessionDate === today) continue; // today's own scans may be the mistake
    if (new Date(a.sessionDate + "T00:00:00").getDay() !== dow) continue;
    if (!datesByProg.has(a.programKey)) datesByProg.set(a.programKey, new Set());
    datesByProg.get(a.programKey).add(a.sessionDate);
  }
  const usual = [...datesByProg.entries()].filter(([, set]) => set.size >= 2).map(([k]) => k);
  return usual.length && !usual.includes(programKey) ? usual : null;
}

async function confirmBatch() {
  if (!scanState.batch.length) return;
  const am = getLang() === "am";
  const usual = await usualProgramsIfMismatch(scanState.program, scanState.batch[0].scannedAt);
  if (usual) {
    const progs = PROGRAM_DEFS();
    const nameOf = (k) => (progs.find((p) => p.key === k) || { name: k }).name;
    const days = am ? ["እሁድ", "ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "አርብ", "ቅዳሜ"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const day = days[scanState.batch[0].scannedAt.getDay()];
    const ok = await showConfirm(am
      ? `${day} ብዙውን ጊዜ የሚካሄደው «${usual.map(nameOf).join("፣ ")}» ነው፣ አሁን ግን «${nameOf(scanState.program)}» እየመዘገቡ ነው። እንዲህ ይመዝግቡ?`
      : `${day} is normally ${usual.map(nameOf).join(", ")}, but you're recording ${nameOf(scanState.program)}. Record it anyway?`,
      { okLabel: am ? "አዎ መዝግብ" : "Record anyway", cancelLabel: am ? "ፕሮግራም ልቀይር" : "Change program" });
    if (!ok) return; // batch is kept so the program can be changed first
  }
  const items = [...scanState.batch];
  scanState.batch = [];
  renderBatchList();
  for (const item of items) {
    const { status } = await recordAttendance(item.memberId, scanState.program, item.scannedAt);
    pushScanFeed({ fullName: item.fullName }, status);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = t("batch.confirmedToast", { n: items.length });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function pushScanFeed(member, status) {
  const feed = el("scanFeed");
  if (!feed) return;
  const badge = status === "late" ? `<span class="badge badge-amber">${t("scan.late")}</span>` : `<span class="badge badge-green">${t("scan.onTime")}</span>`;
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `<div><b>${member.fullName}</b><br><span class="muted">${new Date().toLocaleTimeString()}</span></div>${badge}`;
  feed.prepend(row);
  if (navigator.vibrate) navigator.vibrate(60);
}

async function toggleCamera() {
  const video = el("video"), btn = el("camToggle"), wrap = el("videoWrap"), status = el("scanStatus"), torchBtn = el("torchToggle");

  if (scanState.streaming) {
    scanState.stream.getTracks().forEach((tr) => tr.stop());
    scanState.streaming = false;
    scanState.torchOn = false;
    wrap.style.display = "none";
    status.style.display = "none";
    torchBtn.style.display = "none";
    torchBtn.classList.remove("active-lang");
    btn.textContent = t("scan.startCamera");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    await showAlert(t("scan.cameraError") + ": " + t("scan.cameraNotSupported"));
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanState.stream = stream;
    video.srcObject = stream;
    wrap.style.display = "block";
    status.style.display = "block";
    await video.play();
    scanState.streaming = true;
    btn.textContent = t("scan.stopCamera");
    scanLoop();

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      torchBtn.style.display = "inline-flex";
    }
  } catch (err) {
    await showAlert(t("scan.cameraError") + ": " + err.message);
  }
}

async function toggleTorch() {
  if (!scanState.stream) return;
  const track = scanState.stream.getVideoTracks()[0];
  if (!track) return;
  scanState.torchOn = !scanState.torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: scanState.torchOn }] });
    el("torchToggle").classList.toggle("active-lang", scanState.torchOn);
  } catch (e) {
    scanState.torchOn = false;
  }
}

function scanLoop() {
  const video = el("video"), canvas = el("canvas");
  if (!scanState.streaming || !video || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    if (scanState.streaming) requestAnimationFrame(scanLoop);
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // jsQR must be loaded globally
  if (typeof jsQR === 'undefined') {
    console.warn('jsQR not loaded');
    if (scanState.streaming) requestAnimationFrame(scanLoop);
    return;
  }
  const code = jsQR(imageData.data, imageData.width, imageData.height);

  if (code && code.data && code.data.startsWith("FTW1|")) handleQrHit(code.data);
  if (scanState.streaming) requestAnimationFrame(scanLoop);
}

async function handleQrHit(qrId) {
  const now = Date.now();
  const last = scanState.recentHits.get(qrId) || 0;
  if (now - last < 1500) return;
  scanState.recentHits.set(qrId, now);

  if (scanState.recentHits.size > 50) {
    const cutoff = now - 10000;
    for (const [key, value] of scanState.recentHits) {
      if (value < cutoff) scanState.recentHits.delete(key);
    }
  }

  const members = await getVisibleMembers();
  const member = members.find((m) => m.qrId === qrId);
  if (!member) return;
  await queueScan(member.id);
}
