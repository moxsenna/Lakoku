-- Repoint body RPC yang masih membaca auth.users → public."user".
-- (Audit 2026-11-04, temuan B1)
--
-- UPDATE pg_proc tidak bisa dipakai di Neon (katalog sistem dilindungi, role
-- migrasi bukan superuser). Maka setiap function di-CREATE OR REPLACE dengan
-- body verbatim dari file migrasi sumber terakhir yang mendefinisikannya,
-- dengan SATU penggantian sasaran per pola. Body diverifikasi otomatis saat
-- generator dijalankan: sebelumnya mengandung auth.users, hasilnya nol.
--
-- Tanpa ini, pendaftar baru (Better Auth, public."user") terlihat tidak ada
-- oleh RPC berikut: clone premium → INVALID_OWNER, welcome credit →
-- "user not found", observability admin → email aktor kosong.

create or replace function public.clone_premium_story_instance(
  p_template_story_id text,
  p_user_id uuid,
  p_new_story_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.stories%rowtype;
  v_source_found boolean;
  v_blueprint_count bigint;
  v_blueprint_distinct_count bigint;
  v_blueprint_min_chapter integer;
  v_blueprint_max_chapter integer;
  v_text_id_count bigint;
  v_distinct_text_id_count bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_character_old_ids text[];
  v_character_new_ids text[];
  v_fact_old_ids text[];
  v_fact_new_ids text[];
  v_secret_old_ids text[];
  v_secret_new_ids text[];
  v_thread_old_ids text[];
  v_thread_new_ids text[];
  v_old_ids text[];
  v_new_ids text[];
begin
  if p_template_story_id is null
    or p_template_story_id = ''
    or p_template_story_id <> pg_catalog.btrim(p_template_story_id)
    or p_new_story_id is null
    or p_new_story_id = ''
    or p_new_story_id <> pg_catalog.btrim(p_new_story_id)
    or pg_catalog.char_length(p_template_story_id) > 200
    or pg_catalog.char_length(p_new_story_id) > 128
    or p_template_story_id = p_new_story_id then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;

  if p_user_id is null
    or not exists (
      select 1
      from public."user" as users
      where users.id = p_user_id
    ) then
    raise exception using errcode = '22023', message = 'INVALID_OWNER';
  end if;

  -- Lock source before target. Source uses authoring RPC namespace; target uses clone namespace.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_template_story_id, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clone_premium_story_instance:' || p_new_story_id, 0)
  );

  select source.*
  into v_source
  from public.stories as source
  where source.id = p_template_story_id
  for share;
  v_source_found := found;

  select
    pg_catalog.count(*),
    pg_catalog.count(distinct blueprint.chapter_number),
    pg_catalog.min(blueprint.chapter_number),
    pg_catalog.max(blueprint.chapter_number)
  into
    v_blueprint_count,
    v_blueprint_distinct_count,
    v_blueprint_min_chapter,
    v_blueprint_max_chapter
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  select pg_catalog.count(*), pg_catalog.count(distinct source_id)
  into v_text_id_count, v_distinct_text_id_count
  from (
    select character.id as source_id
    from public.characters as character
    where character.story_id = p_template_story_id
    union all
    select fact.id
    from public.facts_ledger as fact
    where fact.story_id = p_template_story_id
    union all
    select secret.id
    from public.secrets_reveals as secret
    where secret.story_id = p_template_story_id
    union all
    select thread.id
    from public.story_threads as thread
    where thread.story_id = p_template_story_id
  ) as remapped_source_ids;

  if not v_source_found
    or v_source.story_mode is distinct from 'premium_template'
    or v_source.visibility is distinct from 'public'
    or v_source.total_chapters is distinct from 50
    or not exists (
      select 1
      from public.story_generation_contracts as contract
      where contract.story_id = p_template_story_id
        and contract.mode = 'premium_template'
        and contract.total_chapters = 50
        and pg_catalog.jsonb_typeof(contract.story_contract_json) = 'object'
    )
    or v_blueprint_count <> 50
    or v_blueprint_distinct_count <> 50
    or v_blueprint_min_chapter <> 1
    or v_blueprint_max_chapter <> 50
    or v_text_id_count <> v_distinct_text_id_count
    or not public.clone_premium_story_curated_chapter_is_valid(p_template_story_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'INVALID_TEMPLATE');
  end if;

  select
    coalesce(
      pg_catalog.array_agg(character.id order by character.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':character:' || pg_catalog.md5(character.id)
        order by character.id
      ),
      array[]::text[]
    )
  into v_character_old_ids, v_character_new_ids
  from public.characters as character
  where character.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(fact.id order by fact.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':fact:' || pg_catalog.md5(fact.id)
        order by fact.id
      ),
      array[]::text[]
    )
  into v_fact_old_ids, v_fact_new_ids
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(secret.id order by secret.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':secret:' || pg_catalog.md5(secret.id)
        order by secret.id
      ),
      array[]::text[]
    )
  into v_secret_old_ids, v_secret_new_ids
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(thread.id order by thread.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':thread:' || pg_catalog.md5(thread.id)
        order by thread.id
      ),
      array[]::text[]
    )
  into v_thread_old_ids, v_thread_new_ids
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  v_old_ids := v_character_old_ids || v_fact_old_ids || v_secret_old_ids || v_thread_old_ids;
  v_new_ids := v_character_new_ids || v_fact_new_ids || v_secret_new_ids || v_thread_new_ids;

  insert into public.stories (
    id,
    title,
    cover,
    tagline,
    role,
    tropes,
    total_chapters,
    synopsis,
    status,
    current_chapter,
    jejak,
    ending_name,
    created_at,
    owner_user_id,
    visibility,
    source_story_id,
    story_mode,
    generation_status,
    story_contract_version
  ) values (
    p_new_story_id,
    v_source.title,
    v_source.cover,
    v_source.tagline,
    v_source.role,
    v_source.tropes,
    v_source.total_chapters,
    v_source.synopsis,
    'BARU',
    1,
    '[]'::jsonb,
    null,
    v_now,
    p_user_id,
    'private',
    p_template_story_id,
    'premium_instance',
    'ready',
    v_source.story_contract_version
  )
  on conflict (id) do nothing;

  if not found then
    raise exception using errcode = '23505', message = 'TARGET_STORY_EXISTS';
  end if;

  insert into public.story_generation_contracts (
    story_id,
    mode,
    total_chapters,
    contract_source,
    onboarding_json,
    story_contract_json,
    route_schema_json,
    plot_debts_json,
    ending_candidates_json,
    ending_lock_json,
    quality_profile,
    created_at,
    updated_at,
    story_contract_version
  )
  select
    p_new_story_id,
    'premium_instance',
    contract.total_chapters,
    contract.contract_source,
    public.clone_premium_story_remap_jsonb(contract.onboarding_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.story_contract_json, v_old_ids, v_new_ids)
      || pg_catalog.jsonb_build_object('storyId', p_new_story_id),
    public.clone_premium_story_remap_jsonb(contract.route_schema_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.plot_debts_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_candidates_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_lock_json, v_old_ids, v_new_ids),
    contract.quality_profile,
    v_now,
    v_now,
    contract.story_contract_version
  from public.story_generation_contracts as contract
  where contract.story_id = p_template_story_id;

  insert into public.characters (
    id,
    story_id,
    canonical_name,
    role,
    motivation,
    introduced_chapter,
    created_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(character.id),
    p_new_story_id,
    character.canonical_name,
    character.role,
    character.motivation,
    character.introduced_chapter,
    v_now
  from public.characters as character
  where character.story_id = p_template_story_id;

  insert into public.character_states (
    character_id,
    status,
    as_of_chapter,
    attributes,
    updated_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(state.character_id),
    state.status,
    state.as_of_chapter,
    public.clone_premium_story_remap_jsonb(state.attributes, v_old_ids, v_new_ids),
    v_now
  from public.character_states as state
  join public.characters as character
    on character.id = state.character_id
  where character.story_id = p_template_story_id;

  insert into public.character_aliases (
    story_id,
    character_id,
    alias,
    alias_type,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(alias.character_id),
    alias.alias,
    alias.alias_type,
    v_now
  from public.character_aliases as alias
  join public.characters as character
    on character.id = alias.character_id
  where character.story_id = p_template_story_id;

  insert into public.character_voice_sheets (
    story_id,
    character_id,
    register,
    speech_habits,
    forbidden_words,
    sample_lines,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(voice.character_id),
    voice.register,
    voice.speech_habits,
    voice.forbidden_words,
    voice.sample_lines,
    v_now
  from public.character_voice_sheets as voice
  join public.characters as character
    on character.id = voice.character_id
  where character.story_id = p_template_story_id;

  insert into public.facts_ledger (
    id,
    story_id,
    statement,
    subject_character_id,
    established_chapter,
    salience,
    load_bearing,
    paid_off,
    created_at
  )
  select
    p_new_story_id || ':fact:' || pg_catalog.md5(fact.id),
    p_new_story_id,
    fact.statement,
    case
      when fact.subject_character_id is null then null
      else p_new_story_id || ':character:' || pg_catalog.md5(fact.subject_character_id)
    end,
    fact.established_chapter,
    fact.salience,
    fact.load_bearing,
    fact.paid_off,
    v_now
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  insert into public.knowledge_scopes (
    story_id,
    character_id,
    fact_id,
    known_from_chapter,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(scope.character_id),
    p_new_story_id || ':fact:' || pg_catalog.md5(scope.fact_id),
    scope.known_from_chapter,
    v_now
  from public.knowledge_scopes as scope
  join public.characters as character
    on character.id = scope.character_id
  join public.facts_ledger as fact
    on fact.id = scope.fact_id
  where character.story_id = p_template_story_id
    and fact.story_id = p_template_story_id;

  insert into public.secrets_reveals (
    id,
    story_id,
    description,
    reveal_gate_chapter,
    revealed,
    created_at
  )
  select
    p_new_story_id || ':secret:' || pg_catalog.md5(secret.id),
    p_new_story_id,
    secret.description,
    secret.reveal_gate_chapter,
    secret.revealed,
    v_now
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  insert into public.story_threads (
    id,
    story_id,
    title,
    status,
    opened_chapter,
    last_touched_chapter,
    payoff_window,
    is_main_mystery,
    stale,
    stale_since_chapter,
    created_at
  )
  select
    p_new_story_id || ':thread:' || pg_catalog.md5(thread.id),
    p_new_story_id,
    thread.title,
    thread.status,
    thread.opened_chapter,
    thread.last_touched_chapter,
    thread.payoff_window,
    thread.is_main_mystery,
    thread.stale,
    thread.stale_since_chapter,
    v_now
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  insert into public.chapter_blueprints (
    story_id,
    chapter_number,
    version,
    phase,
    chapter_goal,
    mandatory_beats,
    forbidden_reveals,
    allowed_state_delta,
    introduces_characters,
    reconciled_from_version,
    reconciliation_reason,
    created_at
  )
  select
    p_new_story_id,
    blueprint.chapter_number,
    blueprint.version,
    blueprint.phase,
    blueprint.chapter_goal,
    public.clone_premium_story_remap_jsonb(blueprint.mandatory_beats, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.forbidden_reveals, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.allowed_state_delta, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.introduces_characters, v_old_ids, v_new_ids),
    blueprint.reconciled_from_version,
    blueprint.reconciliation_reason,
    v_now
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  insert into public.timeline_events (
    story_id,
    chapter_number,
    ordinal,
    description,
    is_flashback,
    occurs_at,
    created_at
  )
  select
    p_new_story_id,
    event.chapter_number,
    event.ordinal,
    event.description,
    event.is_flashback,
    event.occurs_at,
    v_now
  from public.timeline_events as event
  where event.story_id = p_template_story_id;

  insert into public.act_rollups (
    story_id,
    act_number,
    summary,
    state_delta,
    covers_from_chapter,
    covers_to_chapter,
    created_at
  )
  select
    p_new_story_id,
    rollup.act_number,
    rollup.summary,
    public.clone_premium_story_remap_jsonb(rollup.state_delta, v_old_ids, v_new_ids),
    rollup.covers_from_chapter,
    rollup.covers_to_chapter,
    v_now
  from public.act_rollups as rollup
  where rollup.story_id = p_template_story_id;

  insert into public.chapters (
    story_id,
    number,
    title,
    paragraphs,
    choice_prompt,
    choices,
    created_at
  )
  select
    p_new_story_id,
    chapter.number,
    chapter.title,
    public.clone_premium_story_remap_jsonb(chapter.paragraphs, v_old_ids, v_new_ids),
    chapter.choice_prompt,
    public.clone_premium_story_remap_jsonb(chapter.choices, v_old_ids, v_new_ids),
    v_now
  from public.chapters as chapter
  where chapter.story_id = p_template_story_id
    and chapter.number = 1;

  insert into public.choice_outcomes (
    story_id,
    chapter_number,
    choice_id,
    consequence,
    next_chapter_number,
    is_ending,
    created_at,
    effect_json,
    choice_kind
  )
  select
    p_new_story_id,
    outcome.chapter_number,
    outcome.choice_id,
    public.clone_premium_story_remap_jsonb(outcome.consequence, v_old_ids, v_new_ids),
    outcome.next_chapter_number,
    outcome.is_ending,
    v_now,
    public.clone_premium_story_remap_jsonb(outcome.effect_json, v_old_ids, v_new_ids),
    outcome.choice_kind
  from public.choice_outcomes as outcome
  where outcome.story_id = p_template_story_id
    and outcome.chapter_number = 1;

  insert into public.reader_states (
    user_id,
    story_id,
    status,
    current_chapter,
    jejak,
    ending_name,
    updated_at,
    created_at,
    route_state,
    choice_history,
    locked_ending_key
  ) values (
    p_user_id,
    p_new_story_id,
    'BERJALAN',
    1,
    '[]'::jsonb,
    null,
    v_now,
    v_now,
    jsonb_build_object(
      'truth', 0,
      'risk', 0,
      'secrecy', 0,
      'empathy', 0,
      'trust', '{}'::jsonb,
      'evidence', '[]'::jsonb,
      'flags', '{}'::jsonb,
      'endingBias', '{}'::jsonb
    ),
    '[]'::jsonb,
    null
  );

  return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_new_story_id);
end;
$$;

create or replace function public.grant_welcome_credit_v1(
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cost_row        public.feature_credit_costs%rowtype;
  v_cutoff_str      text;
  v_welcome_cutoff  timestamptz;
  v_user_created_at timestamptz;
  v_state           public.account_commercial_states%rowtype;
  v_ref             text;
  v_granted         boolean;
  v_ledger_row      public.credit_ledger%rowtype;
  c_locked_amount   constant integer := 20;
begin
  if p_user_id is null then
    raise exception 'grant_welcome_credit_v1: invalid arguments';
  end if;

  -- Uniform lock for user credit & commercial entitlement mutations
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Query configurable welcome credit setting from feature_credit_costs
  select * into v_cost_row
  from public.feature_credit_costs
  where feature_key = 'welcome_credit';

  if not found or not v_cost_row.is_active then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_NOT_ACTIVE'
    );
  end if;

  if v_cost_row.credits_required <> c_locked_amount then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_CONFIG_INVALID'
    );
  end if;

  v_cutoff_str := v_cost_row.metadata->>'welcome_eligible_from';
  if v_cutoff_str is null or trim(v_cutoff_str) = '' then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_NOT_CONFIGURED'
    );
  end if;

  begin
    v_welcome_cutoff := v_cutoff_str::timestamptz;
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_NOT_CONFIGURED'
    );
  end;

  select "createdAt" into v_user_created_at from public."user" where id = p_user_id;
  if not found then
    raise exception 'grant_welcome_credit_v1: user % not found', p_user_id;
  end if;

  if v_user_created_at < v_welcome_cutoff then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'NOT_ELIGIBLE_ACCOUNT_CREATED_BEFORE_WELCOME_CUTOFF'
    );
  end if;

  insert into public.account_commercial_states (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_state
  from public.account_commercial_states
  where user_id = p_user_id
  for update;

  if v_state.welcome_credit_granted_at is not null then
    return jsonb_build_object(
      'ok', true,
      'granted', false,
      'already_granted', true
    );
  end if;

  v_ref := 'welcome:' || p_user_id::text;
  v_granted := public.grant_credits_v1(p_user_id, v_ref, c_locked_amount, 'welcome_grant');

  if not v_granted then
    select * into v_ledger_row from public.credit_ledger where ref = v_ref;
    if not found or v_ledger_row.user_id <> p_user_id or v_ledger_row.delta <> c_locked_amount or v_ledger_row.reason <> 'welcome_grant' then
      raise exception 'IDEMPOTENCY_CONFLICT: welcome credit ref conflict for user %', p_user_id;
    end if;
  else
    select * into v_ledger_row from public.credit_ledger where ref = v_ref;
  end if;

  update public.account_commercial_states
  set welcome_credit_granted_at = clock_timestamp(),
      welcome_credit_event_id = v_ledger_row.id,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'granted', v_granted,
    'already_granted', not v_granted,
    'credits', c_locked_amount
  );
