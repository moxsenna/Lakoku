begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(1);
select is(
  current_setting('lakoku.test_target', true),
  'local-cli',
  'personalized REST integration targets explicit local CLI database'
);
select * from finish();

rollback;
