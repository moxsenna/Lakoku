-- M10-E E5 Blueprint Validator Proofs
-- Immutable full validator evidence for successful unblock dispositions.

CREATE TABLE public.blueprint_validator_attestations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT,
  source_event_id bigint NOT NULL REFERENCES public.story_events(id) ON DELETE RESTRICT,
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  chapter_numbers integer[] NOT NULL,
  validator_version text NOT NULL,
  spine_reveal_findings jsonb NOT NULL,
  ending_results jsonb NOT NULL,
  expected_chapter_versions jsonb NOT NULL,
  attestation_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

COMMENT ON TABLE public.blueprint_validator_attestations IS
  'Immutable server-issued canonical validator attestations required by E5 unblock authority';

ALTER TABLE public.blueprint_validator_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blueprint_validator_attestations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.e5_issue_validator_attestation(
  p_story_id text,
  p_source_event_id bigint,
  p_reviewer_uid uuid,
  p_chapter_numbers integer[],
  p_validator_version text,
  p_spine_reveal_findings jsonb,
  p_ending_results jsonb,
  p_expected_chapter_versions jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_chapters integer[];
  v_payload jsonb;
  v_hash text;
  v_id uuid;
BEGIN
  SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
  INTO v_chapters
  FROM (
    SELECT DISTINCT u.chapter_number
    FROM pg_catalog.unnest(p_chapter_numbers) AS u(chapter_number)
  ) AS c;

  IF p_story_id IS NULL
    OR p_source_event_id IS NULL
    OR p_reviewer_uid IS NULL
    OR p_validator_version IS DISTINCT FROM 'E5_CANONICAL_VALIDATOR_V1'
    OR p_spine_reveal_findings IS NULL
    OR pg_catalog.jsonb_typeof(p_spine_reveal_findings) <> 'array'
    OR p_ending_results IS NULL
    OR pg_catalog.jsonb_typeof(p_ending_results) <> 'object'
    OR p_expected_chapter_versions IS NULL
    OR pg_catalog.jsonb_typeof(p_expected_chapter_versions) <> 'array'
    OR pg_catalog.cardinality(v_chapters) = 0
    OR pg_catalog.cardinality(v_chapters) <> pg_catalog.cardinality(p_chapter_numbers)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VALIDATOR_ATTESTATION';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'story_id', p_story_id,
    'source_event_id', p_source_event_id::text,
    'reviewer_uid', p_reviewer_uid::text,
    'chapter_numbers', pg_catalog.to_jsonb(v_chapters),
    'validator_version', p_validator_version,
    'spine_reveal_findings', p_spine_reveal_findings,
    'ending_results', p_ending_results,
    'expected_chapter_versions', p_expected_chapter_versions
  );
  v_hash := pg_catalog.encode(
    extensions.digest(v_payload::text, 'sha256'::text),
    'hex'::text
  );

  INSERT INTO public.blueprint_validator_attestations (
    story_id,
    source_event_id,
    reviewer_uid,
    chapter_numbers,
    validator_version,
    spine_reveal_findings,
    ending_results,
    expected_chapter_versions,
    attestation_hash
  ) VALUES (
    p_story_id,
    p_source_event_id,
    p_reviewer_uid,
    v_chapters,
    p_validator_version,
    p_spine_reveal_findings,
    p_ending_results,
    p_expected_chapter_versions,
    v_hash
  )
  ON CONFLICT (attestation_hash) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT bva.id
    INTO STRICT v_id
    FROM public.blueprint_validator_attestations AS bva
    WHERE bva.attestation_hash = v_hash;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)
  TO service_role;

CREATE TABLE public.blueprint_validator_proofs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT,
  resolution_id bigint NOT NULL UNIQUE
    REFERENCES public.blueprint_resolutions(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  source_event_id bigint NOT NULL REFERENCES public.story_events(id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK (disposition = 'UNBLOCK_PERMIT'),
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason_text text NOT NULL,
  chapter_numbers integer[] NOT NULL,
  proof_type text NOT NULL CHECK (proof_type = 'VALIDATOR_RERUN_PASSED'),
  validator_attestation_id uuid NOT NULL UNIQUE
    REFERENCES public.blueprint_validator_attestations(id) ON DELETE RESTRICT,
  validator_version text NOT NULL,
  spine_reveal_findings jsonb NOT NULL,
  ending_results jsonb NOT NULL,
  validator_payload jsonb NOT NULL,
  proof_hash text NOT NULL UNIQUE,
  proof_value text NOT NULL UNIQUE,
  chapter_version_pairs jsonb NOT NULL,
  request_fingerprint text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.blueprint_resolutions
  ADD CONSTRAINT blueprint_resolutions_result_proof_id_fkey
  FOREIGN KEY (result_proof_id)
  REFERENCES public.blueprint_validator_proofs(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_validator_proof_story_id
  ON public.blueprint_validator_proofs(story_id);
CREATE INDEX idx_validator_proof_source_event
  ON public.blueprint_validator_proofs(source_event_id);
CREATE INDEX idx_validator_proof_created
  ON public.blueprint_validator_proofs(created_at DESC);

COMMENT ON TABLE public.blueprint_validator_proofs IS
  'Immutable full validator payload, hash, proof value, and persisted source/result versions for E-OPS-1 unblock';
COMMENT ON COLUMN public.blueprint_validator_proofs.spine_reveal_findings IS
  'Canonical spine/reveal findings as plain jsonb';
COMMENT ON COLUMN public.blueprint_validator_proofs.chapter_version_pairs IS
  'Source/result chapter-version pairs as plain jsonb';

ALTER TABLE public.blueprint_validator_proofs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.e5_is_owner_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
  );
$function$;

REVOKE ALL ON FUNCTION public.e5_is_owner_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.e5_is_owner_admin() TO authenticated;

CREATE POLICY blueprint_validator_proofs_owner_admin_select
  ON public.blueprint_validator_proofs
  FOR SELECT TO authenticated
  USING ((SELECT public.e5_is_owner_admin()));

CREATE POLICY blueprint_validator_proofs_service_role_select
  ON public.blueprint_validator_proofs
  FOR SELECT TO service_role
  USING (true);
REVOKE ALL ON TABLE public.blueprint_validator_proofs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.blueprint_validator_proofs TO authenticated, service_role;
