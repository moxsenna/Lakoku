-- Audit NIT: kunci per-story sebelum perhitungan seq di record_content_report_v1.
--
-- Dua report konten bersamaan pada cerita yang sama menghitung MAX(seq)+1
-- yang sama dan menabrak UNIQUE (story_id, seq) → exception. Pattern retry
-- sudah ada di sisi TS (appendStoryEvent), tapi jalur RPC ini tidak — kunci
-- advisory per-story menutupnya di sumber.

CREATE OR REPLACE FUNCTION public.record_content_report_v1(
    p_story_id text,
    p_chapter_number integer,
    p_reporter_id uuid,
    p_category text,
    p_note text,
    p_canonical_refs jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_report_id uuid;
  v_next_seq integer;
begin
  if p_story_id is null or p_chapter_number is null or p_chapter_number < 1 then
    raise exception 'invalid_report_args';
  end if;
  if not exists (select 1 from public.stories s where s.id = p_story_id) then
    raise exception 'unknown_story';
  end if;

  insert into public.content_reports
    (story_id, chapter_number, reporter_id, category, note, canonical_refs)
  values
    (p_story_id, p_chapter_number, p_reporter_id, p_category, p_note,
     coalesce(p_canonical_refs, '{}'::jsonb))
  returning id into v_report_id;

  -- Audit NIT: kunci per-story sebelum MAX(seq)+1 (append-only ledger).
  perform pg_advisory_xact_lock(hashtext('story_events:' || p_story_id));

  select coalesce(max(seq), 0) + 1 into v_next_seq
  from public.story_events where story_id = p_story_id;

  insert into public.story_events (story_id, seq, type, payload)
  values (
    p_story_id,
    v_next_seq,
    'REPORT_FILED',
    jsonb_build_object(
      'report_id', v_report_id,
      'chapter_number', p_chapter_number,
      'category', p_category,
      'canonical_refs', coalesce(p_canonical_refs, '{}'::jsonb)
    )
  );

  return v_report_id;
end;
$function$;
