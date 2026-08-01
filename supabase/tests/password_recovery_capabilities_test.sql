begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select has_table('public', 'password_recovery_capabilities', 'capability table exists');
select has_column('public', 'password_recovery_capabilities', 'token_hash', 'stores token hash');
select has_column('public', 'password_recovery_capabilities', 'used_at', 'tracks consumption');
select table_privs_are('public', 'password_recovery_capabilities', 'anon', array[]::text[], 'anon has no table access');
select table_privs_are('public', 'password_recovery_capabilities', 'authenticated', array[]::text[], 'authenticated has no table access');

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'recovery@example.invalid', '', clock_timestamp(), clock_timestamp());
set local role service_role;
select lives_ok($$select public.create_password_recovery_capability_v1(decode(repeat('ab', 32), 'hex'), '71000000-0000-4000-8000-000000000001', 'session-a', 600)$$, 'service creates capability');
select ok(public.consume_password_recovery_capability_v1(decode(repeat('ab', 32), 'hex'), '71000000-0000-4000-8000-000000000001', 'session-a'), 'matching capability consumed');
select isnt(public.consume_password_recovery_capability_v1(decode(repeat('ab', 32), 'hex'), '71000000-0000-4000-8000-000000000001', 'session-a'), true, 'used capability rejected');
select isnt(public.consume_password_recovery_capability_v1(decode(repeat('ab', 32), 'hex'), '71000000-0000-4000-8000-000000000002', 'session-a'), true, 'other account rejected');
reset role;
select is((select count(*) from public.password_recovery_capabilities where used_at is not null), 1::bigint, 'only one atomic consumption recorded');

select * from finish();
rollback;
