-- Run this in Supabase → SQL Editor once, on a fresh project.
-- Then in Authentication → Providers, make sure "Email" is enabled
-- (Confirm email can be turned off for a small internal team if you
-- want sign-up to work without an email step).
--
-- If you already ran an earlier version of this file and are just
-- picking up the grade + call-log additions, run this migration
-- instead of the CREATE TABLE below:
--   alter table members add column if not exists grade integer check (grade between 1 and 12);
--   alter table members add column if not exists call_log jsonb;
--   alter table members add column if not exists call_history jsonb;
--
-- If you're picking up the extended registration fields (Christian name,
-- gender, age, address, parent/confession-father info, department
-- preferences, etc.), run this migration instead of the CREATE TABLE below:
--   alter table members add column if not exists christian_name text;
--   alter table members add column if not exists gender text;
--   alter table members add column if not exists age integer;
--   alter table members add column if not exists alt_phone text;
--   alter table members add column if not exists address text;
--   alter table members add column if not exists confession_father text;
--   alter table members add column if not exists parish text;
--   alter table members add column if not exists parent_name text;
--   alter table members add column if not exists parent_phone text;
--   alter table members add column if not exists education_level text;
--   alter table members add column if not exists spiritual_education text;
--   alter table members add column if not exists dept1 text;
--   alter table members add column if not exists dept2 text;
--   alter table members add column if not exists dept3 text;
--
-- If you're picking up member photos (ID card photo), run:
--   alter table members add column if not exists photo text;
--
-- If you're picking up the family-structure + department-chair sync,
-- just run the "families" and "dept_heads" table blocks below (search
-- for "families" / "dept_heads") — everything else can be skipped.
--
-- If you're adding the display-name feature to an existing project,
-- just run the "profiles" table block below (search for "profiles") —
-- everything else can be skipped.
--
-- If you're picking up roles & permissions (pending / scanner / member /
-- admin), run ONLY supabase-permissions-migration.sql from this folder.
--
-- If you're picking up the Advice (ምክር) feature, run ONLY
-- supabase-advice-migration.sql from this folder.
--
-- If you're picking up the Punishments (ቅጣት) feature, run ONLY
-- supabase-punishments-migration.sql from this folder.
--
-- If you're picking up the Permissions (ፈቃድ) feature, run ONLY
-- supabase-excuses-migration.sql from this folder.
--
-- If you're picking up synced deletes (soft-delete tombstones), run
-- ONLY this migration (the last block of this file, "Synced deletes"):
--   alter table members add column if not exists deleted_at timestamptz;
--   alter table families add column if not exists deleted_at timestamptz;
--   ...then the guard_deleted_at() function + two triggers at the bottom.

create table if not exists members (
  id uuid primary key,
  full_name text not null,
  phone text,
  category text,
  grade integer check (grade between 1 and 12),
  qr_id text unique not null,
  last_confession_date date,
  join_date date,
  active boolean default true,
  call_log jsonb, -- { called, reason, calledBy, calledAt } for the absence-call workflow
  call_history jsonb, -- append-only log of every call made, kept even after resolved (for reports)
  christian_name text,
  gender text,
  age integer,
  alt_phone text,
  address text,
  confession_father text,
  parish text,
  parent_name text,
  parent_phone text,
  education_level text,
  spiritual_education text,
  dept1 text,
  dept2 text,
  dept3 text,
  photo text, -- small compressed JPEG data URL (see resizeImageFile in app.js)
  deleted_at timestamptz, -- soft-delete tombstone; see "Synced deletes" below
  updated_at timestamptz default now()
);

create table if not exists attendance (
  id uuid primary key,
  member_id uuid references members(id) on delete cascade,
  program_key text not null,
  session_date date not null,
  ts timestamptz not null,
  status text not null,
  device_id text,
  created_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  unique (member_id, session_date, program_key)
);

create table if not exists hr_events (
  id uuid primary key,
  title_key text,
  recurrence_days integer,
  next_date date,
  last_done date,
  updated_at timestamptz default now()
);

-- Family structure: father/mother/first-son/children are all references
-- to existing members. children_ids is a jsonb array of member uuids
-- rather than a native uuid[] to keep it consistent with the jsonb-array
-- pattern already used for call_history above (and to keep the client
-- mapping code simple — no array-literal quoting to worry about).
create table if not exists families (
  id uuid primary key,
  father_id uuid references members(id) on delete set null,
  mother_id uuid references members(id) on delete set null,
  first_son_id uuid references members(id) on delete set null,
  children_ids jsonb default '[]'::jsonb,
  address_code text,
  last_meeting_date date,
  meeting_log jsonb default '[]'::jsonb, -- append-only log of monthly family-meeting check-ins
  deleted_at timestamptz, -- soft-delete tombstone; see "Synced deletes" below
  updated_at timestamptz default now()
);

