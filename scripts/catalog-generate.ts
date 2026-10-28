/**
 * Catalog novel generator CLI (Plan 2) — pola runner M10-G, hasil ditulis ke DB.
 *
 *   node scripts/run-smoke.cjs scripts/catalog-generate.ts --provider=deterministic --create \
 *     --story=catalog:uji-coba --title="Judul" --tagline="..." --synopsis="..." \
 *     --protagonist="Raka" --genre=misteri --tropes="Rahasia Keluarga,Kebangkitan Diri"
 *   node scripts/run-smoke.cjs scripts/catalog-generate.ts --story=catalog:uji-coba \
 *     --provider=deterministic --chapters=50
 *   node scripts/run-smoke.cjs scripts/catalog-generate.ts --story=catalog:uji-coba --regenerate=12
 *
 * Keamanan:
 *  - Wajib DATABASE_URL + CATALOG_GENERATE_DB=1 (script ini MENULIS DB).
 *  - Provider gateway (9Router VPS terkualifikasi) wajib CATALOG_GENERATE_AUTHORIZED=1:
 *    satu novel ≈ 120+ panggilan model dan tunduk pada plafon E0 per novel.
 *  - Provider deterministik hanya untuk gate/verifikasi (prosa template, tanpa biaya).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  createDeterministicProvider,
  DEFAULT_RUNTIME_POLICY,
} from '@lakoku/ai-gateway'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { toAiModelRoute, assertM10GG1RouteAuthority } from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../fixtures/m10-g/g1-route-authority-9router'
import { resolveGenreId } from '../lib/taste-profile/catalog'
import { createCatalogDraft, createDbCatalogWriter } from '../lib/catalog/generator-db.server'
import { generateCatalogNovel, regenerateCatalogSpineChapter } from '../lib/catalog/generator.server'

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? (arg.split('=').slice(1).join('=') ?? null) : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function loadEnvLocal(): void {
  // Urutan: .env.local (lokal) menang, .env (konvensi server) mengisi sisanya.
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
}

function requireDbAccess(): void {
  if (process.env.CATALOG_GENERATE_DB !== '1') {
    throw new Error('CATALOG_GENERATE_DB_REQUIRED: script ini menulis DB. Set CATALOG_GENERATE_DB=1 dengan DATABASE_URL yang disengaja.')
  }
  if (!process.env.DATABASE_URL) throw new Error('MISSING_DATABASE_URL')
}

function buildProvider() {
  if (argValue('provider') === 'deterministic') {
    if (process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER !== '1') {
      throw new Error('DETERMINISTIC_PROVIDER_FORBIDDEN: set LAKOKU_ALLOW_DETERMINISTIC_PROVIDER=1 untuk gate/verifikasi.')
    }
    console.log('Provider: deterministic-fake-v1 (tanpa biaya, prosa template)')
    return createDeterministicProvider(DEFAULT_RUNTIME_POLICY)
  }
  if (process.env.CATALOG_GENERATE_AUTHORIZED !== '1') {
    throw new Error('CATALOG_GENERATE_AUTHORIZATION_REQUIRED: set CATALOG_GENERATE_AUTHORIZED=1 dengan otorisasi biaya eksplisit (plafon E0 per novel).')
  }
  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (!baseUrl || !apiKey) throw new Error('MISSING_NINEROUTER_CREDENTIALS')
  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  const provider = createProviderFromExactRoutes({
    writerRoute: toAiModelRoute(authority, 'writer'),
    choicesRoute: toAiModelRoute(authority, 'choice'),
    judgeRoute: toAiModelRoute(authority, 'continuity'),
    generationPolicy: DEFAULT_RUNTIME_POLICY,
  })
  console.log('Provider: 9Router VPS terkualifikasi (otorisasi biaya aktif)')
  return provider
}

async function main(): Promise<void> {
  loadEnvLocal()
  requireDbAccess()
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname
    } catch {
      return '(tidak terbaca)'
    }
  })()
  console.log(`Target database host: ${dbHost}`)
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1' && dbHost !== '::1') {
    console.log('PERINGATAN: menulis ke database non-lokal. Pastikan ini memang disengaja.')
  }

  const storyId = argValue('story')
  const regenerateRaw = argValue('regenerate')

  if (hasFlag('create')) {
    if (!storyId) throw new Error('MISSING_STORY_ID')
    const title = argValue('title')
    const synopsis = argValue('synopsis')
    const protagonist = argValue('protagonist')
    if (!title || !synopsis || !protagonist) {
      throw new Error('CREATE_REQUIRES_TITLE_SYNOPSIS_PROTAGONIST')
    }
    const provider = buildProvider()
    const tropes = (argValue('tropes') ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    const genreRaw = argValue('genre')
    const genreId = genreRaw ? resolveGenreId(genreRaw) : null
    const result = await createCatalogDraft({
      storyId,
      title,
      tagline: argValue('tagline') ?? title,
      synopsis,
      protagonistName: protagonist,
      tropes,
      genreId,
      provider,
    })
    console.log(`Draf dibuat: ${storyId} (kontrak: ${result.contractSource})`)
    console.log(`Lanjutkan: node scripts/run-smoke.cjs scripts/catalog-generate.ts --story=${storyId} --provider=deterministic`)
    return
  }

  if (!storyId) throw new Error('MISSING_STORY_ID')
  const provider = buildProvider()
  const writer = createDbCatalogWriter()
  const log = (message: string): void => console.log(message)

  if (regenerateRaw !== null) {
    const chapterNumber = Number(regenerateRaw)
    if (!Number.isInteger(chapterNumber)) throw new Error(`REGENERATE_INVALID:${regenerateRaw}`)
    await regenerateCatalogSpineChapter({ provider, writer }, { storyId, chapterNumber, log })
    console.log(`Bab ${chapterNumber} ditulis ulang; status tinjauan kembali "belum ditinjau".`)
    return
  }

  const chaptersRaw = argValue('chapters')
  const maxChapters = chaptersRaw ? Number(chaptersRaw) : 50
  if (!Number.isInteger(maxChapters) || maxChapters < 1 || maxChapters > 50) {
    throw new Error(`CHAPTERS_INVALID:${chaptersRaw}`)
  }
  const result = await generateCatalogNovel({ provider, writer }, { storyId, maxChapters, log })
  console.log(`Selesai: spine +${result.spineWritten}, varian +${result.variantsWritten}, lengkap=${result.completed}`)
  if (!result.completed) {
    console.log('Belum lengkap — jalankan lagi perintah yang sama untuk resume.')
  } else {
    console.log('Novel masuk status review. Lanjutkan QC di /admin/katalog.')
  }
}

main().catch((err) => {
  console.error('[catalog-generate] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
