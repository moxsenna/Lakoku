-- Migration: 20261004000000_live_drift_capture.sql
-- Description: Capture live Supabase schema drift (content_reports table and record_content_report_v1 function)
-- Source: Supabase live database introspection (PG 17.6)

CREATE TABLE IF NOT EXISTS public.content_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id text NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
    chapter_number integer NOT NULL CHECK (chapter_number >= 1),
    reporter_id uuid,
    category text NOT NULL,
    note text,
    canonical_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'OPEN'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_reports_story_chapter_idx
    ON public.content_reports USING btree (story_id, chapter_number);

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

  -- seq monotonic per-story (append-only event ledger).
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
