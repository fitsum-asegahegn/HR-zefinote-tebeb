/* ፍኖተ ጥበብ — Settings screen.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   MUST load BEFORE app.js: app.js builds RENDERERS at load time and
   references renderSettings.
   Roles/permissions helpers live in roles.js.
   Depends on globals: put, getAll, getSettings, setSetting, getSession,
   sbClient, signOut, syncNow, moreBackBtn, userRole, roleLabel,
   the notif... and bio... functions (device.js), testNotifyNow, exportScansJSON, importScansJSON,
   exportAttendanceExcel, gregorianToEthiopianTime, ethiopianToGregorianTime,
   getSupabaseConfig, showAlert, withButtonLoading, applyStaticI18n,
   setLang, getLang, t, el. */

// ---------- Settings ----------
async function renderSettings() {
  const settings = await getSettings();
  const programs = await getAll("programs");
  const session = await getSession();
  const cfg = getSupabaseConfig();
  const notifOn = await notifIsEnabled();
  const notifSupported = notifIsSupported();
  const bioOn = await bioIsEnabled();
  const bioSupported = await bioIsSupported();
  const lang = getLang();

  function displayTime(gregTime) {
    if (getLang() === 'am' && gregTime) {
      return gregorianToEthiopianTime(gregTime);
    }
    return gregTime || '';
  }

  el("view").innerHTML = `
    ${moreBackBtn()}
    <h3 class="section-title">${t("settings.languageTitle")}</h3>
    <div class="toolbar">
      <button class="btn-secondary ${getLang() === "am" ? "active-lang" : ""}" id="langAm">አማርኛ</button>
      <button class="btn-secondary ${getLang() === "en" ? "active-lang" : ""}" id="langEn">English</button>
    </div>

    <h3 class="section-title">${lang === "am" ? "መለያ" : "Account"}</h3>
    <p class="muted">
      ${lang === "am" ? "ደረጃ" : "Role"}:
      <b>${roleLabel(userRole(), lang)}</b>
      ${window.currentDisplayName ? " · " + window.currentDisplayName : ""}
    </p>
    ${sbClient
      ? `<button id="signOutBtn" class="btn-secondary">${lang === "am" ? "ውጣ" : "Sign Out"}</button>`
      : `<p class="muted">${lang === "am" ? "ያለ ደመና ሁነታ እየሰሩ ነው" : "Running without cloud sync"}</p>`}

    <details class="settings-section" open>
      <summary style="cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;">${t("settings.generalTitle")}</summary>
      <div class="form-grid">
        <label>${t("settings.defaultStart")}</label>
        <input id="s_startTime" class="text-input" placeholder="${getLang() === 'am' ? 'ለምሳሌ ከቀኑ 6:00 = 0, 12:00 = 6, ምሽቱ 6:00 = 12 ይተይቡ' : 'e.g. 6AM=0, 12PM=6, 6PM=12'}" value="${displayTime(settings.defaultStartTime)}"/>
        <label>${t("settings.grace")}</label>
        <input id="s_grace" type="number" class="text-input" value="${settings.graceMinutes}"/>
        <label>${t("settings.confessionInterval")}</label>
        <input id="s_conf" type="number" class="text-input" value="${settings.confessionIntervalMonths}"/>
        <label>${t("settings.absenceThreshold")}</label>
        <input id="s_abs" type="number" class="text-input" value="${settings.absenceThreshold}"/>
        <label>${t("settings.deviceName")}</label>
        <input id="s_device" class="text-input" value="${settings.deviceName || ""}" placeholder="${t("settings.deviceNamePlaceholder")}"/>
      </div>
      <button id="saveSettings" class="btn-primary">${t("settings.save")}</button>
    </details>

    <details class="settings-section">
      <summary style="cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;">${t("settings.programTimesTitle")}</summary>
      <div class="list">
        ${programs.map(p => `
          <div class="list-row">
            <div><b>${p.name}</b></div>
            <div class="row-actions">
              <input class="text-input small" placeholder="${getLang() === 'am' ? 'ሰዓት' : 'HH:MM'}" id="pt_${p.key}" value="${displayTime(p.startTime)}"/>
              <input class="text-input small" placeholder="min" id="pg_${p.key}" value="${p.graceMinutes || ''}"/>
            </div>
          </div>`).join("")}
      </div>
      <button id="saveProgs" class="btn-secondary">${t("settings.saveProgramTimes")}</button>
    </details>

    <details class="settings-section">
      <summary style="cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;">${lang === "am" ? "ማሳወቂያዎች" : "Notifications"}</summary>
      <p class="muted">${lang === "am" ? "በዚህ መሳሪያ ላይ ብቻ የሚታዩ የአካባቢ ማስታወሻዎች ናቸው (ማዕከላዊ push አገልጋይ የለም)።" : "Local reminders shown only on this device — there's no push server behind these."}</p>
      ${notifSupported
        ? `<div class="toolbar">
             <button id="notifToggleBtn" class="btn-secondary">${notifOn ? (lang === "am" ? "ማሳወቂያዎችን አጥፋ" : "Disable Reminders") : (lang === "am" ? "ማሳወቂያዎችን አብራ" : "Enable Reminders")}</button>
             ${notifOn ? `<button id="notifTestBtn" class="btn-secondary">${lang === "am" ? "አሁን ሞክር" : "Test Now"}</button>` : ""}
           </div>`
        : `<p class="muted">${lang === "am" ? "በዚህ መሣሪያ/አሳሽ ማሳወቂያ አይደገፍም" : "Notifications aren't supported on this device/browser."}</p>`}
    </details>

    <details class="settings-section">
      <summary style="cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;">${lang === "am" ? "የባዮሜትሪክ መቆለፊያ" : "Biometric Lock"}</summary>
      <p class="muted">${lang === "am" ? "መተግበሪያውን በሚከፍቱበት ጊዜ በዚህ መሣሪያ ላይ በጣት አሻራ/በፊት ማወቂያ እንዲቆለፍ ያድርጉ።" : "Require this device's fingerprint/face unlock to open the app."}</p>
      ${bioSupported
        ? `<div class="toolbar"><button id="bioToggleBtn" class="btn-secondary">${bioOn ? (lang === "am" ? "መቆለፊያውን አጥፋ" : "Disable Lock") : (lang === "am" ? "መቆለፊያውን አብራ" : "Enable Lock")}</button></div>`
        : `<p class="muted">${lang === "am" ? "በዚህ መሣሪያ ላይ አይደገፍም" : "Not supported on this device."}</p>`}
    </details>

    <details class="settings-section" open>
      <summary style="cursor:pointer;color:var(--amber);font-family:'Fraunces','Noto Sans Ethiopic',serif;font-size:1rem;margin:22px 0 8px;">${t("settings.syncTitle")}</summary>
      <p class="muted" id="syncStatus">-</p>
      <div class="toolbar">
        <button id="syncBtn" class="btn-secondary">${t("settings.syncNow")}</button>
        ${!["scanner", "children"].includes(userRole()) ? `
        <button id="exportJsonBtn" class="btn-secondary">${t("settings.exportJson")}</button>
        <label class="btn-secondary file-btn">${t("settings.importJson")}<input type="file" id="importJsonInput" accept=".json" style="display:none;"/></label>
        <button id="exportExcelBtn" class="btn-secondary">${t("settings.exportExcel")}</button>` : ""}
      </div>
    </details>
  `;

  el("langAm").onclick = () => { setLang("am"); applyStaticI18n(); renderSettings(); };
  el("langEn").onclick = () => { setLang("en"); applyStaticI18n(); renderSettings(); };

  const signOutBtn = el("signOutBtn");
  if (signOutBtn) signOutBtn.onclick = signOut;

  const notifBtn = el("notifToggleBtn");
  if (notifBtn) {
    notifBtn.onclick = async () => {
      if (notifOn) {
        await notifDisable();
      } else {
        try {
          await notifEnable();
          checkAndNotify();
        } catch (e) {
          await showAlert(e.message);
        }
      }
      renderSettings();
    };
  }
  const notifTestBtn = el("notifTestBtn");
  if (notifTestBtn) notifTestBtn.onclick = () => testNotifyNow();

  const bioBtn = el("bioToggleBtn");
  if (bioBtn) {
    bioBtn.onclick = async () => {
      if (bioOn) {
        await bioDisable();
      } else {
        try {
          await bioEnable();
        } catch (e) {
          await showAlert(e.message);
        }
      }
      renderSettings();
    };
  }

  el("saveSettings").onclick = async () => {
    let startTime = el("s_startTime").value || "10:00";
    if (getLang() === "am" && startTime) startTime = ethiopianToGregorianTime(startTime);
    await setSetting("defaultStartTime", startTime);
    await setSetting("graceMinutes", Number(el("s_grace").value) || 0);
    await setSetting("confessionIntervalMonths", Number(el("s_conf").value) || 12);
    await setSetting("absenceThreshold", Number(el("s_abs").value) || 3);
    await setSetting("deviceName", el("s_device").value || "");
    await showAlert(t("settings.saved"));
  };

  el("saveProgs").onclick = async () => {
    for (const p of programs) {
      let startTime = el("pt_" + p.key).value || "";
      if (getLang() === "am" && startTime) startTime = ethiopianToGregorianTime(startTime);
      p.startTime = startTime;
      p.graceMinutes = el("pg_" + p.key).value || "";
      await put("programs", p);
    }
    await showAlert(t("settings.saved"));
  };

  el("syncBtn").onclick = (e) => withButtonLoading(e.currentTarget, getLang() === "am" ? "በማመሳሰል ላይ..." : "Syncing...", syncNow);
  if (el("exportJsonBtn")) el("exportJsonBtn").onclick = exportScansJSON;
  if (el("exportExcelBtn")) el("exportExcelBtn").onclick = exportAttendanceExcel;

  if (el("importJsonInput")) el("importJsonInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { mCount, aCount } = await importScansJSON(file);
    await showAlert(t("settings.importedJsonResult", { m: mCount, a: aCount }));
  };
}
