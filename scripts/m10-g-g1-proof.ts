/**
 * M10-G G-1 proof runner CLI.
 *
 * Modes:
 *   --preflight           offline preflight, zero provider calls / network / DB.
 *   --execute-authorized  live G-1 run. Requires the child-process guard, an
 *                         injected OPENROUTER_API_KEY, an explicit m10g-g1
 *                         story id, LAKOKU_LOCAL_DB_TEST=1, and
 *                         NARRATIVE_PROVIDER=gateway. Never run by preflight.
 *
 * The runner itself never reads credential values; the parent launcher
 * injects them into this child process's environment only.
 */
import {
  M10G_G1_TRACK,
  buildM10GG1RunManifest,
  preflightM10GG1Runner,
  runM10GG1ProofOrchestration as _runM10GG1ProofOrchestration,
} from '../lib/narrative-qa/harness/m10-g-g1.server'
import {
  validateM10GG1RunBudgetAuthority,
} from '../lib/narrative-qa/contracts/m10-g-g1-run-budget.contract'

const M10G_G1_STORY_ID_PATTERN = /^m10c-m10g-g1-[a-z0-9-]+$/

function emit(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload))
}

async function executeAuthorized(): Promise<void> {
  const preflight = preflightM10GG1Runner()
  emit({ ...preflight })
  if (!preflight.ok || !preflight.liveExecutionReady) {
    throw new Error(preflight.code)
  }

  if (process.env.LAKOKU_M10G_G1_CHILD !== '1') {
    throw new Error('M10G_G1_CHILD_PROCESS_REQUIRED')
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error('M10G_G1_CREDENTIAL_MISSING')
  }
  const storyId = process.env.M10G_G1_STORY_ID?.trim() ?? ''
  if (!M10G_G1_STORY_ID_PATTERN.test(storyId)) {
    throw new Error('M10G_G1_STORY_ID_NAMESPACE_INVALID')
  }
  if (process.env.LAKOKU_LOCAL_DB_TEST !== '1') {
    throw new Error('M10G_G1_ISOLATED_DB_FLAG_REQUIRED')
  }
  if (process.env.NARRATIVE_PROVIDER !== 'gateway') {
    throw new Error('M10G_G1_GATEWAY_PROVIDER_REQUIRED')
  }

  const rawAuthorityJson = process.env.M10G_G1_RUN_BUDGET_AUTHORITY_JSON?.trim()
  if (!rawAuthorityJson) {
    throw new Error('M10G_G1_RUN_BUDGET_AUTHORITY_REQUIRED')
  }

  if (process.env.LAKOKU_M10G_G1_EXECUTE_AUTHORIZED !== '1') {
    throw new Error('M10G_G1_EXPLICIT_EXECUTION_AUTHORIZATION_REQUIRED')
  }

  const { manifest, manifestHash } = buildM10GG1RunManifest()
  const authority = validateM10GG1RunBudgetAuthority(JSON.parse(rawAuthorityJson), {
    runId: manifest.runId,
    manifestHash,
    storyId,
  })

  // Live chapter execution is reachable only through the runtime-issued
  // capability, which binds the exact production personalized executor and the
  // frozen route snapshot. No executor is injectable here.
  const { runM10GG1ProofOrchestrationLive } = await import(
    '../lib/narrative-qa/harness/m10-g-g1-runner.server'
  )
  const { issueM10GG1ExecutionCapability } = await import(
    '../lib/runtime/m10-g-g1-execution-capability.server'
  )

  // The long-horizon semantic judge has no production transport adapter: it
  // still requires an injected trusted-capture transport. Refuse before any
  // chapter transport rather than spending 50 chapters and failing at sample 1.
  const semanticAdapterBound = false
  if (!semanticAdapterBound) {
    throw new Error(`M10G_G1_SEMANTIC_LIVE_ADAPTER_UNBOUND:${authority.runId}`)
  }

  const result = await runM10GG1ProofOrchestrationLive({
    manifest,
    manifestHash,
    authority,
    capability: issueM10GG1ExecutionCapability(),
    deps: {
      executeSemanticSample: () => {
        throw new Error('M10G_G1_SEMANTIC_LIVE_ADAPTER_UNBOUND')
      },
    },
  })
  emit({ track: M10G_G1_TRACK, ...result, manifest: undefined })
}

async function main(): Promise<void> {
  if (process.argv.includes('--preflight')) {
    const result = preflightM10GG1Runner()
    emit({ ...result })
    if (!result.ok) process.exitCode = 1
    return
  }
  if (process.argv.includes('--execute-authorized')) {
    await executeAuthorized()
    return
  }
  throw new Error('M10G_G1_MODE_REQUIRED')
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    track: M10G_G1_TRACK,
    aborted: true,
    code: error instanceof Error && /^M10G_G1_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'M10G_G1_UNEXPECTED_ERROR',
    artifactWritten: false,
  }))
  process.exitCode = 1
})
