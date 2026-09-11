\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
select set_config('m10.task3_run_nonce', :'task3_run_nonce', false);
select set_config('m10.task3_project_id', :'task3_project_id', false);

-- Second guard runs in PostgreSQL before any harness DML/DDL.
do $guard$
begin
  if current_database() <> 'postgres'
    or coalesce(inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet), false)
    or current_setting('port') <> '5432'
  then
    raise exception 'M10_E2_REQUIRES_LOCAL_CONTAINER_DB';
  end if;
end
$guard$;

create temporary table task3_results (
  ordinal integer primary key,
  id text not null,
  proof jsonb not null,
  observed_at timestamptz not null default clock_timestamp(),
  latency_ms double precision not null default 0 check(latency_ms >= 0)
) on commit preserve rows;

create temporary table task3_scenario_clock (
  id text primary key,
  started_at timestamptz not null
) on commit preserve rows;

create or replace function pg_temp.start_scenario(p_id text)
returns void language sql volatile as $fn$
  insert into task3_scenario_clock(id,started_at) values(p_id,clock_timestamp())
  on conflict(id) do update set started_at=excluded.started_at
$fn$;

create or replace function pg_temp.finish_result()
returns trigger language plpgsql as $fn$
declare v_finished timestamptz := clock_timestamp(); v_started timestamptz;
begin
  select started_at into strict v_started from task3_scenario_clock where id=new.id;
  new.observed_at := v_finished;
  new.latency_ms := greatest(0,extract(epoch from (v_finished-v_started))*1000.0);
  return new;
end
$fn$;

create trigger task3_finish_result before insert on task3_results
for each row execute function pg_temp.finish_result();

create or replace function pg_temp.inv(p_code text, p_expected jsonb, p_observed jsonb)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'code', p_code,
    'passed', p_expected = p_observed,
    'detail', jsonb_build_object('expected', p_expected, 'observed', p_observed)
  )
$fn$;

create or replace function pg_temp.executed(
  p_expected_outcome text,
  p_observed_outcome text,
  p_immediate jsonb,
  p_recovery jsonb
) returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'disposition', 'EXECUTED',
    'injectionReached', not exists(
      select 1 from jsonb_array_elements(p_immediate) item where (item->>'passed')::boolean is distinct from true
    ),
    'expectedOutcome', p_expected_outcome,
    'observedOutcome', p_observed_outcome,
    'immediateInvariants', p_immediate,
    'recoveryExpected', jsonb_array_length(p_recovery)>0,
    'recovered', not exists(
      select 1 from jsonb_array_elements(p_recovery) item where (item->>'passed')::boolean is distinct from true
    ),
    'recoveryInvariants', p_recovery
  )
$fn$;

create or replace function pg_temp.delta(p_story text, p_chapter integer)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'schemaVersion', 1,
    'storyId', p_story,
    'chapterNumber', p_chapter,
    'facts', jsonb_build_object('add', jsonb_build_array(jsonb_build_object(
      'id', 'fact:' || p_story, 'statement', 'Bukti lokal.', 'salience', 1
    )), 'markPaidOff', '[]'::jsonb),
    'knowledge', jsonb_build_object('grants', '[]'::jsonb),
    'secrets', jsonb_build_object('revealIds', '[]'::jsonb),
    'timeline', jsonb_build_object('append', '[]'::jsonb),
    'characters', jsonb_build_object('statusChanges', '[]'::jsonb),
    'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb),
    'plotDebts', jsonb_build_object('progress', '[]'::jsonb, 'closures', '[]'::jsonb),
    'actRollup', null
  )
$fn$;

create or replace function pg_temp.audit(p_story text default null)
returns jsonb language sql immutable as $fn$
  select case when p_story='m10-e2-task3:v5-retry' then
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"closureForm":"RESOLVED","debtId":"debt:rich"}]}'::jsonb
  else '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb end
$fn$;

create or replace function pg_temp.rich_delta(p_story text, p_chapter integer)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'schemaVersion',1,'storyId',p_story,'chapterNumber',p_chapter,
    'facts',jsonb_build_object(
      'add',jsonb_build_array(jsonb_build_object(
        'id','fact:new:'||p_story,'statement','Fakta baru terukur.',
        'subjectCharacterId','char:'||p_story,'salience',0.75
      )),
      'markPaidOff',jsonb_build_array('fact:old:'||p_story)
    ),
    'knowledge',jsonb_build_object('grants',jsonb_build_array(jsonb_build_object(
      'characterId','char:'||p_story,'factId','fact:old:'||p_story
    ))),
    'secrets',jsonb_build_object('revealIds',jsonb_build_array('secret:'||p_story)),
    'timeline',jsonb_build_object('append',jsonb_build_array(jsonb_build_object(
      'ordinal',7,'description','Waktu kanon bergerak.','isFlashback',false,'occursAt',2.5
    ))),
    'characters',jsonb_build_object('statusChanges',jsonb_build_array(jsonb_build_object(
      'characterId','char:'||p_story,'from','ALIVE','to','INACTIVE'
    ))),
    'threads',jsonb_build_object(
      'touches',jsonb_build_array('thread:touch:'||p_story),
      'transitions',jsonb_build_array(jsonb_build_object(
        'threadId','thread:transition:'||p_story,'from','OPEN','to','DEVELOPING'
      ))
    ),
    'plotDebts',jsonb_build_object(
      'progress',jsonb_build_array(jsonb_build_object('debtId','debt:rich','milestoneChapter',2)),
      'closures',jsonb_build_array(jsonb_build_object('debtId','debt:rich','closureForm','RESOLVED'))
    ),
    'actRollup',jsonb_build_object(
      'actNumber',1,'summary','Ringkasan kanon terukur.','stateDelta',jsonb_build_object('trust',1),
      'coversFromChapter',1,'coversToChapter',2
    )
  )
$fn$;

create or replace function pg_temp.seed_rich_canon(p_story text)
returns void language plpgsql as $fn$
begin
  update public.story_generation_contracts
  set plot_debts_json='[{"id":"debt:rich","question":"Utang lokal?","introducedAt":1,"mustProgressBy":[2],"mustCloseBy":2,"status":"open"}]'::jsonb,
      story_contract_json='{"actPlan":[{"actNumber":1,"fromChapter":1,"toChapter":2,"goal":"Bukti lokal."},{"actNumber":2,"fromChapter":3,"toChapter":50,"goal":"Lanjut."}]}'::jsonb
  where story_id=p_story;
  insert into public.characters(id,story_id,canonical_name,role,introduced_chapter)
  values('char:'||p_story,p_story,'Raka','protagonist',1);
  insert into public.character_states(character_id,status,as_of_chapter,attributes)
  values('char:'||p_story,'ALIVE',1,'{"seed":true}'::jsonb);
  insert into public.facts_ledger(id,story_id,statement,established_chapter,salience,load_bearing,paid_off)
  values('fact:old:'||p_story,p_story,'Fakta lama.',1,0.5,true,false);
  insert into public.secrets_reveals(id,story_id,description,reveal_gate_chapter,revealed)
  values('secret:'||p_story,p_story,'Rahasia lokal.',2,false);
  insert into public.story_threads(id,story_id,title,status,opened_chapter,last_touched_chapter,stale,stale_since_chapter,is_main_mystery)
  values
    ('thread:touch:'||p_story,p_story,'Sentuh','OPEN',1,1,true,1,false),
    ('thread:transition:'||p_story,p_story,'Transisi','OPEN',1,1,true,1,false);
end
$fn$;

create or replace function pg_temp.choices()
returns jsonb language sql immutable as $fn$
  select '[{"id":"a","label":"Ambil jalan A"},{"id":"b","label":"Ambil jalan B"}]'::jsonb
$fn$;

create or replace function pg_temp.outcomes()
returns jsonb language sql immutable as $fn$
  select '[{"choiceId":"a","consequence":["A"],"nextChapterNumber":3,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"b","consequence":["B"],"nextChapterNumber":3,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
$fn$;

create or replace function pg_temp.seed_story(p_story text, p_revision bigint default 0)
returns void language plpgsql as $fn$
begin
  if p_story not like 'm10-e2-task3:%' then raise exception 'INVALID_TASK3_STORY'; end if;
  insert into public.stories (
    id, title, owner_user_id, visibility, story_mode, living_canon_version,
    canon_state_revision, story_contract_version
  ) values (
    p_story, 'M10-E2 Task 3', 'e2000000-0000-4000-8000-000000000001',
    'private', 'personalized_ai', 1, p_revision, 1
  );
  insert into public.reader_states (user_id, story_id, status, current_chapter)
  values ('e2000000-0000-4000-8000-000000000001', p_story, 'BERJALAN', 2);
  insert into public.story_generation_contracts (
    story_id, mode, total_chapters, plot_debts_json, story_contract_version, story_contract_json
  ) values (
    p_story, 'personalized_ai', 50, '[]'::jsonb, 1,
    '{"actPlan":[{"actNumber":1,"fromChapter":1,"toChapter":5,"goal":"Bukti lokal."},{"actNumber":2,"fromChapter":6,"toChapter":50,"goal":"Lanjut."}]}'::jsonb
  );
