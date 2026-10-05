import { getDb, single, result } from '@lakoku/db'
import { generateNextChapterReal } from '@lakoku/runtime'

const STORY = 'pulang-ke-tanah-yang-masih-marah-o9bple'
const USER = '999d7612-e7e5-4d7a-bade-95b8ec746225'

async function main() {
  const target = Number(process.env.REGEN_CHAPTER)
  if (!Number.isInteger(target) || target < 1) throw new Error('REGEN_CHAPTER invalid')
  if (process.env.NARRATIVE_PROVIDER !== 'gateway') {
    throw new Error('refuse: NARRATIVE_PROVIDER must be gateway')
  }
  const db = getDb()

  const { error: delErr } = await result(
    db
      .deleteFrom('chapters')
      .where('story_id', '=', STORY)
      .where('number', '=', target)
      .execute(),
  )
  if (delErr) throw delErr
  console.log(`deleted Bab ${target}`)

  await db
    .deleteFrom('chapter_generation_checkpoints')
    .where('story_id', '=', STORY)
    .where('chapter_number', '=', target)
    .execute()
  await db
    .deleteFrom('generation_leases')
    .where('story_id', '=', STORY)
    .where('chapter_number', '=', target)
    .execute()

  // Trigger harus id pilihan yang benar-benar diambil pembaca, bukan indeks 0.
  const { data: rs } = await single(
    db
      .selectFrom('reader_states')
      .select('choice_history')
      .where('story_id', '=', STORY)
      .where('user_id', '=', USER)
      .limit(1)
      .execute(),
  )
  const history: Array<{ choiceId?: string; chapterNumber?: number }> =
    Array.isArray(rs?.choice_history) ? (rs.choice_history as Array<{ choiceId?: string; chapterNumber?: number }>) : []
  const fromHistory = history.find((e) => e.chapterNumber === target - 1)?.choiceId ?? null

  const { data: prev } = await single(
    db
      .selectFrom('chapters')
      .select('choices')
      .where('story_id', '=', STORY)
      .where('number', '=', target - 1)
      .limit(1)
      .execute(),
  )
  const validIds = Array.isArray(prev?.choices)
    ? ((prev.choices as Array<{ id?: string }>).map((x) => x.id).filter(Boolean) as string[])
    : []
  const triggerChoiceId =
    fromHistory && validIds.includes(fromHistory) ? fromHistory : validIds[0] ?? null
  console.log('triggerChoiceId:', triggerChoiceId, '(history:', fromHistory, ')')

  const maxAttempts = Number(process.env.REGEN_ATTEMPTS ?? 8)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await db
      .deleteFrom('generation_leases')
      .where('story_id', '=', STORY)
      .where('chapter_number', '=', target)
      .execute()
    await db
      .deleteFrom('chapter_generation_checkpoints')
      .where('story_id', '=', STORY)
      .where('chapter_number', '=', target)
      .execute()
    try {
      const result = await generateNextChapterReal({
        storyId: STORY,
        userId: USER,
        chapterNumber: target,
        correlationId: crypto.randomUUID(),
        triggerChoiceId,
      })
      console.log(`attempt ${attempt}: ${result.ok ? 'OK' : `FAIL ${result.reason}`}`)
      if (result.ok) {
        console.log('result:', JSON.stringify(result, null, 2))
        return
      }
    } catch (e) {
      console.log(`attempt ${attempt}: THREW ${(e as Error).message.slice(0, 160)}`)
    }
  }
  throw new Error(`regen Bab ${target} gagal setelah ${maxAttempts} percobaan`)
}

main().catch((e) => { console.error(e); process.exit(1) })
