-- M10-E E5 Blueprint Review Queue
-- Purpose: Exactly-once review queue for failed story generation incidents
-- Authority: E-OPS-1 acceptance criteria (human blueprint workflow)
-- Boundary: NO novel lifecycle CRUD, NO budget authority tracking, NO multi-tier architecture

DO $$
BEGIN
  -- Idempotency guard: check if this migration already exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blueprint_queue') THEN
    RAISE NOTICE 'blueprint_queue table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE TABLE public.blueprint_queue (
  -- Primary key = story identity exactly once per incident review
  story_id text NOT NULL PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE,
  
  -- Status tracking: PENDING → CLAIMED → RESOLVED or BLOCKED
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CLAIMED', 'RESOLVED', 'BLOCKED')),
  
  -- Chapter numbers affected by this incident (may span multiple chapters across act boundary)
  chapter_numbers integer[] NOT NULL,
  
  -- Act boundary classification for escalation routing
  act_boundary text NOT NULL CHECK (act_boundary IN ('ACT_1', 'ACT_2', 'ACT_3')),
  
  -- JSON payload of failure findings from runtime incident capture
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Consumer claim tracking (advisory lock + thread ID for exactly-once guarantee)
  claimed_by text,
  claimed_at timestamptz,
  
  -- Source event metadata for evidence binding (required, no null allowed)
  provider_call_id text,
  retry_count integer DEFAULT 0,
  brand_scan_hash text,
  lease_id uuid,
  source_event_id bigint NOT NULL REFERENCES public.story_events(id),
  
  -- Creation timestamp
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient queue processing
CREATE INDEX idx_blueprint_queue_status_pending ON public.blueprint_queue(status) WHERE status IN ('PENDING', 'CLAIMED');
CREATE INDEX idx_blueprint_queue_created_asc ON public.blueprint_queue(created_at ASC) WHERE status = 'PENDING';

-- Comments for documentation
COMMENT ON TABLE public.blueprint_queue IS 'Exactly-once human review queue for failed story generation incidents (E-OPS-1)';
COMMENT ON COLUMN public.blueprint_queue.story_id IS 'FK to public.stories(id); TEXT type matches frozen baseline';
COMMENT ON COLUMN public.blueprint_queue.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); missing real event => fail closed';

-- Enable Row Level Security
ALTER TABLE public.blueprint_queue ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (proper PostgreSQL syntax)
DROP POLICY IF EXISTS "blueprint_queue_anon_select" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_service_role" ON public.blueprint_queue;

CREATE POLICY "blueprint_queue_anon_select" 
  ON public.blueprint_queue FOR SELECT TO anon USING (true);

CREATE POLICY "blueprint_queue_service_role" 
  ON public.blueprint_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grant permissions
REVOKE ALL ON TABLE public.blueprint_queue FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blueprint_queue TO service_role;
GRANT INSERT, UPDATE ON TABLE public.blueprint_queue TO service_role;
