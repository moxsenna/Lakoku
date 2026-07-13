-- Atomically create or refresh an authoring story shell without transferring ownership.
-- Callable only by service_role; caller supplies owner from verified server-side auth.

create or replace function public.claim_authoring_story_shell_v1(
  p_story_id text,
  p_owner_user_id uuid,
  p_title text,
  p_cover text,
  p_tagline text,
  p_role text,
  p_tropes jsonb,
  p_total_chapters integer,
  p_synopsis text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  with claimed as (
    insert into public.stories (
      id,
      title,
      cover,
      tagline,
      role,
      tropes,
      total_chapters,
      synopsis,
      status,
      current_chapter,
      jejak,
      ending_name,
      owner_user_id,
      visibility
    )
    select
      p_story_id,
      p_title,
      p_cover,
      p_tagline,
      p_role,
      p_tropes,
      p_total_chapters,
      p_synopsis,
      'BARU',
      0,
      '[]'::jsonb,
      null,
      p_owner_user_id,
      'private'
    where p_story_id is not null
      and btrim(p_story_id) <> ''
      and p_owner_user_id is not null
      and p_title is not null
      and btrim(p_title) <> ''
      and p_cover is not null
      and btrim(p_cover) <> ''
      and p_tagline is not null
      and btrim(p_tagline) <> ''
      and p_role is not null
      and btrim(p_role) <> ''
      and p_tropes is not null
      and jsonb_typeof(p_tropes) = 'array'
      and not jsonb_path_exists(p_tropes, '$[*] ? (@.type() != "string")')
      and p_total_chapters between 1 and 1000
      and p_synopsis is not null
      and btrim(p_synopsis) <> ''
    on conflict (id) do update
    set title = excluded.title,
        cover = excluded.cover,
        tagline = excluded.tagline,
        role = excluded.role,
        tropes = excluded.tropes,
        total_chapters = excluded.total_chapters,
        synopsis = excluded.synopsis
    where public.stories.owner_user_id = p_owner_user_id
    returning true
  )
  select coalesce((select true from claimed limit 1), false);
$$;

revoke all on function public.claim_authoring_story_shell_v1(
  text, uuid, text, text, text, text, jsonb, integer, text
) from public;
revoke all on function public.claim_authoring_story_shell_v1(
  text, uuid, text, text, text, text, jsonb, integer, text
) from anon;
revoke all on function public.claim_authoring_story_shell_v1(
  text, uuid, text, text, text, text, jsonb, integer, text
) from authenticated;
grant execute on function public.claim_authoring_story_shell_v1(
  text, uuid, text, text, text, text, jsonb, integer, text
) to service_role;

comment on function public.claim_authoring_story_shell_v1(
  text, uuid, text, text, text, text, jsonb, integer, text
) is 'Service-only atomic authoring shell claim. Existing null or different owners are never claimable.';