-- Department chairs: one row per department name (matches DEPT_OPTIONS in
-- app.js). Small, low-conflict table — the client always pushes/pulls it
-- in full on every sync rather than tracking per-row dirty state.
create table if not exists dept_heads (
  dept text primary key,
  head_name text,
  updated_at timestamptz default now()
);

-- Role-based access control: every signed-up user starts as 'pending' (no
-- access) until an admin approves them in the app (More -> Users). The very
-- first admin has to be set by hand: sign up, then in the SQL Editor run
-- update user_roles set role='admin' where user_id='...'.
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'pending' check (role in ('pending','scanner','member','admin')),
  updated_at timestamptz default now()
);

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'pending');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Display name: separate from user_roles on purpose, so a self-editable
-- field can never touch the role column (no privilege-escalation path).
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  updated_at timestamptz default now()
);

create or replace function handle_new_user_profile() returns trigger as $$
begin
  insert into public.profiles (user_id, display_name, email) values (new.id, split_part(new.email, '@', 1), new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure handle_new_user_profile();

-- keep updated_at fresh on every write, needed for incremental sync
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_members_updated on members;
create trigger trg_members_updated before update on members
  for each row execute procedure set_updated_at();

drop trigger if exists trg_attendance_updated on attendance;
create trigger trg_attendance_updated before update on attendance
  for each row execute procedure set_updated_at();

drop trigger if exists trg_hrevents_updated on hr_events;
create trigger trg_hrevents_updated before update on hr_events
  for each row execute procedure set_updated_at();

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute procedure set_updated_at();

drop trigger if exists trg_families_updated on families;
create trigger trg_families_updated before update on families
  for each row execute procedure set_updated_at();

drop trigger if exists trg_depthead_updated on dept_heads;
create trigger trg_depthead_updated before update on dept_heads
  for each row execute procedure set_updated_at();

-- RLS: access depends on the user's role (see app_role() and the policies
-- below). Deleting is admin-only (enforced here, and the app UI hides the
-- delete buttons for everyone else).
alter table members enable row level security;
alter table attendance enable row level security;
alter table hr_events enable row level security;
alter table user_roles enable row level security;
alter table profiles enable row level security;
alter table families enable row level security;
alter table dept_heads enable row level security;

create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Which role is the signed-in user? (null if they have no user_roles row,
-- which makes every policy below deny them.) security definer so it can read
-- user_roles regardless of that table's own RLS.
create or replace function app_role() returns text as $$
  select role from user_roles where user_id = auth.uid();
$$ language sql security definer stable;

-- Roles: pending (new sign-up, no access) | scanner (attendance only,
-- member names readable) | member (day-to-day HR work) | admin.
-- Admin-only: deleting (soft-delete trigger below), changing roles.
-- Everything is enforced here, not just hidden in the UI.

-- members: scanners can READ (they need names/QR to take attendance) but not write.
create policy "role read members" on members
  for select using (app_role() in ('scanner','member','admin'));
create policy "role insert members" on members
  for insert with check (app_role() in ('member','admin'));
create policy "role update members" on members
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));
create policy "admin delete members" on members
  for delete using (is_admin());

-- attendance: the one table scanners can write.
create policy "role read attendance" on attendance
  for select using (app_role() in ('scanner','member','admin'));
create policy "role insert attendance" on attendance
  for insert with check (app_role() in ('scanner','member','admin'));
create policy "role update attendance" on attendance
  for update using (app_role() in ('scanner','member','admin')) with check (app_role() in ('scanner','member','admin'));
create policy "admin delete attendance" on attendance
  for delete using (is_admin());

create policy "role read hr_events" on hr_events
  for select using (app_role() in ('member','admin'));
create policy "role insert hr_events" on hr_events
  for insert with check (app_role() in ('member','admin'));
create policy "role update hr_events" on hr_events
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));
create policy "admin delete hr_events" on hr_events
  for delete using (is_admin());

-- Families: members and admins only (scanners never see them). Deletes from
-- the app are soft-deletes guarded by the trigger in "Synced deletes" below;
-- the hard-delete policy is for manual cleanup in the dashboard.
create policy "role read families" on families
  for select using (app_role() in ('member','admin'));
create policy "role insert families" on families
  for insert with check (app_role() in ('member','admin'));
create policy "role update families" on families
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));
create policy "admin delete families" on families
  for delete using (is_admin());

-- Department chairs: members and admins. No delete policy — the app never
-- removes a department row, only updates head_name.
create policy "role read dept_heads" on dept_heads
  for select using (app_role() in ('member','admin'));
create policy "role insert dept_heads" on dept_heads
  for insert with check (app_role() in ('member','admin'));
create policy "role update dept_heads" on dept_heads
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));

-- Everyone can read their OWN role (a pending user needs to learn they were
-- approved); admins can read everyone's and change roles. Nobody else can
-- touch this table, so no one can grant themselves a role.
create policy "read own role" on user_roles
  for select using (auth.uid() = user_id);
create policy "admin read roles" on user_roles
  for select using (is_admin());
