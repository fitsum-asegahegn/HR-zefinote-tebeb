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
-- If you're picking up the family-structure + department-chair sync,
-- just run the "families" and "dept_heads" table blocks below (search
-- for "families" / "dept_heads") — everything else can be skipped.
--
-- If you're adding the display-name feature to an existing project,
-- just run the "profiles" table block below (search for "profiles") —
-- everything else can be skipped.

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

-- Role-based access control: every signed-up user is 'member' by default;
-- promote someone to 'admin' manually in the Table Editor (or via SQL:
-- update user_roles set role='admin' where user_id='...').
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  updated_at timestamptz default now()
);

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'member');
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
  updated_at timestamptz default now()
);

create or replace function handle_new_user_profile() returns trigger as $$
begin
  insert into public.profiles (user_id, display_name) values (new.id, split_part(new.email, '@', 1));
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

-- RLS: any signed-in HR team member can read/write members & attendance.
-- Deleting members is admin-only (enforced both here and, defensively, in
-- the app UI which hides the delete button for non-admins).
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

create policy "authenticated read members" on members
  for select using (auth.role() = 'authenticated');
create policy "authenticated insert members" on members
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update members" on members
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin delete members" on members
  for delete using (is_admin());

create policy "authenticated read attendance" on attendance
  for select using (auth.role() = 'authenticated');
create policy "authenticated insert attendance" on attendance
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update attendance" on attendance
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin delete attendance" on attendance
  for delete using (is_admin());

create policy "authenticated full access hr_events" on hr_events
  for select using (auth.role() = 'authenticated');
create policy "authenticated write hr_events" on hr_events
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update hr_events" on hr_events
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin delete hr_events" on hr_events
  for delete using (is_admin());

-- Families: same shape as members — anyone signed in can read/write,
-- only admins can delete. The app currently only deletes families
-- locally (never pushes a remote delete), but the policy is here for
-- when/if that's added.
create policy "authenticated read families" on families
  for select using (auth.role() = 'authenticated');
create policy "authenticated insert families" on families
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update families" on families
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin delete families" on families
  for delete using (is_admin());

-- Department chairs: anyone signed in can read/write. No delete policy —
-- the app never removes a department row, only updates head_name.
create policy "authenticated read dept_heads" on dept_heads
  for select using (auth.role() = 'authenticated');
create policy "authenticated insert dept_heads" on dept_heads
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update dept_heads" on dept_heads
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "read own role" on user_roles
  for select using (auth.uid() = user_id);
create policy "admin manage roles" on user_roles
  for update using (is_admin()) with check (is_admin());

-- Everyone can see everyone's display name (needed so "called by" shows
-- correctly to other HR members); each person can only edit their own.
create policy "authenticated read profiles" on profiles
  for select using (auth.role() = 'authenticated');
create policy "user manage own profile" on profiles
  for insert with check (auth.uid() = user_id);
create policy "user update own profile" on profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
