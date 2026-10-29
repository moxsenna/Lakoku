import { readFileSync } from 'node:fs'
import { generateCatalogNovel } from '@/lib/catalog/generator.server'
import { createDbCatalogWriter } from '@/lib/catalog/generator-db.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { toAiModelRoute, assertM10GG1RouteAuthority } from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../fixtures/m10-g/g1-route-authority-9router'

const SLUGS = process.argv.slice(2).filter(a => a.startsWith('catalog:'))

function loadEnv(): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(name, 'utf8')
      for (const line of raw.split('\n')) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
        if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
          process.env[match[1]] = match[2]
        }
      }
    } catch { /* file tidak ada */ }
  }
}
loadEnv()

if (SLUGS.length === 0) {
  console.error('Usage: node scripts/run-smoke.cjs scripts/batch-generate.ts catalog:<slug1> catalog:<slug2> ...')
  process.exit(1)
}

function buildProvider() {
  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  return createProviderFromExactRoutes({
    writerRoute: toAiModelRoute(authority, 'writer'),
    choicesRoute: toAiModelRoute(authority, 'choice'),
    judgeRoute: toAiModelRoute(authority, 'continuity'),
    generationPolicy: DEFAULT_RUNTIME_POLICY,
  })
}

async function main(): Promise<void> {
  const provider = buildProvider()
  const writer = createDbCatalogWriter()
  const log = (msg: string) => console.log(msg)

  for (const storyId of SLUGS) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Generating: ${storyId}`)
    console.log('='.repeat(60))
    try {
      const result = await generateCatalogNovel(
        { provider, writer },
        { storyId, maxChapters: 50, log },
      )
      console.log(`[DONE] ${storyId}: spine=${result.spineWritten}, variants=${result.variantsWritten}, complete=${result.completed}`)
      if (!result.completed) {
        console.log(`[RESUME] ${storyId} belum lengkap — jalankan lagi untuk resume.`)
      }
    } catch (err) {
      console.error(`[FAIL] ${storyId}:`, err instanceof Error ? err.message : err)
      console.log(`[RESUME] ${storyId} bisa di-resume dengan menjalankan perintah yang sama.`)
    }
  }
  console.log('\nBatch generation finished.')
}

main().catch((err) => {
  console.error('[batch-generate] FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
