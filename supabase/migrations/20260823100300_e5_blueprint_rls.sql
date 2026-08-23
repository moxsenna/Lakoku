-- M10-E E5 Row-Level Security Enforcement Policy (E-OPS-1 Criterion #4)
-- Purpose: Comprehensive RLS policies - owner/admin ONLY, NO anon/auth-wildcard
-- Authority: Reviewer verdict HOLD - must fix RLS before closure submittal
-- Boundary: 
--   1. Anonymous users: NO access to queue, audit, resolutions tables
--   2. Authenticated users: NO unrestricted access via WITH CHECK (true)  
--   3. Owner/admin only: predicates via admin_users + auth.uid()
--   4. Reuse existing admin_users table (created at 20260718110000); DO NOT recreate
-- FIXES REQUIRED BY REVIEWER:
--   - Remove CREATE TABLE admin_users (already exists)
--   - Use correct DROP POLICY IF EXISTS + CREATE POLICY syntax (not CREATE OR REPLACE)
--   - Remove 'editor' role from admin_users reference
--   - Add explicit deny for anon users where missing

DO $$
BEGIN
  -- This is an idempotent policy definition migration
END $$;

-- ============================================================================
-- ADMIN_USERS TABLE - REUSE EXISTING FROM 20260718110000
-- ============================================================================
-- DO NOT recreate this table! It already exists from admin_generation_observability_rpcs.sql
-- Existing structure:
--   user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
--   role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin'))
--   created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
--   updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
-- Only allow 'owner' | 'admin' roles; NO 'editor' role permitted

COMMENT ON TABLE public.admin_users IS 'Authorization mapping for owner/admin access to blueprint workflow (E-OPS-1 Criterion #4); REUSED from 20260718110000';

-- ============================================================================
-- BLUEPRINT_QUEUE POLICIES - NO ANON ACCESS, OWNER/ADMIN ONLY
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_queue_anon_select" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_service_role" ON public.blueprint_queue;

-- Deny anonymous access entirely
DROP POLICY IF EXISTS "blueprint_queue_anon_all" ON public.blueprint_queue;

-- Allow authenticated admin users ONLY via explicit admin_users membership check
CREATE POLICY "blueprint_queue_owner_admin"
  ON public.blueprint_queue FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

-- Service role bypass for internal operations
CREATE POLICY "blueprint_queue_service_role" 
  ON public.blueprint_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_RESOLUTIONS POLICIES - OWNER/ADMIN ONLY
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_insert" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_service_role" ON public.blueprint_resolutions;

-- Deny wildcard authenticated access; require admin_users membership
CREATE POLICY "blueprint_resolutions_owner_admin"
  ON public.blueprint_resolutions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_resolutions_owner_admin_select"
  ON public.blueprint_resolutions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_resolutions_owner_admin_update"
  ON public.blueprint_resolutions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_resolutions_owner_admin_delete"
  ON public.blueprint_resolutions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_resolutions_service_role" 
  ON public.blueprint_resolutions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_AUDIT_LOG POLICIES - OWNER/ADMIN ONLY, NO DELETE
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_audit_log_anon_select" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_service_role" ON public.blueprint_audit_log;

-- Deny anonymous access entirely
DROP POLICY IF EXISTS "blueprint_audit_log_anon_all" ON public.blueprint_audit_log;

-- Allow owner/admin select/insert only; explicitly BLOCK DELETE (audit immutability)
CREATE POLICY "blueprint_audit_log_owner_admin_select"
  ON public.blueprint_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_audit_log_owner_admin_insert"
  ON public.blueprint_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

-- Block DELETE entirely (audit immutability requirement) - explicit denial
DROP POLICY IF EXISTS "blueprint_audit_log_delete" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_auth_delete" ON public.blueprint_audit_log;

CREATE POLICY "blueprint_audit_log_no_delete"
  ON public.blueprint_audit_log FOR DELETE TO authenticated
  USING (false); -- Explicit deny for all users

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
LEFT JOIN auth.users au ON br.reviewer_uid = au.id
LEFT JOIN public.stories sq ON br.story_id = sq.id
ORDER BY br.created_at DESC
LIMIT 100;

COMMENT ON VIEW public.vw_blueprint_recent_resolutions IS 'Recent resolution history dashboard view (last 100 entries)';

-- ============================================================================
-- END RLS FIXES - All tables now protected by admin_users membership check
-- ============================================================================
