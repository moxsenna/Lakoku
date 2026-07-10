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
import {
  DEMO_ENDING_MAJU,
  DEMO_TOTAL_CHAPTERS,
  demoChoicesForSeed,
  demoOutcomesForSeed,
  getDemoBeat,
} from './demo-prose/chapter-beats'
import { buildHandcraftChapter } from './demo-prose/handcraft/build-handcraft'
import { generateChapterProse } from './demo-prose/generate-chapter-prose'

export const DEMO_STORY_ID = 'demo:selasa-akhir'
const TOTAL_CHAPTERS = DEMO_TOTAL_CHAPTERS
const ENDING_NAME = DEMO_ENDING_MAJU

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
  return demoChoicesForSeed(chapterNumber)
}

function buildOutcomes(chapterNumber: number): ChoiceOutcomeRow[] {
  return demoOutcomesForSeed(DEMO_STORY_ID, chapterNumber)
}

/**
 * Prosa demo = gaya serial drama mobile / web novel (PRD §9).
 * - POV "aku" (Rani)
 * - 18–28 paragraf pendek (1–3 kalimat)
 * - dialog padat, show-don't-tell
 * - tanpa meta "pilihan menunggumu" / filler "kata"
 */
const CHAPTER_TITLES = [
  'Hujan di Atap Kaca',
  'Teh yang Dingin',
  'Kunci di Laci',
  'Cincin yang Hilang',
  'Suara di Dapur',
  'Bayang di Kaca',
  'Janji yang Retak',
  'Amplop Cokelat',
  'Mata yang Menghindar',
  'Laci Bawah',
  'Foto yang Dipotong',
  'Brankas yang Berbunyi',
  'Meja Makan',
  'Sepatu Basah',
  'Telepon Tak Terjawab',
  'Notaris itu Gemetar',
  'Buku Harian',
  'Tangga Belakang',
  'Luka yang Dipoles',
  'Pagi yang Kabur',
  'Surat Tanpa Stempel',
  'Pita Suara',
  'Pintu Terkunci',
  'Tangan Gemetar',
  'Sudut yang Retak',
  'Pertanyaan Dimas',
  'Jawaban yang Menunda',
  'Dusta Halus',
  'Akta yang Aneh',
  'Kata yang Tertahan',
  'Malam di Serambi',
  'Kepercayaan',
  'Saksi yang Kembali',
  'Nama Sari',
  'Tahun Sembilan Belas',
  'Pinggir yang Dipotong',
  'Air Mata yang Ditahan',
  'Peta Warisan',
  'Kaca yang Retak',
  'Ruang Kerja',
  'Daftar Utang',
  'Laporan Lama',
  'Kebenaran Menusuk',
  'Depan Pintu',
  'Semua Tahu',
  'Sore Terakhir',
  'Mereka Berkumpul',
  'Kalimat yang Harus Keluar',
  'Harga Damai',
  'Selasa Berakhir',
] as const

type BeatKey = 'pulang' | 'brankas' | 'retak' | 'ayah' | 'dimas' | 'sari' | 'kakek' | 'akhir'

function beatKey(ch: number): BeatKey {
  if (ch <= 6) return 'pulang'
  if (ch <= 12) return 'brankas'
  if (ch <= 19) return 'retak'
  if (ch <= 25) return 'ayah'
  if (ch <= 32) return 'dimas'
  if (ch <= 39) return 'sari'
  if (ch <= 45) return 'kakek'
  return 'akhir'
}

/** Variasi kecil biar 50 bab tidak identik 100% (masih deterministik). */
function linePick(ch: number, options: string[]): string {
  return options[(ch - 1) % options.length]!
}

