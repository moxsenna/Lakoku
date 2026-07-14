begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'publish_chapter_v2 pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select plan(74);

create or replace function pg_temp.effect_fixture()
returns jsonb
language sql
immutable
as $$
  select '{
    "routeDeltas": {},
    "trustDeltas": {},
    "flagsSet": {},
    "evidenceAdded": [],
    "endingBiasDeltas": {},
    "threadTouches": []
  }'::jsonb;
$$;

create or replace function pg_temp.choices_fixture()
returns jsonb
language sql
immutable
as $$
  select '[
    {"id":"open-door","label":"Buka pintu gudang","hint":"Sari menunggu dekat gudang"},
    {"id":"stop-guard","label":"Hadang penjaga gudang"}
  ]'::jsonb;
$$;

create or replace function pg_temp.outcomes_fixture(p_chapter integer, p_mode text default 'normal')
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
    'choiceId', choice_id,
    'consequence', jsonb_build_array(consequence),
    'nextChapterNumber', case when p_mode = 'special' then null else p_chapter + 1 end,
    'isEnding', p_mode = 'special',
    'effect_json', pg_temp.effect_fixture(),
    'choice_kind', case when p_mode = 'special' then 'special_bad_ending' else 'normal' end
  ) order by ordinal)
  from (values
    (1, 'open-door', 'Raka membuka pintu gudang.'),
    (2, 'stop-guard', 'Raka menghadang penjaga gudang.')
  ) as fixture(ordinal, choice_id, consequence);
$$;

create temporary table test_leases (
  fixture_name text primary key,
  id uuid not null
) on commit drop;

create or replace function pg_temp.add_lease(
  p_fixture_name text,
  p_story_id text,
  p_chapter_number integer,
  p_status text default 'ACTIVE',
  p_expires_at timestamptz default clock_timestamp() + interval '10 minutes'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at
  ) values (
    v_id, p_story_id, p_chapter_number, p_status, 'pgtap', p_expires_at
  );
  insert into pg_temp.test_leases (fixture_name, id) values (p_fixture_name, v_id);
  return v_id;
end;
$$;

