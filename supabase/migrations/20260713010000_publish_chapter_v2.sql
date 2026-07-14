-- Add a hardened personalized chapter publisher without changing legacy publish_chapter.

create or replace function public.publish_chapter_v2(
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_lease_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope constant text := 'publish_chapter_v2:' || p_chapter_number::text;
  v_existing_story_id text;
  v_existing_scope text;
  v_existing_result jsonb;
  v_choice jsonb;
  v_outcome jsonb;
  v_effect jsonb;
  v_record jsonb;
  v_key text;
  v_choice_id text;
  v_choice_ids text[] := array[]::text[];
  v_outcome_ids text[] := array[]::text[];
  v_chapter_49_normal_count integer := 0;
  v_chapter_49_special_count integer := 0;
  v_seq integer;
  v_event_attempt integer := 0;
  v_result jsonb;
  v_count integer;
  v_distinct_count integer;
  v_total_length bigint;
  v_reader_text text;
begin
  -- Identity must be canonical before it participates in lock or key lookup.
  if p_story_id is null
    or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;
  if p_chapter_number is null or p_chapter_number < 1 or p_chapter_number > 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;
  if p_idempotency_key is null
    or p_idempotency_key = ''
    or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- Fast exact replay. Never return a result for another story, scope, or chapter.
  select i.story_id, i.scope, i.result
    into v_existing_story_id, v_existing_scope, v_existing_result
  from public.idempotency_keys as i
  where i.key = p_idempotency_key;
  if found then
    if v_existing_story_id is distinct from p_story_id
      or v_existing_scope is distinct from v_scope then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_COLLISION';
    end if;
    if v_existing_result is not null then
      return v_existing_result;
    end if;
  end if;

  -- V2 publications for one story remain serialized with lifecycle writers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- Recheck replay after waiting for story lock.
  select i.story_id, i.scope, i.result
    into v_existing_story_id, v_existing_scope, v_existing_result
  from public.idempotency_keys as i
  where i.key = p_idempotency_key;
  if found then
    if v_existing_story_id is distinct from p_story_id
      or v_existing_scope is distinct from v_scope then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_COLLISION';
    end if;
    if v_existing_result is not null then
      return v_existing_result;
    end if;
  end if;

  if not exists (select 1 from public.stories as s where s.id = p_story_id) then
    raise exception using errcode = '23503', message = 'STORY_NOT_FOUND';
  end if;

  -- Preserve exact legacy precedence: an existing chapter wins before payload or lease checks.
  if exists (
    select 1 from public.chapters as c
    where c.story_id = p_story_id and c.number = p_chapter_number
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CHAPTER_EXISTS');
  end if;

  -- Validate bounded canonical chapter payload only for a new publication.
  if p_title is null
    or p_title = ''
    or p_title <> pg_catalog.btrim(p_title)
    or pg_catalog.char_length(p_title) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_TITLE';
  end if;
  if p_paragraphs is null
    or pg_catalog.jsonb_typeof(p_paragraphs) <> 'array'
    or pg_catalog.jsonb_array_length(p_paragraphs) < 1
    or pg_catalog.jsonb_array_length(p_paragraphs) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_PARAGRAPHS';
  end if;
  select coalesce(pg_catalog.sum(pg_catalog.char_length(value #>> '{}')), 0::bigint)
    into v_total_length
  from pg_catalog.jsonb_array_elements(p_paragraphs) as paragraph(value);
  if v_total_length > 100000 or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_paragraphs) as paragraph(value)
    where pg_catalog.jsonb_typeof(value) <> 'string'
      or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
      or pg_catalog.char_length(value #>> '{}') < 1
      or pg_catalog.char_length(value #>> '{}') > 5000
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PARAGRAPHS';
  end if;

  if p_chapter_number = 50 then
    if p_choice_prompt is not null then
      raise exception using errcode = '22023', message = 'CHAPTER_50_PROMPT_NOT_ALLOWED';
    end if;
    if p_choices is not null and (
      pg_catalog.jsonb_typeof(p_choices) <> 'array'
      or pg_catalog.jsonb_array_length(p_choices) <> 0
    ) then
      raise exception using errcode = '22023', message = 'CHAPTER_50_CHOICES_NOT_ALLOWED';
    end if;
    if p_outcomes is not null and (
      pg_catalog.jsonb_typeof(p_outcomes) <> 'array'
      or pg_catalog.jsonb_array_length(p_outcomes) <> 0
    ) then
      raise exception using errcode = '22023', message = 'CHAPTER_50_OUTCOMES_NOT_ALLOWED';
    end if;
  else
    if p_choice_prompt is null
      or p_choice_prompt <> pg_catalog.btrim(p_choice_prompt)
      or pg_catalog.char_length(p_choice_prompt) < 8
      or pg_catalog.char_length(p_choice_prompt) > 120 then
      raise exception using errcode = '22023', message = 'INVALID_CHOICE_PROMPT';
    end if;
    if pg_catalog.jsonb_typeof(p_choices) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_choices) < 2
      or pg_catalog.jsonb_array_length(p_choices) > 3 then
      raise exception using errcode = '22023', message = 'INVALID_CHOICES_CARDINALITY';
    end if;
    if pg_catalog.jsonb_typeof(p_outcomes) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_outcomes) < 2
      or pg_catalog.jsonb_array_length(p_outcomes) > 3 then
      raise exception using errcode = '22023', message = 'INVALID_OUTCOMES_CARDINALITY';
    end if;

    for v_choice in select value from pg_catalog.jsonb_array_elements(p_choices)
    loop
      if pg_catalog.jsonb_typeof(v_choice) <> 'object'
        or not (v_choice ?& array['id', 'label'])
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_choice) as key(name)
          where name not in ('id', 'label', 'hint')
        ) then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_SHAPE';
      end if;
      if pg_catalog.jsonb_typeof(v_choice->'id') <> 'string'
        or pg_catalog.jsonb_typeof(v_choice->'label') <> 'string'
        or ((v_choice ? 'hint') and pg_catalog.jsonb_typeof(v_choice->'hint') <> 'string') then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_TYPE';
      end if;

      v_choice_id := v_choice->>'id';
      if v_choice_id <> pg_catalog.btrim(v_choice_id)
        or v_choice_id <> pg_catalog.lower(v_choice_id)
        or pg_catalog.char_length(v_choice_id) < 1
        or pg_catalog.char_length(v_choice_id) > 50
        or v_choice_id !~ '^[a-z0-9]+([-_][a-z0-9]+)*$' then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_ID';
      end if;
      if v_choice_id = any(v_choice_ids) then
        raise exception using errcode = '22023', message = 'DUPLICATE_CHOICE_ID';
      end if;
      v_choice_ids := pg_catalog.array_append(v_choice_ids, v_choice_id);

      if v_choice->>'label' <> pg_catalog.btrim(v_choice->>'label')
        or pg_catalog.char_length(v_choice->>'label') < 8
        or pg_catalog.char_length(v_choice->>'label') > 90 then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_LABEL';
      end if;
      if (v_choice ? 'hint') and (
        v_choice->>'hint' <> pg_catalog.btrim(v_choice->>'hint')
        or pg_catalog.char_length(v_choice->>'hint') < 8
        or pg_catalog.char_length(v_choice->>'hint') > 140
      ) then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_HINT';
      end if;

      if pg_catalog.lower(v_choice->>'label') ~
          '^(lanjut(kan)?|terus(kan)?|pilihan[[:space:]]*[a-z0-9]+|apa yang harus dilakukan\??|pilih ini|continue|next|choice[[:space:]]*[a-z0-9]+|what should .+ do\??)$'
        or pg_catalog.lower(v_choice->>'label') !~
          '^(buka|tutup|ambil|tinggalkan|ikuti|hadang|tanya|tolong|selamatkan|lawan|kejar|periksa|baca|sembunyikan|ungkapkan|masuk|keluar|lari|panggil|cari|pilih|tolak|terima|kirim|hancurkan|jaga|dekati|hindari|open|close|take|leave|follow|stop|ask|help|save|fight|chase|inspect|read|hide|reveal|enter|run|call|find|choose|refuse|accept|send|destroy|guard|approach|avoid)([^[:alnum:]_]|$)' then
        raise exception using errcode = '22023', message = 'CHOICE_GENERIC_OR_INTERNAL';
      end if;
    end loop;

    for v_outcome in select value from pg_catalog.jsonb_array_elements(p_outcomes)
    loop
      if pg_catalog.jsonb_typeof(v_outcome) <> 'object'
        or not (v_outcome ?& array[
          'choiceId', 'consequence', 'nextChapterNumber', 'isEnding', 'effect_json', 'choice_kind'
        ])
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_outcome) as key(name)
          where name not in (
            'choiceId', 'consequence', 'nextChapterNumber', 'isEnding', 'effect_json', 'choice_kind'
          )
        ) then
        raise exception using errcode = '22023', message = 'INVALID_OUTCOME_SHAPE';
      end if;
      if pg_catalog.jsonb_typeof(v_outcome->'choiceId') <> 'string'
        or pg_catalog.jsonb_typeof(v_outcome->'consequence') <> 'array'
        or pg_catalog.jsonb_typeof(v_outcome->'isEnding') <> 'boolean'
        or pg_catalog.jsonb_typeof(v_outcome->'effect_json') <> 'object'
        or pg_catalog.jsonb_typeof(v_outcome->'choice_kind') <> 'string'
        or pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') not in ('number', 'null') then
        raise exception using errcode = '22023', message = 'INVALID_OUTCOME_TYPE';
      end if;

      v_choice_id := v_outcome->>'choiceId';
      if v_choice_id <> pg_catalog.btrim(v_choice_id)
        or v_choice_id <> pg_catalog.lower(v_choice_id)
        or pg_catalog.char_length(v_choice_id) < 1
        or pg_catalog.char_length(v_choice_id) > 50
        or v_choice_id !~ '^[a-z0-9]+([-_][a-z0-9]+)*$' then
        raise exception using errcode = '22023', message = 'INVALID_OUTCOME_CHOICE_ID';
      end if;
      if v_choice_id = any(v_outcome_ids) then
        raise exception using errcode = '22023', message = 'DUPLICATE_OUTCOME_CHOICE_ID';
      end if;
      v_outcome_ids := pg_catalog.array_append(v_outcome_ids, v_choice_id);

      if pg_catalog.jsonb_array_length(v_outcome->'consequence') < 1
        or pg_catalog.jsonb_array_length(v_outcome->'consequence') > 2
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_outcome->'consequence') as consequence(value)
          where pg_catalog.jsonb_typeof(value) <> 'string'
            or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
            or pg_catalog.char_length(value #>> '{}') < 1
            or pg_catalog.char_length(value #>> '{}') > 160
        ) then
        raise exception using errcode = '22023', message = 'INVALID_CONSEQUENCE';
      end if;

      if pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') = 'number' and (
        (v_outcome->>'nextChapterNumber')::numeric
          <> pg_catalog.trunc((v_outcome->>'nextChapterNumber')::numeric)
        or (v_outcome->>'nextChapterNumber')::numeric < 1
        or (v_outcome->>'nextChapterNumber')::numeric > 50
      ) then
        raise exception using errcode = '22023', message = 'INVALID_NEXT_CHAPTER_NUMBER';
      end if;
      if v_outcome->>'choice_kind' not in ('normal', 'special_bad_ending') then
        raise exception using errcode = '22023', message = 'INVALID_CHOICE_KIND';
      end if;

      if p_chapter_number <= 48 then
        if pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') <> 'number'
          or (v_outcome->>'nextChapterNumber')::integer <> p_chapter_number + 1
          or (v_outcome->>'isEnding')::boolean is distinct from false
          or v_outcome->>'choice_kind' <> 'normal' then
          raise exception using errcode = '22023', message = 'INVALID_NORMAL_BRANCH';
        end if;
      else
        if pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') = 'number'
          and (v_outcome->>'nextChapterNumber')::integer = 50
          and (v_outcome->>'isEnding')::boolean is false
          and v_outcome->>'choice_kind' = 'normal' then
          v_chapter_49_normal_count := v_chapter_49_normal_count + 1;
        elsif pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') = 'null'
          and (v_outcome->>'isEnding')::boolean is true
          and v_outcome->>'choice_kind' = 'special_bad_ending' then
          v_chapter_49_special_count := v_chapter_49_special_count + 1;
        else
          raise exception using errcode = '22023', message = 'INVALID_CHAPTER_49_BRANCH';
        end if;
      end if;

      v_effect := v_outcome->'effect_json';
      if not (v_effect ?& array[
        'routeDeltas', 'trustDeltas', 'flagsSet', 'evidenceAdded', 'endingBiasDeltas', 'threadTouches'
      ]) or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_effect) as key(name)
        where name not in (
          'routeDeltas', 'trustDeltas', 'flagsSet', 'evidenceAdded', 'endingBiasDeltas', 'threadTouches'
        )
      ) then
        raise exception using errcode = '22023', message = 'INVALID_EFFECT_SHAPE';
      end if;
      if pg_catalog.jsonb_typeof(v_effect->'routeDeltas') <> 'object'
        or pg_catalog.jsonb_typeof(v_effect->'trustDeltas') <> 'object'
        or pg_catalog.jsonb_typeof(v_effect->'flagsSet') <> 'object'
        or pg_catalog.jsonb_typeof(v_effect->'evidenceAdded') <> 'array'
        or pg_catalog.jsonb_typeof(v_effect->'endingBiasDeltas') <> 'object'
        or pg_catalog.jsonb_typeof(v_effect->'threadTouches') <> 'array' then
        raise exception using errcode = '22023', message = 'INVALID_EFFECT_TYPE';
      end if;

      if exists (
        select 1 from pg_catalog.jsonb_object_keys(v_effect->'routeDeltas') as key(name)
        where name not in ('truth', 'risk', 'secrecy', 'empathy')
      ) or exists (
        select 1 from pg_catalog.jsonb_each(v_effect->'routeDeltas') as delta(key, value)
        where pg_catalog.jsonb_typeof(value) <> 'number'
          or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
          or (value #>> '{}')::numeric < -20
          or (value #>> '{}')::numeric > 20
      ) then
        raise exception using errcode = '22023', message = 'INVALID_ROUTE_DELTAS';
      end if;

      foreach v_key in array array['trustDeltas', 'flagsSet', 'endingBiasDeltas']
      loop
        v_record := v_effect->v_key;
        select pg_catalog.count(*), pg_catalog.count(distinct key)
          into v_count, v_distinct_count
        from pg_catalog.jsonb_object_keys(v_record) as record_key(key);
        if v_count > 32 or v_count <> v_distinct_count or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_record) as record_key(key)
          where key <> pg_catalog.btrim(key)
            or pg_catalog.char_length(key) < 1
            or pg_catalog.char_length(key) > 80
            or key in ('__proto__', 'prototype', 'constructor')
        ) then
          raise exception using errcode = '22023', message = 'INVALID_EFFECT_RECORD_KEYS';
        end if;
        if v_key = 'flagsSet' and exists (
          select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
          where pg_catalog.jsonb_typeof(value) <> 'boolean'
        ) then
          raise exception using errcode = '22023', message = 'INVALID_FLAGS_SET';
        end if;
        if v_key = 'trustDeltas' and exists (
          select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
          where pg_catalog.jsonb_typeof(value) <> 'number'
            or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
            or (value #>> '{}')::numeric < -10
            or (value #>> '{}')::numeric > 10
        ) then
          raise exception using errcode = '22023', message = 'INVALID_TRUST_DELTAS';
        end if;
        if v_key = 'endingBiasDeltas' and exists (
          select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
          where pg_catalog.jsonb_typeof(value) <> 'number'
            or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
            or (value #>> '{}')::numeric < -100
            or (value #>> '{}')::numeric > 100
        ) then
          raise exception using errcode = '22023', message = 'INVALID_ENDING_BIAS_DELTAS';
        end if;
      end loop;

      if pg_catalog.jsonb_array_length(v_effect->'evidenceAdded') > 32 or exists (
        select 1 from pg_catalog.jsonb_array_elements(v_effect->'evidenceAdded') as item(value)
        where pg_catalog.jsonb_typeof(value) <> 'string'
          or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
          or pg_catalog.char_length(value #>> '{}') < 1
          or pg_catalog.char_length(value #>> '{}') > 240
      ) then
        raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_ADDED';
      end if;
      if pg_catalog.jsonb_array_length(v_effect->'threadTouches') > 24 or exists (
        select 1 from pg_catalog.jsonb_array_elements(v_effect->'threadTouches') as item(value)
        where pg_catalog.jsonb_typeof(value) <> 'string'
          or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
          or pg_catalog.char_length(value #>> '{}') < 1
          or pg_catalog.char_length(value #>> '{}') > 120
      ) then
        raise exception using errcode = '22023', message = 'INVALID_THREAD_TOUCHES';
      end if;
    end loop;

    if pg_catalog.cardinality(v_choice_ids) <> pg_catalog.cardinality(v_outcome_ids)
      or not (v_choice_ids @> v_outcome_ids and v_outcome_ids @> v_choice_ids) then
      raise exception using errcode = '22023', message = 'OUTCOME_CHOICE_ID_MISMATCH';
    end if;
    if p_chapter_number = 49
      and not (
        v_chapter_49_normal_count = pg_catalog.cardinality(v_outcome_ids)
        or v_chapter_49_special_count = pg_catalog.cardinality(v_outcome_ids)
      ) then
      raise exception using errcode = '22023', message = 'CHAPTER_49_MODE_MISMATCH';
    end if;

    v_reader_text := pg_catalog.concat_ws(
      ' ',
      p_choice_prompt,
      (select pg_catalog.string_agg(value->>'label', ' ')
       from pg_catalog.jsonb_array_elements(p_choices) as choice(value)),
      (select pg_catalog.string_agg(value->>'hint', ' ')
       from pg_catalog.jsonb_array_elements(p_choices) as choice(value)
       where value ? 'hint'),
      (select pg_catalog.string_agg(item #>> '{}', ' ')
       from pg_catalog.jsonb_array_elements(p_outcomes) as outcome(value)
       cross join lateral pg_catalog.jsonb_array_elements(value->'consequence') as consequence(item))
    );
    if pg_catalog.lower(v_reader_text) ~
      '(^|[^[:alnum:]_])(narraza|prompt|tokens?|gpt[-[:space:]]*[0-9]|claude|gemini|llm|model[[:space:]]*id|temperature|system[[:space:]]*prompt|rag|embeddings?|provider|routes?|internal)([^[:alnum:]_]|$)'
      or pg_catalog.lower(v_reader_text) ~
      '(^|[^[:alnum:]_])rute([^[:alnum:]_]|$)' then
      raise exception using errcode = '22023', message = 'INTERNAL_LANGUAGE_LEAK';
    end if;
  end if;

  -- Every new V2 publication, including Chapter 50, needs one exact live lease.
  if p_lease_id is null then
    raise exception using errcode = '22023', message = 'LEASE_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.generation_leases as lease
    where lease.id = p_lease_id
      and lease.story_id = p_story_id
      and lease.chapter_number = p_chapter_number
      and lease.status = 'ACTIVE'
      and lease.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OR_EXPIRED_LEASE';
  end if;

  -- Global reservation is atomic. Conflict waits, then binding is checked under row lock.
  insert into public.idempotency_keys (key, story_id, scope, result)
  values (p_idempotency_key, p_story_id, v_scope, null)
  on conflict (key) do nothing;

  select i.story_id, i.scope, i.result
    into v_existing_story_id, v_existing_scope, v_existing_result
  from public.idempotency_keys as i
  where i.key = p_idempotency_key
  for update;
  if v_existing_story_id is distinct from p_story_id
    or v_existing_scope is distinct from v_scope then
    raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_COLLISION';
  end if;
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  insert into public.chapters (
    story_id, number, title, paragraphs, choice_prompt, choices
  ) values (
    p_story_id, p_chapter_number, p_title, p_paragraphs, p_choice_prompt, p_choices
  );

  if p_outcomes is not null then
    for v_outcome in select value from pg_catalog.jsonb_array_elements(p_outcomes)
    loop
      insert into public.choice_outcomes (
        story_id,
        chapter_number,
        choice_id,
        consequence,
        next_chapter_number,
        is_ending,
        effect_json,
        choice_kind
      ) values (
        p_story_id,
        p_chapter_number,
        v_outcome->>'choiceId',
        v_outcome->'consequence',
        case
          when pg_catalog.jsonb_typeof(v_outcome->'nextChapterNumber') = 'null' then null
          else (v_outcome->>'nextChapterNumber')::integer
        end,
        (v_outcome->>'isEnding')::boolean,
        v_outcome->'effect_json',
        v_outcome->>'choice_kind'
      );
    end loop;
  end if;

  -- Advisory locking covers V2 writers. Retry also survives noncooperating direct/legacy writers.
  loop
    v_event_attempt := v_event_attempt + 1;
    select coalesce(pg_catalog.max(event.seq), 0) + 1
      into v_seq
    from public.story_events as event
    where event.story_id = p_story_id;
    begin
      insert into public.story_events (story_id, seq, type, payload)
      values (
        p_story_id,
        v_seq,
        'CHAPTER_PUBLISHED',
        pg_catalog.jsonb_build_object(
          'chapter_number', p_chapter_number,
          'lease_id', p_lease_id
        )
      );
      exit;
    exception when unique_violation then
      if v_event_attempt >= 5 then
        raise exception using errcode = '40001', message = 'EVENT_SEQUENCE_RETRY_EXHAUSTED';
      end if;
    end;
  end loop;

  update public.generation_leases
  set status = 'RELEASED'
  where id = p_lease_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
    and status = 'ACTIVE'
    and expires_at > pg_catalog.clock_timestamp();
  if not found then
    raise exception using errcode = '22023', message = 'LEASE_RELEASE_FAILED';
  end if;

  insert into public.outbox (topic, payload)
  values (
    'chapter.published',
    pg_catalog.jsonb_build_object(
      'story_id', p_story_id,
      'chapter_number', p_chapter_number
    )
  );

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'chapter_number', p_chapter_number,
    'seq', v_seq
  );

  update public.idempotency_keys
  set result = v_result
  where key = p_idempotency_key
    and story_id = p_story_id
    and scope = v_scope;
  if not found then
    raise exception using errcode = '40001', message = 'IDEMPOTENCY_RESULT_UPDATE_FAILED';
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_chapter_v2(
  text, integer, text, jsonb, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.publish_chapter_v2(
  text, integer, text, jsonb, text, jsonb, jsonb, uuid, text
) to service_role;