end
$fn$;

create or replace function pg_temp.seed_sync(
  p_story text, p_attempt uuid, p_correlation uuid, p_lease uuid, p_base bigint default 0
) returns void language plpgsql as $fn$
begin
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (p_lease, p_story, 2, 'ACTIVE', 'm10-e2-sync', clock_timestamp() + interval '10 minutes', null, null);
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status, title, paragraphs_json,
    prose_fingerprint, audit_signals_json, audit_signals_version, canon_version,
    blueprint_version, direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number, checkpoint_schema_version,
    prose_attempt_count, choice_attempt_count, expires_at, story_contract_version,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    p_story, 2, p_attempt, p_correlation, 'PROSE_READY', 'Bab Dua', '["Paragraf lokal."]'::jsonb,
    'm10-e2-fp', pg_temp.audit(p_story), 2, 1, 1, 'm10-e2-direction', 'personalized', 2, 2,
    null, null, 3, 1, 0, clock_timestamp() + interval '1 day', 1,
    pg_temp.delta(p_story, 2), 1, public.chapter_state_delta_hash_v1(pg_temp.delta(p_story, 2)), p_base
  );
end
$fn$;

create or replace function pg_temp.seed_worker(
  p_story text, p_job uuid, p_lease uuid, p_base bigint default 0,
  p_worker text default 'm10-e2-worker', p_heartbeat_age interval default interval '0 seconds'
) returns uuid language plpgsql as $fn$
declare v_claim uuid := p_job; v_corr uuid := gen_random_uuid();
begin
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, status, attempt_count,
    max_attempts, available_at, deadline_at, correlation_id,
    publication_idempotency_key, story_contract_version
  ) values (
    p_job, p_story, 2, 'e2000000-0000-4000-8000-000000000001', 'personalized',
    'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '20 minutes', v_corr,
    'generation-job:' || p_job::text || ':publish:2', 1
  );
  update public.generation_jobs set status='RUNNING', attempt_count=1, worker_id=p_worker,
    claim_token=v_claim, claimed_at=clock_timestamp()-p_heartbeat_age,
    heartbeat_at=clock_timestamp()-p_heartbeat_age
  where id=p_job;
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (p_lease, p_story, 2, 'ACTIVE', p_worker, clock_timestamp()+interval '10 minutes', p_job, v_claim);
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status, title, paragraphs_json,
    prose_fingerprint, audit_signals_json, audit_signals_version, canon_version,
    blueprint_version, direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number, checkpoint_schema_version,
    prose_attempt_count, choice_attempt_count, expires_at, story_contract_version,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    p_story, 2, p_job, v_corr, 'PROSE_READY', 'Bab Dua', '["Paragraf lokal."]'::jsonb,
    'm10-e2-fp', pg_temp.audit(p_story), 2, 1, 1, 'm10-e2-direction', 'personalized', 2, 2,
    p_job, 1, 3, 1, 0, clock_timestamp()+interval '1 day', 1,
    case when p_story='m10-e2-task3:v5-retry' then pg_temp.rich_delta(p_story,2) else pg_temp.delta(p_story,2) end,
    1,
    public.chapter_state_delta_hash_v1(case when p_story='m10-e2-task3:v5-retry' then pg_temp.rich_delta(p_story,2) else pg_temp.delta(p_story,2) end),
    p_base
  );
  return v_claim;
end
$fn$;

create or replace function pg_temp.publish_v3(p_story text, p_attempt uuid, p_lease uuid)
returns jsonb language sql as $fn$
  select public.publish_chapter_state_v3(
    p_story, 2, 'e2000000-0000-4000-8000-000000000001', p_lease, p_attempt,
    'Ke mana kamu melangkah?', pg_temp.choices(), pg_temp.outcomes(), null, null
  )
$fn$;

create or replace function pg_temp.publish_v5(p_story text, p_job uuid, p_lease uuid, p_worker text default 'm10-e2-worker')
returns jsonb language sql as $fn$
  select public.publish_generation_job_chapter_v5(
    p_job, p_worker, p_job, p_lease, p_story, 2,
    'Ke mana kamu melangkah?', pg_temp.choices(), pg_temp.outcomes(), null, null
  )
$fn$;

create or replace function pg_temp.snapshot(p_story text)
returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'chapters',(select coalesce(jsonb_agg(to_jsonb(x) order by x.number),'[]'::jsonb) from public.chapters x where x.story_id=p_story),
    'choice_outcomes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.chapter_number,x.choice_id),'[]'::jsonb) from public.choice_outcomes x where x.story_id=p_story),
    'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb) from public.story_events x where x.story_id=p_story),
    'outbox',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.outbox x where x.payload->>'story_id'=p_story),
    'idempotency',(select coalesce(jsonb_agg(to_jsonb(x) order by x.key),'[]'::jsonb) from public.idempotency_keys x where x.story_id=p_story),
    'facts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.facts_ledger x where x.story_id=p_story),
    'knowledge',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.knowledge_scopes x where x.story_id=p_story),
    'secrets',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.secrets_reveals x where x.story_id=p_story),
    'threads',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.story_threads x where x.story_id=p_story),
    'characters',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.characters x where x.story_id=p_story),
    'character_states',(select coalesce(jsonb_agg(to_jsonb(cs) order by cs.character_id,cs.as_of_chapter),'[]'::jsonb) from public.character_states cs join public.characters c on c.id=cs.character_id where c.story_id=p_story),
    'timeline',(select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinal),'[]'::jsonb) from public.timeline_events x where x.story_id=p_story),
    'act_rollups',(select coalesce(jsonb_agg(to_jsonb(x) order by x.act_number),'[]'::jsonb) from public.act_rollups x where x.story_id=p_story),
    'plot_progress',(select coalesce(jsonb_agg(to_jsonb(x) order by x.debt_id,x.milestone_chapter),'[]'::jsonb) from public.reader_plot_debt_progress x where x.story_id=p_story),
    'plot_closures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.debt_id),'[]'::jsonb) from public.reader_plot_debt_closures x where x.story_id=p_story),
    'commits',(select coalesce(jsonb_agg(to_jsonb(x) order by x.chapter_number),'[]'::jsonb) from public.chapter_state_commits x where x.story_id=p_story),
    'checkpoints',(select coalesce(jsonb_agg(to_jsonb(x) order by x.chapter_number,x.attempt_id),'[]'::jsonb) from public.chapter_generation_checkpoints x where x.story_id=p_story),
    'jobs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.generation_jobs x where x.story_id=p_story),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.generation_job_attempts x where x.story_id=p_story),
    'leases',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.generation_leases x where x.story_id=p_story),
    'reader_state',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]'::jsonb) from public.reader_states x where x.story_id=p_story),
    'story',(select to_jsonb(x) from public.stories x where x.id=p_story)
  )
$fn$;

create or replace function pg_temp.try_call(p_sql text)
returns jsonb language plpgsql as $fn$
declare v_result jsonb; v_state text; v_message text;
begin
  execute p_sql into v_result;
  return jsonb_build_object('ok', true, 'result', v_result);
exception when others then
  get stacked diagnostics v_state=returned_sqlstate, v_message=message_text;
  return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_message);
end
$fn$;

-- FK-safe cleanup. Every statement error is fatal under ON_ERROR_STOP.
create or replace function pg_temp.cleanup_task3()
returns void language plpgsql as $fn$
declare
  v_stories text[] := array[
    'm10-e2-task3:stale-lease','m10-e2-task3:v2-retry','m10-e2-task3:v3-retry',
    'm10-e2-task3:v5-retry','m10-e2-task3:race-1','m10-e2-task3:race-2',
    'm10-e2-task3:rollback-before-commit','m10-e2-task3:rollback-terminal',
    'm10-e2-task3:stale-v3','m10-e2-task3:stale-v5','m10-e2-task3:provenance',
    'm10-e2-task3:outbox'
  ];
begin
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
end
$fn$;

select pg_temp.cleanup_task3();
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'm10-e2-task3@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'm10_e2_task3_nonce', current_setting('m10.task3_run_nonce'),
    'm10_e2_task3_project', current_setting('m10.task3_project_id'),
    'm10_e2_task3_dblink_preexisting', exists(select 1 from pg_extension where extname='dblink')
  ),
  clock_timestamp(), clock_timestamp()
);

