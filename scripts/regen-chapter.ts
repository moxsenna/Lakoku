import { createAdminClient } from '@/lib/supabase/admin'
import { generateNextChapterReal } from '@lakoku/runtime'

const STORY = 'pulang-ke-tanah-yang-masih-marah-o9bple'
const USER = '999d7612-e7e5-4d7a-bade-95b8ec746225'

async function main() {
  const target = Number(process.env.REGEN_CHAPTER)
  if (!Number.isInteger(target) || target < 1) throw new Error('REGEN_CHAPTER invalid')
  if (process.env.NARRATIVE_PROVIDER !== 'gateway') {
    throw new Error('refuse: NARRATIVE_PROVIDER must be gateway')
  }
  const admin = createAdminClient()

  const { error: delErr } = await admin
    .from('chapters')
    .delete()
    .eq('story_id', STORY)
    .eq('number', target)
  if (delErr) throw delErr
  console.log(`deleted Bab ${target}`)

  await admin
    .from('chapter_generation_checkpoints')
    .delete()
    .eq('story_id', STORY)
    .eq('chapter_number', target)
  await admin
    .from('generation_leases')
    .delete()
    .eq('story_id', STORY)
    .eq('chapter_number', target)

  // Trigger harus id pilihan yang benar-benar diambil pembaca, bukan indeks 0.
  const { data: rs } = await admin
    .from('reader_states')
    .select('choice_history')
    .eq('story_id', STORY)
    .eq('user_id', USER)
    .maybeSingle()
  const history: Array<{ choiceId?: string; chapterNumber?: number }> =
    Array.isArray(rs?.choice_history) ? rs.choice_history : []
  const fromHistory = history.find((e) => e.chapterNumber === target - 1)?.choiceId ?? null

  const { data: prev } = await admin
    .from('chapters')
    .select('choices')
    .eq('story_id', STORY)
    .eq('number', target - 1)
    .maybeSingle()
  const validIds = Array.isArray(prev?.choices)
    ? ((prev.choices as Array<{ id?: string }>).map((x) => x.id).filter(Boolean) as string[])
    : []
  const triggerChoiceId =
    fromHistory && validIds.includes(fromHistory) ? fromHistory : validIds[0] ?? null
  console.log('triggerChoiceId:', triggerChoiceId, '(history:', fromHistory, ')')

  const maxAttempts = Number(process.env.REGEN_ATTEMPTS ?? 8)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await admin
      .from('generation_leases')
      .delete()
      .eq('story_id', STORY)
      .eq('chapter_number', target)
    await admin
      .from('chapter_generation_checkpoints')
      .delete()
      .eq('story_id', STORY)
      .eq('chapter_number', target)
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
