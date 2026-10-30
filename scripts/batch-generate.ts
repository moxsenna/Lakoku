import { readFileSync } from 'node:fs'

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

process.on('uncaughtException', (err) => {
  console.error('[batch-generate] uncaughtException caught (preventing crash):', err.message)
})

process.on('unhandledRejection', (reason) => {
  console.error('[batch-generate] unhandledRejection caught (preventing crash):', reason)
})

import { generateCatalogNovel } from '@/lib/catalog/generator.server'
import { createDbCatalogWriter } from '@/lib/catalog/generator-db.server'
import { DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { toAiModelRoute, assertM10GG1RouteAuthority } from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../fixtures/m10-g/g1-route-authority-9router'

const SLUGS = process.argv.slice(2).filter((a) => a.startsWith('catalog:'))

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

  const pending = new Set(SLUGS)
  let round = 1
  const maxRounds = 15

  console.log(`[batch-generate] Memulai antrean ${pending.size} novel...`)

  while (pending.size > 0 && round <= maxRounds) {
    console.log(`\n${'#'.repeat(60)}`)
    console.log(`[BATCH ROUND ${round}/${maxRounds}] Sisa belum selesai: ${pending.size}`)
    console.log('#'.repeat(60))

    for (const storyId of Array.from(pending)) {
      const state = await writer.loadState(storyId)
      if (state && (state.status === 'review' || state.status === 'published')) {
        console.log(`[ALREADY-DONE] ${storyId}: status=${state.status}`)
        pending.delete(storyId)
        continue
      }

      console.log(`\n${'='.repeat(60)}`)
      console.log(`[ROUND ${round}] Generating: ${storyId}`)
      console.log('='.repeat(60))

      try {
        const result = await generateCatalogNovel(
          { provider, writer },
          { storyId, maxChapters: 50, log },
        )
        console.log(`[RESULT] ${storyId}: spine=${result.spineWritten}, variants=${result.variantsWritten}, complete=${result.completed}`)
        if (result.completed) {
          pending.delete(storyId)
          console.log(`[COMPLETED] ${storyId} telah selesai dan masuk status review!`)
        } else {
          console.log(`[PARTIAL] ${storyId} belum lengkap (akan dilanjutkan di round berikutnya).`)
        }
      } catch (err) {
        console.error(`[ERROR] ${storyId}:`, err instanceof Error ? err.message : err)
        console.log(`[PAUSE] Menunggu 10 detik agar provider tenang sebelum lanjut...`)
        await new Promise((r) => setTimeout(r, 10_000))
      }
    }

    round += 1
    if (pending.size > 0 && round <= maxRounds) {
      console.log(`\n[COOLDOWN] Round selesai. Jeda 15 detik sebelum round ${round}...`)
      await new Promise((r) => setTimeout(r, 15_000))
    }
  }

  if (pending.size === 0) {
    console.log('\n[SUCCESS] Semua novel dalam batch ini telah 100% selesai!')
  } else {
    console.log(`\n[PARTIAL-FINISH] Masih ada ${pending.size} novel belum selesai setelah ${maxRounds} round: ${Array.from(pending).join(', ')}`)
  }
}

main().catch((err) => {
  console.error('[batch-generate] FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