do $sentinel$
begin
  if current_database()<>'postgres'
    or current_user<>'supabase_admin'
    or not exists(
      select 1 from auth.users
      where id='e2000000-0000-4000-8000-000000000001'
        and raw_user_meta_data @> jsonb_build_object(
          'm10_e2_task3_nonce', current_setting('m10.task3_run_nonce'),
          'm10_e2_task3_project', current_setting('m10.task3_project_id')
        )
    )
  then raise exception 'M10_E2_SENTINEL_INVALID'; end if;
end
$sentinel$;

-- Row 4: controlled stale heartbeat + expired lease, real recovery RPC, old fence, new claim/lease.
select pg_temp.start_scenario('STALE_LEASE_RECLAMATION');
do $case$
declare
  s text := 'm10-e2-task3:stale-lease';
  j uuid := 'e2040000-0000-4000-8000-000000000001';
  l uuid := 'e2040000-0000-4000-8000-000000000002';
  old_claim uuid; recovered jsonb; old_heartbeat jsonb; claim jsonb; new_lease jsonb;
begin
  perform pg_temp.seed_story(s);
  old_claim := pg_temp.seed_worker(s,j,l,0,'m10-e2-old-owner',interval '90 seconds');
  update public.generation_leases set expires_at=clock_timestamp()-interval '1 second' where id=l;
  if (select count(*) from public.stories)<>1
    or (select count(*) from public.generation_jobs)<>1
    or (select count(*) from public.generation_jobs where id=j and story_id=s and status='RUNNING')<>1
    or (select count(*) from public.generation_leases)<>1
    or (select count(*) from public.chapter_generation_checkpoints)<>1
    or (select count(*) from public.chapter_state_commits)<>0
  then raise exception 'M10_E2_GLOBAL_RECOVERY_PREFLIGHT_FAILED'; end if;
  recovered := public.recover_stale_generation_jobs_v1(1);
  if (select count(*) from public.generation_jobs where id<>j)<>0
    or (select count(*) from public.generation_jobs where id=j and status='RETRY_WAIT')<>1
  then raise exception 'M10_E2_GLOBAL_RECOVERY_SCOPE_FAILED'; end if;
  old_heartbeat := public.heartbeat_generation_job_v1(j,'m10-e2-old-owner',old_claim,l,180);
  if (select count(*) from public.generation_jobs)<>1
    or (select count(*) from public.generation_jobs where id=j and status='RETRY_WAIT')<>1
  then raise exception 'M10_E2_GLOBAL_CLAIM_PREFLIGHT_FAILED'; end if;
  claim := public.claim_generation_job_v1('m10-e2-new-owner');
  if (claim->'job'->>'id')::uuid is distinct from j
    or (select count(*) from public.generation_jobs where id<>j)<>0
  then raise exception 'M10_E2_GLOBAL_CLAIM_SCOPE_FAILED'; end if;
  new_lease := public.acquire_generation_job_lease_v1(
    j, 'm10-e2-new-owner', (claim->'job'->>'claim_token')::uuid, 180
  );
  insert into task3_results values (4,'STALE_LEASE_RECLAMATION',pg_temp.executed(
    'STALE_JOB_RECLAIMED',
    case when (recovered->>'recovered_count')::integer=1
      and old_heartbeat->>'reason'='OWNERSHIP_LOST'
      and (select status from public.generation_leases where id=l)='EXPIRED'
      and (select canon_state_revision from public.stories where id=s)=0
      and (claim->>'claimed')::boolean
      and (claim->'job'->>'claim_token')::uuid<>old_claim
      and (new_lease->>'ok')::boolean
    then 'STALE_JOB_RECLAIMED' else 'STALE_JOB_RECLAMATION_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('RECOVERED_COUNT','1'::jsonb,to_jsonb((recovered->>'recovered_count')::integer)),
      pg_temp.inv('OLD_OWNER_FENCED','"OWNERSHIP_LOST"'::jsonb,to_jsonb(old_heartbeat->>'reason')),
      pg_temp.inv('OLD_LEASE_EXPIRED','"EXPIRED"'::jsonb,to_jsonb((select status from public.generation_leases where id=l))),
      pg_temp.inv('NO_OLD_CANON_ADVANCE','0'::jsonb,to_jsonb((select canon_state_revision from public.stories where id=s)))
    ),
    jsonb_build_array(
      pg_temp.inv('NEW_OWNER_CLAIMED','true'::jsonb,to_jsonb((claim->>'claimed')::boolean)),
      pg_temp.inv('NEW_TOKEN_DIFFERS','true'::jsonb,to_jsonb((claim->'job'->>'claim_token')::uuid <> old_claim)),
      pg_temp.inv('NEW_LEASE_VALID','true'::jsonb,to_jsonb((new_lease->>'ok')::boolean))
    )
  ));
end
$case$;

-- Rows 10-12: first publication commits in an independent backend and its result is
-- intentionally discarded. Retry runs in this independent caller session.
create extension if not exists dblink with schema extensions;
select set_config(
  'm10.task3_dblink_conn',
  format('host=127.0.0.1 port=5432 dbname=postgres user=%s password=%s', :'task3_db_user', :'task3_db_password'),
  false
);
select pg_temp.seed_story('m10-e2-task3:v2-retry');
insert into public.generation_leases(id,story_id,chapter_number,status,holder,expires_at)
values('e2100000-0000-4000-8000-000000000001','m10-e2-task3:v2-retry',2,'ACTIVE','m10-e2-v2',clock_timestamp()+interval '10 minutes');
select pg_temp.start_scenario('PUBLICATION_V2_UNCERTAINTY_RETRY');
do $case$
declare
  s text := 'm10-e2-task3:v2-retry'; l uuid := 'e2100000-0000-4000-8000-000000000001';
  first jsonb; replay jsonb;
begin
  perform extensions.dblink_connect('task3_uncertain',current_setting('m10.task3_dblink_conn'));
  perform * from extensions.dblink(
    'task3_uncertain',
    format('select public.publish_chapter_v2(%L,2,%L,%L::jsonb,%L,%L::jsonb,%L::jsonb,%L::uuid,%L)::text',
      s,'Bab Dua','["Paragraf lokal."]','Ke mana kamu melangkah?',pg_temp.choices()::text,pg_temp.outcomes()::text,l,'m10-e2-task3:v2:key')
  ) as ignored(value text);
  perform extensions.dblink_disconnect('task3_uncertain');
  select result into first from public.idempotency_keys where key='m10-e2-task3:v2:key';
  replay := public.publish_chapter_v2(s,2,'Bab Dua','["Paragraf lokal."]'::jsonb,
    'Ke mana kamu melangkah?',pg_temp.choices(),pg_temp.outcomes(),l,'m10-e2-task3:v2:key');
  insert into task3_results values(10,'PUBLICATION_V2_UNCERTAINTY_RETRY',pg_temp.executed('EXACT_RETRY',
    case when (first->>'ok')::boolean
      and (select count(*) from public.chapters where story_id=s)=1
      and (select count(*) from public.story_events where story_id=s)=1
      and (select count(*) from public.outbox where payload @> jsonb_build_object('story_id',s,'chapter_number',2))=1
      and first=replay then 'EXACT_RETRY' else 'EXACT_RETRY_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FIRST_PUBLICATION_OK','true'::jsonb,to_jsonb((first->>'ok')::boolean)),
      pg_temp.inv('ONE_CHAPTER','1'::jsonb,to_jsonb((select count(*) from public.chapters where story_id=s))),
      pg_temp.inv('ONE_EVENT','1'::jsonb,to_jsonb((select count(*) from public.story_events where story_id=s))),
      pg_temp.inv('ONE_OUTBOX','1'::jsonb,to_jsonb((select count(*) from public.outbox where payload @> jsonb_build_object('story_id',s,'chapter_number',2))))
    ),jsonb_build_array(pg_temp.inv('REPLAY_SAME_RESULT',first,replay))));
end
$case$;

select pg_temp.seed_story('m10-e2-task3:v3-retry');
select pg_temp.seed_sync('m10-e2-task3:v3-retry','e2110000-0000-4000-8000-000000000001','e2110000-0000-4000-8000-000000000002','e2110000-0000-4000-8000-000000000003',0);
select pg_temp.start_scenario('PUBLICATION_V3_UNCERTAINTY_RETRY');
do $case$
declare
  s text := 'm10-e2-task3:v3-retry'; a uuid := 'e2110000-0000-4000-8000-000000000001';
  c uuid := 'e2110000-0000-4000-8000-000000000002'; l uuid := 'e2110000-0000-4000-8000-000000000003';
  first jsonb; replay jsonb;
