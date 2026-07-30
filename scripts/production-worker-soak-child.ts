import path from 'node:path'
import {
  createOutboundNetworkSentinel,
  createScenarioRegistry,
  immutableProductionJobScript,
  type ProgrammedCandidate,
} from './production-worker-soak-support'

function observed(text: string) {
  if (text.startsWith('{')) {
    return {
      text: Promise.resolve(text),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      finalStep: Promise.resolve({ response: { modelId: 'local/transport' }, providerMetadata: {} }),
    }
  }
  return {
    text: Promise.resolve(`JUDUL: Jejak Arsip Hujan\n\n${text}`),
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    finalStep: Promise.resolve({ response: { modelId: 'local/transport' }, providerMetadata: {} }),
  }
}

async function main() {
  const jobId = process.env.LAKOKU_SOAK_CHILD_JOB_ID
  const raw = process.env.LAKOKU_SOAK_CHILD_SCRIPT
  if (!jobId || !raw) throw new Error('production worker soak child: job id/script required')
  const parsed = JSON.parse(raw) as { prose: ProgrammedCandidate[]; choices: ProgrammedCandidate[] }
  const storyId = process.env.LAKOKU_SOAK_CHILD_STORY_ID
  const runId = process.env.LAKOKU_SOAK_RUN_ID
  if (!storyId || !runId) throw new Error('production worker soak child: run/story identity required')
  const artifactDir = process.env.LAKOKU_SOAK_ARTIFACT_DIR
  if (!artifactDir || !path.isAbsolute(artifactDir)) throw new Error('production worker soak child: absolute artifact dir required')
  const script = immutableProductionJobScript(parsed)
  const registry = createScenarioRegistry(runId, 40, artifactDir)
  registry.add({ storyId, jobId, script })
  const transport = registry.transport(storyId, jobId, observed)
  const originalFetch = globalThis.fetch
  globalThis.fetch = createOutboundNetworkSentinel(originalFetch)
  process.env.NARRATIVE_PROVIDER = 'gateway'
  process.env.NARRATIVE_MODEL = 'local/prose'
  process.env.CUSTOM_LLM_BASE_URL = 'http://127.0.0.1:1/provider-a'
  process.env.CUSTOM_LLM_API_KEY = 'local-soak-provider-a'
  process.env.NINEROUTER_BASE_URL = 'http://127.0.0.1:1/provider-b'
  process.env.NINEROUTER_API_KEY = 'local-soak-provider-b'
  delete process.env.OPENROUTER_API_KEY
  delete process.env.LAKOKU_CHOICES_MODEL
  delete process.env.LAKOKU_ALLOW_CHOICES_PROSE_FALLBACK
  const { claimAndRunGenerationJobById } = await import('@lakoku/runtime')
  try {
    const result = await claimAndRunGenerationJobById(
      { jobId, workerId: `soak-child:${process.pid}` },
      { providerRuntime: { candidateTransport: transport } },
    )
    if (!result.ok) throw new Error(`production worker soak child failed: ${JSON.stringify(result)}`)
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
