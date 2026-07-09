/**
 * Seed cerita demo SELESAI untuk replay UX dan TestSprite.
 *
 * Jalankan:
 *   npx tsx scripts/seed-selasa-demo.ts
 *
 * Idempotent: bersihkan semua row untuk story ID konstan, lalu insert ulang.
 * Memakai service role key. Jangan pernah jalankan dari browser/client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { buildFixtureSnapshot } from '../fixtures/narrative/fixture-50'

export const DEMO_STORY_ID = 'demo:selasa-akhir'
const TOTAL_CHAPTERS = 50
const ENDING_NAME = 'Rekonsiliasi Bersyarat'

type StoryRow = {
  id: string
  title: string
  cover: string
  tagline: string
  role: string
  tropes: string[]
  total_chapters: number
  synopsis: string
  status: 'SELESAI'
  current_chapter: number
  visibility?: 'public' | 'private' | 'unlisted'
  owner_user_id?: string | null
  jejak: Array<{
    chapter: number
    decision: string
    consequence: string
  }>
  ending_name: string
}

type ChapterRow = {
  story_id: string
  number: number
  title: string
  paragraphs: string[]
  choice_prompt: string
  choices: Array<{
    id: string
    label: string
  }>
}

type ChoiceOutcomeRow = {
  story_id: string
  chapter_number: number
  choice_id: string
  consequence: string[]
  next_chapter_number: number | null
  is_ending: boolean
}

export type SelasaDemoSeedRows = {
  stories: StoryRow[]
  chapters: ChapterRow[]
  choiceOutcomes: ChoiceOutcomeRow[]
}

function buildChoices(chapterNumber: number): ChapterRow['choices'] {
  // Variasi label agar reader demo tidak monotoon, tetap 2 opsi stabil id.
  if (chapterNumber >= 45) {
    return [
      { id: 'maju', label: 'Mengungkap kebenaran di depan keluarga' },
      { id: 'tahan', label: 'Menahan diri demi menjaga damai palsu' },
    ]
  }
  if (chapterNumber >= 30) {
    return [
      { id: 'maju', label: 'Mempercayai Dimas dan menuntut jawaban' },
      { id: 'tahan', label: 'Mengamati dulu, kumpulkan bukti' },
    ]
  }
  if (chapterNumber >= 12) {
    return [
      { id: 'maju', label: 'Membuka brankas / dokumen yang disembunyikan' },
      { id: 'tahan', label: 'Menunggu momen yang lebih aman' },
    ]
  }
  return [
    { id: 'maju', label: 'Melangkah maju menghadapi keadaan' },
    { id: 'tahan', label: 'Menahan diri dan mengamati' },
  ]
}

function buildOutcomes(chapterNumber: number): ChoiceOutcomeRow[] {
  const isEnding = chapterNumber >= TOTAL_CHAPTERS
  const nextChapterNumber = isEnding ? null : chapterNumber + 1

  return [
    {
      story_id: DEMO_STORY_ID,
      chapter_number: chapterNumber,
      choice_id: 'maju',
      consequence: isEnding
        ? [
            ENDING_NAME,
            'Kau memilih bicara jujur, lalu keluarga itu mulai berdamai dengan kebenaran.',
          ]
        : ['Kau maju; langkah itu membuka jalan ke bab berikutnya.'],
      next_chapter_number: nextChapterNumber,
      is_ending: isEnding,
    },
    {
      story_id: DEMO_STORY_ID,
      chapter_number: chapterNumber,
      choice_id: 'tahan',
      consequence: isEnding
        ? [
            'Kemenangan Pahit',
            'Kau memilih menahan diri, dan kebenaran tetap menang dengan harga yang berat.',
          ]
        : ['Kau menahan diri; arus cerita tetap membawamu ke bab berikutnya.'],
      next_chapter_number: nextChapterNumber,
      is_ending: isEnding,
    },
  ]
}

/** Act 1–8 beat untuk prosa demo (bukan filler "kata"). */
const ACT_BEATS: Array<{ from: number; to: number; beat: string; place: string }> = [
  {
    from: 1,
    to: 6,
    beat: 'kepulangan dan kecurigaan pertama di rumah kaca',
    place: 'serambi rumah kaca yang berembun',
  },
  {
    from: 7,
    to: 12,
    beat: 'jejak wasiat dan brankas yang tak boleh disentuh',
    place: 'ruang kerja ayah yang berbau kertas tua',
  },
  {
    from: 13,
    to: 19,
    beat: 'retaknya kepercayaan antar saudara',
    place: 'dapur yang terlalu sunyi untuk keluarga besar',
  },
  {
    from: 20,
    to: 25,
    beat: 'bayang-bayang bahwa ayah mungkin tak benar-benar pergi',
    place: 'koridor belakang menuju rumah kaca',
  },
  {
    from: 26,
    to: 32,
    beat: 'rahasia Dimas dan harga sebuah kepercayaan',
    place: 'bawah pohon jambu di halaman samping',
  },
  {
    from: 33,
    to: 39,
    beat: 'saksi masa lalu yang kembali membuka luka',
    place: 'ruang tamu dengan foto keluarga berdebu',
  },
  {
    from: 40,
    to: 45,
    beat: 'kebenaran kematian kakek yang bukan kecelakaan',
    place: 'ruang kaca yang retak di sudutnya',
  },
  {
    from: 46,
    to: 50,
    beat: 'konfrontasi terakhir dan pilihan berdamai dengan kebenaran',
    place: 'tengah rumah kaca di bawah cahaya sore',
  },
]

