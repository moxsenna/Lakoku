import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { M10_G_SEMANTIC_AUTHORITY, assertM10GSemanticAuthority } from '../fixtures/m10-g/semantic-authority'
import { createGlobalInferenceBudget } from '@lakoku/ai-gateway'
import { M10GSemanticIdentitySchema } from '../lib/narrative-qa/contracts/m10-g-semantic-contract'
import type { M10GAuthoritativeSemanticAttempt } from '../lib/narrative-qa/judges/m10-g-semantic-executor.server'
import { assembleM10GSemanticCases } from '../lib/narrative-qa/judges/m10-g-semantic-assembly'
import { buildM10GSemanticArtifact } from '../lib/narrative-qa/judges/m10-g-semantic-artifact'
import { createM10GSemanticCaptureWriter } from '../lib/narrative-qa/judges/m10-g-semantic-capture.server'
import { executeM10GSemanticJudgeWithTrustedCapture } from '../lib/narrative-qa/judges/m10-g-semantic-executor.server'
import { deriveM10GSemanticAggregate } from '../lib/narrative-qa/judges/m10-g-semantic-policy'
import { evaluateM10GSemanticSurfaceLoaderReadiness } from '../lib/narrative-qa/judges/m10-g-semantic-readiness'
import { buildM10GStorySurfaceFromTrustedSources } from '../lib/narrative-qa/judges/m10-g-semantic-surface.server'
import { stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'

const REQUIRED_EXECUTE_ENV = [
  'M10G_SEMANTIC_EXECUTION_AUTHORIZATION',
  'OPENROUTER_API_KEY',
  'M10G_SEMANTIC_SOURCE_MANIFEST_PATH',
  'M10G_SEMANTIC_SOURCE_CAPTURE_PATH',
  'M10G_SEMANTIC_ARTIFACT_PATH',
  'M10G_SEMANTIC_STORY_ID',
  'M10G_SEMANTIC_RUN_ID',
  'M10G_SEMANTIC_CORRELATION_ID',
  'M10G_SEMANTIC_PROFILE_ID',
  'M10G_SEMANTIC_ROUTE_CLASS',
  'M10G_GLOBAL_BUDGET_AUTHORITY_PATH',
] as const

export interface M10GSemanticCliEnvironment {
  [key: string]: string | undefined
}

const GlobalBudgetAuthoritySchema = z.object({
  schemaVersion: z.literal(1),
  authorityId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  hardLimit: z.number().int().min(36),
  authorization: z.literal('M10G_GLOBAL_INFERENCE_BUDGET_AUTHORIZED'),
}).strict()

export function preflightM10GSemanticCli() {
  const authority = assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
  const readiness = evaluateM10GSemanticSurfaceLoaderReadiness()
  return {
    track: 'M10G_SEMANTIC_SURFACE_AUTHORITY_V1' as const,
    mode: 'PREFLIGHT' as const,
    architectureStatus: readiness.architectureStatus,
    runInputStatus: 'RUN_INPUTS_NOT_YET_AVAILABLE' as const,
    semanticAuthorityHash: authority.authorityHash,
    providerCalls: 0 as const,
    networkAttempts: 0 as const,
    dbCalls: 0 as const,
    artifactWritten: false as const,
    liveExecutionAuthorized: false as const,
  }
}

export function assertM10GSemanticExecuteGuard(env: M10GSemanticCliEnvironment): void {
  if (env.M10G_SEMANTIC_EXECUTION_AUTHORIZATION !== 'AUTHORIZED') {
    throw new Error('M10G_SEMANTIC_EXECUTION_AUTHORIZATION_REQUIRED')
  }
  if (env.LAKOKU_M10G_SEMANTIC_CHILD !== '1') throw new Error('M10G_SEMANTIC_CHILD_PROCESS_REQUIRED')
  if (env.LAKOKU_LOCAL_DB_TEST !== '1') throw new Error('M10G_SEMANTIC_ISOLATED_DB_FLAG_REQUIRED')
  if (env.NARRATIVE_PROVIDER !== 'gateway') throw new Error('M10G_SEMANTIC_GATEWAY_PROVIDER_REQUIRED')
  for (const name of REQUIRED_EXECUTE_ENV) {
    if (!env[name]?.trim()) throw new Error(`M10G_SEMANTIC_EXECUTE_INPUT_REQUIRED_${name}`)
  }
  M10GSemanticIdentitySchema.parse({
    kind: 'NOVEL',
    profileId: env.M10G_SEMANTIC_PROFILE_ID,
    routeClass: env.M10G_SEMANTIC_ROUTE_CLASS,
    storyId: env.M10G_SEMANTIC_STORY_ID,
    runId: env.M10G_SEMANTIC_RUN_ID,
    correlationId: env.M10G_SEMANTIC_CORRELATION_ID,
  })
  resolve(env.M10G_SEMANTIC_SOURCE_MANIFEST_PATH!)
  resolve(env.M10G_SEMANTIC_SOURCE_CAPTURE_PATH!)
  resolve(env.M10G_SEMANTIC_ARTIFACT_PATH!)
  resolve(env.M10G_GLOBAL_BUDGET_AUTHORITY_PATH!)
}

async function main(): Promise<void> {
  if (process.argv.includes('--preflight')) {
    console.log(JSON.stringify(preflightM10GSemanticCli()))
    return
  }
  if (process.argv.includes('--execute-authorized')) {
    assertM10GSemanticExecuteGuard(process.env)
    const authority = assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
    const identity = M10GSemanticIdentitySchema.parse({
      kind: 'NOVEL',
      profileId: process.env.M10G_SEMANTIC_PROFILE_ID,
      routeClass: process.env.M10G_SEMANTIC_ROUTE_CLASS,
      storyId: process.env.M10G_SEMANTIC_STORY_ID,
      runId: process.env.M10G_SEMANTIC_RUN_ID,
      correlationId: process.env.M10G_SEMANTIC_CORRELATION_ID,
    })
    const sourceManifestPath = resolve(process.env.M10G_SEMANTIC_SOURCE_MANIFEST_PATH!)
    const sourceCapturePath = resolve(process.env.M10G_SEMANTIC_SOURCE_CAPTURE_PATH!)
    const outputPath = resolve(process.env.M10G_SEMANTIC_ARTIFACT_PATH!)
    const budgetAuthority = GlobalBudgetAuthoritySchema.parse(JSON.parse(
      readFileSync(resolve(process.env.M10G_GLOBAL_BUDGET_AUTHORITY_PATH!), 'utf8'),
    ) as unknown)
    if (budgetAuthority.runId !== identity.runId) throw new Error('M10G_GLOBAL_BUDGET_AUTHORITY_RUN_MISMATCH')
    const budget = createGlobalInferenceBudget({
      runId: budgetAuthority.runId,
      hardLimit: budgetAuthority.hardLimit,
    })
    const surface = await buildM10GStorySurfaceFromTrustedSources({
      identity, sourceManifestPath, sourceCapturePath,
    })
    const assembledCases = assembleM10GSemanticCases(surface, authority)
    const captureWriter = createM10GSemanticCaptureWriter(`${outputPath}.attempts.jsonl`)
    const attempts: M10GAuthoritativeSemanticAttempt[] = []
    for (const assembled of assembledCases) {
      for (let sampleIndex = 0; sampleIndex < authority.sampleCountPerCase; sampleIndex += 1) {
        attempts.push(await executeM10GSemanticJudgeWithTrustedCapture({
          assembled,
          authority,
          sampleIndex,
          executionOptions: {
            telemetryContext: {
              userId: process.env.M10G_SEMANTIC_USER_ID?.trim() || 'm10g-semantic-authority',
              storyId: identity.storyId,
              chapterNumber: null,
              generationKind: null,
              jobId: null,
              correlationId: identity.correlationId,
              attemptNumber: null,
            },
            workflowPhase: 'M10_G_SEMANTIC_JUDGE',
            m10gMode: true,
            globalInferenceBudget: budget,
          },
          captureWriter,
        }))
      }
    }
    const aggregates = assembledCases.map((assembled) => deriveM10GSemanticAggregate({
      assembled, authority, attempts,
    }))
    const artifact = buildM10GSemanticArtifact({
      identity, authority, sourceManifestPath, sourceCapturePath, surface, attempts, aggregates,
    })
    writeFileSync(outputPath, `${stableStringify(artifact)}\n`, 'utf8')
    console.log(JSON.stringify({
      track: 'M10G_SEMANTIC_SURFACE_AUTHORITY_V1',
      artifactPath: outputPath,
      artifactHash: artifact.artifactHash,
      gate: artifact.gate.outcome,
      consumedInferenceCount: budget.consumed,
    }))
    if (artifact.gate.outcome !== 'PASS') process.exitCode = 1
    return
  }
  throw new Error('M10G_SEMANTIC_MODE_REQUIRED')
}

const importedByVitest = process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined
if (!importedByVitest) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
