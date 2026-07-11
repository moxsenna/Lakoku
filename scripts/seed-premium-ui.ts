import { createClient } from '@supabase/supabase-js'
import {
  PREMIUM_BILIK_KETUJUH_50_STORY_ID,
  PREMIUM_ROUTE_MAP_50,
  buildAllPremiumBilikKetujuh50Drafts
} from '../fixtures/narrative/premium-bilik-ketujuh-50'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function main() {
  const storyId = PREMIUM_BILIK_KETUJUH_50_STORY_ID

  console.log(`Menghapus data lama untuk ${storyId}...`)
  await db.from('choice_outcomes').delete().eq('story_id', storyId)
  await db.from('chapters').delete().eq('story_id', storyId)
  await db.from('stories').delete().eq('id', storyId)

  console.log('Menyiapkan story record...')
  const { error: storyError } = await db.from('stories').insert({
    id: storyId,
    title: PREMIUM_ROUTE_MAP_50.title,
    cover: '/covers/bilik-ketujuh.webp',
    tagline: 'Kisah misteri di balik tembok pesantren.',
    role: 'Naya',
    tropes: PREMIUM_ROUTE_MAP_50.genre,
    total_chapters: PREMIUM_ROUTE_MAP_50.structure.totalChapters,
    synopsis: 'Sebuah rahasia besar tersembunyi di balik bilik ketujuh...',
    status: 'SELESAI',
    current_chapter: 50,
    visibility: 'public',
    ending_name: 'The True End',
    jejak: [],
  })

  if (storyError) throw storyError

  const drafts = buildAllPremiumBilikKetujuh50Drafts()

  console.log('Menyiapkan chapters dan choice_outcomes...')
  for (const draft of drafts) {
    const isMajorChoice = PREMIUM_ROUTE_MAP_50.structure.majorChoiceChapters.includes(draft.chapterNumber)
    const choices = isMajorChoice
      ? PREMIUM_ROUTE_MAP_50.routes.map(r => ({ id: r.id, label: r.label }))
      : [{ id: 'lanjut', label: 'Lanjutkan membaca' }]

    const choice_prompt = isMajorChoice ? 'Apa yang akan Anda lakukan sekarang?' : 'Terus telusuri ceritanya.'

    const { error: chapterError } = await db.from('chapters').insert({
      story_id: storyId,
      number: draft.chapterNumber,
      title: draft.title || `Bab ${draft.chapterNumber}`,
      paragraphs: draft.paragraphs,
      choice_prompt,
      choices,
    })

    if (chapterError) throw chapterError

    // Buat choice_outcomes
    for (const choice of choices) {
      const consequence = isMajorChoice
        ? PREMIUM_ROUTE_MAP_50.routes.find(r => r.id === choice.id)?.description
        : 'Cerita berlanjut ke bab berikutnya.'

      await db.from('choice_outcomes').insert({
        story_id: storyId,
        chapter: draft.chapterNumber,
        choice_id: choice.id,
        resulting_chapter: draft.chapterNumber < 50 ? draft.chapterNumber + 1 : draft.chapterNumber,
        consequence: consequence || 'Keputusan ini mengubah arah nasib Anda.',
        state_delta: {},
        is_ending: draft.chapterNumber === 50,
        ending_name: draft.chapterNumber === 50 ? 'The End' : null,
      })
    }
  }

  console.log(`Selesai seeding UI untuk story "${storyId}".`)
}

main().catch(console.error)
