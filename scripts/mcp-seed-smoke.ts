/**
 * Smoke MCP Seed: jalur penuh assign → pump → 62 unit → review.
 *
 * Wajib env eksplisit (menulis DB):
 *   MCP_SEED_SMOKE=1 CATALOG_GENERATE_DB=1 DATABASE_URL=... \
 *   pnpm smoke:mcp-seed
 *
 * Prosa & pilihan pakai provider deterministic (nol biaya). Novel hasil
 * smoke DIARSIPKAN (catalog_stories.status='archived', stories.status='SELESAI')
 * di akhir run agar katalog tetap bersih.
 */
import fs from 'node:fs'
import path from 'node:path'

for (const name of ['.env.local', '.env']) {
  const envPath = path.resolve(process.cwd(), name)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
    if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

if (process.env.MCP_SEED_SMOKE !== '1' || process.env.CATALOG_GENERATE_DB !== '1' || !process.env.DATABASE_URL) {
  console.error('MCP_SEED_SMOKE_REQUIRED: set MCP_SEED_SMOKE=1 CATALOG_GENERATE_DB=1 DATABASE_URL=...')
  process.exit(1)
}

import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { createCatalogDraft, createDbCatalogWriter } from '../lib/catalog/generator-db.server'
import { createMcpSeedPump, mapUnits } from '../lib/mcp-seed/pump.server'
import { createAutoResponderProseStore, unitKeyOf } from '../lib/mcp-seed/agent-provider.server'
import { getDb, result } from '@lakoku/db'

const STORY_TITLE = 'Smoke MCP Seed'

async function main(): Promise<void> {
  const storyId = `catalog:smoke-mcp-${Date.now()}`
  console.log(`[smoke-mcp] draf: ${storyId}`)
  await createCatalogDraft({
    storyId,
    title: STORY_TITLE,
    tagline: STORY_TITLE,
    synopsis: 'Smoke test MCP seed: cerita uji deterministik untuk memastikan jalur agent-pump tuntas.',
    protagonistName: 'Uji',
    tropes: ['Smoke Test'],
    genreId: 'mystery',
    provider: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
    source: 'gemini-agent',
  })
  const pump = createMcpSeedPump({
    writer: createDbCatalogWriter(),
    inner: createDeterministicProvider(DEFAULT_RUNTIME_POLICY),
    store: createAutoResponderProseStore(),
    proseTimeoutMs: 60_000,
  })
  pump.kick(storyId)
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    if (!pump.isRunning(storyId)) break
    await new Promise((r) => setTimeout(r, 1_000))
  }
  if (pump.isRunning(storyId)) {
    throw new Error('MCP_SMOKE_TIMEOUT: pump masih berjalan setelah 10 menit')
  }
  const error = pump.lastError(storyId)
  if (error) throw new Error(`PUMP_ERROR:${error}`)
  const contract = await (async () => {
    const db = getDb()
    const rows = await db.selectFrom('catalog_stories')
      .select('contract_json')
      .where('story_id', '=', storyId)
      .limit(1).execute()
    const raw = rows[0]?.contract_json
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as import('@/lib/story-engine/story-contract').StoryContract
  })()
  const allUnits = mapUnits(contract)
  const totalUnits = allUnits.length
  if (totalUnits !== 62) throw new Error(`UNIT_COUNT_UNEXPECTED:${totalUnits}`)
  const committed = allUnits.filter((unit) =>
    pump.commits.committed(storyId, unitKeyOf(unit.endingKey, unit.number)),
  ).length
  console.log(`[smoke-mcp] unit commit: ${committed}/${totalUnits}`)
  if (committed !== totalUnits) throw new Error(`UNIT_INCOMPLETE:${committed}/${totalUnits}`)
  await pump.markReview(storyId)

  // Arsipkan smoke story agar katalog bersih.
  // Note: constraint stories_status_check hanya mengizinkan 'BARU' | 'BERJALAN' | 'SELESAI'.
  // markReview() sudah mengubah stories.status menjadi 'SELESAI'.
  // catalog_stories.status diubah ke 'archived'.
  const db = getDb()
  const archiveCatalogResult = await result(
    db.updateTable('catalog_stories')
      .set({ status: 'archived', updated_at: new Date().toISOString() })
      .where('story_id', '=', storyId)
      .execute(),
  )
  if (archiveCatalogResult.error) {
    throw new Error(`[smoke-mcp] arsip gagal: ${archiveCatalogResult.error.message}`)
  }
  const archiveStoriesResult = await result(
    db.updateTable('stories')
      .set({ status: 'SELESAI' })
      .where('id', '=', storyId)
      .execute(),
  )
  if (archiveStoriesResult.error) {
    throw new Error(`[smoke-mcp] arsip gagal: ${archiveStoriesResult.error.message}`)
  }
  console.log(`[smoke-mcp] PASS: ${storyId} (diarsipkan)`)
}

main().catch((err) => {
  console.error('[smoke-mcp] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
