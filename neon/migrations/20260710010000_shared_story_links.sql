-- AMENDMENTS v0.5 — LD-SHARE-MVP / LD-SHARE-PRIVACY
-- Public clients read sanitized teaser only; never source playthrough prose.

create table if not exists public.shared_story_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null /* auth.users fk removed */,
  source_story_id text not null references public.stories (id) on delete cascade,
  share_slug text not null,
  share_type text not null default 'ending_card',
  visibility text not null default 'unlisted',
  title text not null,
  teaser_json jsonb not null default '{}'::jsonb,
  spoiler_level text not null default 'none',
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint shared_story_links_share_type_check
    check (share_type in ('ending_card', 'story_seed', 'challenge')),
  constraint shared_story_links_visibility_check
    check (visibility in ('unlisted', 'public')),
  constraint shared_story_links_spoiler_level_check
    check (spoiler_level in ('none', 'mild', 'heavy'))
);


create unique index if not exists shared_story_links_share_slug_uidx
  on public.shared_story_links (share_slug);


create index if not exists shared_story_links_owner_idx
  on public.shared_story_links (owner_user_id, created_at desc);


create index if not exists shared_story_links_public_idx
  on public.shared_story_links (created_at desc)
  where visibility = 'public' and revoked_at is null;


create table if not exists public.shared_story_starts (
  id uuid primary key default gen_random_uuid(),
  shared_link_id uuid not null references public.shared_story_links (id) on delete cascade,
  new_user_id uuid not null /* auth.users fk removed */,
  new_story_id text null references public.stories (id) on delete set null,
  started_at timestamptz not null default now()
);


create index if not exists shared_story_starts_link_idx
  on public.shared_story_starts (shared_link_id, started_at desc);


create index if not exists shared_story_starts_user_idx
  on public.shared_story_starts (new_user_id, started_at desc);


-- Active share teaser: readable by anyone (anon + authenticated).
drop policy if exists shared_story_links_select_active on public.shared_story_links;


-- Owner manages own shares.
drop policy if exists shared_story_links_insert_owner on public.shared_story_links;


drop policy if exists shared_story_links_update_owner on public.shared_story_links;


-- Starts: user can insert own row; select own rows.
drop policy if exists shared_story_starts_insert_self on public.shared_story_starts;


drop policy if exists shared_story_starts_select_self on public.shared_story_starts;


comment on table public.shared_story_links is
  'Sanitized share cards. Never grant public read on source story instance via this id.';

comment on column public.shared_story_links.teaser_json is
  'Public-safe payload only: title, tagline, tropes, cover, endingName, bigChoices, cta.';

comment on table public.shared_story_starts is
  'Conversion audit when recipient starts a NEW playthrough from a share.';