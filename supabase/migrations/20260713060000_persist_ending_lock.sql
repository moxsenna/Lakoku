-- Atomically persist ending lock on reader_states + story_generation_contracts.

create or replace function public.persist_ending_lock_v1(
  p_user_id uuid,
  p_story_id text,
  p_ending_key text,
  p_ending_name text,
  p_chapter_number integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lock jsonb;
  v_updated_reader integer := 0;
  v_updated_contract integer := 0;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER_ID';
  end if;
  if p_story_id is null
    or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;
  if p_ending_key is null
    or p_ending_key = ''
    or p_ending_key <> pg_catalog.btrim(p_ending_key)
    or pg_catalog.char_length(p_ending_key) > 80 then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_KEY';
  end if;
  if p_ending_name is null
    or p_ending_name = ''
    or p_ending_name <> pg_catalog.btrim(p_ending_name)
    or pg_catalog.char_length(p_ending_name) > 160 then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_NAME';
  end if;
  if p_chapter_number is null or p_chapter_number < 1 or p_chapter_number > 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;

  -- Serialize lock writes for one reader/story pair.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id || ':' || p_user_id::text, 130600)
  );

  v_lock := pg_catalog.jsonb_build_object(
    'key', p_ending_key,
    'name', p_ending_name,
    'lockedAtChapter', p_chapter_number
  );

  update public.reader_states as rs
  set
    locked_ending_key = p_ending_key,
    updated_at = pg_catalog.now()
  where rs.user_id = p_user_id
    and rs.story_id = p_story_id;
  get diagnostics v_updated_reader = row_count;

  update public.story_generation_contracts as c
  set
    ending_lock_json = v_lock,
    updated_at = pg_catalog.now()
  where c.story_id = p_story_id;
  get diagnostics v_updated_contract = row_count;

  if v_updated_reader = 0 then
    raise exception using errcode = 'P0002', message = 'READER_STATE_MISSING';
  end if;
  if v_updated_contract = 0 then
    raise exception using errcode = 'P0002', message = 'CONTRACT_MISSING';
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.persist_ending_lock_v1(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.persist_ending_lock_v1(uuid, text, text, text, integer)
  to service_role;