begin
  perform extensions.dblink_connect('task3_uncertain',current_setting('m10.task3_dblink_conn'));
  perform * from extensions.dblink(
    'task3_uncertain',
    format('select public.publish_chapter_state_v3(%L,2,%L::uuid,%L::uuid,%L::uuid,%L,%L::jsonb,%L::jsonb,null,null)::text',
      s,'e2000000-0000-4000-8000-000000000001',l,a,'Ke mana kamu melangkah?',pg_temp.choices()::text,pg_temp.outcomes()::text)
  ) as ignored(value text);
  perform extensions.dblink_disconnect('task3_uncertain');
  select publication_result into first from public.chapter_state_commits where story_id=s and chapter_number=2;
  replay := pg_temp.publish_v3(s,a,l);
  insert into task3_results values(11,'PUBLICATION_V3_UNCERTAINTY_RETRY',pg_temp.executed('EXACT_RETRY',
    case when (first->>'ok')::boolean
      and (select count(*) from public.chapters where story_id=s)=1
      and (select count(*) from public.chapter_state_commits where story_id=s)=1
      and (select canon_state_revision from public.stories where id=s)=1
      and first=replay then 'EXACT_RETRY' else 'EXACT_RETRY_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FIRST_PUBLICATION_OK','true'::jsonb,to_jsonb((first->>'ok')::boolean)),
      pg_temp.inv('ONE_CHAPTER','1'::jsonb,to_jsonb((select count(*) from public.chapters where story_id=s))),
      pg_temp.inv('ONE_COMMIT','1'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id=s))),
      pg_temp.inv('ONE_CANON_INCREMENT','1'::jsonb,to_jsonb((select canon_state_revision from public.stories where id=s)))
    ),jsonb_build_array(pg_temp.inv('REPLAY_SAME_RESULT',first,replay))));
end
$case$;

select pg_temp.seed_story('m10-e2-task3:v5-retry');
select pg_temp.seed_rich_canon('m10-e2-task3:v5-retry');
select pg_temp.seed_worker('m10-e2-task3:v5-retry','e2120000-0000-4000-8000-000000000001','e2120000-0000-4000-8000-000000000002');
select pg_temp.start_scenario('PUBLICATION_V5_UNCERTAINTY_RETRY');
do $case$
declare
  s text := 'm10-e2-task3:v5-retry'; j uuid := 'e2120000-0000-4000-8000-000000000001';
  l uuid := 'e2120000-0000-4000-8000-000000000002'; first jsonb; replay jsonb;
begin
  perform extensions.dblink_connect('task3_uncertain',current_setting('m10.task3_dblink_conn'));
  perform * from extensions.dblink(
    'task3_uncertain',
    format('select public.publish_generation_job_chapter_v5(%L::uuid,%L,%L::uuid,%L::uuid,%L,2,%L,%L::jsonb,%L::jsonb,null,null)::text',
      j,'m10-e2-worker',j,l,s,'Ke mana kamu melangkah?',pg_temp.choices()::text,pg_temp.outcomes()::text)
  ) as ignored(value text);
  perform extensions.dblink_disconnect('task3_uncertain');
  select publication_result into first from public.generation_jobs where id=j;
  replay := pg_temp.publish_v5(s,j,l);
  insert into task3_results values(12,'PUBLICATION_V5_UNCERTAINTY_RETRY',pg_temp.executed('EXACT_RETRY',
    case when (first->>'ok')::boolean
      and (select count(*) from public.chapters where story_id=s)=1
      and (select count(*) from public.chapter_state_commits where story_id=s)=1
      and (select count(*) from public.generation_job_attempts where job_id=j)=1
      and first=replay then 'EXACT_RETRY' else 'EXACT_RETRY_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FIRST_PUBLICATION_OK','true'::jsonb,to_jsonb((first->>'ok')::boolean)),
      pg_temp.inv('ONE_CHAPTER','1'::jsonb,to_jsonb((select count(*) from public.chapters where story_id=s))),
      pg_temp.inv('ONE_COMMIT','1'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id=s))),
      pg_temp.inv('ONE_ATTEMPT','1'::jsonb,to_jsonb((select count(*) from public.generation_job_attempts where job_id=j)))
    ),jsonb_build_array(pg_temp.inv('REPLAY_SAME_RESULT',first,replay))));
end
$case$;

-- Row 13: exact V3 sync and V5 worker publishers contend in two backend sessions.
-- Exact-story commit triggers hold the first caller long enough for the second to block
-- at the shared story boundary. Launch order forces each path to win once.
create extension if not exists dblink with schema extensions;
select set_config(
  'm10.task3_dblink_conn',
  format('host=127.0.0.1 port=5432 dbname=postgres user=%s password=%s', :'task3_db_user', :'task3_db_password'),
  false
);
create or replace function pg_temp.hold_race_winner() returns trigger language plpgsql as $fn$
begin
  perform pg_sleep(0.25);
  return new;
end
$fn$;
select pg_temp.seed_story('m10-e2-task3:race-1');
select pg_temp.seed_worker('m10-e2-task3:race-1','e2130000-0000-4000-8000-000000000004','e2130000-0000-4000-8000-000000000005',0,'m10-e2-worker');
update public.generation_leases set status='RELEASED' where id='e2130000-0000-4000-8000-000000000005';
select pg_temp.seed_sync('m10-e2-task3:race-1','e2130000-0000-4000-8000-000000000001','e2130000-0000-4000-8000-000000000002','e2130000-0000-4000-8000-000000000003',0);
select pg_temp.seed_story('m10-e2-task3:race-2');
select pg_temp.seed_sync('m10-e2-task3:race-2','e2130000-0000-4000-8000-000000000011','e2130000-0000-4000-8000-000000000012','e2130000-0000-4000-8000-000000000013',0);
update public.generation_leases set status='RELEASED' where id='e2130000-0000-4000-8000-000000000013';
select pg_temp.seed_worker('m10-e2-task3:race-2','e2130000-0000-4000-8000-000000000014','e2130000-0000-4000-8000-000000000015',0,'m10-e2-worker');
create trigger m10_e2_task3_hold_race_1 before insert on public.chapter_state_commits
for each row when (new.story_id='m10-e2-task3:race-1') execute function pg_temp.hold_race_winner();
create trigger m10_e2_task3_hold_race_2 before insert on public.chapter_state_commits
for each row when (new.story_id='m10-e2-task3:race-2') execute function pg_temp.hold_race_winner();
select pg_temp.start_scenario('PUBLICATION_CONCURRENCY_SYNC_VS_WORKER');
do $case$
declare
  s text; a uuid; c uuid; ls uuid; j uuid; lw uuid; order_no integer;
  sync_sql text; worker_sql text; sync_result text; worker_result text;
  sync_error text; worker_error text; winner_job uuid; loser_error text;
  winners jsonb := '[]'::jsonb; no_deadlock boolean := true;
