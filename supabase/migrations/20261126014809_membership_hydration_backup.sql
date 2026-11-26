-- Keep historical group rows; personal history uses the largest legacy total per day
-- because the same water may have been recorded in several groups.
alter table public.hydration_members add column active boolean not null default true;

create table public.hydration_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_oz numeric not null default 64 check (goal_oz > 0 and goal_oz <= 256)
);
insert into public.hydration_profiles
select user_id, min(goal_oz) from public.hydration_members group by user_id;

create table public.hydration_personal (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  oz numeric not null check (oz between 0 and 512),
  goal_oz numeric not null check (goal_oz > 0 and goal_oz <= 256),
  primary key (user_id, day)
);
insert into public.hydration_personal
select d.user_id, d.day, max(d.oz), p.goal_oz
from public.hydration_daily d join public.hydration_profiles p using (user_id)
group by d.user_id, d.day, p.goal_oz;

alter table public.hydration_profiles enable row level security;
alter table public.hydration_personal enable row level security;
revoke all on public.hydration_profiles, public.hydration_personal from public, anon, authenticated;
grant select on public.hydration_profiles, public.hydration_personal to authenticated;
create policy own_profile on public.hydration_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_water on public.hydration_personal for select to authenticated using (user_id = (select auth.uid()));
create index hydration_members_user on public.hydration_members(user_id, group_id) where active;
create index hydration_daily_group_day on public.hydration_daily(group_id, day);
create index hydration_daily_user on public.hydration_daily(user_id);
create index hydration_groups_owner on public.hydration_groups(owner_id);

create or replace function iron_private.hydration_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.hydration_members where group_id = g and user_id = auth.uid() and active);
$$;
drop policy member_read on public.hydration_members;
create policy member_read on public.hydration_members for select to authenticated
  using (active and iron_private.hydration_member(group_id));
drop policy water_read on public.hydration_daily;
create policy water_read on public.hydration_daily for select to authenticated
  using (iron_private.hydration_member(group_id) and exists (
    select 1 from public.hydration_members m
    where m.group_id = hydration_daily.group_id and m.user_id = hydration_daily.user_id and m.active
  ));
drop policy member_goal on public.hydration_members;
drop policy member_leave on public.hydration_members;
drop policy water_insert on public.hydration_daily;
drop policy water_update on public.hydration_daily;
revoke update(goal_oz), delete on public.hydration_members from authenticated;
revoke insert, update on public.hydration_daily from authenticated;
revoke insert, update, delete, truncate on public.workout_backups from public, anon, authenticated;
grant select on public.workout_backups to authenticated;

create table iron_private.recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash bytea not null unique
);
create table iron_private.recovered_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  destination uuid not null references auth.users(id) on delete cascade,
  used_hash bytea not null unique
);
revoke all on iron_private.recovery_codes, iron_private.recovered_users from public, anon, authenticated;

