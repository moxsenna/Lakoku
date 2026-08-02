begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation provider call recording tests require local-cli';
  end if;
end
$$;

select plan(59);

select has_table(
  'public', 'generation_model_pricing_versions',
  'temporal model pricing table exists'
);
select has_pk(
  'public', 'generation_model_pricing_versions',
  'temporal model pricing has primary key'
);
select columns_are(
  'public', 'generation_model_pricing_versions',
  array[
    'id', 'provider_id', 'model_id', 'input_token_price',
    'output_token_price', 'currency', 'unit_size', 'effective_from',
    'effective_to', 'created_by', 'created_at'
  ],
  'temporal pricing has exact scalar columns'
);
select col_type_is(
  'public', 'generation_model_pricing_versions', 'input_token_price',
  'numeric(20,8)', 'input price uses numeric(20,8)'
);
select col_type_is(
  'public', 'generation_model_pricing_versions', 'output_token_price',
  'numeric(20,8)', 'output price uses numeric(20,8)'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.generation_model_pricing_versions'::regclass
      and contype = 'x'
  ),
  'pricing has overlap exclusion constraint'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and contype = 'f'
      and confrelid = 'public.generation_model_pricing_versions'::regclass
      and confdeltype = 'r'
  ),
  'provider calls pricing version uses ON DELETE RESTRICT FK'
);
select ok(
  not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.generation_model_pricing_versions'::regclass
      and c.contype = 'f'
      and a.attname = 'created_by'
  ),
  'created_by is a UUID snapshot without auth FK'
);
select is(
  (select count(*) from public.generation_model_pricing_versions),
  0::bigint,
  'migration seeds no guessed prices'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.generation_model_pricing_versions'::regclass),
  'pricing RLS is enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.generation_model_pricing_versions'::regclass),
  'pricing RLS is forced'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'generation_model_pricing_versions'
  ),
  'pricing exposes no direct policies'
);
select ok(
  not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.generation_model_pricing_versions'::regclass
      and acl.grantee = 0
  ),
  'PUBLIC has no pricing privileges'
);
select ok(
  not has_table_privilege(
    'anon', 'public.generation_model_pricing_versions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'anon has no pricing privileges'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.generation_model_pricing_versions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'authenticated has no pricing privileges'
);
select ok(
  has_table_privilege(
    'service_role', 'public.generation_model_pricing_versions', 'SELECT'
  ),
  'service_role can select pricing'
);
select ok(
  not has_table_privilege(
    'service_role', 'public.generation_model_pricing_versions',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'service_role has no pricing write or DDL privileges'
);

select has_function(
  'public',
  'record_generation_provider_call_v1',
  array[
    'text', 'uuid', 'text', 'integer', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'integer', 'boolean',
    'timestamp with time zone', 'timestamp with time zone', 'bigint', 'text',
    'text', 'bigint', 'bigint', 'bigint', 'numeric', 'text'
  ],
  'legacy recorder v1 keeps exact 25-argument signature'
);
select function_returns(
  'public',
  'record_generation_provider_call_v1',
  array[
    'text', 'uuid', 'text', 'integer', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'integer', 'boolean',
    'timestamp with time zone', 'timestamp with time zone', 'bigint', 'text',
    'text', 'bigint', 'bigint', 'bigint', 'numeric', 'text'
  ],
  'jsonb',
  'legacy recorder v1 returns jsonb'
);
select ok(
  coalesce((select prosecdef from pg_proc
    where oid = to_regprocedure(
      'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)'
    )), false),
  'legacy recorder v1 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure(
     'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)'
   )),
  array['search_path=""']::text[],
  'legacy recorder v1 fixes empty search_path'
);
select ok(
  not has_function_privilege(
    'public',
    'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)',
    'EXECUTE'
  ),
  'PUBLIC, anon, and authenticated cannot execute legacy recorder v1'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_generation_provider_call_v1(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text)',
    'EXECUTE'
  ),
  'service_role can execute legacy recorder v1'
);

select has_function(
  'public',
  'record_generation_provider_call_v2',
  array[
    'text', 'uuid', 'text', 'integer', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'integer', 'boolean',
    'timestamp with time zone', 'timestamp with time zone', 'bigint', 'text',
    'text', 'bigint', 'bigint', 'bigint', 'numeric', 'text', 'text', 'text[]'
  ],
  'recorder v2 has exact diagnostics signature'
);
select function_returns(
  'public',
  'record_generation_provider_call_v2',
  array[
    'text', 'uuid', 'text', 'integer', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'integer', 'boolean',
    'timestamp with time zone', 'timestamp with time zone', 'bigint', 'text',
    'text', 'bigint', 'bigint', 'bigint', 'numeric', 'text', 'text', 'text[]'
  ],
  'jsonb',
  'recorder v2 returns jsonb'
);
select ok(
  coalesce((select prosecdef from pg_proc
    where oid = to_regprocedure(
      'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])'
    )), false),
  'recorder v2 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure(
     'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])'
   )),
  array['search_path=""']::text[],
  'recorder v2 fixes empty search_path'
);
select ok(
  not has_function_privilege(
    'public',
    'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])',
    'EXECUTE'
  ),
  'PUBLIC, anon, and authenticated cannot execute recorder v2'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[])',
    'EXECUTE'
  ),
  'service_role can execute recorder v2'
);

