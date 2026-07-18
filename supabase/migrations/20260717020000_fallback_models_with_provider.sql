-- Fallback candidates now carry their own provider (not inherited from primary).
-- Old shape: text[] of model_id strings (provider = primary route.provider).
-- New shape: jsonb array of { "provider": "...", "modelId": "..." }.
--
-- Note: Supabase/Postgres rejects subqueries inside CHECK and inside
-- ALTER ... TYPE USING. Use a staged column swap + trigger validation.

-- 1) Temporary jsonb column.
alter table public.ai_model_routes
  add column if not exists fallback_models_v2 jsonb not null default '[]'::jsonb;

-- 2) Convert text[] → jsonb objects, keeping each row's primary provider.
update public.ai_model_routes as r
set fallback_models_v2 = coalesce(
  (
    select jsonb_agg(
      jsonb_build_object(
        'provider', r.provider,
        'modelId', m
      )
      order by ord
    )
    from unnest(r.fallback_models) with ordinality as t(m, ord)
  ),
  '[]'::jsonb
);

-- 3) Drop old text[] column and rename.
alter table public.ai_model_routes
  drop column fallback_models;

alter table public.ai_model_routes
  rename column fallback_models_v2 to fallback_models;

-- 4) Validate shape via trigger (CHECK cannot use subqueries here).
create or replace function public.ai_model_routes_validate_fallbacks()
returns trigger
language plpgsql
as $$
declare
  e jsonb;
  p text;
  m text;
begin
  if jsonb_typeof(new.fallback_models) is distinct from 'array' then
    raise exception 'fallback_models must be a jsonb array';
  end if;

  for e in select value from jsonb_array_elements(new.fallback_models)
  loop
    if jsonb_typeof(e) is distinct from 'object' then
      raise exception 'fallback_models entries must be objects';
    end if;
    p := coalesce(e->>'provider', '');
    m := coalesce(e->>'modelId', '');
    if p = '' or m = '' then
      raise exception 'fallback_models entry requires provider and modelId';
    end if;
    if p not in ('custom', 'openrouter', '9router', 'gateway', 'deterministic') then
      raise exception 'fallback_models provider % is not allowed', p;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists ai_model_routes_fallback_models_trg on public.ai_model_routes;
create trigger ai_model_routes_fallback_models_trg
  before insert or update of fallback_models on public.ai_model_routes
  for each row
  execute function public.ai_model_routes_validate_fallbacks();
