import { describe, expect, it, vi } from 'vitest'
import {
  verifyExplicitE5RaceTarget,
  type E5RaceTargetDependencies,
} from '../../scripts/e5-blueprint-race-target'

const validEnvironment = {
  LAKOKU_E5_BLUEPRINT_RACE_LOCAL: '1',
  LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER: 'supabase_db_lakoku-e5-fresh-race',
  LAKOKU_E5_BLUEPRINT_RACE_PROJECT: 'lakoku-e5-fresh-race',
}

const validIdentity =
  'postgres|postgres|false|e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)|e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)'

function dependencies(
  overrides: Partial<E5RaceTargetDependencies> = {},
): E5RaceTargetDependencies {
  return {
    inspectContainer: vi.fn(() => 'lakoku-e5-fresh-race|true'),
    readDatabaseIdentity: vi.fn(() => validIdentity),
    ...overrides,
  }
}

describe('E5 explicit race target authority', () => {
  it('rejects absent local opt-in before Docker or database access', () => {
    const deps = dependencies()

    expect(() => verifyExplicitE5RaceTarget({}, deps)).toThrow(
      'refusing DB access unless LAKOKU_E5_BLUEPRINT_RACE_LOCAL=1',
    )
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects absent container before Docker or database access', () => {
    const deps = dependencies()

    expect(() =>
      verifyExplicitE5RaceTarget(
        {
          LAKOKU_E5_BLUEPRINT_RACE_LOCAL: '1',
          LAKOKU_E5_BLUEPRINT_RACE_PROJECT: 'lakoku-e5-fresh-race',
        },
        deps,
      ),
    ).toThrow('LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER must be explicit and non-empty')
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects absent project before Docker or database access', () => {
    const deps = dependencies()

    expect(() =>
      verifyExplicitE5RaceTarget(
        {
          LAKOKU_E5_BLUEPRINT_RACE_LOCAL: '1',
          LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER: 'supabase_db_lakoku-e5-fresh-race',
        },
        deps,
      ),
    ).toThrow('LAKOKU_E5_BLUEPRINT_RACE_PROJECT must be explicit and non-empty')
    expect(deps.inspectContainer).not.toHaveBeenCalled()
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects Docker label mismatch before database access', () => {
    const deps = dependencies({
      inspectContainer: vi.fn(() => 'another-project|true'),
    })

    expect(() => verifyExplicitE5RaceTarget(validEnvironment, deps)).toThrow(
      'database container label or running state does not match explicit isolated target',
    )
    expect(deps.inspectContainer).toHaveBeenCalledWith(
      'supabase_db_lakoku-e5-fresh-race',
    )
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects stopped container before database access', () => {
    const deps = dependencies({
      inspectContainer: vi.fn(() => 'lakoku-e5-fresh-race|false'),
    })

    expect(() => verifyExplicitE5RaceTarget(validEnvironment, deps)).toThrow(
      'database container label or running state does not match explicit isolated target',
    )
    expect(deps.readDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('rejects wrong database or RPC identity', () => {
    const deps = dependencies({
      readDatabaseIdentity: vi.fn(() => 'postgres|postgres|false||'),
    })

    expect(() => verifyExplicitE5RaceTarget(validEnvironment, deps)).toThrow(
      'isolated local DB identity or final E5 RPC signatures unavailable',
    )
  })

  it('accepts only supplied running container with exact project and DB identity', () => {
    const deps = dependencies()

    expect(verifyExplicitE5RaceTarget(validEnvironment, deps)).toEqual({
      container: 'supabase_db_lakoku-e5-fresh-race',
      context: 'E5 blueprint claim and resolution race',
      applicationPrefix: 'lakoku-e5-blueprint-race',
    })
    expect(deps.inspectContainer).toHaveBeenCalledWith(
      'supabase_db_lakoku-e5-fresh-race',
    )
    expect(deps.readDatabaseIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ container: 'supabase_db_lakoku-e5-fresh-race' }),
    )
  })
})
