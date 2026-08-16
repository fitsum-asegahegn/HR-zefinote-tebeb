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

-- RLS: any signed-in HR team member can read/write everything.
-- Good enough for a small internal team sharing one Supabase project;
-- tighten later if you need per-role restrictions.
alter table members enable row level security;
alter table attendance enable row level security;
alter table hr_events enable row level security;

create policy "authenticated full access members" on members
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access attendance" on attendance
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access hr_events" on hr_events
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
