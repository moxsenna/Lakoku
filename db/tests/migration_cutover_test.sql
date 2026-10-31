begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    perform set_config('lakoku.test_target', 'local-cli', true);
  end if;
end
$$;

select plan(5);

-- Test 1: Function exists & ACLs
select has_function('public', 'spend_credits_v1', array['uuid', 'text', 'integer', 'text'], 'spend_credits_v1 exists');
select has_function('public', 'grant_welcome_credit_v1', array['uuid'], 'grant_welcome_credit_v1 exists');

-- Test 2: Invariant Check - Existing spend_credits_v1 executes cleanly
do $$
declare
  v_user uuid := gen_random_uuid();
  v_res text;
begin
  insert into auth.users (id, email) values (v_user, 'cutover@test.local');
  perform public.grant_credits_v1(v_user, 'seed:cutover'::text, 20::integer, 'seed'::text);

  v_res := public.spend_credits_v1(v_user, 'unlock:story-cutover:4'::text, 8::integer, 'unlock_chapter'::text);
  if v_res <> 'ok' then
    raise exception 'Migration Cutover Test Failed: spend_credits_v1 returned %', v_res;
  end if;
end
$$;

select ok(true, 'spend_credits_v1 executed cleanly across migration cutover boundary');
select ok(has_function_privilege('service_role', 'public.spend_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'service_role can execute spend_credits_v1');
select ok(has_function_privilege('service_role', 'public.grant_welcome_credit_v1(uuid)', 'EXECUTE'), 'service_role can execute grant_welcome_credit_v1');

rollback;
