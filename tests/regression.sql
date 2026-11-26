\set owner '10000000-0000-0000-0000-000000000001'
\set friend '10000000-0000-0000-0000-000000000002'
\set device '10000000-0000-0000-0000-000000000003'
\set stranger '10000000-0000-0000-0000-000000000004'
\set first '20000000-0000-0000-0000-000000000001'
\set second '20000000-0000-0000-0000-000000000002'

create function pg_temp.check(ok boolean, description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Failed: %', description; end if;
end;
$$;
create function pg_temp.error_matches(query text, expected text) returns void language plpgsql as $$
begin
  execute query;
  raise exception 'Expected SQLSTATE %', expected;
exception when others then
  if sqlstate <> expected then raise; end if;
end;
$$;

select pg_temp.check((select count(*)=5 from pg_publication_tables where pubname='supabase_realtime'), 'Realtime publication');
select pg_temp.check((select count(*)=2 and sum(oz)=115 from hydration_daily), 'historical group totals preserved');
select pg_temp.check((select count(*)=1 and min(oz)=65 from hydration_personal), 'legacy personal totals use max per date');

set role anon;
select pg_temp.error_matches('select public.issue_recovery_code()', '42501');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"is_anonymous":true}', false);
select set_config('request.jwt.claim.sub', :'owner', false);
select pg_temp.check(public.log_water(current_date, 16)=16, 'first universal log');
select pg_temp.check((select count(*)=2 and min(oz)=16 from hydration_daily where day=current_date), 'water copied to every group');
select pg_temp.check(public.water_delta(:'first',current_date,8)=24, 'old RPC adds universally');
select pg_temp.check(public.log_water(current_date,-50)=0, 'subtract clamps to zero');
select pg_temp.error_matches('select public.log_water(current_date, 129)', 'P0001');
select pg_temp.error_matches('select public.log_water(current_date-10, 8)', 'P0001');
select public.set_water_goal(current_date, 80);
select pg_temp.check((select goal_oz=80 from hydration_personal where day=current_date), 'today uses changed goal');
select pg_temp.check((select goal_oz=64 from hydration_personal where day=current_date-1), 'historical goal stays fixed');
select pg_temp.check((select count(*)=2 and min(goal_oz)=80 from hydration_members where user_id=:'owner'), 'group goals synchronized');
select public.manage_hydration_group(:'first','rename','New group name',null);
select pg_temp.check((select title='New group name' from hydration_groups where id=:'first'), 'owner renamed group');
select invite_code as old_invite from hydration_groups where id=:'first' \gset

select set_config('request.jwt.claim.sub', :'friend', false);
select pg_temp.check(not exists(select 1 from hydration_personal), 'other personal history is private');
select pg_temp.check(not exists(select 1 from workout_backups), 'other backups are private');
select pg_temp.check(public.enroll_hydration_group('join',null,:'old_invite','Buddy',current_date)=:'first', 'invite joins group');
select pg_temp.error_matches(format('select public.manage_hydration_group(%L,%L,%L,null)', :'first','rename','Not allowed'), 'P0001');
select public.manage_hydration_group(:'first','name','New name',null);
select pg_temp.check(public.log_water(current_date,12)=12, 'friend can log');
select pg_temp.check((select count(*)=2 from hydration_daily where user_id=:'friend'), 'friend log copied');

