import { assertLoopbackSupabaseUrl } from './personalized-db-safety'

export type CandidateOutcome =
  | 'valid'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'HTTP_5XX'
  | 'NETWORK_ERROR'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'QUALITY_UNGROUNDED'
  | 'QUALITY_NOT_DISTINCT'

export type JobScript = Readonly<{
  prose: readonly CandidateOutcome[]
  choices: readonly CandidateOutcome[]
}>

export function immutableJobScript(input: {
  prose: CandidateOutcome[]
  choices: CandidateOutcome[]
}): JobScript {
  return Object.freeze({
    prose: Object.freeze([...input.prose]),
    choices: Object.freeze([...input.choices]),
  })
}

export async function assertLocalSoakEnvironment(input: {
  apiUrl: string
  dbUrl: string
  projectId: string
  containerProject: string
  marker: string
  explicitOptIn: string | undefined
  networkProbe: (apiUrl: string) => Promise<void>
}): Promise<void> {
  const fail = (reason: string): never => { throw new Error(`local worker soak: ${reason}`) }
  if (input.explicitOptIn !== '1') fail('LAKOKU_LOCAL_WORKER_SOAK=1 required')
  try {
    assertLoopbackSupabaseUrl(input.apiUrl)
    assertLoopbackSupabaseUrl(input.dbUrl)
  } catch {
    fail('loopback Supabase API and DB required')
  }
  if (!input.projectId || input.containerProject !== input.projectId) {
    fail('matching local Supabase Docker project required')
  }
  if (input.marker !== 'local-cli') fail('persistent DB marker local-cli required')
  try {
    await input.networkProbe(input.apiUrl)
  } catch {
    fail('local Supabase network probe failed')
  }
}

export async function pollUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`${options.label} timed out`)
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
  }
}
