-- Children's department role (ሕጻናት ክፍል) + sections for grades 5 and 6.
-- Run this ONCE in Supabase -> SQL Editor BEFORE deploying the new app files
-- (the new app sends a `section` column; without it member sync fails).
-- Needs the roles migration first (uses app_role()).
--
-- Role order: pending < scanner < children < member < admin.
-- "children" can: scan attendance, and read / add / edit members of grades 1-6
-- ONLY (never see grade 7+ or members with no grade), plus the attendance of
-- those members. They cannot delete, and cannot touch anything else.

-- 1) allow the new role value
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles add constraint user_roles_role_check
  check (role in ('pending','scanner','children','member','admin'));

-- 2) sections: ሀ / ለ (used for grades 5 and 6)
alter table members add column if not exists section text;
alter table members drop constraint if exists members_section_check;
alter table members add constraint members_section_check
  check (section is null or section in ('ሀ','ለ'));

-- 3) helper: is this member visible to the children's department?
create or replace function child_can_access_member(mid uuid) returns boolean as $$
  select exists (
    select 1 from members where id = mid and grade between 1 and 6 and deleted_at is null
  );
$$ language sql security definer stable;

-- 4) members
drop policy if exists "role read members" on members;
create policy "role read members" on members
  for select using (
    app_role() in ('scanner','member','admin')
    or (app_role() = 'children' and grade between 1 and 6)
  );

drop policy if exists "role insert members" on members;
create policy "role insert members" on members
  for insert with check (
    app_role() in ('member','admin')
    or (app_role() = 'children' and grade between 1 and 6)
  );

-- with check also stops a children's user from moving a member above grade 6
drop policy if exists "role update members" on members;
create policy "role update members" on members
  for update using (
    app_role() in ('member','admin')
    or (app_role() = 'children' and grade between 1 and 6)
  ) with check (
    app_role() in ('member','admin')
    or (app_role() = 'children' and grade between 1 and 6)
  );

-- 5) attendance: only for members they can see
drop policy if exists "role read attendance" on attendance;
create policy "role read attendance" on attendance
  for select using (
    app_role() in ('scanner','member','admin')
    or (app_role() = 'children' and child_can_access_member(member_id))
  );

drop policy if exists "role insert attendance" on attendance;
create policy "role insert attendance" on attendance
  for insert with check (
    app_role() in ('scanner','member','admin')
    or (app_role() = 'children' and child_can_access_member(member_id))
  );

drop policy if exists "role update attendance" on attendance;
create policy "role update attendance" on attendance
  for update using (
    app_role() in ('scanner','member','admin')
    or (app_role() = 'children' and child_can_access_member(member_id))
  ) with check (
    app_role() in ('scanner','member','admin')
    or (app_role() = 'children' and child_can_access_member(member_id))
  );

-- 6) display names readable by the new role too
drop policy if exists "role read profiles" on profiles;
create policy "role read profiles" on profiles
  for select using (auth.uid() = user_id or app_role() in ('scanner','children','member','admin'));