select set_config('request.jwt.claim.sub', :'owner', false);
select public.manage_hydration_group(:'first','remove',null,:'friend');
select pg_temp.check(not exists(select 1 from hydration_members where group_id=:'first' and user_id=:'friend'), 'removed member hidden');
select pg_temp.check(not exists(select 1 from hydration_daily where group_id=:'first' and user_id=:'friend'), 'removed member water hidden');
select invite_code as new_invite from hydration_groups where id=:'first' \gset
select pg_temp.check(:'old_invite' <> :'new_invite', 'removal rotates invite');
select pg_temp.error_matches('update public.workout_backups set payload = ''{}''', '42501');
select pg_temp.error_matches('select public.save_workout_backup(''{}'', null)', 'PT409');
select public.save_workout_backup('{"sets":[],"body":[],"routines":{"Push":["Press"]}}', '2025-01-01Z') as version \gset
select pg_temp.error_matches('select public.save_workout_backup(''{}'', ''2025-01-01Z'')', 'PT409');
select pg_temp.check((select updated_at=:'version' and payload->'routines'->'Push'->>0='Press' from workout_backups), 'conflict preserves backup');
select public.issue_recovery_code() as obsolete \gset
select public.issue_recovery_code() as recover \gset

select set_config('request.jwt.claim.sub', :'device', false);
select pg_temp.error_matches(format('select public.recover_membership(%L)', :'obsolete'), 'P0001');
select public.recover_membership(:'recover') as replacement \gset
select pg_temp.check(length(:'replacement')=32 and :'replacement'<>:'recover', 'recovery rotates the code');
select pg_temp.check(length(public.recover_membership(:'recover'))=32, 'same-session retry after lost response');
select pg_temp.check((select count(*)=2 from hydration_groups), 'group memberships recovered');
select pg_temp.check((select owner_id=:'device' from hydration_groups where id=:'first'), 'group ownership recovered');
select pg_temp.check((select count(*)=2 from hydration_personal), 'personal hydration recovered');
select pg_temp.check((select count(*)=4 from hydration_daily where user_id=:'device'), 'group history recovered');
select pg_temp.check((select updated_at=:'version' from workout_backups), 'backup recovered with version');
select pg_temp.check((select owner_id=:'device' from challenges), 'legacy challenge ownership recovered');
select pg_temp.check((select count(*)=1 from challenge_checkins where user_id=:'device'), 'legacy check-ins recovered');
select pg_temp.error_matches(format('select public.manage_hydration_group(%L,%L,null,null)', :'first','leave'), 'P0001');

select set_config('request.jwt.claim.sub', :'owner', false);
select pg_temp.check(not exists(select 1 from workout_backups), 'old session lost backup access');
select pg_temp.check(not exists(select 1 from hydration_groups), 'old session lost group access');
select pg_temp.error_matches('select public.log_water(current_date,8)', 'P0001');
select pg_temp.error_matches('select public.issue_recovery_code()', 'P0001');

select set_config('request.jwt.claim.sub', :'stranger', false);
select pg_temp.error_matches(format('select public.recover_membership(%L)', :'recover'), 'P0001');
select pg_temp.check(public.log_water(current_date, 26)=26, 'logging works with zero groups');
select pg_temp.check(public.log_water(current_date, 10)=36, 'personal logging remains cumulative');
select public.enroll_hydration_group('create','New group',null,'New member',current_date) as third \gset
select pg_temp.check((select oz=36 from hydration_daily where group_id=:'third'), 'new group receives today’s water');

select set_config('request.jwt.claim.sub', :'friend', false);
select pg_temp.error_matches(format('select public.hydration_join(%L,%L)', :'old_invite','Buddy'), 'P0001');
select public.enroll_hydration_group('join',null,:'new_invite','Buddy',current_date);
select pg_temp.check((select oz=12 from hydration_daily where group_id=:'first' and user_id=:'friend'), 'rejoin restores prior total');
select set_config('request.jwt.claim.sub', :'device', false);
select public.manage_hydration_group(:'first','transfer',null,:'friend');
select public.manage_hydration_group(:'first','leave',null,null);
select pg_temp.check(not exists(select 1 from hydration_groups where id=:'first'), 'left group access removed');
select pg_temp.check((select count(*)=2 from hydration_personal), 'leaving keeps personal history');
reset role;
select pg_temp.check((select count(*)=2 from hydration_daily where user_id=:'device' and group_id=:'first'), 'leaving retains archived group history');
