import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FORWARD_ATTESTATION_MIGRATION = readFileSync(
  `${ROOT}/supabase/migrations/20260824101000_e5_stateless_validator_attestation.sql`,
  'utf8',
)
const RESOLUTION_LEDGER_MIGRATION = readFileSync(
  `${ROOT}/supabase/migrations/20260823100100_e5_blueprint_resolutions.sql`,
  'utf8',
)
const AUDIT_MIGRATION = readFileSync(
  `${ROOT}/supabase/migrations/20260823100200_e5_blueprint_audit.sql`,
  'utf8',
)

describe('E5 append-only authority evidence', () => {
  it('copies latest exact version into a new incremented chapter_blueprints row', () => {
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /FROM public\.chapter_blueprints AS cb[\s\S]*ORDER BY cb\.version DESC[\s\S]*FOR UPDATE;/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toContain(
      'IF v_expected_version IS DISTINCT FROM v_source_version THEN',
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toContain("MESSAGE = 'STALE_BLUEPRINT_VERSION'")
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /INSERT INTO public\.chapter_blueprints[\s\S]*v_blueprint\.version \+ 1,[\s\S]*v_blueprint\.version,[\s\S]*pg_catalog\.format\('E5 %s resolution at %s'/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).not.toMatch(/UPDATE\s+public\.chapter_blueprints/i)
  })

  it('accepts only signed JSONB attestation in forward disposition contract and drops UUID overload', () => {
    const signature = FORWARD_ATTESTATION_MIGRATION.match(
      /CREATE FUNCTION public\.e5_record_disposition\(([\s\S]*?)\)\s*RETURNS TABLE/,
    )?.[1]

    expect(signature).toBeDefined()
    expect(signature).toContain('p_validator_attestation jsonb DEFAULT NULL')
    expect(signature).not.toMatch(/p_validator_attestation_id|p_validation_passed|p_validator_spine_findings|p_validator_ending_results|p_expected_chapter_versions/)
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /DROP FUNCTION public\.e5_record_disposition\(text,text,uuid,text,bigint,integer\[\],uuid\);/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toContain('INVALID_VALIDATOR_ATTESTATION_SHAPE')
    expect(FORWARD_ATTESTATION_MIGRATION).toContain('VALIDATOR_ATTESTATION_BINDING_MISMATCH')
  })

  it('allows only service role to issue write-free signed JSONB attestations', () => {
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /CREATE FUNCTION public\.e5_issue_validator_attestation\([\s\S]*?\)\s*RETURNS jsonb/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.e5_issue_validator_attestation\(text,bigint,uuid,integer\[\],text,jsonb,jsonb,jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.e5_issue_validator_attestation\(text,bigint,uuid,integer\[\],text,jsonb,jsonb,jsonb\)[\s\S]*?TO service_role;/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.e5_issue_validator_attestation\(text,bigint,uuid,integer\[\],text,jsonb,jsonb,jsonb\)\s+TO authenticated;/,
    )
  })

  it('persists full signed envelope, evidence hash, and authoritative version pairs', () => {
    expect(FORWARD_ATTESTATION_MIGRATION).toContain("'source_version', v_source_version")
    expect(FORWARD_ATTESTATION_MIGRATION).toContain("'result_version', v_source_version + 1")
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /extensions\.digest\(p_validator_attestation::text, 'sha256'::text\)/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /INSERT INTO public\.blueprint_validator_proofs[\s\S]*validator_attestation_hash,[\s\S]*validator_attestation,[\s\S]*v_attestation_hash,[\s\S]*p_validator_attestation/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toContain('result_chapter_version_pairs')
    expect(FORWARD_ATTESTATION_MIGRATION).toContain('result_unblock_proof')
    expect(FORWARD_ATTESTATION_MIGRATION).toContain('result_proof_id')
    expect(RESOLUTION_LEDGER_MIGRATION).toContain('request_fingerprint text NOT NULL UNIQUE')
  })

  it('keeps resolution and audit ledgers immutable through grants and restrictive references', () => {
    expect(RESOLUTION_LEDGER_MIGRATION).toContain(
      'story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT',
    )
    expect(RESOLUTION_LEDGER_MIGRATION).toContain(
      'REVOKE ALL ON TABLE public.blueprint_resolutions FROM PUBLIC, anon, authenticated, service_role;',
    )
    expect(RESOLUTION_LEDGER_MIGRATION).toContain(
      'GRANT SELECT ON TABLE public.blueprint_resolutions TO service_role;',
    )
    expect(AUDIT_MIGRATION).toContain(
      'source_event_id bigint NOT NULL REFERENCES public.story_events(id) ON DELETE RESTRICT',
    )
    expect(AUDIT_MIGRATION).toContain(
      'REVOKE ALL ON TABLE public.blueprint_audit_log FROM PUBLIC, anon, authenticated, service_role;',
    )
    expect(AUDIT_MIGRATION).toContain(
      'GRANT SELECT ON TABLE public.blueprint_audit_log TO service_role;',
    )
  })
})
