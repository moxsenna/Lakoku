import { getDb, result } from '@lakoku/db'
import {
  PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
  PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP,
  buildAllPremiumBilikKetujuhV2Drafts,
} from '../fixtures/narrative/premium-bilik-ketujuh-v2'

type ChoiceGate = (typeof PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.choiceGates)[keyof typeof PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.choiceGates]
type GateChoice = ChoiceGate['choices'][number]

async function main() {
  const db = getDb()
  const storyId = PREMIUM_BILIK_KETUJUH_V2_STORY_ID

  console.log(`Menghapus data lama untuk ${storyId}...`)
  await db.deleteFrom('choice_outcomes').where('story_id', '=', storyId).execute()
  await db.deleteFrom('chapters').where('story_id', '=', storyId).execute()
  await db.deleteFrom('stories').where('id', '=', storyId).execute()

  // Juga hapus id lama agar tidak membingungkan
  await db.deleteFrom('choice_outcomes').where('story_id', '=', 'premium:bilik-ketujuh-50').execute()
  await db.deleteFrom('chapters').where('story_id', '=', 'premium:bilik-ketujuh-50').execute()
  await db.deleteFrom('stories').where('id', '=', 'premium:bilik-ketujuh-50').execute()

  console.log('Menyiapkan story record...')
  const { error: storyError } = await result(
    db.insertInto('stories').values({
      id: storyId,
      title: PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.title,
      cover: '/covers/bilik-ketujuh.webp',
      tagline: PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.subtitle,
      role: 'Naya',
      tropes: [...PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.genre],
      total_chapters: PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.structure.totalChapters,
      synopsis: 'Sebuah rahasia besar tersembunyi di balik bilik ketujuh...',
      status: 'SELESAI',
      current_chapter: 50,
      visibility: 'public',
      ending_name: 'The True End',
      jejak: [],
    }).execute(),
  )

  if (storyError) throw storyError

  const drafts = buildAllPremiumBilikKetujuhV2Drafts()

  console.log('Menyiapkan chapters dan choice_outcomes...')
  for (const draft of drafts) {
    const gate = PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.choiceGates[draft.chapterNumber as keyof typeof PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.choiceGates]
    
    let choices
    let choice_prompt

    if (gate) {
      choices = gate.choices.map((c: GateChoice) => ({ id: c.id, label: c.label }))
      choice_prompt = gate.prompt
    } else {
      choices = [{ id: 'lanjut', label: 'Lanjutkan membaca' }]
      choice_prompt = 'Terus telusuri ceritanya.'
    }

    const { error: chapterError } = await result(
      db.insertInto('chapters').values({
        story_id: storyId,
        number: draft.chapterNumber,
        title: draft.title || `Bab ${draft.chapterNumber}`,
        paragraphs: draft.paragraphs,
        choice_prompt,
        choices,
      }).execute(),
    )

    if (chapterError) throw chapterError

    for (const choice of choices) {
      let resulting_chapter = draft.chapterNumber < 50 ? draft.chapterNumber + 1 : draft.chapterNumber
      let consequence = 'Cerita berlanjut ke bab berikutnya.'

      if (gate) {
        const c = gate.choices.find((x: GateChoice) => x.id === choice.id)
        if (c) {
          resulting_chapter = c.nextChapter
          consequence = `Mengambil rute ${c.route}`
        }
      }

      const { error: outcomeError } = await result(
        db.insertInto('choice_outcomes').values({
          story_id: storyId,
          chapter_number: draft.chapterNumber,
          choice_id: choice.id,
          next_chapter_number: resulting_chapter,
          consequence: [consequence],
          is_ending: draft.chapterNumber === 50,
        }).execute(),
      )
      if (outcomeError) throw outcomeError
    }
  }

  console.log(`Selesai seeding UI untuk story "${storyId}".`)
}

main().catch(console.error)