function actBeatFor(chapter: number) {
  return (
    ACT_BEATS.find((a) => chapter >= a.from && chapter <= a.to) ??
    ACT_BEATS[ACT_BEATS.length - 1]!
  )
}

/**
 * Prosa demo mobile-drama: 3 paragraf pendek, natural BI, tanpa filler "kata".
 * Deterministik per nomor bab — cocok seed idempotent.
 */
export function buildDemoChapterProse(chapterNumber: number): {
  title: string
  paragraphs: string[]
  choice_prompt: string
} {
  const { beat, place } = actBeatFor(chapterNumber)
  const titles = [
    'Hujan di Atap Kaca',
    'Surat yang Tak Pernah Dibaca',
    'Langkah di Koridor',
    'Cincin yang Hilang',
    'Suara di Dapur',
    'Bayang di Kaca',
    'Janji yang Retak',
    'Wasiat yang Disembunyikan',
    'Mata yang Menghindar',
    'Kunci di Laci Bawah',
    'Nama di Foto Lama',
    'Brankas yang Berbunyi',
    'Tuduhan di Meja Makan',
    'Jejak Sepatu Basah',
    'Telepon yang Tak Terjawab',
    'Laci Notaris',
    'Rahasia di Buku Harian',
    'Percakapan di Tangga',
    'Luka yang Dipoles',
    'Kabut di Pagi Selasa',
    'Surat Tanpa Stempel',
    'Suara Ayah di Pita',
    'Pintu yang Dikunci Lagi',
    'Tangan yang Gemetar',
    'Cahaya di Sudut Kaca',
    'Pertanyaan Dimas',
    'Jawaban yang Menunda',
    'Dusta yang Halus',
    'Bukti di Amplop Cokelat',
    'Kata-kata yang Tertahan',
    'Malam di Serambi',
    'Kepercayaan yang Diuji',
    'Saksi yang Kembali',
    'Nama Sari di Bibir Ibu',
    'Cerita Tahun 1998',
    'Foto yang Dipotong',
    'Air Mata yang Ditahan',
    'Peta Warisan',
    'Suara Kaca Retak',
    'Pertemuan di Ruang Kerja',
    'Daftar Utang Keluarga',
    'Jejak Darah di Laporan',
    'Kebenaran yang Menusuk',
    'Pilihan di Depan Pintu',
    'Rahasia yang Meledak',
    'Sore Terakhir',
    'Semua Orang Berkumpul',
    'Kalimat yang Harus Diucapkan',
    'Harga Sebuah Damai',
    'Selasa yang Berakhir',
  ]
  const title = titles[(chapterNumber - 1) % titles.length]!

  const p1 = [
    `Bab ${chapterNumber}. Kamu berdiri di ${place}, menghirup udara yang terasa terlalu berat untuk sebuah Selasa.`,
    `Di luar, embun menempel di kaca seperti jejak jari orang yang sudah lama pergi.`,
    `Di dalam, keluarga berbisik seolah rumah ini bisa dengar, dan setiap bisikan menampar ${beat}.`,
    `Kamu—Rani—pulang bukan hanya untuk melayat, tapi untuk menagih jawaban yang ditunda bertahun-tahun.`,
  ].join(' ')

  const p2 = [
    chapterNumber <= 6
      ? `Ibu Ratna menyuguhkan teh tanpa menatap matamu. "Istirahat dulu," katanya, datar. Tapi tatapannya menyapu tasmu seolah mencari surat, bukan anaknya.`
      : chapterNumber <= 12
        ? `Di laci meja ayah, jari-jarimu menemukan kunci kecil yang dingin. Dimas berdiri di ambang pintu. "Kalau kau buka itu sekarang, semuanya berubah," bisiknya. Bukan peringatan. Semacam undangan yang berbahaya.`
        : chapterNumber <= 20
          ? `Notaris Hendra menolak bertemu tanpa janji. Di telepon, suaranya gemetar. "Ada yang dipalsukan, Mbak Rani. Tapi aku tak bisa bilang di sini."`
          : chapterNumber <= 32
            ? `Dimas menyerahkan amplop cokelat. Isinya fotokopi akta yang namanya bukan hanya milikmu. "Aku bukan musuhmu," katanya. "Tapi aku juga bukan orang asing di keluarga ini."`
            : chapterNumber <= 39
              ? `Sari datang dengan tas kain dan foto yang dipotong pinggirnya. "Ibumu menyuruhku diam dulu. Tapi diam itu membunuh orang yang benar."`
              : chapterNumber <= 45
                ? `Laporan lama tentang kecelakaan kakek tak selaras dengan luka di foto. Kaca rumah itu pernah pecah dari dalam, bukan dari angin.`
                : `Semua orang berkumpul di rumah kaca. Sore memerah di atap. Tidak ada lagi tempat untuk dusta yang rapi.`,
    `Kamu merasakan dada sesak—bukan karena takut kalah, tapi karena takut menang dengan cara yang merusak semua yang tersisa.`,
  ].join(' ')

  const p3 = [
    `Di luar, seekor burung mengetuk kaca sekali, lalu pergi. Di dalam, pilihan menunggumu: maju dan bongkar yang busuk, atau menahan diri sambil mengamati celah yang lebih aman.`,
    `Apapun yang kau pilih, Selasa ini tidak akan selesai sebagai Selasa biasa. ${beat[0]!.toUpperCase()}${beat.slice(1)} sudah terlalu jauh untuk diabaikan.`,
    chapterNumber >= TOTAL_CHAPTERS
      ? `Ini bab terakhir. Kebenaran sudah di meja. Yang tersisa hanya: apakah kau akan mengucapkannya dengan damai yang pahit, atau membiarkan luka itu mengering tanpa nama.`
      : `Bab berikutnya menunggu di balik satu keputusan. Dan keputusan itu milikmu.`,
  ].join(' ')

  return {
    title: `Bab ${chapterNumber} — ${title}`,
    paragraphs: [p1, p2, p3],
    choice_prompt:
      chapterNumber >= TOTAL_CHAPTERS
        ? 'Bagaimana kau menutup Selasa ini?'
        : 'Apa yang kaulakukan sekarang?',
  }
}

