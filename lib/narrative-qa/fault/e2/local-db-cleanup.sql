\set ON_ERROR_STOP on
select set_config('m10.task3_run_nonce', :'task3_run_nonce', false);
select set_config('m10.task3_project_id', :'task3_project_id', false);

-- Fresh-connection emergency cleanup. Exact harness IDs only.
do $cleanup$
declare
  v_stories text[] := array[
    'm10-e2-task3:stale-lease','m10-e2-task3:v2-retry','m10-e2-task3:v3-retry',
    'm10-e2-task3:v5-retry','m10-e2-task3:race-1','m10-e2-task3:race-2',
    'm10-e2-task3:rollback-before-commit','m10-e2-task3:rollback-terminal',
    'm10-e2-task3:stale-v3','m10-e2-task3:stale-v5','m10-e2-task3:provenance',
    'm10-e2-task3:outbox'
  ];
  v_trigger record;
  v_dblink_preexisting boolean;
begin
  select (raw_user_meta_data->>'m10_e2_task3_dblink_preexisting')::boolean
  into v_dblink_preexisting
  from auth.users
  where id='e2000000-0000-4000-8000-000000000001'
    and raw_user_meta_data @> jsonb_build_object(
      'm10_e2_task3_nonce', current_setting('m10.task3_run_nonce'),
      'm10_e2_task3_project', current_setting('m10.task3_project_id')
    );
  for v_trigger in
    select n.nspname schema_name, c.relname table_name, t.tgname trigger_name
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgname like 'm10_e2_task3_%'
  loop
    execute format('drop trigger if exists %I on %I.%I',v_trigger.trigger_name,v_trigger.schema_name,v_trigger.table_name);
  end loop;

  delete from public.outbox where payload->>'story_id'=any(v_stories);
  delete from public.story_events where story_id=any(v_stories);
  delete from public.generation_provider_calls where story_id=any(v_stories);
  delete from public.chapter_state_commits where story_id=any(v_stories);
  delete from public.reader_plot_debt_progress where story_id=any(v_stories);
  delete from public.reader_plot_debt_closures where story_id=any(v_stories);
  delete from public.generation_job_attempts where story_id=any(v_stories);
  delete from public.chapter_generation_checkpoints where story_id=any(v_stories);
  delete from public.generation_leases where story_id=any(v_stories);
  delete from public.idempotency_keys where story_id=any(v_stories);
  delete from public.generation_jobs where story_id=any(v_stories);
  delete from public.reader_states where story_id=any(v_stories);
  delete from public.stories where id=any(v_stories);
  if v_dblink_preexisting is false then
    drop extension if exists dblink;
  elsif v_dblink_preexisting is true and not exists(select 1 from pg_extension where extname='dblink') then
    create extension dblink with schema extensions;
  elsif v_dblink_preexisting is null then
    raise exception 'M10_E2_TASK3_DBLINK_PRESTATE_MISSING';
  end if;
  if exists(select 1 from pg_extension where extname='dblink') is distinct from v_dblink_preexisting then
    raise exception 'M10_E2_TASK3_DBLINK_RESTORE_FAILED';
  end if;
  delete from auth.users
  where id='e2000000-0000-4000-8000-000000000001'
    and raw_user_meta_data @> jsonb_build_object(
      'm10_e2_task3_nonce', current_setting('m10.task3_run_nonce'),
      'm10_e2_task3_project', current_setting('m10.task3_project_id')
    );
end
$cleanup$;

do $verify$
declare
  v_stories text[] := array[
    'm10-e2-task3:stale-lease','m10-e2-task3:v2-retry','m10-e2-task3:v3-retry',
    'm10-e2-task3:v5-retry','m10-e2-task3:race-1','m10-e2-task3:race-2',
    'm10-e2-task3:rollback-before-commit','m10-e2-task3:rollback-terminal',
    'm10-e2-task3:stale-v3','m10-e2-task3:stale-v5','m10-e2-task3:provenance',
    'm10-e2-task3:outbox'
  ];
begin
  if exists(select 1 from public.stories where id=any(v_stories))
    or exists(select 1 from public.generation_jobs where story_id=any(v_stories))
    or exists(select 1 from public.generation_leases where story_id=any(v_stories))
    or exists(select 1 from public.chapter_generation_checkpoints where story_id=any(v_stories))
    or exists(select 1 from public.chapter_state_commits where story_id=any(v_stories))
    or exists(select 1 from public.generation_job_attempts where story_id=any(v_stories))
    or exists(select 1 from public.generation_provider_calls where story_id=any(v_stories))
    or exists(select 1 from public.story_events where story_id=any(v_stories))
    or exists(select 1 from public.outbox where payload->>'story_id'=any(v_stories))
    or exists(select 1 from public.idempotency_keys where story_id=any(v_stories))
    or exists(select 1 from pg_trigger where not tgisinternal and tgname like 'm10_e2_task3_%')
    or exists(select 1 from auth.users where id='e2000000-0000-4000-8000-000000000001'
      and raw_user_meta_data @> jsonb_build_object('m10_e2_task3_nonce', current_setting('m10.task3_run_nonce')))
  then
    raise exception 'M10_E2_TASK3_CLEANUP_FAILED';
  end if;
end
$verify$;
