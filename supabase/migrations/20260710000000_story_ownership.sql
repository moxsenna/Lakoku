-- AMENDMENTS v0.5 — LD-STORY-OWNERSHIP (interim shell ownership on `stories`).
-- Expand-only: add owner + visibility; backfill demos as public; user shells private.
-- Full rename to story_instances can follow later (expand → backfill → switch).

alter table public.stories
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

alter table public.stories
  add column if not exists visibility text not null default 'private';

-- Constrain visibility values (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stories_visibility_check'
  ) then
    alter table public.stories
      add constraint stories_visibility_check
      check (visibility in ('private', 'unlisted', 'public'));
  end if;
end $$;

-- Official demos (id prefix demo:) stay publicly listable for Jelajahi.
update public.stories
set visibility = 'public'
where id like 'demo:%';

-- Non-demo shells without owner: keep private so they leave the global "my library" lie.
update public.stories
set visibility = 'private'
where id not like 'demo:%'
  and (visibility is null or visibility = 'private' or owner_user_id is null);

create index if not exists stories_owner_user_id_idx
  on public.stories (owner_user_id, created_at desc);

create index if not exists stories_visibility_idx
  on public.stories (visibility)
  where visibility = 'public';

comment on column public.stories.owner_user_id is
  'Playthrough owner (AMENDMENTS v0.5). Null = orphan/demo/legacy.';
comment on column public.stories.visibility is
  'private | unlisted | public. Jelajahi lists official demos + public shares later.';