end;
$$;

create or replace function public.admin_generation_job_detail_v1(p_job_id uuid)
returns table (
  row_kind text,
  sequence_number bigint,
  job_id uuid,
  job_status text,
  user_id uuid,
  masked_user_email text,
  story_id text,
  story_title text,
  chapter_number integer,
  generation_kind text,
  correlation_id uuid,
  job_attempt_count integer,
  max_attempts integer,
  available_at timestamptz,
  deadline_at timestamptz,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  worker_id text,
  job_error_code text,
  job_created_at timestamptz,
  job_updated_at timestamptz,
  completed_at timestamptz,
  attempt_id uuid,
  attempt_number integer,
  workflow_phase text,
  provider_id text,
  model_id text,
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_ms bigint,
  lease_age_ms bigint,
  lease_remaining_ms bigint,
  retry_decision text,
  error_code text,
  provider_call_row_id uuid,
  provider_call_id text,
  use_case text,
  fallback_index integer,
  actual_model_resolved boolean,
  outcome text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric,
  cost_currency text,
  cost_source text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := private.require_generation_observability_reader_v1();

  if p_job_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_JOB_ID';
  end if;

  if not exists (select 1 from public.generation_jobs as j where j.id = p_job_id) then
    raise exception using errcode = 'P0001', message = 'JOB_NOT_FOUND';
  end if;

  insert into public.admin_generation_access_audit (
    actor_user_id, action, target_job_id, filter_fingerprint
  ) values (
    v_actor, 'VIEW_JOB_DETAIL', p_job_id,
    pg_catalog.md5('job:' || p_job_id::text)
  );

  return query
  with target as (
    select j.*, u.email::text as user_email, s.title as story_title
    from public.generation_jobs as j
    left join public."user" as u on u.id = j.user_id
    left join public.stories as s on s.id = j.story_id
    where j.id = p_job_id
  ), timeline as (
    select
      'JOB'::text as row_kind,
      0::bigint as sequence_number,
      j.id as job_id,
      j.status as job_status,
      j.user_id,
      private.mask_email_v1(j.user_email) as masked_user_email,
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count as job_attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      j.worker_id,
      j.last_error_code as job_error_code,
      j.created_at as job_created_at,
      j.updated_at as job_updated_at,
      j.completed_at,
      null::uuid as attempt_id,
      null::integer as attempt_number,
      null::text as workflow_phase,
      null::text as provider_id,
      null::text as model_id,
      null::timestamptz as started_at,
      null::timestamptz as ended_at,
      null::bigint as elapsed_ms,
      null::bigint as lease_age_ms,
      null::bigint as lease_remaining_ms,
      null::text as retry_decision,
      null::text as error_code,
      null::uuid as provider_call_row_id,
      null::text as provider_call_id,
      null::text as use_case,
      null::integer as fallback_index,
      null::boolean as actual_model_resolved,
      null::text as outcome,
      null::bigint as input_token_count,
      null::bigint as output_token_count,
      null::bigint as total_token_count,
      null::numeric as cost_amount,
      null::text as cost_currency,
      null::text as cost_source
    from target as j

    union all

    select
      'ATTEMPT',
      (
        select pg_catalog.count(*)::bigint
        from (
          select a2.started_at, 0 as kind_order, a2.id
          from public.generation_job_attempts as a2 where a2.job_id = j.id
          union all
          select c2.started_at, 1 as kind_order, c2.id
          from public.generation_provider_calls as c2 where c2.job_id = j.id
        ) as event_order
        where (event_order.started_at, event_order.kind_order, event_order.id)
          <= (a.started_at, 0, a.id)
      ),
      j.id,
      j.status,
      j.user_id,
      private.mask_email_v1(j.user_email),
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      a.worker_id,
      j.last_error_code,
      j.created_at,
      j.updated_at,
      j.completed_at,
      a.id,
      a.attempt_number,
      a.workflow_phase,
      a.provider_id,
      a.model_id,
      a.started_at,
      a.ended_at,
      a.elapsed_ms,
      a.lease_age_ms,
      a.lease_remaining_ms,
      a.retry_decision,
      a.error_code,
      null::uuid,
      null::text,
      null::text,
      null::integer,
      null::boolean,
      null::text,
      null::bigint,
      null::bigint,
      null::bigint,
      null::numeric,
      null::text,
      null::text
    from target as j
    join public.generation_job_attempts as a on a.job_id = j.id

    union all

    select
      'CALL',
      (
        select pg_catalog.count(*)::bigint
        from (
          select a2.started_at, 0 as kind_order, a2.id
          from public.generation_job_attempts as a2 where a2.job_id = j.id
          union all
          select c2.started_at, 1 as kind_order, c2.id
          from public.generation_provider_calls as c2 where c2.job_id = j.id
        ) as event_order
        where (event_order.started_at, event_order.kind_order, event_order.id)
          <= (c.started_at, 1, c.id)
      ),
      j.id,
      j.status,
      j.user_id,
      private.mask_email_v1(j.user_email),
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      j.worker_id,
      j.last_error_code,
      j.created_at,
      j.updated_at,
      j.completed_at,
      null::uuid,
      c.attempt_number,
      c.workflow_phase,
      c.provider_id,
      c.model_id,
      c.started_at,
      c.ended_at,
      c.elapsed_ms,
      null::bigint,
      null::bigint,
      null::text,
      c.error_code,
      c.id,
      c.provider_call_id,
      c.use_case,
      c.fallback_index,
      c.actual_model_resolved,
      c.outcome,
      c.input_token_count,
      c.output_token_count,
      c.total_token_count,
      c.cost_amount,
      c.cost_currency,
      c.cost_source
    from target as j
    join public.generation_provider_calls as c on c.job_id = j.id
  )
  select * from timeline
  order by
    case when timeline.row_kind = 'JOB' then 0 else 1 end,
    timeline.started_at nulls first,
    case timeline.row_kind when 'ATTEMPT' then 0 when 'CALL' then 1 else 0 end,
    coalesce(timeline.attempt_id, timeline.provider_call_row_id, timeline.job_id);
end
$$;

create or replace function public.admin_generation_provider_calls_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer,
  p_cursor_started_at timestamptz,
  p_cursor_id uuid,
  p_page_size integer
)
returns table (
  id uuid,
  provider_call_id text,
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_ms bigint,
  user_id uuid,
  masked_user_email text,
  story_id text,
  story_title text,
  chapter_number integer,
  generation_kind text,
  job_id uuid,
  correlation_id uuid,
  attempt_number integer,
  use_case text,
  workflow_phase text,
  provider_id text,
  model_id text,
  route_version text,
  fallback_index integer,
  actual_model_resolved boolean,
  outcome text,
  error_code text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric,
  cost_currency text,
  cost_source text,
  pricing_version_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_filter_fingerprint text;
begin
  v_actor := private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );

  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_PAGE_SIZE';
  end if;

  if (p_cursor_started_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = 'P0001', message = 'INVALID_CURSOR';
  end if;

  v_filter_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_from::text, p_to::text, coalesce(p_provider_id, ''), coalesce(p_model_id, ''),
    coalesce(p_use_case, ''), coalesce(p_workflow_phase, ''), coalesce(p_outcome, ''),
    coalesce(p_error_code, ''), coalesce(p_cost_source, ''), coalesce(p_user_id::text, ''),
    coalesce(p_story_id, ''), coalesce(p_generation_kind, ''), coalesce(p_job_id::text, ''),
    coalesce(p_correlation_id::text, ''), coalesce(p_chapter_number::text, ''),
    coalesce(p_cursor_started_at::text, ''), coalesce(p_cursor_id::text, ''), p_page_size::text
  ));
  insert into public.admin_generation_access_audit (
    actor_user_id, action, target_provider_call_id, filter_fingerprint
  ) values (
    v_actor, 'VIEW_CALL_DETAIL', null,
    v_filter_fingerprint
  );

  return query
  select
    c.id,
    c.provider_call_id,
    c.started_at,
    c.ended_at,
    c.elapsed_ms,
    c.user_id,
    private.mask_email_v1(u.email::text),
    c.story_id,
    s.title,
    c.chapter_number,
    c.generation_kind,
    c.job_id,
    c.correlation_id,
    c.attempt_number,
    c.use_case,
    c.workflow_phase,
    c.provider_id,
    c.model_id,
    c.route_version,
    c.fallback_index,
    c.actual_model_resolved,
    c.outcome,
    c.error_code,
    c.input_token_count,
    c.output_token_count,
    c.total_token_count,
    c.cost_amount,
    c.cost_currency,
    c.cost_source,
    c.pricing_version_id
  from public.generation_provider_calls as c
  left join public."user" as u on u.id = c.user_id
  left join public.stories as s on s.id = c.story_id
  where c.started_at >= p_from and c.started_at < p_to
    and (p_provider_id is null or c.provider_id = p_provider_id)
    and (p_model_id is null or c.model_id = p_model_id)
    and (p_use_case is null or c.use_case = p_use_case)
    and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_error_code is null or c.error_code = p_error_code)
    and (p_cost_source is null or c.cost_source = p_cost_source)
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_story_id is null or c.story_id = p_story_id)
    and (p_generation_kind is null or c.generation_kind = p_generation_kind)
    and (p_job_id is null or c.job_id = p_job_id)
    and (p_correlation_id is null or c.correlation_id = p_correlation_id)
    and (p_chapter_number is null or c.chapter_number = p_chapter_number)
    and (
      p_cursor_started_at is null
      or (c.started_at, c.id) < (p_cursor_started_at, p_cursor_id)
    )
  order by c.started_at desc, c.id desc
  limit p_page_size;
