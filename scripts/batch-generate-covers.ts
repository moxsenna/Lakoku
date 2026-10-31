import { readFileSync } from 'node:fs'

for (const name of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(name, 'utf8')
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
      if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
  } catch {}
}

// Ensure 9router image generation endpoint is used
process.env.COVER_IMAGE_BASE_URL = 'https://9router.appvibe.web.id/v1'
process.env.COVER_IMAGE_API_KEY = process.env.NINEROUTER_API_KEY
process.env.COVER_IMAGE_MODEL_ID = 'ag/gemini-3.1-flash-image'

import { Pool } from 'pg'
import { generateCoverImage, isCoverProviderConfigured } from '@/lib/cover/provider'
import { normalizeCoverImage } from '@/lib/cover/image'
import { putCover } from '@/lib/cover/storage'
import { resolveStoryCover } from '@/lib/cover/url'
import { publishCatalogStory } from '@/lib/catalog/admin.server'
import type { CoverPresetKey } from '@lakoku/contracts'

const ADMIN_ID = '999d7612-e7e5-4d7a-bade-95b8ec746225'

const PRESET_BY_GENRE: Record<string, CoverPresetKey> = {
  family_drama: 'sinematik',
  romance: 'sinematik',
  mystery: 'gelap',
  fantasy_kingdom: 'fantasi',
  slice_of_life: 'sinematik',
  survival_thriller: 'gelap',
}

async function generateAndSaveCover(
  pool: Pool,
  story: { id: string; title: string; tagline: string; role: string; tropes: unknown; genre: string }
): Promise<string | null> {
  const storyId = story.id
  const preset = PRESET_BY_GENRE[story.genre] ?? 'sinematik'
  // pg mengembalikan jsonb sebagai array siap pakai; kolom legacy teks
  // masih ditangani lewat JSON.parse.
  const tropes: string[] =
    typeof story.tropes === 'string'
      ? JSON.parse(story.tropes)
      : Array.isArray(story.tropes)
        ? story.tropes.map((t) => String(t))
        : []

  console.log(`\nGenerating cover for ${storyId} ("${story.title}")...`)

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const genResult = await generateCoverImage({
        title: story.title,
        tagline: story.tagline,
        role: `${story.role}, tokoh utama`,
        tropes,
        preset,
        includeTitle: true,
      })

      if (!genResult.ok) {
        console.warn(`  [ATTEMPT ${attempt}] generate failed: ${genResult.reason} - ${genResult.detail}`)
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000))
        continue
      }

      const norm = await normalizeCoverImage(genResult.image)
      const stored = await putCover(storyId, norm.data)
      if (!stored.ok) {
        console.warn(`  [ATTEMPT ${attempt}] putCover failed: ${stored.detail}`)
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000))
        continue
      }

      await pool.query(`update stories set cover = $1 where id = $2`, [stored.key, storyId])
      const publicUrl = resolveStoryCover(stored.key)
      console.log(`  [OK] Cover saved: ${stored.key} (${publicUrl})`)
      return stored.key
    } catch (err) {
      console.warn(`  [ATTEMPT ${attempt}] error:`, err instanceof Error ? err.message : err)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000))
    }
  }

  console.error(`  [FAILED] All attempts exhausted for ${storyId}`)
  return null
}

async function main() {
  if (!isCoverProviderConfigured()) {
    throw new Error('Cover provider not configured')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const query = `
    select s.id, s.title, s.tagline, s.role, s.tropes, cs.contract_json->>'genre' as genre, s.cover, cs.status
    from stories s
    join catalog_stories cs on cs.story_id = s.id
    where s.id like 'catalog:%'
    order by s.id
  `
  const stories = await pool.query<{
    id: string
    title: string
    tagline: string
    role: string
    tropes: unknown
    genre: string
    cover: string
    status: string
  }>(query)

  console.log(`Found ${stories.rows.length} total catalog stories.\n`)

  // Mode perbaikan ter-target: `npx tsx scripts/batch-generate-covers.ts <substring-id> ...`
  // Dengan argumen, hanya cerita yang id-nya memuat salah satu substring yang
  // diproses DAN cover lama dipaksa di-regenerate — untuk memperbaiki sampul
  // yang rusak. Tanpa argumen, perilaku lama: semua cerita, yang sudah punya
  // cover R2 dilewati.
  const targets = process.argv.slice(2).filter((a) => a.trim() !== '')
  const force = targets.length > 0
  const selected = force
    ? stories.rows.filter((s) => targets.some((t) => s.id.includes(t)))
    : stories.rows
  if (force) {
    console.log(
      `Repair mode: ${selected.length} story dipilih berdasarkan filter ${JSON.stringify(targets)}. Cover lama DIREGENERATE PAKSA.\n`,
    )
    if (selected.length === 0) {
      console.error('Tidak ada story yang cocok dengan filter — hentikan, tidak ada yang diubah.')
      await pool.end()
      return
    }
  }

  let coverSuccess = 0
  for (const story of selected) {
    // If cover already uploaded to R2, skip re-generation
    if (!force && story.cover && story.cover.startsWith('catalog_') && story.cover.endsWith('.webp')) {
      console.log(`[SKIP COVER] ${story.id} already has R2 cover: ${story.cover}`)
      coverSuccess++
    } else {
      const key = await generateAndSaveCover(pool, story)
      if (key) coverSuccess++
      // Short pause between generations to pace requests
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  console.log(`\nCover generation summary: ${coverSuccess}/${selected.length} have valid covers.`)

  // Step 2: Publish all review-ready stories
  console.log('\nPublishing all review-ready stories...')
  let publishedCount = 0

  for (const story of selected) {
    if (story.status === 'published') {
      console.log(`[ALREADY PUBLISHED] ${story.id}`)
      publishedCount++
      continue
    }

    try {
      await publishCatalogStory({
        storyId: story.id,
        adminUserId: ADMIN_ID,
      })
      console.log(`[PUBLISHED OK] ${story.id} ("${story.title}") is now LIVE!`)
      publishedCount++
    } catch (err) {
      console.error(`[PUBLISH FAILED] ${story.id}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n============================================================`)
  console.log(`FINAL RESULT: ${publishedCount}/${selected.length} stories PUBLISHED and LIVE!`)
  console.log(`============================================================`)

  await pool.end()
}

main().catch((err) => {
  console.error('Fatal batch cover and publish error:', err)
  process.exit(1)
})
