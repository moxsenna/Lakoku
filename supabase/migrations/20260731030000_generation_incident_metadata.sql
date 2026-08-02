-- Owner-only, read-only discovery of a short-lived encrypted incident capture identity.
-- This intentionally returns no encrypted envelope, fingerprint, claim state, or plaintext.

create function public.find_generation_incident_metadata_v1(
  p_story_id text,
  p_chapter_number integer,
  p_from timestamptz,
  p_to timestamptz
)
returns table (capture_id uuid, correlation_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if v_actor is null or not exists (
    select 1 from public.admin_users as admins
    where admins.user_id = v_actor and admins.role = 'owner'
  ) then
    raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED';
  end if;

  if p_story_id is null
    or p_chapter_number is null
    or p_from is null
    or p_to is null
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.length(p_story_id) not between 1 and 200
    or p_story_id ~ '[[:cntrl:]]'
    or p_chapter_number not between 1 and 49
    or p_from >= p_to
    or p_to - p_from > interval '60 minutes' then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_METADATA_LOOKUP';
  end if;

  return query
  select captures.capture_id, captures.correlation_id
  from private.generation_incident_captures as captures
  where captures.story_id = p_story_id
    and captures.chapter_number = p_chapter_number
    and captures.created_at >= p_from
    and captures.created_at < p_to
    and captures.consumed_at is null
    and captures.expires_at > v_now
    and captures.stage = 'FINAL_BRANCH_SCHEMA'
    and captures.code = 'CHOICE_NOT_ACTIONABLE'
  order by captures.created_at asc, captures.capture_id asc
  limit 1;
end
$$;

revoke all on function public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz) to authenticated;