create or replace function pg_temp.lease_id(p_fixture_name text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.test_leases where fixture_name = p_fixture_name;
$$;

create or replace function pg_temp.publish_fixture(
  p_story_id text,
  p_chapter_number integer,
  p_lease_fixture text,
  p_idempotency_key text,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_title text default 'Bab Uji',
  p_paragraphs jsonb default '["Raka berdiri di depan pintu gudang."]'::jsonb
)
returns jsonb
language sql
as $$
  select public.publish_chapter_v2(
    p_story_id,
    p_chapter_number,
    p_title,
    p_paragraphs,
    p_choice_prompt,
    p_choices,
    p_outcomes,
    case when p_lease_fixture is null then null else pg_temp.lease_id(p_lease_fixture) end,
    p_idempotency_key
  );
$$;

-- Structural security and exact runtime identity.
select has_function(
  'public',
  'publish_chapter_v2',
  array['text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'uuid', 'text'],
  'publish_chapter_v2 exact runtime signature exists'
);
select function_lang_is(
  'public', 'publish_chapter_v2',
  array['text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'uuid', 'text'],
  'plpgsql',
  'publish_chapter_v2 uses plpgsql'
);
select ok(
  (select p.prosecdef from pg_proc p where p.oid =
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure),
  'publish_chapter_v2 is SECURITY DEFINER'
);
select is(
  (select p.proconfig from pg_proc p where p.oid =
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure),
  array['search_path=""']::text[],
  'publish_chapter_v2 fixes empty safe search_path'
);
select ok(
  not has_function_privilege('public', 'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)', 'EXECUTE'),
  'PUBLIC, anon, and authenticated cannot execute publish_chapter_v2'
);
select ok(
  has_function_privilege('service_role', 'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)', 'EXECUTE'),
  'service_role alone can execute publish_chapter_v2'
);

-- Exact linked legacy function was hashed from ignored local introspection; source is never copied here.
select has_function(
  'public', 'publish_chapter',
  array['text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'uuid', 'text'],
  'legacy publish_chapter identity remains present'
);
select function_lang_is(
  'public', 'publish_chapter',
  array['text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'uuid', 'text'],
  'plpgsql',
  'legacy publish_chapter language remains unchanged'
);
select ok(
  (select p.prosecdef from pg_proc p where p.oid =
    'public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure),
  'legacy publish_chapter SECURITY DEFINER property remains unchanged'
);
select is(
  (select p.proconfig from pg_proc p where p.oid =
    'public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure),
  array['search_path=public']::text[],
  'legacy publish_chapter search_path remains unchanged'
);
select is(
  (select md5(pg_get_functiondef(
    'public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure
  ))),
  'e8f33f2aaca0b3343f8fe51200fc402b',
  'legacy publish_chapter body remains byte-stable after catalog normalization'
);

insert into public.stories (id, title)
select story_id, 'Task12 ' || story_id
from unnest(array[
  'test:v2-normal',
  'test:v2-49-normal', 'test:v2-49-special', 'test:v2-49-mixed', 'test:v2-49-null',
  'test:v2-50-null-null', 'test:v2-50-null-array', 'test:v2-50-array-null', 'test:v2-50-array-array',
  'test:v2-card-choice', 'test:v2-card-outcome', 'test:v2-id-mismatch',
  'test:v2-choice-key', 'test:v2-outcome-key', 'test:v2-effect-missing', 'test:v2-effect-key',
  'test:v2-effect-bound', 'test:v2-transition', 'test:v2-kind', 'test:v2-generic',
  'test:v2-rute', 'test:v2-leak', 'test:v2-pad-choice', 'test:v2-pad-outcome',
  'test:v2-pad-record', 'test:v2-pad-array', 'test:v2-max-bound',
  'test:v2-lease-valid', 'test:v2-lease-wrong-story', 'test:v2-lease-wrong-chapter',
  'test:v2-lease-released', 'test:v2-lease-expired', 'test:v2-lease-null',
  'test:v2-idem', 'test:v2-idem-other', 'test:v2-idem-chapter',
  'test:v2-existing', 'test:v2-late', 'test:v2-event-retry', 'test:v2-event-exhaust'
]) as fixture(story_id);

-- Chapters 1..48: exact 2-choice publication and all atomic side effects.
select pg_temp.add_lease('normal', 'test:v2-normal', 12);
select is(
  pg_temp.publish_fixture(
    'test:v2-normal', 12, 'normal', 'idem:v2-normal',
    'Apa yang Raka lakukan sekarang?', pg_temp.choices_fixture(), pg_temp.outcomes_fixture(12)
  ),
  '{"ok":true,"chapter_number":12,"seq":1}'::jsonb,
  'normal chapter with two exact choices publishes'
);
select is(
  (select row(number, title, paragraphs, choice_prompt, choices)::text
   from public.chapters where story_id = 'test:v2-normal' and number = 12),
  row(12, 'Bab Uji', '["Raka berdiri di depan pintu gudang."]'::jsonb,
    'Apa yang Raka lakukan sekarang?', pg_temp.choices_fixture())::text,
  'normal chapter preserves exact reader payload'
);
select is(
  (select jsonb_agg(jsonb_build_object(
    'choiceId', choice_id,
    'consequence', consequence,
    'nextChapterNumber', next_chapter_number,
    'isEnding', is_ending,
    'effect_json', effect_json,
    'choice_kind', choice_kind
  ) order by choice_id)
  from public.choice_outcomes where story_id = 'test:v2-normal' and chapter_number = 12),
  (select jsonb_agg(value order by value->>'choiceId') from jsonb_array_elements(pg_temp.outcomes_fixture(12))),
  'normal outcomes parse legacy camelCase keys and persist V2 additions'
);
select is(
  (select row(
    (select count(*) from public.story_events where story_id = 'test:v2-normal' and type = 'CHAPTER_PUBLISHED'),
    (select count(*) from public.outbox where payload @> '{"story_id":"test:v2-normal","chapter_number":12}'::jsonb),
    (select status from public.generation_leases where id = pg_temp.lease_id('normal')),
    (select result from public.idempotency_keys where key = 'idem:v2-normal')
  )::text),
  row(1::bigint, 1::bigint, 'RELEASED', '{"ok":true,"chapter_number":12,"seq":1}'::jsonb)::text,
  'event, outbox, lease release, and idempotency result commit together'
);

-- Chapter 49 requires one exhaustive branch mode.
select pg_temp.add_lease('49-normal', 'test:v2-49-normal', 49);
select is(
  pg_temp.publish_fixture(
    'test:v2-49-normal', 49, '49-normal', 'idem:v2-49-normal',
    'Bagaimana Raka melanjutkan pencarian?', pg_temp.choices_fixture(), pg_temp.outcomes_fixture(49)
  )->>'ok', 'true',
  'chapter 49 accepts all-normal mode'
);
select is(
  (select count(*) from public.choice_outcomes
   where story_id = 'test:v2-49-normal' and chapter_number = 49
     and next_chapter_number = 50 and not is_ending and choice_kind = 'normal'),
  2::bigint,
  'chapter 49 all-normal mode persists every exact normal transition'
);
select pg_temp.add_lease('49-special', 'test:v2-49-special', 49);
select is(
  pg_temp.publish_fixture(
    'test:v2-49-special', 49, '49-special', 'idem:v2-49-special',
    'Bagaimana Raka mengakhiri pencarian?', pg_temp.choices_fixture(), pg_temp.outcomes_fixture(49, 'special')
  )->>'ok', 'true',
  'chapter 49 accepts all-special mode'
);
select is(
  (select count(*) from public.choice_outcomes
   where story_id = 'test:v2-49-special' and chapter_number = 49
     and next_chapter_number is null and is_ending and choice_kind = 'special_bad_ending'),
  2::bigint,
  'chapter 49 all-special mode persists every exact special transition'
);
select pg_temp.add_lease('49-mixed', 'test:v2-49-mixed', 49);
select throws_ok(
  $$select pg_temp.publish_fixture(
    'test:v2-49-mixed', 49, '49-mixed', 'idem:v2-49-mixed',
    'Bagaimana Raka menentukan pencarian?', pg_temp.choices_fixture(),
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.outcomes_fixture(49), '{1,nextChapterNumber}', 'null'::jsonb),
        '{1,isEnding}', 'true'::jsonb
      ),
      '{1,choice_kind}', '"special_bad_ending"'::jsonb
    )
  )$$,
  '22023', null,
  'chapter 49 rejects mixed valid normal and special modes'
);
select pg_temp.add_lease('49-null', 'test:v2-49-null', 49);
select throws_ok(
  $$select pg_temp.publish_fixture(
    'test:v2-49-null', 49, '49-null', 'idem:v2-49-null',
    'Bagaimana Raka menentukan pencarian?', pg_temp.choices_fixture(),
    jsonb_set(pg_temp.outcomes_fixture(49), '{0,nextChapterNumber}', 'null'::jsonb)
  )$$,
  '22023', null,
  'chapter 49 rejects null next chapter on non-ending outcome without SQL NULL bypass'
);

-- Chapter 50 accepts four null/empty combinations but always needs an exact lease.
select pg_temp.add_lease('50-null-null', 'test:v2-50-null-null', 50);
select is(pg_temp.publish_fixture('test:v2-50-null-null', 50, '50-null-null', 'idem:v2-50-1', null, null, null)->>'ok', 'true', 'chapter 50 accepts null choices and null outcomes');
select is((select count(*) from public.choice_outcomes where story_id = 'test:v2-50-null-null'), 0::bigint, 'chapter 50 null/null creates zero outcomes');
select pg_temp.add_lease('50-null-array', 'test:v2-50-null-array', 50);
select is(pg_temp.publish_fixture('test:v2-50-null-array', 50, '50-null-array', 'idem:v2-50-2', null, null, '[]'::jsonb)->>'ok', 'true', 'chapter 50 accepts null choices and empty outcomes');
select is((select count(*) from public.choice_outcomes where story_id = 'test:v2-50-null-array'), 0::bigint, 'chapter 50 null/array creates zero outcomes');
select pg_temp.add_lease('50-array-null', 'test:v2-50-array-null', 50);
select is(pg_temp.publish_fixture('test:v2-50-array-null', 50, '50-array-null', 'idem:v2-50-3', null, '[]'::jsonb, null)->>'ok', 'true', 'chapter 50 accepts empty choices and null outcomes');
select is((select count(*) from public.choice_outcomes where story_id = 'test:v2-50-array-null'), 0::bigint, 'chapter 50 array/null creates zero outcomes');
select pg_temp.add_lease('50-array-array', 'test:v2-50-array-array', 50);
select is(pg_temp.publish_fixture('test:v2-50-array-array', 50, '50-array-array', 'idem:v2-50-4', null, '[]'::jsonb, '[]'::jsonb)->>'ok', 'true', 'chapter 50 accepts empty choices and empty outcomes');
select is((select count(*) from public.choice_outcomes where story_id = 'test:v2-50-array-array'), 0::bigint, 'chapter 50 array/array creates zero outcomes');

-- Shape, transition, canonicalization, quality, and effect contract rejection.
select pg_temp.add_lease('card-choice', 'test:v2-card-choice', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-card-choice',12,'card-choice','idem:card-choice','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture()->0,pg_temp.outcomes_fixture(12))$$, '22023', null, 'chapters 1 through 49 reject non-array or wrong choice cardinality');
select pg_temp.add_lease('card-outcome', 'test:v2-card-outcome', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-card-outcome',12,'card-outcome','idem:card-outcome','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12)->0)$$, '22023', null, 'chapters 1 through 49 reject non-array or wrong outcome cardinality');
select pg_temp.add_lease('id-mismatch', 'test:v2-id-mismatch', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-id-mismatch',12,'id-mismatch','idem:id-mismatch','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{1,choiceId}','"other-choice"'))$$, '22023', null, 'choice and outcome IDs must match exactly');
select pg_temp.add_lease('choice-key', 'test:v2-choice-key', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-choice-key',12,'choice-key','idem:choice-key','Apa yang Raka lakukan sekarang?',jsonb_set(pg_temp.choices_fixture(),'{0,unknown}','true'),pg_temp.outcomes_fixture(12))$$, '22023', null, 'unknown choice keys reject');
select pg_temp.add_lease('outcome-key', 'test:v2-outcome-key', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-outcome-key',12,'outcome-key','idem:outcome-key','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,unknown}','true'))$$, '22023', null, 'unknown outcome keys reject');
select pg_temp.add_lease('effect-missing', 'test:v2-effect-missing', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-effect-missing',12,'effect-missing','idem:effect-missing','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12) #- '{0,effect_json,threadTouches}')$$, '22023', null, 'direct RPC requires all six effect keys');
select pg_temp.add_lease('effect-key', 'test:v2-effect-key', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-effect-key',12,'effect-key','idem:effect-key','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,effect_json,unknown}','true'))$$, '22023', null, 'unknown effect keys reject');
select pg_temp.add_lease('effect-bound', 'test:v2-effect-bound', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-effect-bound',12,'effect-bound','idem:effect-bound','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,effect_json,routeDeltas,truth}','21'))$$, '22023', null, 'malformed or out-of-bound effect rejects');
select pg_temp.add_lease('transition', 'test:v2-transition', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-transition',12,'transition','idem:transition','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,nextChapterNumber}','14'))$$, '22023', null, 'chapters 1 through 48 require exact next chapter transition');
select pg_temp.add_lease('kind', 'test:v2-kind', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-kind',12,'kind','idem:kind','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,choice_kind}','"internal"'))$$, '22023', null, 'unknown choice kind rejects');
select pg_temp.add_lease('generic', 'test:v2-generic', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-generic',12,'generic','idem:generic','Apa yang Raka lakukan sekarang?',jsonb_set(pg_temp.choices_fixture(),'{0,label}','"Lanjutkan"'),pg_temp.outcomes_fixture(12))$$, '22023', null, 'generic reader choice label rejects');
select pg_temp.add_lease('rute', 'test:v2-rute', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-rute',12,'rute','idem:rute','Apa yang Raka lakukan sekarang?',jsonb_set(pg_temp.choices_fixture(),'{0,label}','"Buka rute rahasia"'),pg_temp.outcomes_fixture(12))$$, '22023', null, 'reader-facing rute term rejects');
select pg_temp.add_lease('leak', 'test:v2-leak', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-leak',12,'leak','idem:leak','Apa prompt yang Raka pilih sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))$$, '22023', null, 'reader-facing internal generation leak rejects');
select pg_temp.add_lease('pad-choice', 'test:v2-pad-choice', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-pad-choice',12,'pad-choice','idem:pad-choice','Apa yang Raka lakukan sekarang?',jsonb_set(pg_temp.choices_fixture(),'{0,id}','" open-door "'),pg_temp.outcomes_fixture(12))$$, '22023', null, 'padded choice ID rejects instead of normalizing in DB');
select pg_temp.add_lease('pad-outcome', 'test:v2-pad-outcome', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-pad-outcome',12,'pad-outcome','idem:pad-outcome','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,choiceId}','" open-door "'))$$, '22023', null, 'padded outcome choice ID rejects instead of persisting');
select pg_temp.add_lease('pad-record', 'test:v2-pad-record', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-pad-record',12,'pad-record','idem:pad-record','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,effect_json,trustDeltas}','{" Raka ":1}'))$$, '22023', null, 'padded effect record key rejects instead of normalizing in DB');
select pg_temp.add_lease('pad-array', 'test:v2-pad-array', 12);
select throws_ok($$select pg_temp.publish_fixture('test:v2-pad-array',12,'pad-array','idem:pad-array','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),jsonb_set(pg_temp.outcomes_fixture(12),'{0,effect_json,evidenceAdded}','[" surat "]'))$$, '22023', null, 'padded effect string-array item rejects instead of persisting');
select pg_temp.add_lease('max-bound', 'test:v2-max-bound', 12);
select is(
  pg_temp.publish_fixture(
    'test:v2-max-bound',12,'max-bound','idem:max-bound','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.outcomes_fixture(12),'{0,effect_json,routeDeltas}','{"truth":20,"risk":-20,"secrecy":20,"empathy":-20}'),
        '{0,effect_json,trustDeltas}', jsonb_build_object(repeat('k',80),10)
      ),
      '{0,effect_json,endingBiasDeltas}', '{"ending":100}'
    )
  )->>'ok', 'true',
  'exact effect numeric and record-key boundaries publish'
);
select is(
  (select effect_json->'routeDeltas' from public.choice_outcomes
   where story_id = 'test:v2-max-bound' and chapter_number = 12 and choice_id = 'open-door'),
  '{"truth":20,"risk":-20,"secrecy":20,"empathy":-20}'::jsonb,
  'exact max-bound effect persists canonically'
);

-- Exact active nonexpired lease is mandatory for every new V2 chapter.
select pg_temp.add_lease('lease-valid', 'test:v2-lease-valid', 50);
select is(pg_temp.publish_fixture('test:v2-lease-valid',50,'lease-valid','idem:lease-valid',null,'[]','[]')->>'ok', 'true', 'valid chapter 50 lease publishes and releases');
select is((select status from public.generation_leases where id = pg_temp.lease_id('lease-valid')), 'RELEASED', 'valid lease changes to RELEASED');
select pg_temp.add_lease('lease-wrong-story-source', 'test:v2-lease-wrong-story', 12);
select throws_ok($$select public.publish_chapter_v2('test:v2-lease-wrong-chapter',12,'Bab Uji','["Raka berdiri di gudang."]','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12),pg_temp.lease_id('lease-wrong-story-source'),'idem:lease-wrong-story')$$, '22023', null, 'lease from wrong story rejects');
select pg_temp.add_lease('lease-wrong-chapter-source', 'test:v2-lease-wrong-chapter', 13);
select throws_ok($$select public.publish_chapter_v2('test:v2-lease-wrong-chapter',12,'Bab Uji','["Raka berdiri di gudang."]','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12),pg_temp.lease_id('lease-wrong-chapter-source'),'idem:lease-wrong-chapter')$$, '22023', null, 'lease from wrong chapter rejects');
select pg_temp.add_lease('lease-released-source', 'test:v2-lease-released', 12, 'RELEASED');
select throws_ok($$select pg_temp.publish_fixture('test:v2-lease-released',12,'lease-released-source','idem:lease-released','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))$$, '22023', null, 'non-ACTIVE lease rejects');
select pg_temp.add_lease('lease-expired-source', 'test:v2-lease-expired', 12, 'ACTIVE', clock_timestamp() - interval '1 second');
select throws_ok($$select pg_temp.publish_fixture('test:v2-lease-expired',12,'lease-expired-source','idem:lease-expired','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))$$, '22023', null, 'expired lease rejects');
select throws_ok($$select pg_temp.publish_fixture('test:v2-lease-null',50,null,'idem:lease-null',null,null,null)$$, '22023', null, 'null lease rejects even for chapter 50');

-- Idempotency result binds story, RPC scope, and chapter.
select pg_temp.add_lease('idem', 'test:v2-idem', 12);
select is(pg_temp.publish_fixture('test:v2-idem',12,'idem','idem:shared','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12)), '{"ok":true,"chapter_number":12,"seq":1}'::jsonb, 'initial idempotent publication succeeds');
select is(pg_temp.publish_fixture('test:v2-idem',12,null,'idem:shared','malformed',null,null), '{"ok":true,"chapter_number":12,"seq":1}'::jsonb, 'exact replay returns same result before payload or lease validation');
select is(
  (select row(
    (select count(*) from public.chapters where story_id='test:v2-idem' and number=12),
    (select count(*) from public.choice_outcomes where story_id='test:v2-idem' and chapter_number=12),
    (select count(*) from public.story_events where story_id='test:v2-idem'),
    (select count(*) from public.outbox where payload @> '{"story_id":"test:v2-idem"}'::jsonb)
  )::text),
  row(1::bigint,2::bigint,1::bigint,1::bigint)::text,
  'exact replay creates no duplicate side effects'
);
select throws_ok($$select pg_temp.publish_fixture('test:v2-idem-other',12,null,'idem:shared','malformed',null,null)$$, '23505', null, 'same idempotency key on another story rejects without leaking result');
select throws_ok($$select pg_temp.publish_fixture('test:v2-idem',13,null,'idem:shared','malformed',null,null)$$, '23505', null, 'same idempotency key on another chapter rejects without replay');
insert into public.idempotency_keys (key, story_id, scope, result)
values ('idem:other-scope', 'test:v2-idem-other', 'acquire_generation_lease', '{"ok":true,"lease_id":"redacted","chapter_number":12}');
select throws_ok($$select pg_temp.publish_fixture('test:v2-idem-other',12,null,'idem:other-scope','malformed',null,null)$$, '23505', null, 'same idempotency key from another RPC scope rejects without leaking result');

-- Legacy CHAPTER_EXISTS precedence follows replay/story lock and beats malformed payload or lease.
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values ('test:v2-existing', 12, 'Existing', '["Existing chapter."]', 'Existing prompt', '[]');
select is(
  pg_temp.publish_fixture('test:v2-existing',12,null,'idem:existing-malformed','x',null,null,'', 'null'::jsonb),
  '{"ok":false,"reason":"CHAPTER_EXISTS"}'::jsonb,
  'existing chapter returns CHAPTER_EXISTS before malformed payload validation'
);
select is(
  pg_temp.publish_fixture('test:v2-existing',12,'missing-lease','idem:existing-lease','x',null,null),
  '{"ok":false,"reason":"CHAPTER_EXISTS"}'::jsonb,
  'existing chapter returns CHAPTER_EXISTS before lease validation'
);
select throws_ok(
  $$select public.publish_chapter_v2('test:v2-missing-story',12,'Bab Uji','["Raka berdiri di gudang."]','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12),gen_random_uuid(),'idem:missing-story')$$,
  '23503', null,
  'missing story rejects as STORY_NOT_FOUND'
);

-- Late outbox failure rolls every prior write back; dropping local trigger allows clean retry.
select pg_temp.add_lease('late', 'test:v2-late', 12);
create or replace function pg_temp.fail_task12_outbox()
returns trigger
language plpgsql
as $$
begin
  if current_setting('lakoku.test_target', true) = 'local-cli'
    and new.payload->>'story_id' = 'test:v2-late' then
    raise exception using errcode = 'P0001', message = 'TASK12_TEST_OUTBOX_FAILURE';
  end if;
  return new;
end;
$$;
create trigger task12_test_outbox_failure
before insert on public.outbox
for each row execute function pg_temp.fail_task12_outbox();
select throws_ok(
  $$select pg_temp.publish_fixture('test:v2-late',12,'late','idem:late','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))$$,
  'P0001', 'TASK12_TEST_OUTBOX_FAILURE',
  'controlled late outbox failure aborts publication'
);
select is(
  (select row(
    (select count(*) from public.chapters where story_id='test:v2-late'),
    (select count(*) from public.choice_outcomes where story_id='test:v2-late'),
    (select count(*) from public.story_events where story_id='test:v2-late'),
    (select count(*) from public.outbox where payload @> '{"story_id":"test:v2-late"}'::jsonb)
  )::text),
  row(0::bigint,0::bigint,0::bigint,0::bigint)::text,
  'late failure leaves chapter, outcomes, event, and outbox absent'
);
select is((select status from public.generation_leases where id=pg_temp.lease_id('late')), 'ACTIVE', 'late failure leaves lease ACTIVE');
select is((select count(*) from public.idempotency_keys where key='idem:late'), 0::bigint, 'late failure leaves idempotency reservation absent');
drop trigger task12_test_outbox_failure on public.outbox;
select is(pg_temp.publish_fixture('test:v2-late',12,'late','idem:late','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))->>'ok', 'true', 'clean retry succeeds after controlled late failure removal');
select is(
  (select row(
    (select count(*) from public.chapters where story_id='test:v2-late'),
    (select count(*) from public.choice_outcomes where story_id='test:v2-late'),
    (select count(*) from public.story_events where story_id='test:v2-late'),
    (select count(*) from public.outbox where payload @> '{"story_id":"test:v2-late"}'::jsonb),
    (select status from public.generation_leases where id=pg_temp.lease_id('late'))
  )::text),
  row(1::bigint,2::bigint,1::bigint,1::bigint,'RELEASED')::text,
  'clean retry commits every atomic side effect once'
);

-- Retry unique event sequence collisions created by a noncooperating writer simulation.
select pg_temp.add_lease('event-retry', 'test:v2-event-retry', 12);
insert into public.story_events (story_id, seq, type, payload)
values ('test:v2-event-retry', 1, 'DIRECT_WRITER', '{}');
create temporary sequence task12_event_retry_counter;
create or replace function pg_temp.collide_task12_event_once()
returns trigger
language plpgsql
as $$
begin
  if new.story_id = 'test:v2-event-retry'
    and nextval('pg_temp.task12_event_retry_counter') = 1 then
    new.seq := 1;
  end if;
  return new;
end;
$$;
create trigger task12_test_event_collision
before insert on public.story_events
for each row execute function pg_temp.collide_task12_event_once();
select is(pg_temp.publish_fixture('test:v2-event-retry',12,'event-retry','idem:event-retry','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))->>'ok', 'true', 'event unique violation retries instead of aborting V2 publication');
select is((select max(seq) from public.story_events where story_id='test:v2-event-retry'), 2, 'event retry uses fresh max sequence plus one');
drop trigger task12_test_event_collision on public.story_events;

-- Retry count is bounded and exhaustion remains atomic.
select pg_temp.add_lease('event-exhaust', 'test:v2-event-exhaust', 12);
insert into public.story_events (story_id, seq, type, payload)
values ('test:v2-event-exhaust', 1, 'DIRECT_WRITER', '{}');
create or replace function pg_temp.collide_task12_event_always()
returns trigger
language plpgsql
as $$
begin
  if new.story_id = 'test:v2-event-exhaust' then
    new.seq := 1;
  end if;
  return new;
end;
$$;
create trigger task12_test_event_exhaustion
before insert on public.story_events
for each row execute function pg_temp.collide_task12_event_always();
select throws_ok(
  $$select pg_temp.publish_fixture('test:v2-event-exhaust',12,'event-exhaust','idem:event-exhaust','Apa yang Raka lakukan sekarang?',pg_temp.choices_fixture(),pg_temp.outcomes_fixture(12))$$,
  '40001', 'EVENT_SEQUENCE_RETRY_EXHAUSTED',
  'event sequence retry stops after bounded attempts'
);
select is(
  (select row(
    (select count(*) from public.chapters where story_id='test:v2-event-exhaust'),
    (select count(*) from public.choice_outcomes where story_id='test:v2-event-exhaust'),
    (select count(*) from public.story_events where story_id='test:v2-event-exhaust' and type='CHAPTER_PUBLISHED'),
    (select count(*) from public.outbox where payload @> '{"story_id":"test:v2-event-exhaust"}'::jsonb),
    (select count(*) from public.idempotency_keys where key='idem:event-exhaust'),
    (select status from public.generation_leases where id=pg_temp.lease_id('event-exhaust'))
  )::text),
  row(0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'ACTIVE')::text,
  'event retry exhaustion rolls back publication and preserves active lease'
);
drop trigger task12_test_event_exhaustion on public.story_events;

select * from finish();
rollback;
