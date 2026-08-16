# ፍኖተ ጥበብ — ዲጂታል መገኘት (Digital Attendance PWA)

Offline-first QR attendance system for the HR (የሰው ሀብት አስተዳደር) department.
Works fully on-device via IndexedDB with no backend at all. Supabase is
**optional** — connect it if you want multiple phones to sync and want
sign-in per HR member; skip it and the app runs entirely offline/local.

Bilingual: every screen has an EN/አማ toggle in the top-right corner
(also selectable in ቅንብር/Settings). Language choice is remembered per device.

## Deploy
1. Push this folder to a GitHub Pages repo (e.g. `tools/attendance/`),
   same pattern as your other Tools 1–4.
2. Open the URL on a phone → "Add to Home Screen" / "Install app".
3. First load must happen **online once** so the service worker can cache
   the app shell and CDN libraries (QR gen/scan, Excel, Supabase client).
   After that it works fully offline.

## Optional: connect Supabase
1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste and run `supabase-schema.sql` from this
   folder — creates `members`, `attendance`, `hr_events` tables + RLS
   policies (any signed-in user can read/write, good enough for a small
   internal team).
3. In **Authentication → Providers**, confirm Email is enabled. For a
   small trusted team you can turn off "Confirm email" so sign-up works
   immediately without an email step.
4. In **Project Settings → API**, copy the **Project URL** and **anon
   public key**.
5. On first app load (or Settings → ☁️ Supabase connection if you skipped
   it before), paste those two values in and continue. You'll land on a
   sign-in/sign-up screen — each HR member creates their own account.
6. If you'd rather not use the cloud at all, tap **"Skip — offline only"**
   on that first screen. You can always come back to Settings later and
   connect it.

## First-time data setup
1. **አባላት/Members** → **Excel አስገባ/Import Excel** → upload your member
   list. Recognized headers (any of): `ሙሉ ስም`/`Name`, `ስልክ`/`Phone`,
   `ምድብ`/`Category`, `ንስሃ ቀን`/`Last Confession` (optional). Each row gets
   a unique QR code (`FTW1|...`) automatically.
2. **ቅንብር/Settings** → set default start time (e.g. `16:00`), grace/late
   window in minutes, ንስሃ interval (months), and consecutive-absence
   threshold. Per-program (ትምህርት/ዝማሬ/ጸሎት) start times can override the
   default individually.
3. **አባላት → 🖨 ሁሉንም QR አትም/Print all QR codes** to print a sheet of QR +
   names for ID cards or handouts.

## Daily use (offline)
- **ስካን/Scan** tab → pick the program → start camera → point at each
  student's QR. Status ("በሰዓቱ/On time" or "ዘግይቷል/Late") is computed
  instantly and locally from the program's start time + grace window —
  no internet required. Manual name-search is the fallback if a phone
  has no camera or a QR is missing/damaged.
- Everything queues locally (`synced:false`) until the phone is online
  and (if configured) signed in to Supabase.

## Syncing multiple phones
- **With Supabase connected + signed in:** Settings → 🔄 Sync now pushes
  pending members/attendance up and pulls anything new down. It also
  auto-triggers whenever the phone regains a connection.
- **Without Supabase (fully offline mode):** Settings → Export JSON on
  each phone after service, then Import JSON on a "master" device to
  merge — send the file over Telegram/Drive like you already do for the
  yearbook bot.

## What it tracks automatically
- **Late logic:** per-program start time + configurable grace minutes,
  editable anytime in Settings.
- **3+ consecutive absences:** Dashboard flags anyone missing that many
  sessions in a row (any program counts as "present" that week) — your
  call list.
- **ንስሃ (confession) due:** flips a member to "due" once your configured
  number of months has passed since their `lastConfessionDate`. Mark
  "ንስሃ ገብቷል ✓" from the dashboard, or bulk-update via a re-imported Excel
  with the ንስሃ ቀን column filled.
- **HR internal relationship-building reminders:** the 5 team-cohesion
  items (monthly meeting, agape day x2/yr, spiritual trip, recognition,
  celebration/condolence check-ins) surface on the dashboard with due
  dates; "ተከናውኗል ✓/Done ✓" reschedules the recurring ones.

## Files
- `index.html` — app shell, dark/amber styling (Fraunces + JetBrains Mono)
- `i18n.js` — full AM/EN dictionary + `t()` helper + language toggle
- `auth.js` — Supabase client init, sign-in/sign-up screens, cloud sync
- `app.js` — IndexedDB, Excel import, QR gen/scan, attendance rules,
  dashboard analytics, exports, tab routing, boot/auth orchestration
- `manifest.json`, `sw.js` — PWA installability + offline caching
  (bump the `CACHE` version string in `sw.js` whenever you redeploy
  changed files, so phones pick up the update)
- `supabase-schema.sql` — one-time table + RLS setup for Supabase
- `icon-192.png`, `icon-512.png` — app icons
