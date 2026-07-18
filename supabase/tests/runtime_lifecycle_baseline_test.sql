begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'runtime lifecycle tests require local-cli';
  end if;
end
$$;

select plan(33);
select has_table('public', 'generation_leases', 'generation_leases exists');
select has_table('public', 'idempotency_keys', 'idempotency_keys exists');
select has_table('public', 'story_events', 'story_events exists');
select has_table('public', 'outbox', 'outbox exists');
select has_column('public', 'generation_leases', 'id', 'generation_leases.id exists');
select has_column('public', 'generation_leases', 'story_id', 'generation_leases.story_id exists');
select has_column('public', 'generation_leases', 'chapter_number', 'generation_leases.chapter_number exists');
select has_column('public', 'generation_leases', 'status', 'generation_leases.status exists');
select has_column('public', 'generation_leases', 'holder', 'generation_leases.holder exists');
select has_column('public', 'generation_leases', 'expires_at', 'generation_leases.expires_at exists');
select has_index('public', 'generation_leases', 'generation_leases_one_active', 'generation_leases active index exists');
select has_function('public', 'acquire_generation_lease', array['text','integer','text','integer','text'], 'acquire signature exists');
select has_function('public', 'release_generation_lease', array['text','uuid'], 'release signature exists');
select has_function('public', 'publish_chapter', array['text','integer','text','jsonb','text','jsonb','jsonb','uuid','text'], 'publish signature exists');
select ok((select prosecdef from pg_proc where oid = 'public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure), 'acquire is SECURITY DEFINER');
select ok((select prosecdef from pg_proc where oid = 'public.release_generation_lease(text,uuid)'::regprocedure), 'release is SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'), 'anon cannot acquire');
select ok(not has_function_privilege('authenticated', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'), 'authenticated cannot acquire');
select ok(has_function_privilege('service_role', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'), 'service_role can acquire');
select ok(has_function_privilege('service_role', 'public.release_generation_lease(text,uuid)', 'EXECUTE'), 'service_role can release');
select is(md5(pg_get_functiondef('public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure)), 'a510dcaf674b178782dfe971aea57be2', 'acquire function is exact linked definition');
select is(md5(pg_get_functiondef('public.release_generation_lease(text,uuid)'::regprocedure)), 'aa4b498641464d7d56479860d51a7ec9', 'release function is exact linked definition');
select is(md5(pg_get_functiondef('public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure)), 'e8f33f2aaca0b3343f8fe51200fc402b', 'publish function is exact linked definition');
select has_function('public', 'story_is_public', array['text'], 'public story RLS helper exists');
select has_function('public', 'story_is_owned_by_auth', array['text'], 'owned story RLS helper exists');
select is(md5(pg_get_functiondef('public.story_is_public(text)'::regprocedure)), '73310f024aff9df0dcfd3995648954ad', 'public story helper is exact linked definition');
select is(md5(pg_get_functiondef('public.story_is_owned_by_auth(text)'::regprocedure)), '25bf18127829a221b1db9d9dc67dcd85', 'owned story helper is exact linked definition');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.story_is_public(text)'::regprocedure), 'public story helper is hardened SECURITY DEFINER');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.story_is_owned_by_auth(text)'::regprocedure), 'owned story helper is hardened SECURITY DEFINER');
select ok(has_function_privilege('anon', 'public.story_is_public(text)', 'EXECUTE'), 'anon can execute public story helper');
select ok(has_function_privilege('authenticated', 'public.story_is_owned_by_auth(text)', 'EXECUTE'), 'authenticated can execute owned story helper');
select ok(not has_function_privilege('anon', 'public.story_is_owned_by_auth(text)', 'EXECUTE'), 'anon cannot execute owned story helper');
select ok((select count(*) = 7 from pg_policies where schemaname = 'public' and tablename in ('stories','chapters','choice_outcomes','reader_states')), 'exact early policy set exists');
select * from finish();

rollback;