function buildSceneParagraphs(ch: number): string[] {
  const key = beatKey(ch)
  const n = ch

  // Hook + tubuh + cliff — banyak baris pendek.
  const commonOpen = [
    linePick(n, [
      'Embun masih menempel di atap rumah kaca.',
      'Hujan baru berhenti. Bau tanah basah masuk lewat celah pintu.',
      'Lampu serambi berkedip sekali, lalu stabil.',
    ]),
    'Aku mengusap ujung tas. Jari-jariku dingin.',
    linePick(n, [
      'Di dalam, piring berdenting pelan.',
      'Di dalam, TV menyala tanpa suara.',
      'Di dalam, ada tawa yang terasa palsu.',
    ]),
  ]

  const byBeat: Record<BeatKey, string[]> = {
    pulang: [
      ...commonOpen,
      'Ibu Ratna muncul dari dapur. Baki teh di tangannya.',
      'Ia tidak memelukku.',
      '“Istirahat dulu,” katanya.',
      'Tatapannya jatuh ke resleting tasku—bukan ke mataku.',
      '“Aku baru sampai, Bu.”',
      '“Kamu capek. Nanti saja bicara.”',
      'Teh tumpah sedikit di tepi cangkir. Ia tidak membersihkan.',
      'Dimas lewat di koridor. Berhenti sejenak.',
      '“Selamat datang, Mbak.”',
      'Nada suaranya hati-hati. Seperti orang yang takut salah langkah.',
      'Aku mengangguk. Tenggorokanku kering.',
      'Di dinding, foto Ayah masih tersenyum. Bingkainya miring sedikit.',
      'Aku meluruskannya.',
      'Ibu Ratna menahan napas. Hampir tak kelihatan.',
      '“Jangan sentuh barang-barang Ayah dulu.”',
      '“Kenapa?”',
      '“Nanti berantakan.”',
      'Berantakan.',
      'Aku menatap kaca rumah di halaman. Embun mengaburkan isinya.',
      'Ada yang disembunyikan di rumah ini.',
      'Dan mereka berharap aku terlalu lelah untuk mencari.',
      'Aku mengepal tangan di samping tubuh.',
      '“Besok pagi aku mau ke ruang kerja Ayah.”',
      'Ibu Ratna tersenyum tipis.',
      '“Besok kita bicarakan.”',
      'Lampu serambi berkedip lagi.',
      'Aku tidak mengalihkan pandang.',
    ],
    brankas: [
      ...commonOpen,
      'Pintu ruang kerja Ayah setengah terbuka.',
      'Bau kertas tua dan minyak kayu.',
      'Aku masuk tanpa mengetuk.',
      'Laci bawah macet. Aku menarik lebih kuat.',
      'Kunci kecil. Dingin. Berkarat di ujungnya.',
      '“Mbak.”',
      'Dimas di ambang pintu. Tangan di saku.',
      '“Kalau dibuka sekarang, semuanya berubah.”',
      'Aku memutar badan.',
      '“Berubah untuk siapa?”',
      'Ia terdiam. Rahangnya mengeras.',
      '“Untuk semuanya.”',
      'Aku mengepal kunci di telapak tangan.',
      'Di pojok ruangan, brankas tua menempel di lantai. Debu tebal di tutupnya—kecuali satu sudut yang baru diusap.',
      'Seseorang sudah ke sini.',
      '“Siapa yang buka brankas ini?” tanyaku.',
      '“Aku tidak tahu.”',
      'Bohong itu terdengar mulus. Terlalu mulus.',
      'Aku melangkah mendekati brankas.',
      'Dimas mengangkat tangan, bukan menahan—hampir seperti minta waktu.',
      '“Tunggu Ibu. Jangan sendirian.”',
      '“Ibu yang melarangku sentuh barang Ayah.”',
      'Diam sebentar.',
      'Di luar, burung mengetuk kaca sekali.',
      'Aku menelan ludah.',
      'Kunci di tanganku berdenyut seolah panas.',
    ],
    retak: [
      'Dapur terlalu sunyi untuk rumah sebesar ini.',
      'Aku menuang air. Gelas bergetar di nampan.',
      '“Kamu curiga terus,” kata sepupuku dari meja makan.',
      '“Aku cuma tanya siapa yang urus wasiat.”',
      'Ia tertawa pendek.',
      '“Dasar anak kota. Semua mau dibawa ke notaris.”',
      'Ibu Ratna masuk. Celemek masih basah.',
      '“Sudah. Makan dulu.”',
      'Aku tidak duduk.',
      '“Pak Hendra menolak ketemu tanpa janji. Kenapa?”',
      'Sendok jatuh. Dentingnya nyaring.',
      'Ibu Ratna menunduk, mengambil sendok itu pelan-pelan.',
      '“Notaris sibuk.”',
      '“Sibuk atau disuruh diam?”',
      'Semua orang menoleh.',
      'Dimas berdiri di pintu dapur. Matanya memperingatkanku.',
      'Aku tidak mundur.',
      'Jari-jariku mengetuk tepi meja.',
      '“Kalau kalian bersih, kenapa takut pertanyaan sederhana?”',
      'Sepupuku bangkit.',
      '“Kamu bikin suasana rusak.”',
      '“Suasana sudah rusak sejak Ayah dikubur dengan cepat.”',
      'Ibu Ratna menatapku lama.',
      '“Cukup, Rani.”',
      'Suara itu rendah. Bukan marah—ancaman yang dibungkus sopan.',
      'Aku menghela napas.',
      'Di jendela, bayanganku terlihat pucat.',
    ],
    ayah: [
      'Koridor belakang lengang.',
      'Aku memutar pita rekaman di ponsel. Suara Ayah serak, tertawa kecil.',
      '“…jangan percaya semua yang ditulis di kertas itu—”',
      'Pita putus. Desis.',
      'Tangan ku gemetar.',
      'Dimas muncul dari belokan.',
      '“Kamu dengar apa?”',
      '“Ayah. Sebelum… sebelum semua ini.”',
      'Ia menggigit bibir.',
      '“Itu bisa palsu.”',
      '“Suara Ayah tidak bisa dipalsukan semudah itu.”',
      'Kami diam. Hanya detak jam dinding.',
      '“Kalau Ayah masih hidup,” bisikku, “siapa yang dikubur?”',
      'Dimas memalingkan wajah.',
      '“Jangan bilang itu keras-keras.”',
      'Aku melangkah mendekat.',
      '“Kamu tahu sesuatu.”',
      '“Aku tahu kalau kamu terus menggali, mereka akan mengusirmu.”',
      '“Lebih baik diusir daripada dibodohi.”',
      'Matanya basah sepersekian detik. Lalu kering lagi.',
      'Di ujung koridor, pintu rumah kaca terbuka sendiri. Angin.',
      'Atau seseorang baru lewat.',
      'Aku mengejar.',
      'Hanya daun basah di lantai.',
      'Tapi di kaca, ada jejak jari yang belum kering.',
    ],
    dimas: [
      'Pohon jambu meneduhkan bangku tua.',
      'Dimas menyerahkan amplop cokelat. Tidak langsung ke tanganku—ditaruh di bangku.',
      '“Buka sendiri.”',
      'Aku merobek. Fotokopi akta. Nama-nama. Satu baris yang membuat napasku tersangkut.',
      '“Ini… siapa?”',
      '“Aku,” katanya pelan. “Nama ibuku di situ. Bukan Ibu Ratna.”',
      'Dunia sejenak mengecil.',
      '“Kamu… saudara?”',
      '“Setengah. Atau lebih rumit dari itu. Ayahmu menolong ibuku dulu.”',
      'Aku menatapnya. Mencari dusta. Yang kutemukan justru lelah.',
      '“Kenapa baru sekarang?”',
      '“Karena Ibu bilang diam adalah cara bertahan.”',
      '“Diam membunuh orang yang benar.”',
      'Ia tertawa pahit.',
      '“Aku bukan musuhmu, Mbak. Tapi aku juga bukan tamu.”',
      'Amplop bergetar di tanganku.',
      '“Kalau ini benar, wasiat yang mereka pamer palsu.”',
      '“Bisa.”',
      '“Bisa, atau ya?”',
      'Dimas menghela napas.',
      '“Ya. Sebagian.”',
      'Burung di dahan terbang. Daun jatuh di antara kami.',
      'Aku berdiri.',
      '“Aku butuh bukti lain. Bukan hanya ini.”',
      '“Kalau kau maju sekarang, mereka akan menyerangmu dulu.”',
      'Aku menatap rumah kaca di kejauhan.',
      '“Biar.”',
    ],
    sari: [
      'Bel pintu berbunyi tiga kali.',
      'Perempuan dengan tas kain berdiri di beranda. Rambut diikat asal.',
      '“Rani?”',
      '“Siapa?”',
      '“Sari. Dulu… aku kerja di rumah ini.”',
      'Ibu Ratna muncul di belakangku. Wajahnya memucat.',
      '“Pulang. Sekarang.”',
      'Sari tidak bergerak.',
      '“Ibu bilang diam. Aku sudah diam terlalu lama.”',
      'Ia mengeluarkan foto. Pinggirnya dipotong rapi.',
      'Ayah. Seorang perempuan. Bayi.',
      '“Ini tahun sembilan belas. Sebelum semuanya dibersihkan.”',
      'Aku meraih foto. Jari-jariku basah keringat.',
      '“Kenapa dipotong?”',
      '“Supaya tidak kelihatan siapa yang digendong.”',
      'Ibu Ratna melangkah maju.',
      '“Cukup. Tamu tidak boleh bawa fitnah.”',
      '“Fitnah?” Sari tertawa kecil. “Aku bawa saksi mata.”',
      'Dimas berdiri di tangga. Tidak ikut bicara.',
      'Aku menelan ludah.',
      '“Masuk,” kataku pada Sari.',
      '“Rani!” bentak Ibu.',
      '“Ini rumah Ayah juga.”',
      'Suaraku bergetar. Tapi kaki ku tidak mundur.',
      'Sari melangkah masuk. Bau minyak kayu mengikutinya.',
      'Foto di tanganku terasa lebih berat dari amplop mana pun.',
    ],
    kakek: [
      'Aku membentangkan laporan lama di meja kaca.',
      'Foto kecelakaan. Luka. Catatan polisi yang rapi—terlalu rapi.',
      '“Kaca pecah dari dalam,” kataku.',
      'Dimas mengernyit. “Maksudmu?”',
      '“Angin tidak mendorong dari arah itu. Lihat serpihannya.”',
      'Sari menunjuk sudut foto.',
      '“Ada jejak sapuan. Orang membersihkan sebelum polisi datang.”',
      'Ibu Ratna berdiri di pintu. Tangan di dada.',
      '“Kalian gila. Kakek meninggal karena sial.”',
      '“Sial yang terorganisir,” sahutku.',
      'Ruangan diam.',
      'Aku berdiri. Meja bergetar pelan.',
      '“Siapa yang diuntungkan kalau Kakek pergi cepat?”',
      'Tidak ada yang jawab.',
      'Hanya detak jam.',
      'Aku menatap Ibu.',
      '“Kalau bukan kamu, kamu tahu siapa.”',
      'Bibirnya bergetar. Bukan karena kasihan—karena terpojok.',
      '“Aku menjaga keluarga ini.”',
      '“Dengan mengubur orang hidup-hidup di cerita palsu?”',
      'Dimas mengangkat tangan.',
      '“Mbak, pelan.”',
      'Aku menggeleng.',
      '“Sudah cukup pelan.”',
      'Di atap, hujan mulai lagi. Tik. Tik. Tik.',
      'Seperti hitungan mundur.',
    ],
    akhir: [
      'Sore memerah di atap rumah kaca.',
      'Semua orang ada di sini. Tidak ada yang bisa kabur dengan alasan sibuk.',
      'Aku meletakkan amplop, foto, laporan—di meja tengah.',
      'Kertas-kertas itu berbunyi pelan saat bersentuhan.',
      '“Ini bukan fitnah,” kataku. “Ini jejak.”',
      'Ibu Ratna tertawa. Pendek. Pahit.',
      '“Kamu mau hancurkan keluarga demi ego?”',
      '“Aku mau nama Ayah tidak jadi alat.”',
      'Dimas berdiri di sampingku. Tidak memegang tanganku. Cukup dekat.',
      'Sari mengangguk pelan.',
      'Sepupuku mengalihkan pandang ke lantai.',
      '“Bilang saja,” desakku. “Siapa yang memalsukan wasiat. Siapa yang mengatur kematian Kakek. Siapa yang menyuruh notaris diam.”',
      'Angin masuk lewat celah kaca. Dingin.',
      'Ibu Ratna melangkah maju.',
      '“Kalau kamu terus, tidak ada yang menang.”',
      'Aku menatap matanya.',
      '“Kalau aku diam, yang kalah cuma orang yang sudah mati.”',
      'Jari-jariku mengepal.',
      'Di luar, adzan jauh terdengar samar.',
      'Selasa hampir selesai.',
      'Tapi di dalam rumah kaca ini, semuanya baru mulai jujur—atau meledak.',
      'Aku menarik napas dalam.',
      '“Sekarang kalian pilih. Bicara. Atau aku bawa ini ke orang yang tidak bisa kalian bungkam.”',
      'Tidak ada yang bergerak dulu.',
      'Lalu, di sudut ruangan, seseorang menelan ludah terlalu keras.',
    ],
  }

  const body = byBeat[key]
  // Pastikan cukup paragraf (18+): ulangi variasi penutup pendek bila kurang.
  const paragraphs = [...body]
  while (paragraphs.length < 20) {
    paragraphs.push(
      linePick(ch + paragraphs.length, [
        'Aku menghembuskan napas pelan.',
        'Jantungku berdetak terlalu cepat.',
        'Tidak ada yang berani memecah sunyi itu dulu.',
        'Aku menatap lantai, lalu mengangkat dagu lagi.',
      ]),
    )
  }
  // Cap wajar untuk seed (baca nyaman); tidak usah 800 kata penuh.
  return paragraphs.slice(0, 28)
}

export function buildDemoChapterProse(chapterNumber: number): {
  title: string
  paragraphs: string[]
  choice_prompt: string
} {
  // Bab 1–3: handcraft premium (step 4).
  if (chapterNumber >= 1 && chapterNumber <= 3) {
    const hc = buildHandcraftChapter(chapterNumber as 1 | 2 | 3)
    return {
      title: hc.title,
      paragraphs: hc.paragraphs,
      choice_prompt: hc.choice_prompt,
    }
  }

  // Bab 4–50: beat-driven generator (step 5) — soft rhythm band.
  return generateChapterProse(chapterNumber)
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
        cover: '/covers/selasa-terakhir.webp',
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