create or replace function pg_temp.assert_invalid_pricing_rows()
returns void
language plpgsql
as $function$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values (' openrouter','model',1,1,'USD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values (E'open\nrouter','model',1,1,'USD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter',repeat('m',201),1,1,'USD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter','model',-0.00000001,1,'USD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter','model',1,-0.00000001,'USD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter','model',1,1,'usd',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter','model',1,1,'USDD',1000,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,created_by) values ('openrouter','model',1,1,'USD',0,'2026-01-01','51000000-0000-4000-8000-000000000001')$$,
    $$insert into public.generation_model_pricing_versions (provider_id,model_id,input_token_price,output_token_price,currency,unit_size,effective_from,effective_to,created_by) values ('openrouter','model',1,1,'USD',1000,'2026-01-02','2026-01-01','51000000-0000-4000-8000-000000000001')$$
  ] loop
    begin
      execute v_sql;
      raise exception 'invalid pricing row unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;
end
$function$;

select lives_ok(
  $$select pg_temp.assert_invalid_pricing_rows()$$,
  'pricing rejects untrimmed, control, oversized, negative, currency, unit, and range inputs'
);

insert into public.generation_model_pricing_versions (
  id, provider_id, model_id, input_token_price, output_token_price,
  currency, unit_size, effective_from, effective_to, created_by
) values
  (
    '52000000-0000-4000-8000-000000000001', 'openrouter', 'priced-model',
    2, 6, 'USD', 1000000, '2026-07-01 00:00:00+00', null,
    '51000000-0000-4000-8000-000000000001'
  ),
  (
    '52000000-0000-4000-8000-000000000002', 'openrouter', 'windowed-model',
    2, 6, 'USD', 1000000,
    '2026-07-01 00:00:00+00', '2026-07-18 11:00:00+00',
    '51000000-0000-4000-8000-000000000001'
  ),
  (
    '52000000-0000-4000-8000-000000000003', 'openrouter', 'windowed-model',
    2, 6, 'USD', 1000000,
    '2026-07-18 13:00:00+00', null,
    '51000000-0000-4000-8000-000000000001'
  );

select throws_ok(
  $$insert into public.generation_model_pricing_versions (
      provider_id, model_id, input_token_price, output_token_price,
      currency, unit_size, effective_from, effective_to, created_by
    ) values (
      'openrouter', 'priced-model', 3, 7, 'EUR', 1000000,
      '2026-07-10 00:00:00+00', '2026-07-20 00:00:00+00',
      '51000000-0000-4000-8000-000000000001'
    )$$,
  '23P01', null,
  'overlapping provider and model pricing ranges reject across currencies'
);
select lives_ok(
  $$insert into public.generation_model_pricing_versions (
      provider_id, model_id, input_token_price, output_token_price,
      currency, unit_size, effective_from, effective_to, created_by
    ) values (
      'openrouter', 'windowed-model', 3, 7, 'EUR', 1000000,
      '2026-07-18 11:00:00+00', '2026-07-18 13:00:00+00',
      '51000000-0000-4000-8000-000000000001'
    )$$,
  'touching half-open pricing ranges allow sequential currency version'
);
select is(
  (select currency
   from public.generation_model_pricing_versions
   where provider_id = 'openrouter'
     and model_id = 'windowed-model'
     and effective_from = '2026-07-18 11:00:00+00'),
  'EUR',
  'non-overlapping sequential pricing can change currency'
);
delete from public.generation_model_pricing_versions
where provider_id = 'openrouter'
  and model_id = 'windowed-model'
  and effective_from = '2026-07-18 11:00:00+00';

