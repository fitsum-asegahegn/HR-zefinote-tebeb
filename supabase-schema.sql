-- Run this in Supabase → SQL Editor once, on a fresh project.
-- Then in Authentication → Providers, make sure "Email" is enabled
-- (Confirm email can be turned off for a small internal team if you
-- want sign-up to work without an email step).

create table if not exists members (
  id uuid primary key,
  full_name text not null,
  phone text,
  category text,
  qr_id text unique not null,
  last_confession_date date,
  join_date date,
  active boolean default true,
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

-- RLS: any signed-in HR team member can read/write members & attendance.
-- Deleting members is admin-only (enforced both here and, defensively, in
-- the app UI which hides the delete button for non-admins).
alter table members enable row level security;
alter table attendance enable row level security;
alter table hr_events enable row level security;
alter table user_roles enable row level security;

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

create policy "read own role" on user_roles
  for select using (auth.uid() = user_id);
create policy "admin manage roles" on user_roles
  for update using (is_admin()) with check (is_admin());
