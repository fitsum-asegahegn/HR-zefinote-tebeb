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
   Everyone starts as `member`; open the `user_roles` table in Supabase
   and change someone's row to `admin` if they should be able to delete
   records.
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

## Batch scanning
Scan (camera or manual search) now queues each hit into a review list
instead of writing it instantly — scan a whole line of kids quickly,
glance at the list to remove any mis-scans, then **✓ Confirm all** writes
them in one go, timestamped by when each was actually scanned (not when
you tapped confirm), so late/on-time is still accurate.

## Printed QR cards (8 per A4 page) + soft copy
Members → 🖨 Print all QR codes lays out an ID-card grid: 2 columns × 4
rows per page, each card split in half — QR on the left, a 3×4 photo box
+ the person's name on the right (paste/attach a photo into the box
however you normally produce ID cards). Every member's individual QR
modal also has **⬇ Download** and **↗ Share** buttons so you can send the
soft copy straight to their phone (e.g. over Telegram) if they forget
the printed card.

## Charts
Reports tab now shows an attendance-trend line (last 12 sessions) and a
per-program on-time/late bar chart, computed entirely from local data —
works offline.

## Local notifications (not server push)
Settings → 🔔 lets you opt in to local reminders that surface absentees,
confession-due members, and overdue HR events while the app is open on
that device. This is genuinely different from real push notifications:
there's no server that can wake the app when it's closed, since that
would require standing up backend infrastructure (a push service +
VAPID keys) which conflicts with this project's zero-server, static-site
design. If you later want true push, that's a separate, heavier project.

## Biometric unlock (device-level convenience only)
Settings → 🔐 lets a device remember a fingerprint/face credential via
WebAuthn. This is **not** a replacement for the Supabase sign-in and
nothing is verified server-side — it's purely a fast local gate so
whoever's holding an already-signed-in phone doesn't have to retype a
password each time. Turning it on only affects that one device/browser.

## Role-based access control (Supabase)
`supabase-schema.sql` now also creates a `user_roles` table: every new
sign-up becomes `member` automatically. Promote someone to `admin` by
editing that table directly in the Supabase dashboard (or `update
user_roles set role='admin' where user_id='...'`). Admins can delete
members/attendance/HR-events; members can read and add/update but not
delete — enforced by Postgres RLS policies, not just hidden buttons, so
it holds even if someone calls the API directly. In offline-only mode
(no Supabase connected) this restriction doesn't apply since there's no
shared database to protect.

## Calling absentees: tap-to-dial + no duplicate calls + reasons
On the Dashboard, each absentee's phone number is now a `tel:` link —
tapping it opens the phone's dialer directly. Once someone calls, they
tap **"ደወልኩ ✓"** and add a short reason (sick, moved away, etc.); the
row then shows "ተደውሏል" (already called) with who called and when, so
another HR member glancing at the same list doesn't call again. There's
an "Undo" if it was marked by mistake.

