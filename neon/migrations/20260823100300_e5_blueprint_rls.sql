-- M10-E E5 owner/admin read policies and dashboard views.
-- Authenticated writes remain available only through SECURITY DEFINER RPC.

COMMENT ON TABLE public.admin_users IS
  'Authorization mapping reused for owner/admin blueprint workflow access';


CREATE VIEW public.vw_blueprint_review_authority AS
SELECT
  bq.story_id,
  bq.chapter_numbers,
  bq.source_event_id::text AS source_event_id,
  bq.status
FROM public.blueprint_queue AS bq
WHERE bq.status IN ('PENDING', 'CLAIMED', 'BLOCKED')
  AND (SELECT public.e5_is_owner_admin());


CREATE VIEW public.vw_blueprint_pending_review_items AS
SELECT
  bq.story_id,
  bq.chapter_numbers,
  bq.act_boundary,
  bq.findings,
  bq.source_event_id::text AS source_event_id,
  bq.created_at AS queue_created_at,
  s.title AS story_title,
  s.tagline,
  s.role,
  s.total_chapters,
  s.status AS story_status
FROM public.blueprint_queue AS bq
JOIN public.stories AS s ON s.id = bq.story_id
WHERE bq.status = 'PENDING'
  AND (SELECT public.e5_is_owner_admin());


CREATE VIEW public.vw_blueprint_recent_resolutions AS
SELECT
  br.id::text AS resolution_id,
  br.story_id,
  br.source_event_id::text AS source_event_id,
  br.disposition,
  br.reason_text,
  br.chapter_numbers,
  br.result_chapter_version_pairs,
  br.created_at AS resolution_created_at,
  u.email AS reviewer_email,
  br.reviewer_uid,
  s.title AS story_title
FROM public.blueprint_resolutions AS br
LEFT JOIN auth.users AS u ON u.id = br.reviewer_uid
LEFT JOIN public.stories AS s ON s.id = br.story_id
WHERE (SELECT public.e5_is_owner_admin())
ORDER BY br.created_at DESC
LIMIT 100;


CREATE VIEW public.vw_blueprint_review_item_details AS
SELECT
  bq.story_id,
  bq.status,
  bq.chapter_numbers,
  bq.act_boundary,
  bq.findings,
  bq.claimed_by,
  bq.claimed_at,
  bq.provider_call_id,
  bq.retry_count,
  bq.brand_scan_hash,
  bq.lease_id,
  bq.source_event_id::text AS source_event_id,
  bq.created_at,
  s.title AS story_title,
  s.tagline,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', br.id::text,
        'disposition', br.disposition,
        'reason_text', br.reason_text,
        'created_at', br.created_at
      )
      ORDER BY br.created_at DESC
    )
    FROM public.blueprint_resolutions AS br
    WHERE br.story_id = bq.story_id
  ), '[]'::jsonb) AS recent_resolutions,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', bal.id::text,
        'disposition', bal.disposition,
        'reason_text', bal.reason_text,
        'created_at', bal.created_at
      )
      ORDER BY bal.created_at DESC
    )
    FROM public.blueprint_audit_log AS bal
    WHERE bal.story_id = bq.story_id
  ), '[]'::jsonb) AS audit_entries
FROM public.blueprint_queue AS bq
JOIN public.stories AS s ON s.id = bq.story_id
WHERE (SELECT public.e5_is_owner_admin());


COMMENT ON VIEW public.vw_blueprint_pending_review_items IS
  'Owner/admin dashboard view of pending E5 review items';

COMMENT ON VIEW public.vw_blueprint_recent_resolutions IS
  'Owner/admin dashboard view of 100 recent E5 resolutions with lossless decimal IDs';

COMMENT ON VIEW public.vw_blueprint_review_item_details IS
  'Owner/admin E5 queue detail with every PostgreSQL BIGINT represented as decimal text';