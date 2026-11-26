-- Iron Log social backend, proposed migration. Review before applying.
create table public.workout_backups (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload)='object'),
 updated_at timestamptz not null default now()
);
alter table public.workout_backups enable row level security;
create policy own_backup on public.workout_backups for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create table public.challenges (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 invite_code uuid not null unique default gen_random_uuid(),
 title text not null check (length(title) between 1 and 80),
 kind text not null check (kind in ('hydration','protein','steps','workouts','streak','strength')),
 starts_on date not null default current_date,
 ends_on date not null check (ends_on >= starts_on and ends_on <= starts_on+90)
);
create table public.challenge_members (
 challenge_id uuid references public.challenges(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 display_name text not null check (length(display_name) between 1 and 40),
 primary key(challenge_id,user_id)
);
create table public.challenge_checkins (
 challenge_id uuid not null,
 user_id uuid not null,
 day date not null,
 points numeric not null check(points >= 0 and points <= 1),
 primary key(challenge_id,user_id,day),
 foreign key(challenge_id,user_id) references public.challenge_members(challenge_id,user_id) on delete cascade
);
alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.challenge_checkins enable row level security;
create function public.is_challenge_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.challenge_members where challenge_id=cid and user_id=auth.uid()) $$;
revoke all on function public.is_challenge_member(uuid) from public;
grant execute on function public.is_challenge_member(uuid) to authenticated;
create policy challenge_read on public.challenges for select to authenticated using(public.is_challenge_member(id));
create policy member_read on public.challenge_members for select to authenticated using(public.is_challenge_member(challenge_id));
create policy checkin_read on public.challenge_checkins for select to authenticated using(public.is_challenge_member(challenge_id));
create function public.create_challenge(t text,k text,e date,n text) returns uuid language plpgsql security definer set search_path='' as $$ declare c uuid; begin
if auth.uid() is null then raise exception 'Sign in first'; end if;
insert into public.challenges(owner_id,title,kind,ends_on) values(auth.uid(),t,k,e) returning id into c;
insert into public.challenge_members values(c,auth.uid(),n);
return c; end $$;
create function public.join_challenge(code uuid,n text) returns uuid language plpgsql security definer set search_path='' as $$ declare c uuid; begin
if auth.uid() is null then raise exception 'Sign in first'; end if;
select id into c from public.challenges where invite_code=code and ends_on>=current_date;
if c is null then raise exception 'Invalid or expired invite'; end if;
insert into public.challenge_members values(c,auth.uid(),n) on conflict do nothing;
return c; end $$;
create function public.check_in(cid uuid,d date,p numeric) returns void language plpgsql security definer set search_path='' as $$ begin
if auth.uid() is null or not public.is_challenge_member(cid) then raise exception 'Not a member'; end if;
if not exists(select 1 from public.challenges where id=cid and d between starts_on and ends_on and d<=current_date) then raise exception 'Date outside challenge'; end if;
insert into public.challenge_checkins values(cid,auth.uid(),d,p) on conflict(challenge_id,user_id,day) do update set points=excluded.points; end $$;
revoke all on function public.create_challenge(text,text,date,text),public.join_challenge(uuid,text),public.check_in(uuid,date,numeric) from public;
grant execute on function public.create_challenge(text,text,date,text),public.join_challenge(uuid,text),public.check_in(uuid,date,numeric) to authenticated;