begin
  for order_no in 1..2 loop
    s := 'm10-e2-task3:race-' || order_no;
    a := case order_no when 1 then 'e2130000-0000-4000-8000-000000000001' else 'e2130000-0000-4000-8000-000000000011' end;
    c := case order_no when 1 then 'e2130000-0000-4000-8000-000000000002' else 'e2130000-0000-4000-8000-000000000012' end;
    ls := case order_no when 1 then 'e2130000-0000-4000-8000-000000000003' else 'e2130000-0000-4000-8000-000000000013' end;
    j := case order_no when 1 then 'e2130000-0000-4000-8000-000000000004' else 'e2130000-0000-4000-8000-000000000014' end;
    lw := case order_no when 1 then 'e2130000-0000-4000-8000-000000000005' else 'e2130000-0000-4000-8000-000000000015' end;
    sync_sql := format(
      'select public.publish_chapter_state_v3(%L,2,%L::uuid,%L::uuid,%L::uuid,%L,%L::jsonb,%L::jsonb,null,null)::text',
      s,'e2000000-0000-4000-8000-000000000001',ls,a,'Ke mana kamu melangkah?',pg_temp.choices()::text,pg_temp.outcomes()::text
    );
    worker_sql := format(
      'select public.publish_generation_job_chapter_v5(%L::uuid,%L,%L::uuid,%L::uuid,%L,2,%L,%L::jsonb,%L::jsonb,null,null)::text',
      j,'m10-e2-worker',j,lw,s,'Ke mana kamu melangkah?',pg_temp.choices()::text,pg_temp.outcomes()::text
    );
    perform extensions.dblink_connect('task3_sync',current_setting('m10.task3_dblink_conn'));
    perform extensions.dblink_connect('task3_worker',current_setting('m10.task3_dblink_conn'));
    if order_no = 1 then
      perform extensions.dblink_send_query('task3_sync',sync_sql);
      perform pg_sleep(0.05);
      perform extensions.dblink_send_query('task3_worker',worker_sql);
    else
      perform extensions.dblink_send_query('task3_worker',worker_sql);
      perform pg_sleep(0.05);
      perform extensions.dblink_send_query('task3_sync',sync_sql);
    end if;
    begin
      select value into sync_result from extensions.dblink_get_result('task3_sync') as t(value text);
    exception when others then
      get stacked diagnostics sync_error=message_text;
    end;
    begin
      select value into worker_result from extensions.dblink_get_result('task3_worker') as t(value text);
    exception when others then
      get stacked diagnostics worker_error=message_text;
    end;
    perform extensions.dblink_disconnect('task3_sync');
    perform extensions.dblink_disconnect('task3_worker');
    select source_job_id into winner_job from public.chapter_state_commits where story_id=s;
    loser_error := case when winner_job is null then worker_error else sync_error end;
    winners := winners || jsonb_build_array(case when winner_job is null then 'sync' else 'worker' end);
    if (order_no = 1 and winner_job is not null)
      or (order_no = 2 and winner_job is distinct from j)
      or loser_error not in ('PUBLICATION_CONFLICT','GENERATION_JOB_LEASE_INVALID')
      or (case when winner_job is null then sync_result else worker_result end) is null
      or (select count(*) from public.chapters where story_id=s) <> 1
      or (select count(*) from public.chapter_state_commits where story_id=s) <> 1
      or (select canon_state_revision from public.stories where id=s) <> 1
      or (select count(*) from public.story_events where story_id=s) <> 1
      or (select count(*) from public.outbox where payload @> jsonb_build_object('story_id',s,'chapter_number',2)) <> 1
    then
      raise exception 'RACE_INVARIANT_FAILED order=% winners=% sync_error=% worker_error=%',order_no,winners,sync_error,worker_error;
    end if;
    sync_result := null; worker_result := null; sync_error := null; worker_error := null;
  end loop;
  insert into task3_results values(13,'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER',pg_temp.executed('ONE_DB_WINNER_BOTH_ORDERS',
    case when winners='["sync","worker"]'::jsonb and no_deadlock
      then 'ONE_DB_WINNER_BOTH_ORDERS' else 'PUBLICATION_RACE_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('WINNER_ORDER','["sync","worker"]'::jsonb,winners),
      pg_temp.inv('ONE_CANONICAL_WINNER_EACH','true'::jsonb,'true'::jsonb),
      pg_temp.inv('NO_DEADLOCK','true'::jsonb,to_jsonb(no_deadlock))
    ),jsonb_build_array(pg_temp.inv('LOSERS_FENCED','true'::jsonb,'true'::jsonb))));
exception when others then
  begin perform extensions.dblink_disconnect('task3_sync'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('task3_worker'); exception when others then null; end;
  execute 'drop trigger if exists m10_e2_task3_hold_race_1 on public.chapter_state_commits';
  execute 'drop trigger if exists m10_e2_task3_hold_race_2 on public.chapter_state_commits';
  raise;
end
$case$;
drop trigger m10_e2_task3_hold_race_1 on public.chapter_state_commits;
drop trigger m10_e2_task3_hold_race_2 on public.chapter_state_commits;
-- Sentinel remains authoritative through fresh finally cleanup. Extension state
-- restoration never occurs in proof connection.

-- Row 14: scoped commit failpoint after V2 writes, then clean V3 retry.
create or replace function pg_temp.fail_commit() returns trigger language plpgsql as $fn$
begin raise exception using errcode='P0001',message='M10_E2_FAIL_BEFORE_COMMIT_LEDGER'; end
$fn$;
create trigger m10_e2_task3_fail_commit before insert on public.chapter_state_commits
for each row when (new.story_id='m10-e2-task3:rollback-before-commit') execute function pg_temp.fail_commit();
select pg_temp.start_scenario('TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT');
do $case$
declare
  s text := 'm10-e2-task3:rollback-before-commit'; a uuid := 'e2140000-0000-4000-8000-000000000001';
  c uuid := 'e2140000-0000-4000-8000-000000000002'; l uuid := 'e2140000-0000-4000-8000-000000000003';
  failed jsonb; retry jsonb; before_state jsonb; after_state jsonb;
begin
  perform pg_temp.seed_story(s); perform pg_temp.seed_sync(s,a,c,l);
  before_state := pg_temp.snapshot(s);
  failed := pg_temp.try_call(format('select pg_temp.publish_v3(%L,%L::uuid,%L::uuid)',s,a,l));
  after_state := pg_temp.snapshot(s);
  execute 'drop trigger m10_e2_task3_fail_commit on public.chapter_state_commits';
  retry := pg_temp.publish_v3(s,a,l);
  insert into task3_results values(14,'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',pg_temp.executed('INJECTED_ROLLBACK',
    case when failed->>'message'='M10_E2_FAIL_BEFORE_COMMIT_LEDGER'
      and before_state=after_state and (retry->>'ok')::boolean
      and (select count(*) from public.chapter_state_commits where story_id=s)=1
      then 'INJECTED_ROLLBACK' else 'INJECTED_ROLLBACK_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FAILPOINT_REACHED','"M10_E2_FAIL_BEFORE_COMMIT_LEDGER"'::jsonb,to_jsonb(failed->>'message')),
      pg_temp.inv('FULL_SNAPSHOT_UNCHANGED',before_state,after_state)
    ),jsonb_build_array(
      pg_temp.inv('CLEAN_RETRY_OK','true'::jsonb,to_jsonb((retry->>'ok')::boolean)),
      pg_temp.inv('ONE_COMMIT_AFTER_RETRY','1'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id=s)))
    )));
exception when others then
  execute 'drop trigger if exists m10_e2_task3_fail_commit on public.chapter_state_commits'; raise;
end
$case$;

-- Row 15: scoped terminalization trigger after applier, snapshot rollback, clean V5 retry.
create or replace function pg_temp.fail_terminalization() returns trigger language plpgsql as $fn$
begin raise exception using errcode='P0001',message='M10_E2_FAIL_TERMINALIZATION'; end
$fn$;
create trigger m10_e2_task3_fail_terminal before update on public.generation_jobs
for each row when (old.story_id='m10-e2-task3:rollback-terminal' and new.status='SUCCEEDED')
execute function pg_temp.fail_terminalization();
select pg_temp.start_scenario('TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION');
do $case$
declare
  s text := 'm10-e2-task3:rollback-terminal'; j uuid := 'e2150000-0000-4000-8000-000000000001';
  l uuid := 'e2150000-0000-4000-8000-000000000002'; failed jsonb; retry jsonb;
  before_state jsonb; after_state jsonb;
begin
  perform pg_temp.seed_story(s); perform pg_temp.seed_worker(s,j,l);
  before_state := pg_temp.snapshot(s);
  failed := pg_temp.try_call(format('select pg_temp.publish_v5(%L,%L::uuid,%L::uuid)',s,j,l));
  after_state := pg_temp.snapshot(s);
  execute 'drop trigger m10_e2_task3_fail_terminal on public.generation_jobs';
  retry := pg_temp.publish_v5(s,j,l);
  insert into task3_results values(15,'TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION',pg_temp.executed('INJECTED_ROLLBACK',
    case when failed->>'message'='M10_E2_FAIL_TERMINALIZATION'
      and before_state=after_state and (retry->>'ok')::boolean
      and (select status from public.generation_jobs where id=j)='SUCCEEDED'
      then 'INJECTED_ROLLBACK' else 'INJECTED_ROLLBACK_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FAILPOINT_REACHED','"M10_E2_FAIL_TERMINALIZATION"'::jsonb,to_jsonb(failed->>'message')),
      pg_temp.inv('FULL_SNAPSHOT_UNCHANGED',before_state,after_state)
    ),jsonb_build_array(
      pg_temp.inv('CLEAN_RETRY_OK','true'::jsonb,to_jsonb((retry->>'ok')::boolean)),
      pg_temp.inv('JOB_TERMINALIZED_ONCE','"SUCCEEDED"'::jsonb,to_jsonb((select status from public.generation_jobs where id=j)))
    )));
exception when others then
  execute 'drop trigger if exists m10_e2_task3_fail_terminal on public.generation_jobs'; raise;
end
$case$;

-- Row 16: fresh V3 and V5 calls with stale checkpoint base, immediate no-mutation proof.
select pg_temp.start_scenario('STALE_CANON_REVISION');
do $case$
declare
  s3 text := 'm10-e2-task3:stale-v3'; s5 text := 'm10-e2-task3:stale-v5';
  a uuid := 'e2160000-0000-4000-8000-000000000001'; c uuid := 'e2160000-0000-4000-8000-000000000002';
  l3 uuid := 'e2160000-0000-4000-8000-000000000003'; j uuid := 'e2160000-0000-4000-8000-000000000004';
  l5 uuid := 'e2160000-0000-4000-8000-000000000005'; r3 jsonb; r5 jsonb;