create or replace function pg_temp.record_call(
  p_provider_call_id text,
  p_model_id text default 'priced-model',
  p_started_at timestamptz default '2026-07-18 12:00:00+00',
  p_input_token_count bigint default 1000,
  p_output_token_count bigint default 2000,
  p_total_token_count bigint default 3000,
  p_provider_cost_amount numeric default null,
  p_provider_cost_currency text default null,
  p_elapsed_ms bigint default 1000
)
returns jsonb
language sql
as $$
  select public.record_generation_provider_call_v1(
    p_provider_call_id,
    '51000000-0000-4000-8000-000000000010'::uuid,
    'test:generation-provider-recording',
    3,
    'standard',
    null,
    '53000000-0000-4000-8000-000000000001'::uuid,
    null,
    'chapter_generation',
    'CHAPTER_PROSE_INITIAL',
    'openrouter',
    p_model_id,
    'chapter-v1',
    0,
    true,
    p_started_at,
    p_started_at + interval '1 second',
    p_elapsed_ms,
    'SUCCEEDED',
    null,
    p_input_token_count,
    p_output_token_count,
    p_total_token_count,
    p_provider_cost_amount,
    p_provider_cost_currency
  )
$$;
grant execute on function pg_temp.record_call(
  text, text, timestamptz, bigint, bigint, bigint, numeric, text, bigint
) to service_role;

set local role service_role;
select is(
  pg_temp.record_call('actual-wins', 'priced-model',
    '2026-07-18 12:00:00+00', 1000, 2000, 3000, 1.25000000, 'EUR'),
  '{"recorded":true,"duplicate":false}'::jsonb,
  'new actual-cost call reports recorded'
);
select is(
  (select row(cost_source, cost_amount, cost_currency, pricing_version_id)::text
   from public.generation_provider_calls
   where provider_call_id = 'actual-wins'),
  row('provider_actual', 1.25000000::numeric, 'EUR', null::uuid)::text,
  'valid provider actual amount and currency win over matching price'
);

select is(
  pg_temp.record_call('estimated'),
  '{"recorded":true,"duplicate":false}'::jsonb,
  'new estimated call reports recorded'
);
select is(
  (select cost_amount from public.generation_provider_calls
   where provider_call_id = 'estimated'),
  0.01400000::numeric,
  'effective price estimates exact input and output cost'
);
select is(
  (select row(cost_source, cost_currency, pricing_version_id)::text
   from public.generation_provider_calls
   where provider_call_id = 'estimated'),
  row('price_estimate', 'USD',
    '52000000-0000-4000-8000-000000000001'::uuid)::text,
  'estimate records uppercase currency and exact pricing version'
);
select lives_ok(
  $$select pg_temp.record_call('invalid-actual-scale', 'priced-model',
      '2026-07-18 12:00:00+00', 1000, 2000, 3000,
      1.000000001, 'EUR')$$,
  'provider amount outside numeric(20,8) scale does not reject record'
);
select is(
  (select row(cost_source, cost_amount, cost_currency)::text
   from public.generation_provider_calls
   where provider_call_id = 'invalid-actual-scale'),
  row('price_estimate', 0.01400000::numeric, 'USD')::text,
  'provider amount outside numeric(20,8) scale falls back to estimate'
);

select lives_ok(
  $$select pg_temp.record_call('expired-future', 'windowed-model')$$,
  'call between expired and future windows records'
);
select is(
  (select row(cost_source, cost_amount, cost_currency, pricing_version_id)::text
   from public.generation_provider_calls
   where provider_call_id = 'expired-future'),
  row('unavailable', null::numeric, null::text, null::uuid)::text,
  'expired and future prices are ignored'
);
select lives_ok(
  $$select pg_temp.record_call('missing-price', 'missing-model')$$,
  'call without pricing records'
);
select is(
  (select row(cost_source, cost_amount, cost_currency)::text
   from public.generation_provider_calls
   where provider_call_id = 'missing-price'),
  row('unavailable', null::numeric, null::text)::text,
  'missing pricing remains unavailable rather than zero'
);
select lives_ok(
  $$select pg_temp.record_call('missing-output', 'priced-model',
      '2026-07-18 12:00:00+00', 1000, null, null)$$,
  'call with missing required token count records'
);
select is(
  (select row(cost_source, cost_amount, cost_currency)::text
   from public.generation_provider_calls
   where provider_call_id = 'missing-output'),
  row('unavailable', null::numeric, null::text)::text,
  'missing required token count leaves cost unavailable'
);
select lives_ok(
  $$select pg_temp.record_call('invalid-actual-currency', 'priced-model',
      '2026-07-18 12:00:00+00', 1000, 2000, 3000, 9.5, 'usd')$$,
  'invalid provider currency does not reject record'
);
select is(
  (select row(cost_source, cost_amount, cost_currency)::text
   from public.generation_provider_calls
   where provider_call_id = 'invalid-actual-currency'),
  row('price_estimate', 0.01400000::numeric, 'USD')::text,
  'invalid provider currency falls back to uppercase priced estimate'
);
select lives_ok(
  $$select pg_temp.record_call('invalid-actual-amount', 'priced-model',
      '2026-07-18 12:00:00+00', 1000, 2000, 3000, -1, 'USD')$$,
  'invalid provider amount does not reject record'
);
select is(
  (select row(cost_source, cost_amount, cost_currency)::text
   from public.generation_provider_calls
   where provider_call_id = 'invalid-actual-amount'),
  row('price_estimate', 0.01400000::numeric, 'USD')::text,
  'invalid provider amount falls back to priced estimate'
);

