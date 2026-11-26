create or replace function public.water_delta(g uuid,d date,v numeric) returns numeric language plpgsql security invoker set search_path='' as $$ declare total numeric; begin if auth.uid() is null or not iron_private.hydration_member(g) then raise exception 'Not a member'; end if; if abs(v)>128 or d not between current_date-1 and current_date+1 then raise exception 'Invalid entry'; end if; insert into public.hydration_daily(group_id,user_id,day,oz) values(g,auth.uid(),d,greatest(0,v)) on conflict(group_id,user_id,day) do update set oz=greatest(0,public.hydration_daily.oz+v) returning oz into total; return total; end $$;
revoke all on function public.water_delta(uuid,date,numeric) from public,anon;
grant execute on function public.water_delta(uuid,date,numeric) to authenticated;
create policy member_leave on public.hydration_members for delete to authenticated using(user_id=auth.uid());
grant delete on public.hydration_members to authenticated;
