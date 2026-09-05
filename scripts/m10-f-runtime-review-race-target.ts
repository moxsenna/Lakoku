import type { RaceTarget } from './authoring-race-session'

export const CONTEXT = 'M10-F runtime review enqueue and E5 disposition race'
export const LOCAL_OPT_IN = 'LAKOKU_M10F_RUNTIME_REVIEW_RACE_LOCAL'
export const CONTAINER_ENV = 'LAKOKU_M10F_RUNTIME_REVIEW_RACE_DB_CONTAINER'
export const PROJECT_ENV = 'LAKOKU_M10F_RUNTIME_REVIEW_RACE_PROJECT'
export const EXPECTED_DATABASE_IDENTITY =
  'postgres|postgres|false|e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)|enqueue_runtime_review_v1(text,integer,integer,jsonb,text,text,text,text,uuid)'

export interface RuntimeReviewRaceTargetDependencies {
  inspectContainer: (container: string) => string
  readDatabaseIdentity: (target: RaceTarget) => string
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`${CONTEXT}: ${message}`)
}

export function verifyExplicitRuntimeReviewRaceTarget(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: RuntimeReviewRaceTargetDependencies,
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
    applicationPrefix: 'lakoku-m10f-review-race',
  }
  const identity = dependencies.readDatabaseIdentity(target).trim()
  check(
    identity === EXPECTED_DATABASE_IDENTITY,
    'isolated local DB identity or required E5 / review enqueue RPC signatures unavailable',
  )
  return target
}