export function buildSelasaDemoSeedRows(): SelasaDemoSeedRows {
  // Snapshot tetap dibangun untuk cleanup character_states di seed runner.
  buildFixtureSnapshot()
  const chapters: ChapterRow[] = []
  const choiceOutcomes: ChoiceOutcomeRow[] = []

  for (let chapterNumber = 1; chapterNumber <= TOTAL_CHAPTERS; chapterNumber++) {
    const prose = buildDemoChapterProse(chapterNumber)

    chapters.push({
      story_id: DEMO_STORY_ID,
      number: chapterNumber,
      title: prose.title,
      paragraphs: prose.paragraphs,
      choice_prompt: prose.choice_prompt,
      choices: buildChoices(chapterNumber),
    })

    choiceOutcomes.push(...buildOutcomes(chapterNumber))
  }

  return {
    stories: [
      {
        id: DEMO_STORY_ID,
        title: 'Selasa Terakhir di Rumah Kaca',
        cover: '/placeholder.svg?height=400&width=300',
        tagline: 'Satu keluarga, satu warisan, dan satu Selasa yang mengubah segalanya.',
        role: 'Rani, pewaris yang pulang terlambat',
        tropes: ['Rahasia Keluarga', 'Warisan', 'Pengkhianatan'],
        total_chapters: TOTAL_CHAPTERS,
        synopsis:
          'Rani pulang setelah kematian ayahnya dan menemukan rumah kaca keluarga menyimpan kunci wasiat yang diperebutkan semua orang.',
        status: 'SELESAI',
        current_chapter: TOTAL_CHAPTERS,
        // AMENDMENTS v0.5: demo resmi publik di Jelajahi.
        visibility: 'public',
        owner_user_id: null,
        jejak: [
          {
            chapter: 12,
            decision: 'Membuka brankas tua',
            consequence: 'Rani menemukan salinan wasiat yang tidak pernah diumumkan.',
          },
          {
            chapter: 32,
            decision: 'Mempercayai Dimas',
            consequence: 'Rahasia hubungan Dimas dengan keluarga mulai terkuak.',
          },
          {
            chapter: 50,
            decision: 'Mengungkap kebenaran di depan keluarga',
            consequence: ENDING_NAME,
          },
        ],
        ending_name: ENDING_NAME,
      },
    ],
    chapters,
    choiceOutcomes,
  }
}