create policy "admin manage roles" on user_roles
  for update using (is_admin()) with check (is_admin());

-- Display names/emails: visible to approved users (so "called by" shows
-- correctly and admins can see who is waiting); you can always see and edit
-- your own row. Still a separate table from user_roles on purpose.
create policy "role read profiles" on profiles
  for select using (auth.uid() = user_id or app_role() in ('scanner','member','admin'));
create policy "user manage own profile" on profiles
  for insert with check (auth.uid() = user_id);
create policy "user update own profile" on profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Synced deletes (soft-delete tombstones)
-- ---------------------------------------------------------------------
-- The app never hard-DELETEs members/families remotely. Deleting sets
-- deleted_at, which bumps updated_at (via the triggers above) so every
-- other device picks it up on its next incremental pull and removes the
-- record locally; a fresh install pulls the tombstone too and skips the
-- row instead of resurrecting it.
--
-- Because a soft-delete is an UPDATE (which the member/admin update
-- policies allow), this trigger is what keeps
-- deleting admin-only at the database level, not just in the UI.
-- An admin can "undelete" by setting deleted_at back to null.
alter table members add column if not exists deleted_at timestamptz;
alter table families add column if not exists deleted_at timestamptz;

create or replace function guard_deleted_at() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null and not is_admin() then
      raise exception 'only admins can delete records';
    end if;
  elsif new.deleted_at is distinct from old.deleted_at and not is_admin() then
    raise exception 'only admins can delete records';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_members_guard_deleted on members;
create trigger trg_members_guard_deleted before insert or update on members
  for each row execute procedure guard_deleted_at();

drop trigger if exists trg_families_guard_deleted on families;
create trigger trg_families_guard_deleted before insert or update on families
  for each row execute procedure guard_deleted_at();

-- ---------------------------------------------------------------------
-- Permissions / excused absences (ፈቃድ). Needs the roles migration first
-- (uses app_role()). Only members and admins can see or change these.
-- Removing a permission is a soft-delete (deleted_at) so other devices can
-- pull the removal, same pattern as members/families.
create table if not exists excuses (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  program_keys jsonb default '[]'::jsonb, -- empty = all programs
  created_by_name text,
  deleted_at timestamptz,
  updated_at timestamptz default now(),
  check (end_date >= start_date)
);

drop trigger if exists trg_excuses_updated on excuses;
create trigger trg_excuses_updated before update on excuses
  for each row execute procedure set_updated_at();

alter table excuses enable row level security;

drop policy if exists "role read excuses" on excuses;
drop policy if exists "role insert excuses" on excuses;
drop policy if exists "role update excuses" on excuses;
create policy "role read excuses" on excuses
  for select using (app_role() in ('member','admin'));
create policy "role insert excuses" on excuses
  for insert with check (app_role() in ('member','admin'));
create policy "role update excuses" on excuses
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));

-- ---------------------------------------------------------------------
-- Punishments (ቅጣት). Needs the roles migration first (uses app_role()).
-- A member on punishment can still attend and be scanned, but is left out of
-- the Service Attendance report until end_date has passed. Only members and
-- admins can see or change these. Removing one is a soft-delete (deleted_at)
-- so other devices can pull the removal.
create table if not exists punishments (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by_name text,
  deleted_at timestamptz,
  updated_at timestamptz default now(),
  check (end_date >= start_date)
);

drop trigger if exists trg_punishments_updated on punishments;
create trigger trg_punishments_updated before update on punishments
  for each row execute procedure set_updated_at();

alter table punishments enable row level security;

drop policy if exists "role read punishments" on punishments;
drop policy if exists "role insert punishments" on punishments;
drop policy if exists "role update punishments" on punishments;
create policy "role read punishments" on punishments
  for select using (app_role() in ('member','admin'));
create policy "role insert punishments" on punishments
  for insert with check (app_role() in ('member','admin'));
create policy "role update punishments" on punishments
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));

-- ---------------------------------------------------------------------
-- Advice / counseling log (ምክር). Needs the roles migration first (uses
-- app_role()). Members who made a fault and were advised to correct it
-- before any punishment. Only members and admins can see or change these.
-- Removing a record is a soft-delete (deleted_at) so other devices can pull it.
create table if not exists advice (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  advised_on date not null,
  fault text,
  advice text,
  advised_by text,
  deleted_at timestamptz,
  updated_at timestamptz default now()
);

drop trigger if exists trg_advice_updated on advice;
create trigger trg_advice_updated before update on advice
  for each row execute procedure set_updated_at();

alter table advice enable row level security;

drop policy if exists "role read advice" on advice;
drop policy if exists "role insert advice" on advice;
drop policy if exists "role update advice" on advice;
create policy "role read advice" on advice
  for select using (app_role() in ('member','admin'));
create policy "role insert advice" on advice
  for insert with check (app_role() in ('member','admin'));
create policy "role update advice" on advice
  for update using (app_role() in ('member','admin')) with check (app_role() in ('member','admin'));
