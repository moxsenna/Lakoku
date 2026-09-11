-- M10-E E5 Blueprint Review Queue
-- Exactly one active review record per story/source incident.

CREATE TABLE public.blueprint_queue (
  story_id text PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CLAIMED', 'RESOLVED', 'BLOCKED')),
  chapter_numbers integer[] NOT NULL,
  act_boundary text NOT NULL CHECK (act_boundary IN ('ACT_1', 'ACT_2', 'ACT_3')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  provider_call_id text,
  retry_count integer NOT NULL DEFAULT 0,
  brand_scan_hash text,
  lease_id uuid,
  source_event_id bigint NOT NULL REFERENCES public.story_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT blueprint_queue_chapters_nonempty_check
    CHECK (pg_catalog.cardinality(chapter_numbers) > 0),
  CONSTRAINT blueprint_queue_chapters_range_check
    CHECK (0 < ALL (chapter_numbers) AND 51 > ALL (chapter_numbers))
);

CREATE INDEX idx_blueprint_queue_status_pending
  ON public.blueprint_queue(status)
  WHERE status IN ('PENDING', 'CLAIMED');
CREATE INDEX idx_blueprint_queue_created_asc
  ON public.blueprint_queue(created_at ASC)
  WHERE status = 'PENDING';

COMMENT ON TABLE public.blueprint_queue IS
  'Exactly-once human review queue for failed story generation incidents (E-OPS-1)';
COMMENT ON COLUMN public.blueprint_queue.source_event_id IS
  'Required source story event; event/story consistency is enforced by e5_record_disposition';

ALTER TABLE public.blueprint_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.blueprint_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.blueprint_queue TO service_role;