function admin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di env.')
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function deleteByStoryId(
  db: SupabaseClient,
  table: string,
  column = 'story_id',
) {
  const { error } = await db.from(table).delete().eq(column, DEMO_STORY_ID)
  if (error) throw new Error(`delete ${table}: ${error.message}`)
}

async function deleteCharacterStates(db: SupabaseClient) {
  const characterIds = buildFixtureSnapshot().characters.map((character) => character.id)
  if (!characterIds.length) return

  const { error } = await db
    .from('character_states')
    .delete()
    .in('character_id', characterIds)
  if (error) throw new Error(`delete character_states: ${error.message}`)
}

async function insertRows(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return

  const { error } = await db.from(table).insert(rows)
  if (error) throw new Error(`insert ${table}: ${error.message}`)
  console.log(`[seed-selasa-demo] ${table}: ${rows.length} baris`)
}

async function assertCount(
  db: SupabaseClient,
  table: string,
  expected: number,
  column = 'story_id',
) {
  const { count, error } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, DEMO_STORY_ID)
  if (error) throw new Error(`count ${table}: ${error.message}`)
  if (count !== expected) {
    throw new Error(`count ${table}: expected ${expected}, got ${count ?? 'null'}`)
  }
}

export async function seedSelasaDemo() {
  const db = admin()
  const rows = buildSelasaDemoSeedRows()

  for (const table of [
    'content_reports',
    'story_events',
    'retrieval_logs',
    'generation_leases',
    'idempotency_keys',
    'reader_states',
    'choice_outcomes',
    'chapters',
    'chapter_blueprints',
    'act_rollups',
    'story_threads',
    'timeline_events',
    'secrets_reveals',
    'knowledge_scopes',
    'facts_ledger',
    'character_voice_sheets',
    'character_aliases',
    'characters',
  ]) {
    await deleteByStoryId(db, table)
  }
  await deleteCharacterStates(db)
  await deleteByStoryId(db, 'stories', 'id')

  await insertRows(db, 'stories', rows.stories)
  await insertRows(db, 'chapters', rows.chapters)
  await insertRows(db, 'choice_outcomes', rows.choiceOutcomes)

  await assertCount(db, 'stories', 1, 'id')
  await assertCount(db, 'chapters', TOTAL_CHAPTERS)
  await assertCount(db, 'choice_outcomes', TOTAL_CHAPTERS * 2)

  console.log(`[seed-selasa-demo] selesai untuk story "${DEMO_STORY_ID}".`)
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/seed-selasa-demo.ts')) {
  seedSelasaDemo().catch((error) => {
    console.error('[seed-selasa-demo] gagal:', error.message)
    process.exit(1)
  })
}