That status automatically clears the next time the member shows up and
gets scanned — so if they go absent again later, it's treated as a
fresh case and can be called again. The reason itself isn't lost when
it clears, though: every call is also appended to a permanent
`callHistory` log on the member (separate from the live "currently
flagged" status), which is what feeds the **"Absentee call reasons"**
table in the generated Word/PPT reports and the members Excel export —
so patterns in why people are missing sessions are visible over time,
not just in the moment.

## The plan is now built into the system (ዕቅድ tab)
The exact 18-item plan from `የሰው_ሀብት_ክፍል_ዕቅድ.docx` (13 main Article-20 items
+ 5 internal team-cohesion items) is seeded automatically on first load —
the Dashboard's reminder section now shows these real items, not a
generic placeholder.

- **Import from Excel:** ዕቅድ tab → Import Excel. Columns recognized (any
  of): `ተ.ቁ`/`No`, `ንዑስ ክፍል`/`Sub-unit`, `ዕቅድ/ፕሮጀክት`/`Title`, `የክንውን
  ዝርዝር`/`Details`, `ውጤት`/`Outcome`, `አመልካች`/`Indicator`, `መለኪያ`/`Target`,
  `የክንውን ጊዜ`/`Timing`, `ፈጻሚ አካል`/`Executor`, `በጀት`/`Budget`, and optionally
  `ምድብ`/`Category` (`internal` routes it to the team-cohesion section,
  anything else is treated as the main plan). Re-importing updates
  existing rows matched by title + sub-unit rather than duplicating them.
- **Export to Excel** any time to back up or hand-edit the current plan,
  then re-import.
- **Mark items done:** both the Dashboard and the ዕቅድ tab have a
  "ተከናውኗል ✓" button — add a short note (e.g. "given to 12 members") and
  it's logged with today's date. Recurring items (monthly meeting,
  quarterly reports, etc.) automatically push their next-due date
  forward; one-off/as-needed items just log the note.
- **Edit timing/cadence** per item from the ዕቅድ tab — Ethiopian month
  names in the plan text aren't converted to exact Gregorian recurrence
  automatically, so double-check/adjust each item's "repeat every N
  days" the first time you import.
- **Reset to original:** ዕቅድ tab → "ወደ መጀመሪያው ዕቅድ መልስ" wipes any edits
  and restores the exact docx-derived plan.

## Grades 1–12
Every member can now have a grade (1–12) — set it when adding a member
manually, or via an Excel `ክፍል ደረጃ`/`Grade` column on import (`ክፍል`
alone now always means grade, not the old free-text category). Members
tab has a grade filter; the printed ID cards and the QR modal show grade
too.

Reports tab adds a **by-grade attendance-rate chart** and auto-generated
comparison lines (e.g. "Grade 12 attended more than Grade 11"), computed
as scans ÷ (students in that grade × sessions held) so grades with
different class sizes are still comparable. The same chart, table, and
narrative are included in every generated period report.

## One-button period reports (Word / PowerPoint / both)
**Admin-only** (same `user_roles` mechanism as delete): only your account
sees the report generator on the ዕቅድ tab; other signed-in members can
still view/update the plan itself but get a note instead of the
generator. In offline-only mode (no Supabase connected) there's no
shared team to restrict from, so it's shown to whoever's using that
device.

ዕቅድ tab → pick 3/6/12 months and Word/PPT/Both → 🖨 Generate. Built
entirely client-side (no server) from real data:
- Overall stats for the period (members, new members, sessions held,
  on-time/late attendance, confessions recorded, current absentee count)
- Grade-level breakdown + narrative comparisons
- Per-plan-item performance: how many times each item was marked done
  in the period vs. how many times it was expected (from its recurrence
  cadence), with a status (on track / in progress / needs attention /
  done / manual tracking)

The Word doc uses the `docx` library and the PowerPoint uses
`PptxGenJS`, both loaded from CDN and cached by the service worker so
report generation also works offline once the app has loaded online
at least once.

## Background sync (best-effort)
When a scan is recorded while offline, the app also registers a
Background Sync tag so Chromium/Android browsers can push it up shortly
after connectivity returns, even if you've switched away from the app.
This is progressive enhancement only — notably unsupported on iOS
Safari — so the reliable path is still: open the app, it syncs
automatically via the regular online-event listener.

## Files
- `index.html` — app shell, dark/amber styling (Fraunces + JetBrains Mono),
  print CSS for the 8-per-page ID card layout
- `i18n.js` — full AM/EN dictionary + `t()` helper + language toggle with
  automatic browser-locale detection on first run
- `auth.js` — Supabase client init, sign-in/sign-up screens, role lookup,
  cloud sync
- `app.js` — IndexedDB, Excel import/export, QR gen/scan (batch queue),
  attendance rules, dashboard analytics, charts, notifications,
  biometric unlock, plan management + grade analytics, Word/PPT report
  generation, tab routing, boot/auth orchestration
- `manifest.json`, `sw.js` — PWA installability, offline caching, and a
  best-effort Background Sync handler
  (bump the `CACHE` version string in `sw.js` whenever you redeploy
  changed files, so phones pick up the update)
- `supabase-schema.sql` — one-time table + RLS + role setup for Supabase
- `icon-192.png`, `icon-512.png` — app icons
