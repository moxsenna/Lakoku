-- Add personalized story storage without replacing legacy story data or lifecycle RPCs.

alter table public.stories
  add column if not exists source_story_id text null,
  add column if not exists story_mode text not null default 'standard',
  add column if not exists generation_status text not null default 'idle',
  add column if not exists story_contract_version integer not null default 1;

alter table public.reader_states
  add column if not exists route_state jsonb not null default '{}'::jsonb,
  add column if not exists choice_history jsonb not null default '[]'::jsonb,
  add column if not exists locked_ending_key text null;

alter table public.choice_outcomes
  add column if not exists effect_json jsonb not null default '{}'::jsonb,
  add column if not exists choice_kind text not null default 'normal';

-- Constraint checks include relation identity because constraint names are not schema-global.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_story_mode_check'
  ) then
    alter table public.stories
      add constraint stories_story_mode_check
      check (story_mode in ('standard', 'personalized_ai', 'premium_template', 'premium_instance'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_generation_status_check'
  ) then
    alter table public.stories
      add constraint stories_generation_status_check
      check (generation_status in ('idle', 'creating_contract', 'generating_chapter', 'ready', 'failed', 'needs_review'));
  end if;
end
$$;

create table if not exists public.story_generation_contracts (
  story_id text primary key references public.stories(id) on delete cascade,
  mode text not null check (mode in ('personalized_ai', 'premium_template', 'premium_instance')),
  total_chapters integer not null default 50 check (total_chapters = 50),
  contract_source text not null default 'template_fallback'
    check (contract_source in ('llm', 'llm_repaired', 'template_fallback')),
  onboarding_json jsonb not null default '{}'::jsonb,
  story_contract_json jsonb not null default '{}'::jsonb,
  route_schema_json jsonb not null default '{}'::jsonb,
  plot_debts_json jsonb not null default '[]'::jsonb,
  ending_candidates_json jsonb not null default '[]'::jsonb,
  ending_lock_json jsonb null,
  quality_profile text not null default 'lakoku_mobile_drama_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_creation_requests (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  request_kind text not null check (request_kind in ('personalized', 'premium_clone')),
  idempotency_key text not null,
  request_hash text not null,
  story_id text not null,
  status text not null check (status in ('RESERVED', 'READY', 'FAILED')),
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, request_kind, idempotency_key),
  unique (story_id)
);

create index if not exists stories_source_story_idx
  on public.stories(source_story_id);

create index if not exists stories_owner_mode_idx
  on public.stories(owner_user_id, story_mode, created_at desc);

create index if not exists choice_outcomes_effect_idx
  on public.choice_outcomes(story_id, chapter_number);

alter table public.stories enable row level security;
alter table public.chapters enable row level security;
alter table public.choice_outcomes enable row level security;
alter table public.reader_states enable row level security;
alter table public.story_generation_contracts enable row level security;
alter table public.story_creation_requests enable row level security;

-- Child-table policies cannot inspect ungranted story ownership columns as invoker.
-- Narrow SECURITY DEFINER predicates preserve column privacy without granting those columns.
create or replace function public.story_is_public(p_story_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    where s.id = p_story_id
      and s.visibility = 'public'
  );
$$;

create or replace function public.story_is_owned_by_auth(p_story_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    where s.id = p_story_id
      and s.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.story_is_public(text) from public, anon, authenticated;
revoke all on function public.story_is_owned_by_auth(text) from public, anon, authenticated;
grant execute on function public.story_is_public(text) to anon, authenticated;
grant execute on function public.story_is_owned_by_auth(text) to authenticated;

-- Exact linked policies below were permissive. Replacing them is required because
-- adding another permissive policy cannot narrow an existing USING (true) policy.
drop policy if exists stories_public_read on public.stories;
drop policy if exists stories_owner_read on public.stories;
create policy stories_public_read on public.stories
  for select to anon, authenticated
  using (visibility = 'public');
create policy stories_owner_read on public.stories
  for select to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists chapters_public_read on public.chapters;
drop policy if exists chapters_owner_read on public.chapters;
create policy chapters_public_read on public.chapters
  for select to anon, authenticated
  using (public.story_is_public(story_id));
create policy chapters_owner_read on public.chapters
  for select to authenticated
  using (public.story_is_owned_by_auth(story_id));

drop policy if exists choice_outcomes_public_read on public.choice_outcomes;
drop policy if exists choice_outcomes_owner_read on public.choice_outcomes;
create policy choice_outcomes_public_read on public.choice_outcomes
  for select to anon, authenticated
  using (public.story_is_public(story_id));
create policy choice_outcomes_owner_read on public.choice_outcomes
  for select to authenticated
  using (public.story_is_owned_by_auth(story_id));

-- Reconcile four exact linked owner policies into approved single owner policy.
drop policy if exists reader_states_delete_own on public.reader_states;
drop policy if exists reader_states_insert_own on public.reader_states;
drop policy if exists reader_states_select_own on public.reader_states;
drop policy if exists reader_states_update_own on public.reader_states;
drop policy if exists reader_states_owner on public.reader_states;
create policy reader_states_owner on public.reader_states
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists sgc_owner_read on public.story_generation_contracts;
create policy sgc_owner_read on public.story_generation_contracts
  for select to authenticated
  using (public.story_is_owned_by_auth(story_id));

-- Revoke inherited/default broad grants before granting only reader-contract columns.
-- RLS predicates may reference ungranted internal columns such as visibility and owner_user_id.
revoke all on table public.stories from public, anon, authenticated;
revoke all on table public.chapters from public, anon, authenticated;
revoke all on table public.choice_outcomes from public, anon, authenticated;
revoke all on table public.reader_states from public, anon, authenticated;
revoke all on table public.story_generation_contracts from public, anon, authenticated;
revoke all on table public.story_creation_requests from public, anon, authenticated;

grant select (
  id, title, cover, tagline, role, tropes, total_chapters, synopsis,
  status, current_chapter, jejak, ending_name
) on public.stories to anon, authenticated;

grant select (
  story_id, number, title, paragraphs, choice_prompt, choices
) on public.chapters to anon, authenticated;

grant select (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending
) on public.choice_outcomes to anon, authenticated;

grant select (
  user_id, story_id, status, current_chapter, jejak, ending_name, updated_at
) on public.reader_states to anon, authenticated;
grant insert (
  user_id, story_id, status, current_chapter, jejak, ending_name, updated_at
) on public.reader_states to authenticated;
grant update (
  user_id, story_id, status, current_chapter, jejak, ending_name, updated_at
) on public.reader_states to authenticated;
grant delete on table public.reader_states to authenticated;

-- Explicit service-role grants support local baselines without relying on default grants.
grant all on table public.stories to service_role;
grant all on table public.chapters to service_role;
grant all on table public.choice_outcomes to service_role;
grant all on table public.reader_states to service_role;
grant all on table public.story_generation_contracts to service_role;
grant all on table public.story_creation_requests to service_role;
