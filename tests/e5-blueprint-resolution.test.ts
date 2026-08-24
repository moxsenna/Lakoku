import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  E5DispositionRpcArgs,
  ResolutionContext,
  ValidatorRerunResult,
} from '@/lib/types/blueprint.contract'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  requireAdminUser: vi.fn(),
  runValidatorRerun: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/utils/validator-rerun.helper', () => ({
  runValidatorRerun: mocks.runValidatorRerun,
}))

import { recordDisposition } from '@/lib/runtime/blueprint-workflow.server'

const CONTEXT: ResolutionContext = {
  story_id: 'story-123',
  disposition: 'RETRY_ALLOW',
  reviewer_uid: 'payload-attacker',
  reason_text: 'Ulangi setelah pemeriksaan.',
  source_event_id: '9223372036854775807',
  chapter_numbers: [7],
}

const PASSED_VALIDATION: ValidatorRerunResult = {
  passed: true,
  failures: [],
  validatedChapterVersions: [
    { chapter: 2, expected_version: 4 },
    { chapter: 9, expected_version: 7 },
  ],
  spineRevealFindings: [
    { chapterNumber: 9, findings: [{ findingType: 'SPINE_OK', message: 'Lolos.' }] },
  ],
  endingResults: {
    mainEndingReachable: true,
    secretEndingsReachable: ['secret-ending-1'],
  },
}

function authenticatedClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_functionName: string, _args: Record<string, unknown>) => result)
  mocks.createClient.mockResolvedValue({ rpc })
  return rpc
}

function adminClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_functionName: string, _args: Record<string, unknown>) => result)
  mocks.createAdminClient.mockReturnValue({ rpc })
  return rpc
}

describe('E5 blueprint resolution authority', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each(['owner', 'admin'] as const)(
    'allows trusted %s identity, skips attestation for non-unblock, and forwards only current RPC args',
    async (role) => {
      mocks.requireAdminUser.mockResolvedValue({ id: `trusted-${role}`, role })
      const rpc = authenticatedClient({
        data: [{ success: true, unblock_proof: null, error_message: null }],
        error: null,
      })

      await expect(recordDisposition(CONTEXT)).resolves.toEqual({
        success: true,
        unblockProof: undefined,
        validationResult: undefined,
      })
      const expectedArgs: E5DispositionRpcArgs = {
        p_story_id: 'story-123',
        p_disposition: 'RETRY_ALLOW',
        p_reviewer_uid: `trusted-${role}`,
        p_reason_text: 'Ulangi setelah pemeriksaan.',
        p_source_event_id: '9223372036854775807',
        p_chapter_numbers: [7],
        p_validator_attestation_id: null,
      }
      expect(rpc).toHaveBeenCalledWith('e5_record_disposition', expectedArgs)
      expect(Object.keys(rpc.mock.calls[0][1])).toEqual(Object.keys(expectedArgs))
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
      expect(mocks.runValidatorRerun).not.toHaveBeenCalled()
      expect(CONTEXT.reviewer_uid).toBe('payload-attacker')
    },
  )

  it('issues server attestation from canonical evidence before authenticated unblock resolution', async () => {
    const attestationId = '11111111-2222-4333-8444-555555555555'
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-owner', role: 'owner' })
    mocks.runValidatorRerun.mockResolvedValue(PASSED_VALIDATION)
    const issueRpc = adminClient({ data: attestationId, error: null })
    const resolutionRpc = authenticatedClient({
      data: [{ success: true, unblock_proof: 'E5_UNBLOCK_PROOF_hash', error_message: null }],
      error: null,
    })

    await expect(recordDisposition({
      ...CONTEXT,
      disposition: 'UNBLOCK_PERMIT',
      chapter_numbers: [9, 2],
    })).resolves.toEqual({
      success: true,
      unblockProof: 'E5_UNBLOCK_PROOF_hash',
      validationResult: PASSED_VALIDATION,
    })

    expect(issueRpc).toHaveBeenCalledWith('e5_issue_validator_attestation', {
      p_story_id: 'story-123',
      p_source_event_id: '9223372036854775807',
      p_reviewer_uid: 'trusted-owner',
      p_chapter_numbers: [2, 9],
      p_validator_version: 'E5_CANONICAL_VALIDATOR_V1',
      p_spine_reveal_findings: PASSED_VALIDATION.spineRevealFindings,
      p_ending_results: PASSED_VALIDATION.endingResults,
      p_expected_chapter_versions: PASSED_VALIDATION.validatedChapterVersions,
    })
    expect(resolutionRpc).toHaveBeenCalledWith('e5_record_disposition', {
      p_story_id: 'story-123',
      p_disposition: 'UNBLOCK_PERMIT',
      p_reviewer_uid: 'trusted-owner',
      p_reason_text: 'Ulangi setelah pemeriksaan.',
      p_source_event_id: '9223372036854775807',
      p_chapter_numbers: [2, 9],
      p_validator_attestation_id: attestationId,
    })
    expect(issueRpc.mock.invocationCallOrder[0]).toBeLessThan(
      resolutionRpc.mock.invocationCallOrder[0],
    )
  })

  it('issues neither attestation nor resolution when canonical validation fails', async () => {
    const validationResult: ValidatorRerunResult = {
      passed: false,
      failures: [{
        chapterNumber: 7,
        failureType: 'FORBIDDEN_REVEAL',
        message: 'Reveal terlalu dini.',
      }],
      validatedChapterVersions: [{ chapter: 7, expected_version: 3 }],
    }
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-owner', role: 'owner' })
    mocks.runValidatorRerun.mockResolvedValue(validationResult)
    const resolutionRpc = authenticatedClient({ data: null, error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(recordDisposition({
      ...CONTEXT,
      disposition: 'UNBLOCK_PERMIT',
    })).resolves.toEqual({
      success: false,
      error: 'Canonical validators rejected - remain BLOCKED',
      validationResult,
    })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(resolutionRpc).not.toHaveBeenCalled()
  })

  it('does not call resolution authority when attestation issuance fails', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-owner', role: 'owner' })
    mocks.runValidatorRerun.mockResolvedValue(PASSED_VALIDATION)
    adminClient({ data: null, error: { message: 'attestation unavailable' } })
    const resolutionRpc = authenticatedClient({ data: null, error: null })

    await expect(recordDisposition({
      ...CONTEXT,
      disposition: 'UNBLOCK_PERMIT',
      chapter_numbers: [2, 9],
    })).resolves.toEqual({
      success: false,
      error: 'attestation unavailable',
      validationResult: PASSED_VALIDATION,
    })
    expect(resolutionRpc).not.toHaveBeenCalled()
  })

  it('rejects untrusted role before validator, attestation, or resolution RPC', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-user', role: 'editor' })
    const rpc = authenticatedClient({ data: null, error: null })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(recordDisposition(CONTEXT)).resolves.toEqual({
      success: false,
      error: 'Unauthorized: role=editor cannot record dispositions',
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.runValidatorRerun).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  it('fails closed when trusted identity cannot be established', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('Unauthenticated'))
    const rpc = authenticatedClient({ data: null, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(recordDisposition(CONTEXT)).resolves.toEqual({
      success: false,
      error: 'Unauthenticated',
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects malformed native authority response', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-owner', role: 'owner' })
    authenticatedClient({ data: [{ success: true }], error: null })

    await expect(recordDisposition(CONTEXT)).resolves.toEqual({
      success: false,
      error: 'Invalid response from resolution authority',
    })
  })
})
