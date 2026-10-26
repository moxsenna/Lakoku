import 'server-only'
import { getDb } from '@lakoku/db'
import { sql } from 'kysely'

export interface ChoiceStats {
  /** Pembaca yang mencatat pilihan pada bab ini. */
  readers: number
  /** Jumlah pemilih per choice_id, mis. { 'chapter-3-choice-1': 12 }. */
  perChoice: Record<string, number>
}

/**
 * Statistik pilihan lintas pembaca untuk satu bab — agregat anonim dari
 * `choice_history` (id pilihan saja, tanpa identitas atau teks). Cerita
 * privat sampelnya kecil; UI menyembunyikan angka di bawah ambang.
 */
export async function getChoiceStats(
  storyId: string,
  chapterNumber: number,
): Promise<ChoiceStats> {
  try {
    const db = getDb()
    const queryResult = await sql<{ choice_id: string; picks: number }>`
      select entry->>'choiceId' as choice_id, count(*)::int as picks
      from reader_states,
           jsonb_array_elements(
             case when jsonb_typeof(choice_history) = 'array'
               then choice_history else '[]'::jsonb end
           ) as entry
      where story_id = ${storyId}
        and entry->>'chapterNumber' = ${String(chapterNumber)}
        and entry->>'choiceId' is not null
      group by 1
    `.execute(db)

    const perChoice: Record<string, number> = {}
    let readers = 0
    for (const row of queryResult.rows) {
      const picks = Number(row.picks)
      perChoice[row.choice_id] = picks
      readers += picks
    }
    return { readers, perChoice }
  } catch {
    return { readers: 0, perChoice: {} }
  }
}