begin
  perform pg_temp.seed_story(s3,1); perform pg_temp.seed_sync(s3,a,c,l3,0);
  perform pg_temp.seed_story(s5,1); perform pg_temp.seed_worker(s5,j,l5,0);
  r3 := pg_temp.try_call(format('select pg_temp.publish_v3(%L,%L::uuid,%L::uuid)',s3,a,l3));
  r5 := pg_temp.try_call(format('select pg_temp.publish_v5(%L,%L::uuid,%L::uuid)',s5,j,l5));
  insert into task3_results values(16,'STALE_CANON_REVISION',pg_temp.executed('STALE_FENCED',
    case when r3->>'message'='PROVENANCE_CONFLICT' and r5->>'message'='STALE_CANON_REVISION'
      and (select count(*) from public.chapters where story_id in(s3,s5))=0
      and (select count(*) from public.chapter_state_commits where story_id in(s3,s5))=0
      and (select sum(canon_state_revision) from public.stories where id in(s3,s5))=2
      and (select count(*)=2 from public.chapter_generation_checkpoints where story_id in(s3,s5) and status='PROSE_READY')
      then 'STALE_FENCED' else 'STALE_FENCE_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('V3_STALE_FENCED','"PROVENANCE_CONFLICT"'::jsonb,to_jsonb(r3->>'message')),
      pg_temp.inv('V5_STALE_FENCED','"STALE_CANON_REVISION"'::jsonb,to_jsonb(r5->>'message')),
      pg_temp.inv('NO_CHAPTER_MUTATION','0'::jsonb,to_jsonb((select count(*) from public.chapters where story_id in(s3,s5)))),
      pg_temp.inv('NO_COMMIT_MUTATION','0'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id in(s3,s5)))),
      pg_temp.inv('REVISIONS_UNCHANGED','2'::jsonb,to_jsonb((select sum(canon_state_revision) from public.stories where id in(s3,s5))))
    ),jsonb_build_array(pg_temp.inv('BOTH_FIXTURES_RETRYABLE','true'::jsonb,to_jsonb((select count(*)=2 from public.chapter_generation_checkpoints where story_id in(s3,s5) and status='PROSE_READY'))))));
end
$case$;

-- Row 17: publish then alter checkpoint provenance; exact current replay machine rejects without mutation.
select pg_temp.start_scenario('COMMIT_LEDGER_PROVENANCE_MISMATCH');
do $case$
declare
  s text := 'm10-e2-task3:provenance'; j uuid := 'e2170000-0000-4000-8000-000000000001';
  l uuid := 'e2170000-0000-4000-8000-000000000002'; first jsonb; mismatch jsonb;
  before_replay jsonb; after_replay jsonb;
begin
  perform pg_temp.seed_story(s); perform pg_temp.seed_worker(s,j,l);
  first := pg_temp.publish_v5(s,j,l);
  update public.chapter_generation_checkpoints set correlation_id='e2170000-0000-4000-8000-000000000099' where job_id=j;
  before_replay := pg_temp.snapshot(s);
  mismatch := pg_temp.try_call(format('select pg_temp.publish_v5(%L,%L::uuid,%L::uuid)',s,j,l));
  after_replay := pg_temp.snapshot(s);
  insert into task3_results values(17,'COMMIT_LEDGER_PROVENANCE_MISMATCH',pg_temp.executed('PROVENANCE_CONFLICT',
    case when mismatch->>'message'='PROVENANCE_CONFLICT' and before_replay=after_replay
      and (select count(*) from public.chapters where story_id=s)=1
      and (select count(*) from public.chapter_state_commits where story_id=s)=1
      and (select canon_state_revision from public.stories where id=s)=1
      and (first->>'ok')::boolean then 'PROVENANCE_CONFLICT' else 'PROVENANCE_CHECK_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('LEDGER_REPLAY_MISMATCH_REJECTED','"PROVENANCE_CONFLICT"'::jsonb,to_jsonb(mismatch->>'message')),
      pg_temp.inv('FULL_REPLAY_SNAPSHOT_UNCHANGED',before_replay,after_replay),
      pg_temp.inv('ONE_CHAPTER_REMAINS','1'::jsonb,to_jsonb((select count(*) from public.chapters where story_id=s))),
      pg_temp.inv('ONE_COMMIT_REMAINS','1'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id=s))),
      pg_temp.inv('REVISION_NOT_REINCREMENTED','1'::jsonb,to_jsonb((select canon_state_revision from public.stories where id=s)))
    ),jsonb_build_array(pg_temp.inv('ORIGINAL_PUBLICATION_VALID','true'::jsonb,to_jsonb((first->>'ok')::boolean)))));
end
$case$;

-- Row 19: exact-story outbox failpoint inside nested V2, full outer rollback, clean retry.
create or replace function pg_temp.fail_outbox() returns trigger language plpgsql as $fn$
begin raise exception using errcode='P0001',message='M10_E2_FAIL_OUTBOX'; end
$fn$;
create trigger m10_e2_task3_fail_outbox before insert on public.outbox
for each row when (new.payload @> '{"story_id":"m10-e2-task3:outbox"}'::jsonb)
execute function pg_temp.fail_outbox();
select pg_temp.start_scenario('NOTIFICATION_OUTBOX_FAILURE');
do $case$
declare
  s text := 'm10-e2-task3:outbox'; a uuid := 'e2190000-0000-4000-8000-000000000001';
  c uuid := 'e2190000-0000-4000-8000-000000000002'; l uuid := 'e2190000-0000-4000-8000-000000000003';
  failed jsonb; retry jsonb; before_state jsonb; after_state jsonb;
begin
  perform pg_temp.seed_story(s); perform pg_temp.seed_sync(s,a,c,l);
  before_state := pg_temp.snapshot(s);
  failed := pg_temp.try_call(format('select pg_temp.publish_v3(%L,%L::uuid,%L::uuid)',s,a,l));
  after_state := pg_temp.snapshot(s);
  execute 'drop trigger m10_e2_task3_fail_outbox on public.outbox';
  retry := pg_temp.publish_v3(s,a,l);
  insert into task3_results values(19,'NOTIFICATION_OUTBOX_FAILURE',pg_temp.executed('OUTBOX_FAILURE_ROLLBACK',
    case when failed->>'message'='M10_E2_FAIL_OUTBOX' and before_state=after_state
      and (retry->>'ok')::boolean
      and (select count(*) from public.outbox where payload @> jsonb_build_object('story_id',s,'chapter_number',2))=1
      and (select count(*) from public.chapters where story_id=s)=1
      and (select count(*) from public.chapter_state_commits where story_id=s)=1
      then 'OUTBOX_FAILURE_ROLLBACK' else 'OUTBOX_ROLLBACK_FAILED' end,
    jsonb_build_array(
      pg_temp.inv('FAILPOINT_REACHED','"M10_E2_FAIL_OUTBOX"'::jsonb,to_jsonb(failed->>'message')),
      pg_temp.inv('FULL_SNAPSHOT_UNCHANGED',before_state,after_state)
    ),jsonb_build_array(
      pg_temp.inv('CLEAN_RETRY_OK','true'::jsonb,to_jsonb((retry->>'ok')::boolean)),
      pg_temp.inv('ONE_OUTBOX_AFTER_RETRY','1'::jsonb,to_jsonb((select count(*) from public.outbox where payload @> jsonb_build_object('story_id',s,'chapter_number',2)))),
      pg_temp.inv('ONE_CHAPTER_AFTER_RETRY','1'::jsonb,to_jsonb((select count(*) from public.chapters where story_id=s))),
      pg_temp.inv('ONE_COMMIT_AFTER_RETRY','1'::jsonb,to_jsonb((select count(*) from public.chapter_state_commits where story_id=s)))
    )));
exception when others then
  execute 'drop trigger if exists m10_e2_task3_fail_outbox on public.outbox'; raise;
end
$case$;

-- Exact trigger teardown proof before fixture cleanup.
do $verify$
begin
  if exists (
    select 1 from pg_trigger where not tgisinternal and tgname like 'm10_e2_task3_%'
  ) then raise exception 'TASK3_TRIGGER_TEARDOWN_FAILED'; end if;
end
$verify$;

