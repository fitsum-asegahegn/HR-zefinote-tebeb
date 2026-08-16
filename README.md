# ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)

Offline-first QR attendance system for the HR (የሰው ሀብት አስተዳደር) department.
No backend required — works entirely on-device via IndexedDB. Deploy as a
static site (GitHub Pages, same as your other Tools 1-4) and install it as
a PWA on each HR member's phone.

## Deploy
1. Push this folder as-is to a GitHub Pages repo (e.g. `tools/attendance/`).
2. Open the URL on a phone → browser menu → "Add to Home Screen" / "Install app".
   That's what makes it a PWA (offline-capable, full-screen, own icon).
3. First load must happen **online once** so the service worker can cache
   the app shell and the QR/Excel/scanner libraries. After that it works
   fully offline.

## First-time setup
1. Go to **አባላት (Members)** → **Excel አስገባ** → upload your member list.
   Expected columns (any of these header names work): `ሙሉ ስም`/`Name`,
   `ስልክ`/`Phone`, `ምድብ`/`Category`, `ንስሃ ቀን`/`Last Confession` (optional).
   Each row gets a unique QR code (`FTW1|...`) automatically.
2. **ቅንብር (Settings)** → set the default start time (e.g. `16:00`), the
   grace/late-window in minutes, ንስሃ interval (months), and the
   consecutive-absence threshold. You can also override the start time
   per program (ትምህርት / ዝማሬ / ጸሎት) individually.
3. **አባላት → 🖨 ሁሉንም QR አትም** to print a sheet of QR codes + names to
   hand out / stick in ID cards.

## Daily use (offline)
- **ስካን (Scan)** tab → pick the program (ትምህርት/ዝማሬ/ጸሎት) → start camera
  → point at each student's QR. The app timestamps the scan locally and
  immediately shows "በሰዓቱ" (on-time) or "ዘግይቷል" (late) based on the
  program's start time + grace window — no internet needed.
- If a phone has no camera or a QR is missing, use the manual search
  box on the same screen.
- Everything is queued locally (`synced:false`) until the phone goes
  online again.

## Syncing multiple phones
Two options, pick whichever fits:
- **Simple (no setup):** Settings → **Export JSON** on each phone after
  service, then **Import JSON** that file on a "master" phone/laptop to
  merge. Send the file over Telegram/Drive like you already do for the
  yearbook bot.
- **Automatic:** if you stand up a tiny webhook (e.g. a Google Apps
  Script Web App or a Firebase/Supabase function) that accepts a POST of
  `{ deviceId, records: [...] }`, paste its URL into Settings →
  **የሲንክ አድራሻ**. The app will push pending records automatically
  whenever it detects it's back online.

## What it tracks automatically
- **Late logic:** per-program start time + configurable grace minutes;
  editable anytime in Settings without touching code.
- **3+ consecutive absences:** Dashboard flags anyone missing that many
  sessions in a row across any program, so HR knows who to call.
- **ንስሃ (confession) due:** flips a member to "due" once the configured
  number of months has passed since `lastConfessionDate`. HR marks
  "ንስሃ ገብቷል ✓" on the dashboard, or bulk-updates via a re-imported
  Excel with the `ንስሃ ቀን` column filled in.
- **HR internal relationship-building reminders:** the 5 team-cohesion
  items (monthly meeting, agape day x2/yr, spiritual trip, recognition,
  celebration/condolence check-ins) surface on the dashboard with due
  dates; "ተከናውኗል ✓" reschedules the recurring ones.

## Files
- `index.html` — app shell, dark/amber styling (Fraunces + JetBrains Mono)
- `app.js` — all logic: IndexedDB, Excel import, QR gen/scan, attendance
  rules, dashboard analytics, sync, exports
- `manifest.json`, `sw.js` — PWA installability + offline caching
- `icon-192.png`, `icon-512.png` — app icons
