-- Harden atomic authoring story claims with strict server-bound payload limits.
-- Same signature as 20260713005000; ownership remains conditional and atomic.

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
    where p_owner_user_id is not null
      and char_length(btrim(p_story_id)) between 1 and 128
      and char_length(btrim(p_cover)) between 1 and 2048
      and char_length(btrim(p_title)) between 3 and 80
      and char_length(btrim(p_tagline)) between 10 and 160
      and char_length(btrim(p_role)) between 3 and 80
      and char_length(btrim(p_synopsis)) between 60 and 700
      and case
        when jsonb_typeof(p_tropes) = 'array'
          then jsonb_array_length(p_tropes) between 2 and 5
        else false
      end
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(p_tropes) = 'array' then p_tropes else '[]'::jsonb end
        ) as trope(value)
        where jsonb_typeof(trope.value) <> 'string'
          or char_length(btrim(trope.value #>> '{}')) not between 2 and 40
      )
      and p_total_chapters = 50
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
) is 'Service-only atomic authoring shell claim with strict payload bounds. Existing null or different owners are never claimable.';
