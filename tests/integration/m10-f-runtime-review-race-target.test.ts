import { describe, expect, it, vi } from 'vitest'
import {
  EXPECTED_DATABASE_IDENTITY,
  verifyExplicitRuntimeReviewRaceTarget,
  type RuntimeReviewRaceTargetDependencies,
} from '../../scripts/m10-f-runtime-review-race-target'

const validEnvironment = {
  LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL: '1',
  LAKOKU_M10F_RUNTIME_REVIEW_RACE_DB_CONTAINER: 'supabase_db_lakoku-m10f-review-race',
  LAKOKU_M10F_RUNTIME_REVIEW_RACE_PROJECT: 'lakoku-m10f-review-race',
}

function dependencies(
  overrides: Partial<RuntimeReviewRaceTargetDependencies> = {},
): RuntimeReviewRaceTargetDependencies {
  return {
    inspectContainer: vi.fn(() => 'lakoku-m10f-review-race|true'),
    readDatabaseIdentity: vi.fn(() => EXPECTED_DATABASE_IDENTITY),
    ...overrides,
  }
}

describe('M10-F runtime review race target authority', () => {
  it('rejects absent exact opt-in before Docker or DB access', () => {
    const deps = dependencies()

    expect(() => verifyExplicitRuntimeReviewRaceTarget({}, deps)).toThrow(
      'refusing DB access unless LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL=1',
    )
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects non-exact opt-in before Docker or DB access', () => {
    const deps = dependencies()

    expect(() => verifyExplicitRuntimeReviewRaceTarget({
      ...validEnvironment,
      LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL: 'true',
    }, deps)).toThrow('refusing DB access unless LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL=1')
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects absent explicit container before Docker or DB access', () => {
    const deps = dependencies()

    expect(() => verifyExplicitRuntimeReviewRaceTarget({
      LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL: '1',
      LAKOKU_M10F_RUNTIME_REVIEW_RACE_PROJECT: 'lakoku-m10f-review-race',
    }, deps)).toThrow(
      'LAKOKU_M10F_RUNTIME_REVIEW_RACE_DB_CONTAINER must be explicit and non-empty',
    )
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects absent explicit project before Docker or DB access', () => {
    const deps = dependencies()

    expect(() => verifyExplicitRuntimeReviewRaceTarget({
      LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL: '1',
      LAKOKU_M10F_RUNTIME_REVIEW_RACE_DB_CONTAINER: 'supabase_db_lakoku-m10f-review-race',
    }, deps)).toThrow(
      'LAKOKU_M10F_RUNTIME_REVIEW_RACE_PROJECT must be explicit and non-empty',
    )
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong project label', 'another-project|true'],
    ['stopped container', 'lakoku-m10f-review-race|false'],
  ])('rejects %s before DB access', (_label, inspection) => {
    const deps = dependencies({ inspectContainer: vi.fn(() => inspection) })

    expect(() => verifyExplicitRuntimeReviewRaceTarget(validEnvironment, deps)).toThrow(
      'database container label or running state does not match explicit isolated target',
    )
    expect(deps.inspectContainer).toHaveBeenCalledWith('supabase_db_lakoku-m10f-review-race')
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects wrong DB or either RPC identity', () => {
    const deps = dependencies({
      readDatabaseIdentity: vi.fn(() => 'postgres|postgres|false||'),
    })

    expect(() => verifyExplicitRuntimeReviewRaceTarget(validEnvironment, deps)).toThrow(
      'isolated local DB identity or required E5 / review enqueue RPC signatures unavailable',
    )
  })

  it('accepts only supplied running container with exact project and DB identity', () => {
    const deps = dependencies()

    expect(verifyExplicitRuntimeReviewRaceTarget(validEnvironment, deps)).toEqual({
      container: 'supabase_db_lakoku-m10f-review-race',
      context: 'M10-F runtime review enqueue and E5 disposition race',
      applicationPrefix: 'lakoku-m10f-review-race',
    })
    expect(deps.inspectContainer).toHaveBeenCalledWith('supabase_db_lakoku-m10f-review-race')
    expect(deps.readDatabaseIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ container: 'supabase_db_lakoku-m10f-review-race' }),
    )
  })
})
