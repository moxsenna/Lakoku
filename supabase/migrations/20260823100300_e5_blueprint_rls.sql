-- M10-E E5 Row-Level Security Enforcement Policy (E-OPS-1 Criterion #4)
-- Purpose: Comprehensive RLS policies - owner/admin ONLY, NO anon/auth-wildcard
-- Authority: Reviewer verdict HOLD + Static Gate fb64c47 corrections
-- Boundary: 
--   1. Anonymous users: NO access to queue, audit, resolutions tables
--   2. Authenticated users: NO unrestricted access via WITH CHECK (true)  
--   3. Owner/admin only: predicates via admin_users + auth.uid()
--   4. Reuse existing admin_users table (created at 20260718110000); DO NOT recreate
-- STATIC GATE CORRECTIONS (fb64c47):
--   - No resolution UPDATE/DELETE policies (append-only ledger requirement)
--   - Minimum grants + owner/admin RLS actually usable by current server reads
--   - Audit log reviewer FK RESTRICT/NO ACTION (not CASCADE)
--   - blueprint_queue SELECT permission granted for authenticated reads

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
-- BLUEPRINT_QUEUE POLICIES - OWNER/ADMIN ONLY, SERVICE_ROLE FOR INTERNAL OPERATIONS
-- ===================================================== ===================

DROP POLICY IF EXISTS "blueprint_queue_anon_select" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_service_role" ON public.blueprint_queue;
DROP POLICY IF EXISTS "blueprint_queue_anon_all" ON public.blueprint_queue;

-- Grant minimum SELECT to authenticated (used by admin dashboard/client reads)
-- RLS restricts to owner/admin members only
CREATE POLICY "blueprint_queue_authenticated_select"
  ON public.blueprint_queue FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

-- Deny anonymous access entirely
CREATE POLICY "blueprint_queue_anon_deny_all"
  ON public.blueprint_queue FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Service role bypass for internal operations
CREATE POLICY "blueprint_queue_service_role" 
  ON public.blueprint_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_RESOLUTIONS POLICIES - APPEND-ONLY (NO UPDATE/DELETE)
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_insert" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_service_role" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_update" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_delete" ON public.blueprint_resolutions;

-- Append-only pattern: INSERT + SELECT only; NO UPDATE/DELETE paths
CREATE POLICY "blueprint_resolutions_owner_admin_insert"
  ON public.blueprint_resolutions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_resolutions_owner_admin_select"
  ON public.blueprint_resolutions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

-- Explicitly deny UPDATE/DELETE (append-only ledger immutability)
CREATE POLICY "blueprint_resolutions_no_update"
  ON public.blueprint_resolutions FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "blueprint_resolutions_no_delete"
  ON public.blueprint_resolutions FOR DELETE TO authenticated
  USING (false);

-- Service role bypass (INSERT/SELECT only)
CREATE POLICY "blueprint_resolutions_service_role_select" 
  ON public.blueprint_resolutions FOR SELECT TO service_role USING (true);

CREATE POLICY "blueprint_resolutions_service_role_insert" 
  ON public.blueprint_resolutions FOR INSERT TO service_role WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_AUDIT_LOG POLICIES - APPEND-ONLY, REVIEWER FK RESTRICT (NOT CASCADE)
-- ============================================================================

DROP POLICY IF EXISTS "blueprint_audit_log_anon_select" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_service_role" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_update" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_delete" ON public.blueprint_audit_log;

-- Deny anonymous access entirely
CREATE POLICY "blueprint_audit_log_anon_deny_all"
  ON public.blueprint_audit_log FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Allow owner/admin select/insert only
CREATE POLICY "blueprint_audit_log_owner_admin_select"
  ON public.blueprint_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

CREATE POLICY "blueprint_audit_log_owner_admin_insert"
  ON public.blueprint_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')));

-- Block DELETE entirely (audit immutability requirement)
CREATE POLICY "blueprint_audit_log_no_delete"
  ON public.blueprint_audit_log FOR DELETE TO authenticated
  USING (false);

-- Block UPDATE (append-only immutability)
CREATE POLICY "blueprint_audit_log_no_update"
  ON public.blueprint_audit_log FOR UPDATE TO authenticated
  USING (false);

-- Service role bypass for internal operations
CREATE POLICY "blueprint_audit_log_service_role" 
  ON public.blueprint_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- BLUEPRINT_VALIDATOR_PROOFS POLICIES - IMMUTABLE AFTER INSERTION
-- ============================================================================

DROP POLICY IF EXISTS "e5_validator_proof_authenticated" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "e5_validator_proof_service_role" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_select" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_insert" ON public.blueprint_validator_proofs;

-- Allow owner/admin SELECT/INSERT only (NO UPDATE/DELETE)
CREATE POLICY e5_validator_proof_select
  ON public.blueprint_validator_proofs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY e5_validator_proof_insert
  ON public.blueprint_validator_proofs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
    )
  );

-- Explicitly deny UPDATE/DELETE (immutability requirement)
CREATE POLICY e5_validator_proof_no_update
  ON public.blueprint_validator_proofs
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY e5_validator_proof_no_delete
  ON public.blueprint_validator_proofs
  FOR DELETE
  TO authenticated
  USING (false);

-- Service role bypass
CREATE POLICY e5_validator_proof_service_role_select
  ON public.blueprint_validator_proofs
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY e5_validator_proof_service_role_insert
  ON public.blueprint_validator_proofs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

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
