-- Normalize accepted authoring story claim text while rejecting raw padding bypasses.
-- Same signature; ownership remains conditional and atomic.

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
  with normalized as (
    select
      btrim(p_story_id) as story_id,
      btrim(p_title) as title,
      btrim(p_cover) as cover,
      btrim(p_tagline) as tagline,
      btrim(p_role) as role,
      btrim(p_synopsis) as synopsis,
      case
        when jsonb_typeof(p_tropes) = 'array' then (
          select jsonb_agg(to_jsonb(btrim(trope.value #>> '{}')) order by trope.ordinality)
          from jsonb_array_elements(p_tropes) with ordinality as trope(value, ordinality)
        )
        else null
      end as tropes
    where p_owner_user_id is not null
      and char_length(p_story_id) <= 128
      and char_length(btrim(p_story_id)) >= 1
      and char_length(p_cover) <= 2048
      and char_length(btrim(p_cover)) >= 1
      and char_length(p_title) <= 80
      and char_length(btrim(p_title)) >= 3
      and char_length(p_tagline) <= 160
      and char_length(btrim(p_tagline)) >= 10
      and char_length(p_role) <= 80
      and char_length(btrim(p_role)) >= 3
      and char_length(p_synopsis) <= 700
      and char_length(btrim(p_synopsis)) >= 60
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
          or char_length(trope.value #>> '{}') > 40
          or char_length(btrim(trope.value #>> '{}')) not between 2 and 40
      )
      and p_total_chapters = 50
  ),
  claimed as (
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
      normalized.story_id,
      normalized.title,
      normalized.cover,
      normalized.tagline,
      normalized.role,
      normalized.tropes,
      p_total_chapters,
      normalized.synopsis,
      'BARU',
      0,
      '[]'::jsonb,
      null,
      p_owner_user_id,
      'private'
    from normalized
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
) is 'Service-only atomic authoring shell claim with raw bounds and normalized text. Existing null or different owners are never claimable.';
