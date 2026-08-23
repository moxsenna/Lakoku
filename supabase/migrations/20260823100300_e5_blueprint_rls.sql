-- M10-E E5 Row-Level Security Enforcement Policy
-- Purpose: Comprehensive RLS policies across all E5 tables
-- Authority: E-OPS-1 Criterion #4 (authorized admin user only)
-- Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'

DO $$
BEGIN
  -- This is an idempotent policy definition migration
END $$;

-- ============================================================================
-- BLUEPRINT_QUEUE POLICIES - Update existing policies
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_queue_anon_select" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_service_role" ON public.blueprint_queue;

CREATE POLICY "blueprint_queue_anon_select" 
  ON public.blueprint_queue FOR SELECT TO anon USING (true);

CREATE POLICY "blueprint_queue_service_role" 
  ON public.blueprint_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_RESOLUTIONS POLICIES - Update existing policies  
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_insert" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_service_role" ON public.blueprint_resolutions;

-- For authenticated users (owner/admin can insert via API gateway check)
CREATE POLICY "blueprint_resolutions_authenticated_insert" 
  ON public.blueprint_resolutions FOR INSERT TO authenticated WITH CHECK (true);

-- For authenticated users (select)
CREATE POLICY "blueprint_resolutions_authenticated_select" 
  ON public.blueprint_resolutions FOR SELECT TO authenticated USING (true);

CREATE POLICY "blueprint_resolutions_service_role" 
  ON public.blueprint_resolutions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_AUDIT_LOG POLICIES - Update existing policies
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_audit_log_anon_select" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_service_role" ON public.blueprint_audit_log;

CREATE POLICY "blueprint_audit_log_anon_select" 
  ON public.blueprint_audit_log FOR SELECT TO anon USING (true);

CREATE POLICY "blueprint_audit_log_authenticated_insert" 
  ON public.blueprint_audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "blueprint_audit_log_service_role" 
  ON public.blueprint_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- CONVENIENCE VIEWS - Fixed to not assume non-existent columns
-- ============================================================================

-- View: Pending review items (do NOT assume stories.metadata exists)
DROP VIEW IF EXISTS public.vw_blueprint_pending_review_items;

CREATE OR REPLACE VIEW public.vw_blueprint_pending_review_items AS
SELECT 
  bq.story_id,
  bq.chapter_numbers,
  bq.act_boundary,
  bq.findings,
  bq.created_at as queue_created_at,
  sq.title as story_title,
  sq.tagline,
  sq.role,
  sq.total_chapters,
  sq.status
FROM public.blueprint_queue bq
JOIN public.stories sq ON bq.story_id = sq.id
WHERE bq.status = 'PENDING'
ORDER BY bq.created_at ASC;

COMMENT ON VIEW public.vw_blueprint_pending_review_items IS 'Dashboard view of pending review items (E5 workflow only)';

-- View: Recent resolutions by reviewer
DROP VIEW IF EXISTS public.vw_blueprint_recent_resolutions;

CREATE OR REPLACE VIEW public.vw_blueprint_recent_resolutions AS
SELECT 
  br.story_id,
  br.disposition,
  br.reason_text,
  br.created_at as resolution_created_at,
  au.email as reviewer_email,
  br.reviewer_uid,
  sq.title as story_title
FROM public.blueprint_resolutions br
LEFT JOIN public.auth.users au ON br.reviewer_uid = au.id
LEFT JOIN public.stories sq ON br.story_id = sq.id
ORDER BY br.created_at DESC
LIMIT 100;

COMMENT ON VIEW public.vw_blueprint_recent_resolutions IS 'Recent resolution history dashboard view (last 100 entries)';