-- Serialize membership changes and writes with recovery. An old JWT is still
-- valid for its session until expiry, so reject writes from retired identities.
create function iron_private.lock_member(u uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if u is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  if exists(select 1 from iron_private.recovered_users where user_id = u) then
    raise exception 'Membership moved to another session';
  end if;
end;
$$;

create function iron_private.lock_current_member() returns void
language sql security definer set search_path = '' as $$
  select iron_private.lock_member(auth.uid())
$$;

create function iron_private.issue_recovery_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  code text := replace(gen_random_uuid()::text, '-', '');
begin
  perform iron_private.lock_member(u);
  insert into iron_private.recovery_codes values (u, sha256(convert_to(code, 'UTF8')))
  on conflict (user_id) do update set code_hash = excluded.code_hash;
  return code;
end;
$$;

create function iron_private.recover_membership(code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  dest uuid := auth.uid();
  source uuid;
  hashed bytea;
begin
  if dest is null or not coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Recovery requires a new anonymous session';
  end if;
  code := lower(regexp_replace(code, '[[:space:]-]', '', 'g'));
  if code is null or code !~ '^[0-9a-f]{32}$' then raise exception 'Invalid recovery code'; end if;
  hashed := sha256(convert_to(code, 'UTF8'));
  select user_id into source from iron_private.recovery_codes where code_hash = hashed;
  if source is null then
    -- A retry from the same destination can complete after a lost HTTP response.
    if exists(select 1 from iron_private.recovered_users where used_hash = hashed and destination = dest) then
      return iron_private.issue_recovery_code();
    end if;
    raise exception 'Invalid or used recovery code';
  end if;
  if source = dest then raise exception 'Invalid or used recovery code'; end if;

  perform iron_private.lock_member(least(source, dest));
  perform iron_private.lock_member(greatest(source, dest));
  delete from iron_private.recovery_codes where user_id = source and code_hash = hashed;
  if not found then raise exception 'Invalid or used recovery code'; end if;
  if exists(select 1 from public.hydration_members where user_id = dest)
    or exists(select 1 from public.hydration_groups where owner_id = dest)
    or exists(select 1 from public.hydration_profiles where user_id = dest)
    or exists(select 1 from public.hydration_personal where user_id = dest)
    or exists(select 1 from public.challenge_members where user_id = dest)
    or exists(select 1 from public.challenges where owner_id = dest)
    or exists(select 1 from public.workout_backups where user_id = dest)
    or exists(select 1 from iron_private.recovery_codes where user_id = dest) then
    raise exception 'Recovery requires a new membership session';
  end if;

  insert into public.hydration_members (group_id, user_id, display_name, goal_oz, active)
    select group_id, dest, display_name, goal_oz, active from public.hydration_members where user_id = source;
  update public.hydration_daily set user_id = dest where user_id = source;
  delete from public.hydration_members where user_id = source;
  update public.hydration_groups set owner_id = dest where owner_id = source;
  update public.hydration_profiles set user_id = dest where user_id = source;
  update public.hydration_personal set user_id = dest where user_id = source;

  insert into public.challenge_members (challenge_id, user_id, display_name)
    select challenge_id, dest, display_name from public.challenge_members where user_id = source;
  update public.challenge_checkins set user_id = dest where user_id = source;
  delete from public.challenge_members where user_id = source;
  update public.challenges set owner_id = dest where owner_id = source;
  update public.workout_backups set user_id = dest where user_id = source;
  insert into iron_private.recovered_users values (source, dest, hashed);
  return iron_private.issue_recovery_code();
end;
$$;

create function iron_private.log_water(d date, v numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  total numeric;
  goal numeric;
begin
  perform iron_private.lock_member(u);
  if v is null or abs(v) > 128 or d is null or d not between current_date - 1 and current_date + 1 then
    raise exception 'Invalid water entry';
  end if;
  select goal_oz into goal from public.hydration_profiles where user_id = u;
  insert into public.hydration_personal (user_id, day, oz, goal_oz)
    values (u, d, greatest(0, v), coalesce(goal, 64))
    on conflict (user_id, day) do update set oz = greatest(0, public.hydration_personal.oz + v)
    returning oz into total;
  insert into public.hydration_daily (group_id, user_id, day, oz)
    select group_id, u, d, total from public.hydration_members where user_id = u and active
    on conflict (group_id, user_id, day) do update set oz = excluded.oz;
  return total;
end;
$$;

create function iron_private.set_water_goal(d date, goal numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  perform iron_private.lock_member(u);
  if d is null or d not between current_date - 1 and current_date + 1 then raise exception 'Invalid date'; end if;
  insert into public.hydration_profiles values (u, goal)
    on conflict (user_id) do update set goal_oz = excluded.goal_oz;
  update public.hydration_members set goal_oz = goal where user_id = u and active;
  update public.hydration_personal set goal_oz = goal where user_id = u and day = d;
end;
$$;

create or replace function iron_private.hydration_create(t text,n text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  g uuid;
begin
  perform iron_private.lock_member(u);
  insert into public.hydration_groups(title, owner_id) values(trim(t), u) returning id into g;
  insert into public.hydration_members(group_id, user_id, display_name, goal_oz)
    values(g, u, trim(n), coalesce((select goal_oz from public.hydration_profiles where user_id = u), 64));
  return g;
end;
$$;

create or replace function iron_private.hydration_join(c uuid,n text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  g uuid;
begin
  perform iron_private.lock_member(u);
  select id into g from public.hydration_groups where invite_code = c for update;
  if g is null then raise exception 'Invalid invite'; end if;
  insert into public.hydration_members(group_id, user_id, display_name, goal_oz)
    values(g, u, trim(n), coalesce((select goal_oz from public.hydration_profiles where user_id = u), 64))
    on conflict (group_id, user_id) do update
      set active = true, display_name = excluded.display_name, goal_oz = excluded.goal_oz
      where not hydration_members.active;
  return g;
end;
$$;

create function iron_private.sync_water_today(g uuid, d date) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  perform iron_private.lock_member(u);
  if not iron_private.hydration_member(g) or d is null or d not between current_date - 1 and current_date + 1 then
    raise exception 'Invalid group or date';
  end if;
  insert into public.hydration_daily (group_id, user_id, day, oz)
    select g, u, d, p.oz from public.hydration_personal p where p.user_id = u and p.day = d
    on conflict (group_id, user_id, day) do update set oz = excluded.oz where hydration_daily.oz <> excluded.oz;
end;
$$;

create function public.enroll_hydration_group(action text, title text, invite uuid, display text, d date) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare g uuid;
begin
  case action
    when 'create' then g := iron_private.hydration_create(title, display);
    when 'join' then g := iron_private.hydration_join(invite, display);
    else raise exception 'Unknown group action';
  end case;
  perform iron_private.sync_water_today(g, d);
  return g;
end;
$$;

create function iron_private.manage_hydration_group(g uuid, action text, title text, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  owner uuid;
begin
  perform iron_private.lock_member(u);
  select owner_id into owner from public.hydration_groups where id = g for update;
  if not iron_private.hydration_member(g) then raise exception 'Not a group member'; end if;
  if action = 'leave' then
    if owner = u then raise exception 'Transfer ownership before leaving'; end if;
    update public.hydration_members set active = false where group_id = g and user_id = u;
  elsif action = 'name' then
    update public.hydration_members set display_name = trim(title) where group_id = g and user_id = u;
  elsif owner = u then
    case action
      when 'rename' then
        update public.hydration_groups set title = trim(manage_hydration_group.title) where id = g;
      when 'remove' then
        if member is null or member = u then raise exception 'Choose another member'; end if;
        update public.hydration_members set active = false where group_id = g and user_id = member and active;
        if not found then raise exception 'Member unavailable'; end if;
        update public.hydration_groups set invite_code = gen_random_uuid() where id = g;
      when 'transfer' then
        if member is null or member = u or not exists(
          select 1 from public.hydration_members where group_id = g and user_id = member and active
        ) then raise exception 'Choose an active member'; end if;
        update public.hydration_groups set owner_id = member where id = g;
      else raise exception 'Unknown group action';
    end case;
  else
    raise exception 'Only the group owner can do that';
  end if;
end;
$$;

create function iron_private.save_workout_backup(snapshot jsonb, expected timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  previous timestamptz;
  saved timestamptz;
begin
  perform iron_private.lock_member(u);
  select updated_at into previous from public.workout_backups where user_id = u for update;
  if previous is distinct from expected then
    raise exception using errcode = 'PT409', message = 'Cloud backup changed elsewhere.';
  end if;
  saved := greatest(clock_timestamp(), previous + interval '1 microsecond');
  insert into public.workout_backups (user_id, payload, updated_at) values (u, snapshot, saved)
    on conflict (user_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  return saved;
end;
$$;

-- Preserve the previous RPC for cached clients while using the universal log.
create or replace function public.water_delta(g uuid,d date,v numeric) returns numeric
language plpgsql security invoker set search_path = '' as $$
begin
  if not iron_private.hydration_member(g) then raise exception 'Not a member'; end if;
  return iron_private.log_water(d, v);
end;
$$;

create or replace function public.create_challenge(t text,k text,e date,n text) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform iron_private.lock_current_member();
  return iron_private.create_challenge(t,k,e,n);
end;
$$;
create or replace function public.join_challenge(code uuid,n text) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform iron_private.lock_current_member();
  return iron_private.join_challenge(code,n);
end;
$$;
create or replace function public.check_in(cid uuid,d date,p numeric) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform iron_private.lock_current_member();
  perform iron_private.check_in(cid,d,p);
end;
$$;

create function public.issue_recovery_code() returns text language sql security invoker set search_path = ''
  as $$ select iron_private.issue_recovery_code() $$;
create function public.recover_membership(code text) returns text language sql security invoker set search_path = ''
  as $$ select iron_private.recover_membership(code) $$;
create function public.log_water(d date, v numeric) returns numeric language sql security invoker set search_path = ''
  as $$ select iron_private.log_water(d, v) $$;
create function public.set_water_goal(d date, goal numeric) returns void language sql security invoker set search_path = ''
  as $$ select iron_private.set_water_goal(d, goal) $$;
create function public.manage_hydration_group(g uuid, action text, title text, member uuid) returns void
  language sql security invoker set search_path = ''
  as $$ select iron_private.manage_hydration_group(g, action, title, member) $$;
create function public.save_workout_backup(snapshot jsonb, expected timestamptz) returns timestamptz
  language sql security invoker set search_path = ''
  as $$ select iron_private.save_workout_backup(snapshot, expected) $$;

revoke all on function iron_private.lock_member(uuid) from public, anon, authenticated;
revoke all on function iron_private.lock_current_member(),
  iron_private.issue_recovery_code(), public.issue_recovery_code(),
  iron_private.recover_membership(text), public.recover_membership(text),
  iron_private.log_water(date,numeric), public.log_water(date,numeric),
  iron_private.set_water_goal(date,numeric), public.set_water_goal(date,numeric),
  iron_private.sync_water_today(uuid,date),
  public.enroll_hydration_group(text,text,uuid,text,date),
  iron_private.manage_hydration_group(uuid,text,text,uuid), public.manage_hydration_group(uuid,text,text,uuid),
  iron_private.save_workout_backup(jsonb,timestamptz), public.save_workout_backup(jsonb,timestamptz)
  from public, anon;
grant execute on function iron_private.lock_current_member(),
  iron_private.issue_recovery_code(), public.issue_recovery_code(),
  iron_private.recover_membership(text), public.recover_membership(text),
  iron_private.log_water(date,numeric), public.log_water(date,numeric),
  iron_private.set_water_goal(date,numeric), public.set_water_goal(date,numeric),
  iron_private.sync_water_today(uuid,date),
  public.enroll_hydration_group(text,text,uuid,text,date),
  iron_private.manage_hydration_group(uuid,text,text,uuid), public.manage_hydration_group(uuid,text,text,uuid),
  iron_private.save_workout_backup(jsonb,timestamptz), public.save_workout_backup(jsonb,timestamptz)
  to authenticated;

do $$
declare tbl text;
begin
  foreach tbl in array array['hydration_daily','hydration_groups','hydration_members','hydration_personal','hydration_profiles'] loop
    if not exists(select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end;
$$;
