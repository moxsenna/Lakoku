-- Idempotent repair: ensure creative-direction table + generation_policy columns.
-- Does NOT overwrite story_generation_contracts with empty payloads.
-- Does NOT drop data. Safe if either 20260722090000_* intent already applied.

-- 1) story_creative_directions (from creative_directions migration intent)
create table if not exists public.story_creative_directions (
  story_id text primary key references public.stories(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  direction_json jsonb not null,
  direction_fingerprint text not null,
  prompt_contract_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists story_creative_directions_owner_idx
  on public.story_creative_directions(owner_user_id);

alter table public.story_creative_directions enable row level security;

drop policy if exists scd_owner_read on public.story_creative_directions;
create policy scd_owner_read on public.story_creative_directions
  for select
  to authenticated
  using (owner_user_id = auth.uid());

revoke all on table public.story_creative_directions from public, anon, authenticated;
grant select on table public.story_creative_directions to authenticated;
grant all on table public.story_creative_directions to service_role;

-- 2) generation_policy columns (from align_choices migration intent)
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

-- 3) Ensure choices route exists and is active when chapter_prose is present.
-- Only updates primary/fallbacks alignment; never wipes generation contracts.
update public.ai_model_routes as choices
set
  provider = prose.provider,
  model_id = prose.model_id,
  fallback_models = prose.fallback_models,
  route_version = '2026-07-24-reconcile-choices',
  notes = coalesce(choices.notes, '') || ' | reconcile 20260724100000',
  is_active = true,
  updated_at = now()
from public.ai_model_routes as prose
where choices.use_case = 'choices'
  and prose.use_case = 'chapter_prose'
  and prose.is_active = true
  and (
    choices.provider is distinct from prose.provider
    or choices.model_id is distinct from prose.model_id
    or choices.fallback_models is distinct from prose.fallback_models
    or choices.is_active is distinct from true
  );