end
$$;

create or replace function public.admin_generation_cost_breakdown_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer,
  p_limit integer
)
returns table (
  use_case text,
  user_id uuid,
  masked_user_email text,
  generation_kind text,
  provider_id text,
  model_id text,
  cost_currency text,
  call_count bigint,
  actual_cost_amount numeric,
  estimated_cost_amount numeric,
  unavailable_cost_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = 'P0001', message = 'INVALID_PAGE_SIZE';
  end if;

  return query
  select
    c.use_case,
    c.user_id,
    private.mask_email_v1(u.email::text),
    c.generation_kind,
    c.provider_id,
    c.model_id,
    c.cost_currency,
    pg_catalog.count(*)::bigint,
    coalesce(pg_catalog.sum(c.cost_amount) filter (
      where c.cost_source = 'provider_actual'
    ), 0)::numeric,
    coalesce(pg_catalog.sum(c.cost_amount) filter (
      where c.cost_source = 'price_estimate'
    ), 0)::numeric,
    pg_catalog.count(*) filter (where c.cost_source = 'unavailable')::bigint
  from public.generation_provider_calls as c
  left join public."user" as u on u.id = c.user_id
  where c.started_at >= p_from and c.started_at < p_to
    and (p_provider_id is null or c.provider_id = p_provider_id)
    and (p_model_id is null or c.model_id = p_model_id)
    and (p_use_case is null or c.use_case = p_use_case)
    and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_error_code is null or c.error_code = p_error_code)
    and (p_cost_source is null or c.cost_source = p_cost_source)
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_story_id is null or c.story_id = p_story_id)
    and (p_generation_kind is null or c.generation_kind = p_generation_kind)
    and (p_job_id is null or c.job_id = p_job_id)
    and (p_correlation_id is null or c.correlation_id = p_correlation_id)
    and (p_chapter_number is null or c.chapter_number = p_chapter_number)
  group by c.use_case, c.user_id, u.email, c.generation_kind,
    c.provider_id, c.model_id, c.cost_currency
  order by
    coalesce(pg_catalog.sum(c.cost_amount), 0) desc,
    c.use_case, c.user_id, c.generation_kind, c.provider_id, c.model_id,
    c.cost_currency nulls last
  limit p_limit;
