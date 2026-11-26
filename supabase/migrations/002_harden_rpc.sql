create schema if not exists iron_private;
revoke all on schema iron_private from public,anon;
grant usage on schema iron_private to authenticated;
alter function public.is_challenge_member(uuid) set schema iron_private;
alter function public.create_challenge(text,text,date,text) set schema iron_private;
alter function public.join_challenge(uuid,text) set schema iron_private;
alter function public.check_in(uuid,date,numeric) set schema iron_private;
-- Existing function body references public.is_challenge_member; provide an invoker wrapper.
create function public.is_challenge_member(cid uuid) returns boolean language sql stable security invoker set search_path='' as $$ select iron_private.is_challenge_member(cid) $$;
create function public.create_challenge(t text,k text,e date,n text) returns uuid language sql security invoker set search_path='' as $$ select iron_private.create_challenge(t,k,e,n) $$;
create function public.join_challenge(code uuid,n text) returns uuid language sql security invoker set search_path='' as $$ select iron_private.join_challenge(code,n) $$;
create function public.check_in(cid uuid,d date,p numeric) returns void language sql security invoker set search_path='' as $$ select iron_private.check_in(cid,d,p) $$;
revoke all on all functions in schema iron_private from public,anon;
grant execute on all functions in schema iron_private to authenticated;
revoke all on function public.is_challenge_member(uuid),public.create_challenge(text,text,date,text),public.join_challenge(uuid,text),public.check_in(uuid,date,numeric) from public,anon;
grant execute on function public.is_challenge_member(uuid),public.create_challenge(text,text,date,text),public.join_challenge(uuid,text),public.check_in(uuid,date,numeric) to authenticated;
