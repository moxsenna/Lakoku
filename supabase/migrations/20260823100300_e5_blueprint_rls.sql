-- M10-E E5 Row-Level Security Enforcement Policy
-- Purpose: Comprehensive RLS policies across all E5 tables
-- Authority: E-OPS-1 Criterion #4 (authorized admin user only)
-- Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'

DO $$
BEGIN
  -- This is an idempotent policy definition migration
  -- Existing policies will be dropped and recreated if needed
END $$;

-- ============================================================================
-- BLUEPRINT_QUEUE POLICIES
-- ============================================================================

-- Drop existing policies if they exist (idempotency)
DROP POLICY IF EXISTS "blueprint_queue_anon_read" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_service_role" ON public.blueprint_queue;

-- Create new policies with explicit authorization semantics
CREATE POLICY "blueprint_queue_anon_read" ON public.blueprint_queue
  FOR SELECT TO anon
  USING (true) WITH CHECK (false);
  
CREATE POLICY "blueprint_queue_admin_select" ON public.blueprint_queue
  FOR SELECT TO authenticated
  USING (
    -- Only authorized admin users can read queue items
    EXISTS (
      SELECT 1 FROM public.admin_users AS admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('owner', 'admin')
    )
  ) WITH CHECK (false);
  
CREATE POLICY "blueprint_queue_service_role" ON public.blueprint_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_RESOLUTIONS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_resolutions_public_read" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_anon_insert" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_write" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_service_role" ON public.blueprint_resolutions;

CREATE POLICY "blueprint_resolutions_admin_insert" ON public.blueprint_resolutions
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Only authorized admin users can record dispositions
    EXISTS (
      SELECT 1 FROM public.admin_users AS admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('owner', 'admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.blueprint_queue
      WHERE blueprint_queue.story_id = new.story_id
      AND blueprint_queue.status != 'RESOLVED' -- Cannot resolve already-resolved item
    )
  );
  
CREATE POLICY "blueprint_resolutions_admin_select" ON public.blueprint_resolutions
  FOR SELECT TO authenticated
  USING (
    -- Admins can view their own resolutions + all resolutions for audit
    EXISTS (
      SELECT 1 FROM public.admin_users AS admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('owner', 'admin')
    )
  ) WITH CHECK (false);
  
CREATE POLICY "blueprint_resolutions_service_role" ON public.blueprint_resolutions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_AUDIT_LOG POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_select" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_service_role" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log;

CREATE POLICY "blueprint_audit_log_admin_select" ON public.blueprint_audit_log
  FOR SELECT TO authenticated
  USING (
    -- Admins can view audit log for review purposes
    EXISTS (
      SELECT 1 FROM public.admin_users AS admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('owner', 'admin')
    )
  ) WITH CHECK (false);
  
CREATE POLICY "blueprint_audit_log_service_role" ON public.blueprint_audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "blueprint_audit_log_admin_insert" ON public.blueprint_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Only authorized admin users can create audit entries
    EXISTS (
      SELECT 1 FROM public.admin_users AS admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- GRANT PERMISSIONS FINALIZATION
-- ============================================================================

-- Ensure proper permissions are set
REVOKE ALL ON TABLE public.blueprint_queue FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blueprint_queue TO authenticated; -- Read via RLS filter
GRANT INSERT, UPDATE ON TABLE public.blueprint_queue TO service_role;

REVOKE ALL ON TABLE public.blueprint_resolutions FROM public, anon;
GRANT INSERT ON TABLE public.blueprint_resolutions TO authenticated; -- Insert via RLS filter
GRANT SELECT ON TABLE public.blueprint_resolutions TO authenticated; -- Select via RLS filter
GRANT ALL ON TABLE public.blueprint_resolutions TO service_role;

REVOKE ALL ON TABLE public.blueprint_audit_log FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blueprint_audit_log TO authenticated; -- Select via RLS filter
GRANT INSERT ON TABLE public.blueprint_audit_log TO authenticated; -- Insert via RLS filter
GRANT ALL ON TABLE public.blueprint_audit_log TO service_role;

-- ============================================================================
-- ADDITIONAL CONVENIENCE VIEWS FOR ADMIN DASHBOARD
-- ============================================================================

-- View: Pending review items with full details
DROP VIEW IF EXISTS public.vw_blueprint_pending_review_items;
CREATE VIEW public.vw_blueprint_pending_review_items AS
SELECT 
  bq.story_id,
  bq.chapter_numbers,
  bq.act_boundary,
  bq.findings,
  bq.created_at as queue_created_at,
  sq.title as story_title,
  sq.metadata->>'genre' as genre,
  sq.metadata->>'author_note' as author_note
FROM public.blueprint_queue bq
JOIN public.stories sq ON bq.story_id = sq.id
WHERE bq.status = 'PENDING'
ORDER BY bq.created_at ASC;

COMMENT ON VIEW public.vw_blueprint_pending_review_items IS 'Dashboard view of pending review items (E5 workflow only)';

-- View: Recent resolutions by admin user
DROP VIEW IF EXISTS public.vw_blueprint_recent_resolutions;
CREATE VIEW public.vw_blueprint_recent_resolutions AS
SELECT 
  br.story_id,
  br.disposition,
  br.reason_text,
  br.created_at as resolution_created_at,
  au.email as reviewer_email,
  au.role as reviewer_role,
  sq.title as story_title
FROM public.blueprint_resolutions br
JOIN public.auth.users au ON br.reviewer_uid = au.id
LEFT JOIN public.stories sq ON br.story_id = sq.id
ORDER BY br.created_at DESC
LIMIT 100;

COMMENT ON VIEW public.vw_blueprint_recent_resolutions IS 'Recent resolution history dashboard view (last 100 entries)';

-- Indexes on views (if performance tuning required later)
-- CREATE INDEX IF NOT EXISTS idx_vw_pending_created ON public.vw_blueprint_pending_review_items(queue_created_at);