end
$$;

create or replace function public.admin_generation_provider_calls_v2(
  p_from timestamptz,p_to timestamptz,p_provider_id text,p_model_id text,p_use_case text,p_workflow_phase text,p_outcome text,p_error_code text,p_cost_source text,p_user_id uuid,p_story_id text,p_generation_kind text,p_job_id uuid,p_correlation_id uuid,p_chapter_number integer,p_cursor_started_at timestamptz,p_cursor_id uuid,p_page_size integer
) returns table (
  id uuid,provider_call_id text,started_at timestamptz,ended_at timestamptz,elapsed_ms bigint,user_id uuid,masked_user_email text,story_id text,story_title text,chapter_number integer,generation_kind text,job_id uuid,correlation_id uuid,attempt_number integer,use_case text,workflow_phase text,provider_id text,model_id text,route_version text,fallback_index integer,actual_model_resolved boolean,outcome text,error_code text,input_token_count bigint,output_token_count bigint,total_token_count bigint,cost_amount numeric,cost_currency text,cost_source text,pricing_version_id uuid,validation_stage text,validation_codes text[]
) language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid; v_filter_fingerprint text;
begin
  v_actor := private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from,p_to);
  perform private.validate_generation_observability_filters_v1(p_provider_id,p_model_id,p_use_case,p_workflow_phase,p_outcome,p_error_code,p_cost_source,p_story_id,p_generation_kind,p_chapter_number);
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then raise exception using errcode = 'P0001', message = 'INVALID_PAGE_SIZE'; end if;
  if (p_cursor_started_at is null) <> (p_cursor_id is null) then raise exception using errcode = 'P0001', message = 'INVALID_CURSOR'; end if;
  v_filter_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',p_from::text,p_to::text,coalesce(p_provider_id,''),coalesce(p_model_id,''),coalesce(p_use_case,''),coalesce(p_workflow_phase,''),coalesce(p_outcome,''),coalesce(p_error_code,''),coalesce(p_cost_source,''),coalesce(p_user_id::text,''),coalesce(p_story_id,''),coalesce(p_generation_kind,''),coalesce(p_job_id::text,''),coalesce(p_correlation_id::text,''),coalesce(p_chapter_number::text,''),coalesce(p_cursor_started_at::text,''),coalesce(p_cursor_id::text,''),p_page_size::text));
  insert into public.admin_generation_access_audit(actor_user_id,action,target_provider_call_id,filter_fingerprint) values (v_actor,'VIEW_CALL_DETAIL',null,v_filter_fingerprint);
  return query select c.id,c.provider_call_id,c.started_at,c.ended_at,c.elapsed_ms,c.user_id,private.mask_email_v1(u.email::text),c.story_id,s.title,c.chapter_number,c.generation_kind,c.job_id,c.correlation_id,c.attempt_number,c.use_case,c.workflow_phase,c.provider_id,c.model_id,c.route_version,c.fallback_index,c.actual_model_resolved,c.outcome,c.error_code,c.input_token_count,c.output_token_count,c.total_token_count,c.cost_amount,c.cost_currency,c.cost_source,c.pricing_version_id,c.validation_stage,c.validation_codes from public.generation_provider_calls c left join public."user" u on u.id=c.user_id left join public.stories s on s.id=c.story_id where c.started_at >= p_from and c.started_at < p_to and (p_provider_id is null or c.provider_id=p_provider_id) and (p_model_id is null or c.model_id=p_model_id) and (p_use_case is null or c.use_case=p_use_case) and (p_workflow_phase is null or c.workflow_phase=p_workflow_phase) and (p_outcome is null or c.outcome=p_outcome) and (p_error_code is null or c.error_code=p_error_code) and (p_cost_source is null or c.cost_source=p_cost_source) and (p_user_id is null or c.user_id=p_user_id) and (p_story_id is null or c.story_id=p_story_id) and (p_generation_kind is null or c.generation_kind=p_generation_kind) and (p_job_id is null or c.job_id=p_job_id) and (p_correlation_id is null or c.correlation_id=p_correlation_id) and (p_chapter_number is null or c.chapter_number=p_chapter_number) and (p_cursor_started_at is null or (c.started_at,c.id)<(p_cursor_started_at,p_cursor_id)) order by c.started_at desc,c.id desc limit p_page_size;
end $$;

-- Jaminan: tidak ada lagi RPC public yang membaca auth.users.
-- Pengecualian: create_test_auth_user_v1 — helper test legacy (narrative-qa)
-- yang sengaja menulis ke shell auth.users; bukan jalur pembaca.
do $$
declare
  v_leftover text;
begin
  select string_agg(p.proname, ', ') into v_leftover
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc like '%auth.users%'
    and p.proname <> 'create_test_auth_user_v1';
  if v_leftover is not null then
    raise exception 'Masih ada RPC yang membaca auth.users: %', v_leftover;
  end if;
end $$;
