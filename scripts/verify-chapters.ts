import { getDb, result } from '@lakoku/db'

const STORY = 'pulang-ke-tanah-yang-masih-marah-o9bple'
const STUB_MARKERS = ['tak bisa ditunda lagi', 'Petunjuk kunci di balik papan', 'Satu detik. Dua.']

async function main() {
  const db = getDb()
  const { data } = await result(
    db
      .selectFrom('chapters')
      .select(['number', 'title', 'paragraphs', 'choice_prompt', 'choices'])
      .where('story_id', '=', STORY)
      .orderBy('number', 'asc')
      .execute(),
  )
  for (const ch of data ?? []) {
    const ps: string[] = Array.isArray(ch.paragraphs) ? (ch.paragraphs as unknown[]).map(String) : []
    const text = ps.join(' ')
    const words = text.split(/\s+/).filter(Boolean).length
    const stub = STUB_MARKERS.filter((m) => text.includes(m))
    console.log(`\n=== Bab ${ch.number}: ${ch.title} | ${ps.length} par | ${words} kata${stub.length ? ' | STUB!' : ''}`)
    console.log('AWAL : ' + ps[0])
    console.log('AKHIR: ' + ps.slice(-1)[0])
    console.log('PILIHAN: ' + (Array.isArray(ch.choices) ? (ch.choices as Array<{label?: string}>).map((c) => c.label).join(' | ') : ''))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
