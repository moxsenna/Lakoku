import { describe, expect, it } from 'vitest'
import {
  createM10GG1RunBudgetAuthority,
  validateM10GG1RunBudgetAuthority,
} from '../../lib/narrative-qa/contracts/m10-g-g1-run-budget.contract'

describe('M10-G G-1 run-budget authority contract', () => {
  const validSeedIdentity = {
    fixtureId: 'm10c-brankas-50',
    storyId: 'm10c-m10g-g1-test-story',
    harnessUserId: '99999999-9999-4999-9999-99999999c000',
    publicationMode: 'isolated-local-db' as const,
  }

  const validParams = {
    runId: 'm10g-g1-0123456789abcdef',
    manifestHash: 'a'.repeat(64),
    storySeedIdentity: validSeedIdentity,
    hardLimit: 250,
    issuedBy: 'Lakoku Project Lead',
    issuedAt: '2026-09-07T00:00:00.000Z',
  }

  it('creates and validates a valid run-budget authority record', () => {
    const authority = createM10GG1RunBudgetAuthority(validParams)

    expect(authority.schemaVersion).toBe(1)
    expect(authority.authorityKind).toBe('M10G_G1_RUN_BUDGET_AUTHORITY')
    expect(authority.authorityHash).toMatch(/^[0-9a-f]{64}$/)

    const validated = validateM10GG1RunBudgetAuthority(authority)
    expect(validated).toEqual(authority)
  })

  it('validates expected runId, manifestHash, and storyId pins', () => {
    const authority = createM10GG1RunBudgetAuthority(validParams)

    const validated = validateM10GG1RunBudgetAuthority(authority, {
      runId: validParams.runId,
      manifestHash: validParams.manifestHash,
      storyId: validParams.storySeedIdentity.storyId,
    })
    expect(validated).toEqual(authority)

    expect(() =>
      validateM10GG1RunBudgetAuthority(authority, {
        runId: 'm10g-g1-mismatched-run-id',
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_RUN_ID_MISMATCH')

    expect(() =>
      validateM10GG1RunBudgetAuthority(authority, {
        manifestHash: 'b'.repeat(64),
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_MANIFEST_HASH_MISMATCH')

    expect(() =>
      validateM10GG1RunBudgetAuthority(authority, {
        storyId: 'm10c-m10g-g1-other-story',
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_STORY_ID_MISMATCH')
  })

  it('rejects tampered authority payload with hash mismatch', () => {
    const authority = createM10GG1RunBudgetAuthority(validParams)
    const tampered = { ...authority, hardLimit: 999 }

    expect(() => validateM10GG1RunBudgetAuthority(tampered)).toThrow(
      'M10G_G1_RUN_BUDGET_AUTHORITY_HASH_MISMATCH',
    )
  })

  it('rejects invalid or non-integer hardLimit', () => {
    expect(() =>
      createM10GG1RunBudgetAuthority({
        ...validParams,
        hardLimit: 0,
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_AUTHORITY_INVALID')

    expect(() =>
      createM10GG1RunBudgetAuthority({
        ...validParams,
        hardLimit: -5,
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_AUTHORITY_INVALID')

    expect(() =>
      createM10GG1RunBudgetAuthority({
        ...validParams,
        hardLimit: 12.5,
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_AUTHORITY_INVALID')
  })

  it('rejects invalid manifest hash or story namespace format', () => {
    expect(() =>
      createM10GG1RunBudgetAuthority({
        ...validParams,
        manifestHash: 'not-a-valid-sha256',
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_AUTHORITY_INVALID')

    expect(() =>
      createM10GG1RunBudgetAuthority({
        ...validParams,
        storySeedIdentity: {
          ...validSeedIdentity,
          storyId: 'invalid-prefix-story',
        },
      }),
    ).toThrow('M10G_G1_RUN_BUDGET_AUTHORITY_INVALID')
  })
})
