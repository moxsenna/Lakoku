/**
 * Seed Supabase dengan konten fixtures (konten published demo).
 * Jalankan: set -a && source /vercel/share/.env.project && set +a && npx tsx scripts/seed-supabase.ts
 *
 * Memakai service role key — HANYA untuk script/server, tidak pernah di client.
 * Idempotent: upsert berdasarkan primary key.
 */
import { createClient } from '@supabase/supabase-js'
import {
  storyFixtures as stories,
  chapterFixtures as chapters,
  outcomeFixtures as outcomes,
} from '../lib/api/fixtures'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di env.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)

async function main() {
  // 1) stories
  const storyRows = stories.map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    tagline: s.tagline,
    role: s.role,
    tropes: s.tropes,
    total_chapters: s.totalChapters,
    synopsis: s.synopsis,
    status: s.status,
    current_chapter: s.currentChapter,
    jejak: s.jejak,
    ending_name: s.endingName ?? null,
  }))
  const { error: e1 } = await supabase.from('stories').upsert(storyRows)
  if (e1) throw new Error(`stories: ${e1.message}`)
  console.log(`[seed] stories: ${storyRows.length} baris`)

  // 2) chapters
  const chapterRows = chapters.map((c) => ({
    story_id: c.storyId,
    number: c.number,
    title: c.title,
    paragraphs: c.paragraphs,
    choice_prompt: c.choicePrompt,
    choices: c.choices,
  }))
  const { error: e2 } = await supabase.from('chapters').upsert(chapterRows)
  if (e2) throw new Error(`chapters: ${e2.message}`)
  console.log(`[seed] chapters: ${chapterRows.length} baris`)

  // 3) choice_outcomes
  const outcomeRows = Object.values(outcomes).map((o) => ({
    story_id: o.storyId,
    chapter_number: o.chapterNumber,
    choice_id: o.choiceId,
    consequence: o.consequence,
    next_chapter_number: o.nextChapterNumber,
    is_ending: o.isEnding,
  }))
  const { error: e3 } = await supabase.from('choice_outcomes').upsert(outcomeRows)
  if (e3) throw new Error(`choice_outcomes: ${e3.message}`)
  console.log(`[seed] choice_outcomes: ${outcomeRows.length} baris`)

  console.log('[seed] selesai.')
}

main().catch((err) => {
  console.error('[seed] gagal:', err.message)
  process.exit(1)
})
