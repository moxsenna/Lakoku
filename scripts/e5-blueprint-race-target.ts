import type { RaceTarget } from './authoring-race-session'

const CONTEXT = 'E5 blueprint claim and resolution race'
const LOCAL_OPT_IN = 'LAKOKU_E5_BLUEPRINT_RACE_LOCAL'
const CONTAINER_ENV = 'LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER'
const PROJECT_ENV = 'LAKOKU_E5_BLUEPRINT_RACE_PROJECT'
const EXPECTED_DATABASE_IDENTITY =
  'postgres|postgres|false|e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)|e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)'

export interface E5RaceTargetDependencies {
  inspectContainer: (container: string) => string
  readDatabaseIdentity: (target: RaceTarget) => string
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`${CONTEXT}: ${message}`)
}

export function verifyExplicitE5RaceTarget(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: E5RaceTargetDependencies,
): RaceTarget {
  check(
    environment[LOCAL_OPT_IN] === '1',
    `refusing DB access unless ${LOCAL_OPT_IN}=1`,
  )

  const container = environment[CONTAINER_ENV]?.trim()
  check(container, `${CONTAINER_ENV} must be explicit and non-empty`)

  const project = environment[PROJECT_ENV]?.trim()
  check(project, `${PROJECT_ENV} must be explicit and non-empty`)

  const inspected = dependencies.inspectContainer(container).trim()
  check(
    inspected === `${project}|true`,
    'database container label or running state does not match explicit isolated target',
  )

  const target: RaceTarget = {
    container,
    context: CONTEXT,
    applicationPrefix: 'lakoku-e5-blueprint-race',
  }
  const identity = dependencies.readDatabaseIdentity(target).trim()
  check(
    identity === EXPECTED_DATABASE_IDENTITY,
    'isolated local DB identity or final E5 RPC signatures unavailable',
  )
  return target
}