create or replace function pg_temp.canonical_corruption_count()
returns bigint language sql stable as $fn$
  with committed as (
    select c.story_id,c.chapter_number,c.source_job_id,c.state_delta_json
    from public.chapter_state_commits c
    where c.story_id like 'm10-e2-task3:%' and c.story_id<>'m10-e2-task3:v5-retry'
  ), expected as (
    select
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'facts'->'add','[]'::jsonb))),0) facts,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'knowledge'->'grants','[]'::jsonb))),0) knowledge,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'secrets'->'revealIds','[]'::jsonb))),0) secrets,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'timeline'->'append','[]'::jsonb))),0) timeline,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'characters'->'statusChanges','[]'::jsonb))),0) character_states,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'threads'->'transitions','[]'::jsonb))),0) thread_transitions,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'plotDebts'->'progress','[]'::jsonb))),0) plot_progress,
      coalesce(sum(jsonb_array_length(coalesce(state_delta_json->'plotDebts'->'closures','[]'::jsonb))),0) plot_closures,
      count(*) filter(where state_delta_json->'actRollup' is not null and state_delta_json->'actRollup'<>'null'::jsonb) act_rollups
    from committed
  ), actual as (
    select
      (select count(*) from public.facts_ledger where story_id in(select story_id from committed)) facts,
      (select count(*) from public.knowledge_scopes where story_id in(select story_id from committed)) knowledge,
      (select count(*) from public.secrets_reveals where story_id in(select story_id from committed)) secrets,
      (select count(*) from public.timeline_events where story_id in(select story_id from committed)) timeline,
      (select count(*) from public.character_states cs join public.characters c on c.id=cs.character_id where c.story_id in(select story_id from committed)) character_states,
      (select count(*) from public.story_threads where story_id in(select story_id from committed) and status<>'OPEN') thread_transitions,
      (select count(*) from public.reader_plot_debt_progress where story_id in(select story_id from committed)) plot_progress,
      (select count(*) from public.reader_plot_debt_closures where story_id in(select story_id from committed)) plot_closures,
      (select count(*) from public.act_rollups where story_id in(select story_id from committed)) act_rollups
  )
  select
    (e.facts<>a.facts)::integer + (e.knowledge<>a.knowledge)::integer +
    (e.secrets<>a.secrets)::integer + (e.timeline<>a.timeline)::integer +
    (e.character_states<>a.character_states)::integer +
    (e.thread_transitions<>a.thread_transitions)::integer +
    (e.plot_progress<>a.plot_progress)::integer +
    (e.plot_closures<>a.plot_closures)::integer + (e.act_rollups<>a.act_rollups)::integer +
    (select count(*) from public.characters c where c.story_id in(select story_id from committed)
      and not exists(select 1 from public.character_states cs where cs.character_id=c.id)) +
    (select count(*) from public.character_states cs where not exists(select 1 from public.characters c where c.id=cs.character_id)) +
    (select count(*) from public.facts_ledger f where f.story_id in(select story_id from committed) and not exists(
      select 1 from committed c where c.story_id=f.story_id and c.chapter_number=f.established_chapter
    )) +
    (select count(*) from public.timeline_events t where t.story_id in(select story_id from committed) and not exists(
      select 1 from committed c where c.story_id=t.story_id and c.chapter_number=t.chapter_number
    )) +
    (select count(*) from public.reader_plot_debt_progress p where p.story_id in(select story_id from committed)
      and p.source_job_id is not null and not exists(select 1 from committed c where c.story_id=p.story_id and c.source_job_id=p.source_job_id)) +
    (select count(*) from public.reader_plot_debt_closures p where p.story_id in(select story_id from committed)
      and p.closed_by_job_id is not null and not exists(select 1 from committed c where c.story_id=p.story_id and c.source_job_id=p.closed_by_job_id))
  from expected e cross join actual a
$fn$;

create or replace function pg_temp.rich_canonical_corruption_count()
returns bigint language sql stable as $fn$
  with r as (
    select story_id,chapter_number,source_job_id,state_delta_json d
    from public.chapter_state_commits where story_id='m10-e2-task3:v5-retry'
  ) select
    (select count(*)<>2 from public.facts_ledger where story_id=r.story_id)::integer +
    (not exists(select 1 from public.facts_ledger f,jsonb_array_elements(r.d->'facts'->'add') x
      where f.story_id=r.story_id and f.id=x->>'id' and f.statement=x->>'statement'
        and f.subject_character_id=x->>'subjectCharacterId' and f.established_chapter=r.chapter_number
        and f.salience=(x->>'salience')::real and not f.load_bearing and not f.paid_off))::integer +
    (not exists(select 1 from public.facts_ledger f,jsonb_array_elements_text(r.d->'facts'->'markPaidOff') x
      where f.story_id=r.story_id and f.id=x.value and f.paid_off))::integer +
    (select count(*)<>1 from public.knowledge_scopes where story_id=r.story_id)::integer +
    (not exists(select 1 from public.knowledge_scopes k,jsonb_array_elements(r.d->'knowledge'->'grants') x
      where k.story_id=r.story_id and k.character_id=x->>'characterId' and k.fact_id=x->>'factId' and k.known_from_chapter=r.chapter_number))::integer +
    (select count(*)<>1 from public.secrets_reveals where story_id=r.story_id)::integer +
    (not exists(select 1 from public.secrets_reveals s,jsonb_array_elements_text(r.d->'secrets'->'revealIds') x
      where s.story_id=r.story_id and s.id=x.value and s.revealed and s.reveal_gate_chapter<=r.chapter_number))::integer +
    (select count(*)<>1 from public.timeline_events where story_id=r.story_id)::integer +
    (not exists(select 1 from public.timeline_events t,jsonb_array_elements(r.d->'timeline'->'append') x
      where t.story_id=r.story_id and t.chapter_number=r.chapter_number and t.ordinal=(x->>'ordinal')::integer
        and t.description=x->>'description' and t.is_flashback=(x->>'isFlashback')::boolean and t.occurs_at=(x->>'occursAt')::real))::integer +
    (select count(*)<>2 from public.character_states cs join public.characters c on c.id=cs.character_id where c.story_id=r.story_id)::integer +
    (not exists(select 1 from public.character_states cs,jsonb_array_elements(r.d->'characters'->'statusChanges') x
      where cs.character_id=x->>'characterId' and cs.as_of_chapter=r.chapter_number and cs.status=x->>'to' and cs.attributes='{}'::jsonb))::integer +
    (select count(*)<>2 from public.story_threads where story_id=r.story_id)::integer +
    (not exists(select 1 from public.story_threads t,jsonb_array_elements_text(r.d->'threads'->'touches') x
      where t.story_id=r.story_id and t.id=x.value and t.status='OPEN' and t.last_touched_chapter=r.chapter_number and not t.stale and t.stale_since_chapter is null))::integer +
    (not exists(select 1 from public.story_threads t,jsonb_array_elements(r.d->'threads'->'transitions') x
      where t.story_id=r.story_id and t.id=x->>'threadId' and t.status=x->>'to' and t.last_touched_chapter=r.chapter_number and not t.stale and t.stale_since_chapter is null))::integer +
    (select count(*)<>1 from public.reader_plot_debt_progress where story_id=r.story_id)::integer +
    (not exists(select 1 from public.reader_plot_debt_progress p,jsonb_array_elements(r.d->'plotDebts'->'progress') x
      where p.story_id=r.story_id and p.debt_id=x->>'debtId' and p.milestone_chapter=(x->>'milestoneChapter')::integer
        and p.progressed_at_chapter=(x->>'milestoneChapter')::integer and p.source_job_id=r.source_job_id and p.progress_version=1))::integer +
    (select count(*)<>1 from public.reader_plot_debt_closures where story_id=r.story_id)::integer +
    (not exists(select 1 from public.reader_plot_debt_closures p,jsonb_array_elements(r.d->'plotDebts'->'closures') x
      where p.story_id=r.story_id and p.debt_id=x->>'debtId' and p.closure_form=x->>'closureForm'
        and p.closed_at_chapter=r.chapter_number and p.closed_by_job_id=r.source_job_id and p.closure_version=1))::integer +
    (select count(*)<>1 from public.act_rollups where story_id=r.story_id)::integer +
    (not exists(select 1 from public.act_rollups a where a.story_id=r.story_id
      and a.act_number=(r.d->'actRollup'->>'actNumber')::integer and a.summary=r.d->'actRollup'->>'summary'
      and a.state_delta=r.d->'actRollup'->'stateDelta' and a.covers_from_chapter=(r.d->'actRollup'->>'coversFromChapter')::integer
      and a.covers_to_chapter=(r.d->'actRollup'->>'coversToChapter')::integer))::integer
  from r
$fn$;

