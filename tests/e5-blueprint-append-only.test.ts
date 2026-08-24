import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const RESOLUTION_MIGRATION = readFileSync(
  `${ROOT}/supabase/migrations/20260824100000_e5_blueprint_resolution_function.sql`,
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
const VALIDATOR_ATTESTATION_MIGRATION = readFileSync(
  `${ROOT}/supabase/migrations/20260823100250_e5_blueprint_validator_proofs.sql`,
  'utf8',
)

describe('E5 append-only authority evidence', () => {
  it('copies latest exact version into a new incremented chapter_blueprints row', () => {
    expect(RESOLUTION_MIGRATION).toMatch(
      /FROM public\.chapter_blueprints AS cb[\s\S]*ORDER BY cb\.version DESC[\s\S]*FOR UPDATE;/,
    )
    expect(RESOLUTION_MIGRATION).toContain(
      'IF v_expected_version IS NULL OR v_expected_version IS DISTINCT FROM v_source_version THEN',
    )
    expect(RESOLUTION_MIGRATION).toContain("MESSAGE = 'STALE_BLUEPRINT_VERSION'")
    expect(RESOLUTION_MIGRATION).toMatch(
      /INSERT INTO public\.chapter_blueprints[\s\S]*v_source_version \+ 1,[\s\S]*v_source_version,[\s\S]*pg_catalog\.format\('E5 %s resolution at %s'/,
    )
    expect(RESOLUTION_MIGRATION).not.toMatch(/UPDATE\s+public\.chapter_blueprints/i)
  })

  it('accepts only server-issued attestation ID in current disposition contract', () => {
    const signature = RESOLUTION_MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\.e5_record_disposition\(([\s\S]*?)\)\s*RETURNS TABLE/,
    )?.[1]

    expect(signature).toBeDefined()
    expect(signature).toContain('p_validator_attestation_id uuid DEFAULT NULL')
    expect(signature).not.toMatch(/p_validation_passed|p_validator_spine_findings|p_validator_ending_results|p_expected_chapter_versions/)
    expect(RESOLUTION_MIGRATION).toContain('VALIDATOR_ATTESTATION_REQUIRED')
    expect(RESOLUTION_MIGRATION).toContain('VALIDATOR_ATTESTATION_BINDING_MISMATCH')
  })

  it('allows only service role to issue validator attestations', () => {
    expect(VALIDATOR_ATTESTATION_MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    )
    expect(VALIDATOR_ATTESTATION_MIGRATION).toContain(
      'FROM PUBLIC, anon, authenticated;',
    )
    expect(VALIDATOR_ATTESTATION_MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    )
    expect(VALIDATOR_ATTESTATION_MIGRATION).toContain('TO service_role;')
    expect(VALIDATOR_ATTESTATION_MIGRATION).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.e5_issue_validator_attestation\(text,bigint,uuid,integer\[\],text,jsonb,jsonb,jsonb\)\s+TO authenticated;/,
    )
  })

  it('persists source/result version pairs and returns authoritative proof only', () => {
    expect(RESOLUTION_MIGRATION).toContain("'source_version', v_source_version")
    expect(RESOLUTION_MIGRATION).toContain("'result_version', v_source_version + 1")
    expect(RESOLUTION_MIGRATION).toContain('result_chapter_version_pairs')
    expect(RESOLUTION_MIGRATION).toContain('result_unblock_proof')
    expect(RESOLUTION_MIGRATION).toContain('result_proof_id')
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
