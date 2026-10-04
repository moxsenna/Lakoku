-- Story-level creative direction snapshot (taste + story setup at creation time).
-- Reader clients do not need raw direction; service role loads for generation.

create table if not exists public.story_creative_directions (
  story_id text primary key references public.stories(id) on delete cascade,
  owner_user_id uuid not null /* auth.users fk removed */,
  version int not null default 1,
  direction_json jsonb not null,
  direction_fingerprint text not null,
  prompt_contract_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create index if not exists story_creative_directions_owner_idx
  on public.story_creative_directions(owner_user_id);


-- Owner can read own direction via authenticated session if ever needed by server actions.
drop policy if exists scd_owner_read on public.story_creative_directions;