-- Every owned table and both update paths must detect mutation and restore zero.
do $mutation$
declare base bigint; changed bigint; step text;
begin
  base:=pg_temp.canonical_corruption_count()+pg_temp.rich_canonical_corruption_count();
  if base<>0 then raise exception 'CANONICAL_BASELINE_CORRUPT:%',base; end if;
  for step in select unnest(array['facts_add','facts_paid_off','knowledge','secrets','timeline','character_transition','thread_touch','thread_transition','plot_progress','plot_closure','act_rollup']) loop
    case step
      when 'facts_add' then update public.facts_ledger set statement='MUTATED' where id='fact:new:m10-e2-task3:v5-retry';
      when 'facts_paid_off' then update public.facts_ledger set paid_off=false where id='fact:old:m10-e2-task3:v5-retry';
      when 'knowledge' then update public.knowledge_scopes set known_from_chapter=9 where story_id='m10-e2-task3:v5-retry';
      when 'secrets' then update public.secrets_reveals set revealed=false where story_id='m10-e2-task3:v5-retry';
      when 'timeline' then update public.timeline_events set description='MUTATED' where story_id='m10-e2-task3:v5-retry';
      when 'character_transition' then update public.character_states set status='DEAD' where character_id='char:m10-e2-task3:v5-retry' and as_of_chapter=2;
      when 'thread_touch' then update public.story_threads set stale=true where id='thread:touch:m10-e2-task3:v5-retry';
      when 'thread_transition' then update public.story_threads set status='PAYOFF_DUE' where id='thread:transition:m10-e2-task3:v5-retry';
      when 'plot_progress' then
        alter table public.reader_plot_debt_progress disable trigger user;
        update public.reader_plot_debt_progress set source_job_id=null where story_id='m10-e2-task3:v5-retry';
      when 'plot_closure' then
        alter table public.reader_plot_debt_closures disable trigger user;
        update public.reader_plot_debt_closures set closed_by_job_id=null where story_id='m10-e2-task3:v5-retry';
      when 'act_rollup' then update public.act_rollups set summary='MUTATED' where story_id='m10-e2-task3:v5-retry';
    end case;
    changed:=pg_temp.canonical_corruption_count()+pg_temp.rich_canonical_corruption_count();
    if changed<=base then raise exception 'CANONICAL_MUTATION_NOT_DETECTED:%',step; end if;
    case step
      when 'facts_add' then update public.facts_ledger set statement='Fakta baru terukur.' where id='fact:new:m10-e2-task3:v5-retry';
      when 'facts_paid_off' then update public.facts_ledger set paid_off=true where id='fact:old:m10-e2-task3:v5-retry';
      when 'knowledge' then update public.knowledge_scopes set known_from_chapter=2 where story_id='m10-e2-task3:v5-retry';
      when 'secrets' then update public.secrets_reveals set revealed=true where story_id='m10-e2-task3:v5-retry';
      when 'timeline' then update public.timeline_events set description='Waktu kanon bergerak.' where story_id='m10-e2-task3:v5-retry';
      when 'character_transition' then update public.character_states set status='INACTIVE' where character_id='char:m10-e2-task3:v5-retry' and as_of_chapter=2;
      when 'thread_touch' then update public.story_threads set stale=false where id='thread:touch:m10-e2-task3:v5-retry';
      when 'thread_transition' then update public.story_threads set status='DEVELOPING' where id='thread:transition:m10-e2-task3:v5-retry';
      when 'plot_progress' then
        update public.reader_plot_debt_progress set source_job_id='e2120000-0000-4000-8000-000000000001' where story_id='m10-e2-task3:v5-retry';
        alter table public.reader_plot_debt_progress enable trigger user;
      when 'plot_closure' then
        update public.reader_plot_debt_closures set closed_by_job_id='e2120000-0000-4000-8000-000000000001' where story_id='m10-e2-task3:v5-retry';
        alter table public.reader_plot_debt_closures enable trigger user;
      when 'act_rollup' then update public.act_rollups set summary='Ringkasan kanon terukur.' where story_id='m10-e2-task3:v5-retry';
    end case;
    if pg_temp.canonical_corruption_count()+pg_temp.rich_canonical_corruption_count()<>base then raise exception 'CANONICAL_MUTATION_RESTORE_FAILED:%',step; end if;
  end loop;
end
$mutation$;

create temporary table task3_safety_counters(
  duplicate_publication_count bigint not null,
  canonical_corruption_count bigint not null,
  unbounded_retry_count bigint not null
) on commit preserve rows;
insert into task3_safety_counters
select
  (select count(*) from (
    select s.id
    from public.stories s
    where s.id like 'm10-e2-task3:%'
      and exists(select 1 from public.chapters ch where ch.story_id=s.id)
      and (
        (select count(*) from public.chapters ch where ch.story_id=s.id)<>1
        or (select count(*) from public.story_events e where e.story_id=s.id)<>1
        or (select count(*) from public.outbox o where o.payload->>'story_id'=s.id)<>1
        or (select count(*) from public.idempotency_keys i where i.story_id=s.id)<>1
      )
  ) duplicate_failures),
  pg_temp.canonical_corruption_count() + pg_temp.rich_canonical_corruption_count() + (select count(*) from (
    select s.id
    from public.stories s
    where s.id like 'm10-e2-task3:%'
      and exists(select 1 from public.chapter_state_commits c where c.story_id=s.id)
      and (
        (select count(*) from public.chapter_state_commits c where c.story_id=s.id)
          <> (select count(*) from public.chapters ch where ch.story_id=s.id)
        or (select count(*) from public.chapter_state_commits c where c.story_id=s.id)
          <> (select count(distinct c.chapter_number) from public.chapter_state_commits c where c.story_id=s.id)
        or (select count(*) from public.chapter_state_commits c where c.story_id=s.id)
          <> (select count(distinct c.committed_canon_revision) from public.chapter_state_commits c where c.story_id=s.id)
        or s.canon_state_revision<>(select max(c.committed_canon_revision) from public.chapter_state_commits c where c.story_id=s.id)
        or exists(select 1 from public.chapter_state_commits c where c.story_id=s.id and c.committed_canon_revision<>c.base_canon_revision+1)
        or exists(select 1 from public.chapter_state_commits c where c.story_id=s.id and not exists(
          select 1 from public.chapters ch where ch.story_id=c.story_id and ch.number=c.chapter_number
        ))
      )
  ) canonical_failures),
  (select count(*) from public.generation_jobs
    where story_id like 'm10-e2-task3:%' and attempt_count > max_attempts);

select pg_temp.cleanup_task3();
-- Sentinel intentionally survives. Fresh finally cleanup restores extension state,
-- verifies equality, then deletes sentinel.

-- Absence proof covers publication, jobs, attempts, provider calls, checkpoints,
-- commits, idempotency, events/outbox, and canonical story-owned tables.
do $absence$
declare residue bigint;
begin
  select
    (select count(*) from public.stories where id like 'm10-e2-task3:%') +
    (select count(*) from public.chapters where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.choice_outcomes where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.story_events where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.outbox where payload->>'story_id' like 'm10-e2-task3:%') +
    (select count(*) from public.idempotency_keys where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.chapter_generation_checkpoints where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.chapter_state_commits where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.generation_jobs where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.generation_job_attempts where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.generation_provider_calls where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.generation_leases where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.reader_states where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.facts_ledger where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.knowledge_scopes where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.secrets_reveals where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.story_threads where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.characters where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.character_states cs join public.characters c on c.id=cs.character_id where c.story_id like 'm10-e2-task3:%') +
    (select count(*) from public.character_aliases ca join public.characters c on c.id=ca.character_id where c.story_id like 'm10-e2-task3:%') +
    (select count(*) from public.character_voice_sheets cvs join public.characters c on c.id=cvs.character_id where c.story_id like 'm10-e2-task3:%') +
    (select count(*) from public.timeline_events where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.act_rollups where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.reader_plot_debt_progress where story_id like 'm10-e2-task3:%') +
    (select count(*) from public.reader_plot_debt_closures where story_id like 'm10-e2-task3:%')
  into residue;
  if residue <> 0 then raise exception 'TASK3_CLEANUP_RESIDUE:%',residue; end if;
  if exists(select 1 from pg_trigger where not tgisinternal and tgname like 'm10_e2_task3_%')
    then raise exception 'TASK3_TRIGGER_RESIDUE'; end if;
end
$absence$;

select 'M10_E2_TASK3_RESULT=' || jsonb_build_object(
  'rows', (select jsonb_agg(jsonb_build_object(
    'id',id,'proof',proof,'operational',jsonb_build_object(
      'observedAt',to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'latencyMs',latency_ms
    )
  ) order by ordinal) from task3_results),
  'safetyCounters', jsonb_build_object(
    'duplicatePublicationCount', duplicate_publication_count,
    'canonicalCorruptionCount', canonical_corruption_count,
    'unboundedRetryCount', unbounded_retry_count
  ),
  'resetProof', jsonb_build_object(
    'completed', true,
    'targets', jsonb_build_array(jsonb_build_object(
      'target','m10-e2-task3-local-db','resetApplied',true,'cleanStateVerified',true
    ))
  )
)::text from task3_safety_counters;
