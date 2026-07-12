import { createClient } from '@supabase/supabase-js'
import {
  PREMIUM_BILIK_KETUJUH_KBM_V2_STORY_ID,
  PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP,
  buildAllPremiumBilikKetujuhKbmV2Drafts
} from '../fixtures/narrative/premium-bilik-ketujuh-kbm-v2'

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
  const storyId = PREMIUM_BILIK_KETUJUH_KBM_V2_STORY_ID

  console.log(`Menghapus data lama untuk ${storyId}...`)
  await db.from('choice_outcomes').delete().eq('story_id', storyId)
  await db.from('chapters').delete().eq('story_id', storyId)
  await db.from('stories').delete().eq('id', storyId)

  // Juga hapus id lama agar tidak membingungkan
  await db.from('choice_outcomes').delete().eq('story_id', 'premium:bilik-ketujuh-50')
  await db.from('chapters').delete().eq('story_id', 'premium:bilik-ketujuh-50')
  await db.from('stories').delete().eq('id', 'premium:bilik-ketujuh-50')

  console.log('Menyiapkan story record...')
  const { error: storyError } = await db.from('stories').insert({
    id: storyId,
    title: PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.title,
    cover: '/covers/bilik-ketujuh.webp',
    tagline: PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.subtitle,
    role: 'Naya',
    tropes: PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.genre,
    total_chapters: PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.structure.totalChapters,
    synopsis: 'Sebuah rahasia besar tersembunyi di balik bilik ketujuh...',
    status: 'SELESAI',
    current_chapter: 50,
    visibility: 'public',
    ending_name: 'The True End',
    jejak: [],
  })

  if (storyError) throw storyError

  const drafts = buildAllPremiumBilikKetujuhKbmV2Drafts()

  console.log('Menyiapkan chapters dan choice_outcomes...')
  for (const draft of drafts) {
    const gate = PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.choiceGates[draft.chapterNumber as keyof typeof PREMIUM_BILIK_KETUJUH_KBM_V2_ROUTE_MAP.choiceGates]
    
    let choices
    let choice_prompt

    if (gate) {
      choices = gate.choices.map((c: any) => ({ id: c.id, label: c.label }))
      choice_prompt = gate.prompt
    } else {
      choices = [{ id: 'lanjut', label: 'Lanjutkan membaca' }]
      choice_prompt = 'Terus telusuri ceritanya.'
    }

    const { error: chapterError } = await db.from('chapters').insert({
      story_id: storyId,
      number: draft.chapterNumber,
      title: draft.title || `Bab ${draft.chapterNumber}`,
      paragraphs: draft.paragraphs,
      choice_prompt,
      choices,
    })

    if (chapterError) throw chapterError

    for (const choice of choices) {
      let resulting_chapter = draft.chapterNumber < 50 ? draft.chapterNumber + 1 : draft.chapterNumber
      let consequence = 'Cerita berlanjut ke bab berikutnya.'
      let state_delta = {}

      if (gate) {
        const c = gate.choices.find((x: any) => x.id === choice.id) as any
        if (c) {
          resulting_chapter = c.nextChapter
          consequence = `Mengambil rute ${c.route}`
          state_delta = c.stateDelta || {}
        }
      }

      const { error: outcomeError } = await db.from('choice_outcomes').insert({
        story_id: storyId,
        chapter_number: draft.chapterNumber,
        choice_id: choice.id,
        next_chapter_number: resulting_chapter,
        consequence: [consequence],
        is_ending: draft.chapterNumber === 50,
      })
      if (outcomeError) throw outcomeError
    }
  }

  console.log(`Selesai seeding UI untuk story "${storyId}".`)
}

main().catch(console.error)