select is(
  pg_temp.record_call('estimated'),
  '{"recorded":false,"duplicate":true}'::jsonb,
  'exact duplicate reports duplicate without recording'
);
select is(
  (select count(*) from public.generation_provider_calls
   where provider_call_id = 'estimated'),
  1::bigint,
  'exact duplicate leaves one complete row'
);
select throws_ok(
  $$select pg_temp.record_call('estimated', 'priced-model',
      '2026-07-18 12:00:00+00', 1000, 2000, 3000, null, null, 1001)$$,
  'P0001', 'GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT',
  'same provider_call_id with mismatched supplied result rejects'
);

create or replace function pg_temp.record_call_v2(
  p_provider_call_id text,
  p_validation_stage text,
  p_validation_codes text[]
)
returns jsonb
language sql
as $$
  select public.record_generation_provider_call_v2(
    p_provider_call_id,
    '51000000-0000-4000-8000-000000000010'::uuid,
    'test:generation-provider-recording',
    3,
    'standard',
    null,
    '53000000-0000-4000-8000-000000000001'::uuid,
    null,
    'chapter_generation',
    'CHOICES_INITIAL',
    'openrouter',
    'priced-model',
    'chapter-v1',
    0,
    true,
    '2026-07-18 12:00:00+00',
    '2026-07-18 12:00:01+00',
    1000,
    'INVALID_RESPONSE',
    'PROVIDER_INVALID_RESPONSE',
    1000,
    2000,
    3000,
    null,
    null,
    p_validation_stage,
    p_validation_codes
  )
$$;
grant execute on function pg_temp.record_call_v2(
  text, text, text[]
) to service_role;

select lives_ok(
  $$select pg_temp.record_call_v2('v2-diag',
      'FINAL_BRANCH_SCHEMA', array['CHOICE_NOT_ACTIONABLE','NEXT_CHAPTER_MISMATCH'])$$,
  'recorder v2 records canonical diagnostics'
);
select is(
  (select row(validation_stage, validation_codes)::text
   from public.generation_provider_calls
   where provider_call_id = 'v2-diag'),
  row('FINAL_BRANCH_SCHEMA', array['CHOICE_NOT_ACTIONABLE','NEXT_CHAPTER_MISMATCH']::text[])::text,
  'recorder v2 persists exact canonical diagnostics'
);
select is(
  pg_temp.record_call_v2('v2-diag',
    'FINAL_BRANCH_SCHEMA', array['CHOICE_NOT_ACTIONABLE','NEXT_CHAPTER_MISMATCH']),
  '{"recorded":false,"duplicate":true}'::jsonb,
  'recorder v2 exact duplicate with identical diagnostics reports duplicate'
);
select throws_ok(
  $$select pg_temp.record_call_v2('v2-diag',
      'FINAL_BRANCH_SCHEMA', array['NEXT_CHAPTER_MISMATCH'])$$,
  'P0001', 'GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT',
  'recorder v2 duplicate with different diagnostics rejects'
);
select throws_ok(
  $$select pg_temp.record_call_v2('v2-noncanonical',
      'FINAL_BRANCH_SCHEMA', array['NEXT_CHAPTER_MISMATCH','CHOICE_NOT_ACTIONABLE'])$$,
  '23514', null,
  'recorder v2 noncanonical diagnostics rejects'
);
select throws_ok(
  $$select public.record_generation_provider_call_v2(
      'v2-wrong-outcome',
      '51000000-0000-4000-8000-000000000010'::uuid,
      'test:generation-provider-recording', 3, 'standard', null,
      '53000000-0000-4000-8000-000000000001'::uuid, null,
      'chapter_generation', 'CHOICES_INITIAL', 'openrouter', 'priced-model',
      'chapter-v1', 0, true, '2026-07-18 12:00:00+00', '2026-07-18 12:00:01+00',
      1000, 'TIMEOUT', 'PROVIDER_TIMEOUT', 1000, 2000, 3000, null, null,
      'FINAL_BRANCH_SCHEMA', array['CHOICE_NOT_ACTIONABLE'])$$,
  '23514', null,
  'recorder v2 diagnostics reject non-invalid-response outcome'
);

reset role;

select * from finish();
rollback;
