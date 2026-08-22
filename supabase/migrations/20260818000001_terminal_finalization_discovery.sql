-- Terminal Finalization Discovery Helper (J: Replacement for reconcile RPC)
-- 
-- ONLY discovers terminal jobs with matching ACTIVE reservations.
-- Does NOT mutate anything.
-- Used by runtime recovery tick.

create or replace function public.list_terminal_commercial_finalization_candidates_v1(
  p_batch_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb := '[]'::jsonb;
  
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 200 then
    return pg_catalog.jsonb_build_object('candidates', v_results, 'count', 0);
  end if;
  
  -- Discover terminal jobs with matching ACTIVE reservations
  -- Uses SKIP LOCKED for safe concurrent discovery
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'job_id', gj.id,
      'user_id', gj.user_id,
      'story_id', gj.story_id,
      'chapter_number', gj.chapter_number,
      'status', gj.status
    )
  ) into v_results
  from (
    select gj.id, gj.user_id, gj.story_id, gj.chapter_number, gj.status
    from public.generation_jobs gj
    where gj.status in ('FAILED', 'CANCELLED')
    and exists (
      select 1 from public.credit_reservations r
      where r.user_id = gj.user_id
        and r.story_id = gj.story_id
        and coalesce(r.chapter_number, 0) = coalesce(gj.chapter_number, 0)
        and r.status = 'ACTIVE'
        and (
          -- STORY_START pattern
          (r.reservation_kind = 'STORY_START' 
            and coalesce(r.chapter_number, 0) = 1
            and gj.chapter_number = 1)
          or
          -- CHAPTER_UNLOCK pattern
          (r.reservation_kind = 'CHAPTER_UNLOCK'
            and r.chapter_number = gj.chapter_number)
        )
    )
    order by gj.updated_at asc
    limit p_batch_size
    for update skip locked
  ) candidates;
  
  return pg_catalog.jsonb_build_object(
    'candidates', coalesce(v_results, '[]'::jsonb),
    'count', coalesce(pg_catalog.jsonb_array_length(v_results), 0)
  );
end;
$$;

-- Grant execute to service_role only
revoke all on function public.list_terminal_commercial_finalization_candidates_v1(integer) from public, anon, authenticated;
grant execute on function public.list_terminal_commercial_finalization_candidates_v1(integer) to service_role;
