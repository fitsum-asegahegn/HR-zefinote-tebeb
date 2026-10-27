/* ፍኖተ ጥበብ — Device features: biometric lock (WebAuthn) and local notifications.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   Depends on globals: get, del, setSetting, getSettings, todayISO, userRole,
   computeConsecutiveAbsences, computeConfessionDue, computePlanReminders,
   showAlert, t, getLang. Everything is used at call time, so load order
   relative to app.js doesn't matter. */

// ---------- Biometric lock (WebAuthn, purely local — no server involved) ----------
// Everything else (translations, Supabase/auth, Ethiopian calendar) is
// provided by i18n.js, auth.js, and ethiopian-calendar.js, loaded before
// this file — do NOT redeclare sbClient/t/getLang/ETH_MONTH_NAMES_*/etc.
// here, it will throw "Identifier has already been declared" and stop
// this entire script from running.
//
// Uses a platform authenticator (Face/Touch ID, Windows Hello, Android
// fingerprint) purely as a local re-auth gate for opening the app. The
// challenge is generated on-device and never leaves it, and there's no
// server to verify the assertion against — this proves "same device/
// person who set it up," not a cryptographic identity. Requires a secure
// context (HTTPS or localhost).
async function bioIsSupported() {
  return !!(window.PublicKeyCredential && window.isSecureContext &&
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
}
async function bioIsEnabled() {
  const row = await get("settings", "bioCredentialId");
  return !!(row && row.value);
}
async function bioEnable() {
  if (!(await bioIsSupported())) throw new Error(getLang() === "am" ? "አይደገፍም" : "Not supported on this device.");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "ፍኖተ ጥበብ" },
      user: { id: userId, name: "local-lock", displayName: "Local Lock" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error(getLang() === "am" ? "ተሰርዟል" : "Setup was cancelled.");
  const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  await setSetting("bioCredentialId", credId);
  return true;
}
async function bioDisable() {
  await del("settings", "bioCredentialId");
}
async function unlockWithBiometric() {
  const row = await get("settings", "bioCredentialId");
  if (!row || !row.value) return true; // not enabled — nothing to unlock
  try {
    const idBytes = Uint8Array.from(atob(row.value), (c) => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: idBytes, type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch (e) {
    return false;
  }
}

// ---------- Local notifications (no push server — checked on an interval while the app is open) ----------
function notifIsSupported() { return "Notification" in window; }
async function notifIsEnabled() {
  const row = await get("settings", "notificationsEnabled");
  return !!(row && row.value);
}
async function notifEnable() {
  if (!notifIsSupported()) throw new Error(getLang() === "am" ? "አይደገፍም" : "Not supported on this device/browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(getLang() === "am" ? "ፈቃድ አልተሰጠም" : "Notification permission was denied.");
  await setSetting("notificationsEnabled", true);
}
async function notifDisable() {
  await setSetting("notificationsEnabled", false);
}
// Android throws "Illegal constructor" from `new Notification(...)` once a
// service worker is registered — it requires going through the service
// worker's registration instead. Desktop/other browsers are usually fine
// with either, so this tries the service worker path first and falls back.
async function sendNotification(title, options) {
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch (e) {
    // fall through to the direct constructor below
  }
  try {
    new Notification(title, options);
    return true;
  } catch (e) {
    return false;
  }
}

async function buildAndFireNotifications() {
  if (!notifIsSupported() || Notification.permission !== "granted") return false;
  if (userRole() === "scanner") return false; // scanners don't see call lists/reminders
  const lang = getLang();
  const [absentees, confessionDue, planDue] = await Promise.all([
    computeConsecutiveAbsences(), computeConfessionDue(), computePlanReminders(),
  ]);
  const overduePlan = planDue.filter((e) => e.overdue);
  let firedAny = false;
  const fire = async (tag, body) => {
    // No explicit `icon` — the browser falls back to the site's favicon,
    // which is what showed up correctly in the original notifications.
    const ok = await sendNotification(t("app.title"), { body, tag });
    if (ok) firedAny = true;
  };
  if (absentees.length) {
    await fire("finote-absence-streak", lang === "am" ? `${absentees.length} ተከታታይ ቀሪ` : `${absentees.length} on an absence streak`);
  }
  if (confessionDue.length) {
    await fire("finote-confession-due", lang === "am" ? `${confessionDue.length} ንስሃ ይጠበቃል` : `${confessionDue.length} confession${confessionDue.length === 1 ? "" : "s"} due`);
  }
  if (overduePlan.length) {
    await fire("finote-plan-overdue", lang === "am" ? `${overduePlan.length} የዘገየ ዕቅድ` : `${overduePlan.length} plan item${overduePlan.length === 1 ? "" : "s"} overdue`);
  }
  return firedAny;
}

async function checkAndNotify() {
  if (!notifIsSupported() || Notification.permission !== "granted") return;
  if (!(await notifIsEnabled())) return;
  const settings = await getSettings();
  const today = todayISO();
  if (settings.lastNotifiedDate === today) return; // once a day is enough for a local reminder
  const firedAny = await buildAndFireNotifications();
  if (firedAny) await setSetting("lastNotifiedDate", today);
}

// Manual trigger for testing against real current data — ignores the
// once-a-day gate above, since that gate exists to avoid pestering the
// user during normal use, not to block a deliberate on-demand check.
window.testNotifyNow = async () => {
  const lang = getLang();
  if (!notifIsSupported() || Notification.permission !== "granted") {
    await showAlert(lang === "am" ? "ማሳወቂያ ገና አልነቃም" : "Notifications aren't enabled yet.");
    return;
  }
  const firedAny = await buildAndFireNotifications();
  if (firedAny) {
    await setSetting("lastNotifiedDate", todayISO());
  } else {
    await showAlert(lang === "am"
      ? "በአሁኑ ጊዜ የሚያሳውቅ ነገር የለም — ቀሪ የለም፣ ንስሃ አልደረሰም፣ የዘገየ ዕቅድም የለም"
      : "Nothing to notify right now — no current absence streaks, confessions due, or overdue plan items.");
  }
};
