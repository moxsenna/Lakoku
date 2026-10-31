-- Align choices route to chapter_prose primary/fallbacks; extend generation_policy.

-- 1) Policy columns (safe defaults match current code/env)
alter table public.generation_policy
  add column if not exists lease_ttl_seconds integer not null default 300,
  add column if not exists max_concurrent_generations integer not null default 10,
  add column if not exists max_concurrent_generations_per_user integer not null default 1,
  add column if not exists generation_max_queue integer not null default 40;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_lease_ttl_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_lease_ttl_check
      check (lease_ttl_seconds between 60 and 1800);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_concurrent_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_concurrent_check
      check (max_concurrent_generations between 1 and 64);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_per_user_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_per_user_check
      check (max_concurrent_generations_per_user between 1 and 8);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'generation_policy_max_queue_check'
  ) then
    alter table public.generation_policy
      add constraint generation_policy_max_queue_check
      check (generation_max_queue between 0 and 500);
  end if;
end $$;

-- 2) Align choices → chapter_prose (primary + fallbacks only; keep temp/max if set)
update public.ai_model_routes as choices
set
  provider = prose.provider,
  model_id = prose.model_id,
  fallback_models = prose.fallback_models,
  route_version = '2026-07-22-align-choices-to-prose',
  notes = coalesce(choices.notes, '') || ' | aligned primary/fallbacks to chapter_prose',
  is_active = true,
  updated_at = now()
from public.ai_model_routes as prose
where choices.use_case = 'choices'
  and prose.use_case = 'chapter_prose'
  and prose.is_active = true;
