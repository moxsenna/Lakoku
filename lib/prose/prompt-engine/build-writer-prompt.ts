import {
  MOBILE_DRAMA_RHYTHM,
  STYLE_PROFILE_ID,
  mobileDramaSystemPrompt,
  type StyleProfileId,
} from '@/lib/prose/mobile-drama-style'
import { buildGenreProseDirective } from '@/lib/prose/genre-flavor'
import {
  buildCulturalHonorificDirectives,
  type CharacterDescriptor,
} from '@/lib/prose/cultural-conventions'
import type { BuildWriterPromptInput, WriterPromptParts } from './types'

function writerVisible(value: string, authorityIds: readonly string[]): string {
  let visible = value
  for (const authorityId of authorityIds) {
    visible = visible.split(authorityId).join('rahasia kanonik')
  }
  return visible
}

/** Stopword umum judul; tidak berguna sebagai ban kata kunci. */
const TITLE_KEYWORD_STOPWORDS = new Set([
  'yang', 'dari', 'dengan', 'untuk', 'pada', 'dalam', 'antara', 'setelah',
  'sebelum', 'para', 'siapa', 'ketika', 'karena',
])

/**
 * Kata kunci yang muncul di >= minTitles judul berbeda — kandidat ban agar
 * kosakata judul tidak kolaps (mis. "balik" muncul di 16 dari 50 judul).
 * Deterministik: hitung per judul (bukan per kemunculan), urut alfabetis.
 */
export function dominantTitleKeywords(
  titles: readonly string[],
  minTitles = 3,
): string[] {
  const titlesByWord = new Map<string, Set<number>>()
  titles.forEach((title, index) => {
    const words = title
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4 && !TITLE_KEYWORD_STOPWORDS.has(word))
    for (const word of new Set(words)) {
      const set = titlesByWord.get(word) ?? new Set<number>()
      set.add(index)
      titlesByWord.set(word, set)
    }
  })
  return [...titlesByWord.entries()]
    .filter(([, indices]) => indices.size >= minTitles)
    .map(([word]) => word)
    .sort()
}

function buildChapterBriefV2Prompt(input: BuildWriterPromptInput): WriterPromptParts {
  const brief = input.brief
  if (!brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')

  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  const styleProfile: StyleProfileId = input.styleProfile ?? STYLE_PROFILE_ID
  const isKbm = styleProfile === 'kbm_viral_v1'
  const language = input.language ?? 'id'
  const descriptors: CharacterDescriptor[] = input.characterDescriptors ?? (input.characterNames ?? []).map((name) => ({ name }))
  const beats = input.plannedBeats ?? []
  const cc = input.continuation
  const authorityIds = [
    ...brief.forbiddenRevealIds,
    ...brief.resolvedPlotDebtIds,
    ...brief.scheduledReveals.map((item) => item.authorityId),
    ...brief.plotDebtsToProgress.map((item) => item.authorityId),
    ...brief.plotDebtsToClose.map((item) => item.authorityId),
    ...(brief.lockedEndingKey === null ? [] : [brief.lockedEndingKey]),
  ]
  const safe = (value: string) => writerVisible(value, authorityIds)
  const lines = (values: readonly string[]) => values.map((value) => `- ${safe(value)}`)
  const obligationLines = (label: string, values: typeof brief.scheduledReveals) => (
    values.length > 0
      ? [label, ...values.map((item) => `- ${safe(item.writerDirective)}`)]
      : []
  )

  const characterDisplayList = descriptors.map((d) => {
    const parts = [safe(d.name)]
    if (d.role) parts.push(`Peran: ${safe(d.role)}`)
    if (d.honorifics && d.honorifics.length > 0) parts.push(`sapaan sah: ${d.honorifics.map(safe).join(' / ')}`)
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]
  })

  const p0 = [
    '=== [P0] INVARIAN CANON & KEAMANAN (MANDATORI / HARUS DIPATUHI) ===',
    characterDisplayList.length > 0 ? `- Tokoh yang boleh tampil: ${characterDisplayList.join('; ')}.` : '',
    '- DILARANG memunculkan tokoh bernama baru yang tidak ada dalam daftar di atas.',
    language === 'id' ? '- Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan, BUKAN tokoh baru.' : '',
    brief.mustNotReveal.length > 0
      ? '- RAHASIA DILARANG UNTUK DIUNGKAP/DIBOCORKAN:'
      : '',
    ...lines(brief.mustNotReveal),
    '- DILARANG membocorkan istilah teknis atau metadata internal.',
  ].filter(Boolean).join('\n')

  const endingLines = brief.lockedEndingKey === null
    ? []
    : [
        '- ARAH AKHIR CERITA (ENDING TERKUNCI): Cerita telah mengunci arah resolusi menuju ending terpilih.',
        ...lines(brief.lockedEndingClosure),
        '- Semua tindakan, ketegangan, dan akibat adegan bab ini WAJIB mengarah ke penyelesaian tersebut.',
      ]
  const anchorLines = cc?.storyAnchors
    ? [
        cc.storyAnchors.corePromise ? `- Janji Inti Cerita: ${safe(cc.storyAnchors.corePromise)}` : '',
        cc.storyAnchors.mainConflict ? `- Konflik Utama: ${safe(cc.storyAnchors.mainConflict)}` : '',
        cc.storyAnchors.finalQuestion ? `- Pertanyaan Akhir Cerita: ${safe(cc.storyAnchors.finalQuestion)}` : '',
      ].filter(Boolean)
    : []
  const p1 = [
    '=== [P1] KEWAJIBAN NARATIF MANDATORI BAB INI ===',
    ...endingLines,
    ...obligationLines('- REVEAL / TITIK BALIK WAJIB:', brief.scheduledReveals),
    ...obligationLines('- HUTANG PLOT WAJIB DIMAJUKAN:', brief.plotDebtsToProgress),
    ...obligationLines('- HUTANG PLOT HARUS DITUTUP:', brief.plotDebtsToClose),
    ...anchorLines,
  ].join('\n')

  const previousEnding = cc?.previousChapter?.endingParagraphs
    .map((paragraph) => `> ${safe(paragraph)}`)
    .join('\n') ?? '-'
  const previousChoice = cc?.previousChoice
  const echoGuard = cc?.previousChapter
    ? '- Paragraf-paragraf di atas adalah PENUTUP BAB SEBELUMNYA yang sudah dibaca pembaca. DILARANG mengulangnya (verbatim maupun nyaris verbatim) sebagai paragraf pembuka bab ini. Buka bab ini dengan adegan BARU yang langsung melanjutkan akibat pilihan pembaca.'
    : ''
  const context = [
    '=== KONTEKS: RIWAYAT PEMBACA & AKIBAT PILIHAN ===',
    'Potongan Paragraf Akhir Bab Sebelumnya:',
    previousEnding,
    echoGuard,
    previousChoice ? `- Pilihan: "${safe(previousChoice.label)}"` : '- Pilihan: -',
    previousChoice
      ? `- Konsekuensi Kanonik: ${previousChoice.consequence.map(safe).join(' / ')}`
      : '- Konsekuensi Kanonik: -',
    previousChoice
      ? '- KONSEKUENSI DI ATAS TELAH TERJADI DAN MENGIKAT. Buka bab ini dengan menyambung langsung akibat tersebut. DILARANG menganulir atau membatalkan pilihan pembaca.'
      : '',
    brief.routeStateSummary ? `- Keadaan rute: ${safe(brief.routeStateSummary)}` : '',
  ].filter(Boolean).join('\n')

  const p2 = [
    '=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===',
    `- Tujuan Bab: ${safe(brief.chapterGoal)}`,
    '- AWALI BAB DENGAN TINDAKAN ATAU DIALOG LANGSUNG (In Medias Res). DILARANG membuka bab dengan deskripsi cuaca (hujan/panas/mendung), perabot ruangan (meja berdebu/lampu berkedip), atau renungan masa lalu. Tiga kalimat pertama bab WAJIB memuat benturan masalah, tindakan fisik, atau ucapan dialog tokoh.',
    beats.length > 0 ? '- Beat Wajib yang Harus Dijalani Tokoh:' : '',
    ...lines(beats),
    '- Urai setiap beat secara mendalam menjadi rangkaian interaksi bertahap; jangan meringkas satu beat hanya dalam segelintir paragraf singkat.',
    '- Khusus Bab 45 ke atas atau bab resolusi/klimaks: Urai proses pemulihan, percakapan konfrontasi/penyelesaian mendalam antar tokoh, dan konsekuensi pilihan secara bertahap menjadi 4 adegan berbobot. DILARANG merangkum atau mempercepat adegan menuju akhir sebelum mencapai target panjang kata.',
    '- Tulis 4 adegan berkesinambungan di lokasi fisik nyata yang mengalir tanpa lompatan waktu drastis.',
    '- Setiap adegan WAJIB memuat: interaksi dialog bolak-balik yang hidup, aksi fisik nyata, dan reaksi tubuh tokoh.',
    isKbm
      ? '- Hidupkan adegan dengan percakapan langsung: Sertakan banyak interaksi dialog bolak-balik antar tokoh (minimal 16–20 pertukaran ucapan) agar suasana hidup dan naskah tidak menjadi monolog sepi.'
      : '- Hidupkan adegan dengan percakapan langsung: Sertakan banyak interaksi dialog bolak-balik antar tokoh (minimal 12–16 pertukaran ucapan) agar suasana hidup dan naskah tidak menjadi monolog sepi.',
    '- Terapkan Show, Don\'t Tell: fokus pada aksi fisik, reaksi emosional tubuh, dan subteks dialog.',
    '- Bangun penutupan dramatis yang tuntas pada akhir bab, mengerucut pada cliffhanger yang tajam dan bermakna.',
  ].filter(Boolean).join('\n')

  const p3 = [
    '=== [P3] OTORITAS PANJANG KATA & STRUKTUR PARAGRAF ===',
    '- Target utama penulisan: 890–950 kata (titik tengah ideal: 920 kata).',
    '- Batas penerimaan keras: 800–1000 kata.',
    '- Batas minimal mutlak: 800 kata. Naskah di bawah 800 kata DITOLAK oleh validator sistem.',
    '- Batas maksimal mutlak: 1000 kata.',
    '- Agar aman dan tidak jatuh di bawah batas 800 kata, tuliskan naskah dengan panjang 890–950 kata.',
    '- Panjang naskah dicapai dengan MENAMBAH ISI CERITA, bukan dengan memotong-motong kalimat menjadi banyak baris pendek.',
    '- Setiap paragraf WAJIB berisi kalimat utuh yang bermakna (sekitar 10–20 kata per paragraf). DILARANG menulis paragraf berisi potongan frasa, satu-dua kata, atau pecahan kalimat.',
    '- Tulis TEPAT 4 adegan penuh. Anggaran panjang setiap adegan: sekitar 230 kata (4 × 230 = ±920 kata).',
    '- Adegan 1 ±230 kata, Adegan 2 ±230 kata, Adegan 3 ±230 kata, Adegan 4 ±230 kata. DILARANG berpindah adegan sebelum adegan berjalan mencapai sekitar 230 kata.',
    '- DILARANG menutup bab sebelum keempat adegan selesai ditulis penuh.',
    '- Khusus bab klimaks atau bab-bab akhir: DILARANG menyelesaikan konflik secara terburu-buru. Urai percakapan konfrontasi, pertarungan argumen, dan ketegangan situasi secara bertahap dan mendalam.',
    isKbm
      ? '- Tekankan rasio dialog tinggi: minimal 16–20 pertukaran dialog bolak-balik per adegan, eskalasi ketegangan relasi/hinaan moral, dan reaksi fisik mentah.'
      : '- Tekankan interaksi dialog yang hidup: minimal 12–16 pertukaran dialog bolak-balik per adegan, aksi fisik nyata, dan dinamika tensi adegan.',
    '- Kembangkan interaksi sensorik, dinamika dialog, dan ketegangan adegan secara mendalam.',
    '- Sebelum menutup bab, periksa ulang: bila total naskah masih di bawah 880 kata, WAJIB kembangkan adegan yang ada dengan dialog dan detail tambahan sampai melewatinya.',
    '- DILARANG keras menutup bab atau menulis penutup sebelum panjang naskah melewati minimal 880 kata.',
  ].join('\n')

  const culturalDirective = buildCulturalHonorificDirectives(descriptors, language)
  const genreDirective = input.genre ? buildGenreProseDirective(input.genre) : null
  const p4 = [
    '=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===',
    '- Pertahankan sudut pandang orang pertama ("aku") secara konsisten.',
    input.voiceGuidance ? `- Panduan Suara Karakter:\n${safe(input.voiceGuidance)}` : '',
    culturalDirective ? safe(culturalDirective) : '',
    genreDirective ? safe(genreDirective) : '',
    '- Format pergantian ucapan tokoh dipisahkan dengan jelas agar pembaca mudah mengikuti percakapan.',
    '- Keterbacaan Mobile: Utamakan kalimat tunggal yang lugas, padat, dan bertenaga (SP / SPO).',
    '- Pecah kalimat majemuk bertingkat yang panjang atau berbelit-belit menjadi kalimat-kalimat tunggal yang ringkas.',
    '- DILARANG menyambung banyak klausa atau anak kalimat dengan koma beruntun (seperti: ", merasakan...", ", membuat...", ", sehingga...", ", lalu...").',
    '- Contoh SALAH: "Aku mengusap meja kayu yang kasar, merasakan alur seratnya sambil menatap pintu."',
    '- Contoh BENAR: "Aku mengusap meja kayu yang kasar. Alur seratnya sudah kuhafal di luar kepala."',
  ].filter(Boolean).join('\n')

  const p5 = [
    '=== [P5] RITME PARAGRAF KUALITATIF ===',
    '- Paragraf Ringkas: Setiap paragraf wajib bernapas lega. Cukup satu atau dua kalimat pendek saja per paragraf.',
    '- DILARANG menumpuk banyak kalimat dalam satu blok paragraf. Hindari paragraf berjejal atau dinding teks.',
    '- Dialog Mandiri: Setiap baris ucapan dialog tokoh WAJIB berdiri sendiri dalam paragraf terpisah. Jangan satukan dialog dengan kalimat narasi panjang.',
    '- Pemisahan Aksi & Reaksi: Pecah runtutan aksi fisik, reaksi emosi, dan detail sensorik menjadi paragraf-paragraf mandiri yang terpisah satu baris kosong.',
    '- Setiap paragraf tetap WAJIB berupa kalimat utuh yang bermakna (sekitar 10–20 kata). Paragraf pendek berarti ringkas dan bernapas, BUKAN pecahan frasa atau potongan kalimat.',
    '- Target panjang 800–1000 kata dicapai dengan memperkaya isi adegan (dialog, detail sensorik, gejolak batin), BUKAN dengan memecah kalimat menjadi banyak baris.',
    ...(isKbm ? [
      '',
      '=== KHUSUS GAYA KBM VIRAL ===',
      '- Dialog sentris: jadikan percakapan sebagai penggerak utama cerita.',
      '- Micro-injustice: angkat hal-hal sepele yang menyengat harga diri dan memicu amarah pembaca.',
      '- Sikap tokoh utama: tidak merengek/cengeng; bersikap tenang, dingin, atau menyimpan pembalasan terencana.',
      '- Ujung bab: akhiri dengan cliffhanger tajam yang menggantungkan nasib tokoh atau rahasia yang hampir terbongkar.',
    ] : []),
  ].join('\n')

  // Judul bab sebelumnya sudah tersedia di continuation tetapi tak pernah
  // sampai ke penulis, sehingga bab berurutan bisa terbit dengan judul
  // identik (mis. Bab 4 & Bab 5 sama-sama "Jejak di Balik Pintu").
  const previousTitle = cc?.previousChapter?.title
  // Registry judul: novel produksi pernah terbit dengan judul duplikat lintas
  // bab yang tidak berurutan ("Bayang-Bayang di Balik Daun Pintu" 3x) dan
  // kosakata judul yang kolaps (balik/bawah/jejak dominan). Ban eksplisit.
  const usedTitles = [...new Set((cc?.previousTitles ?? [])
    .map((title) => title.trim())
    .filter(Boolean))]
  const dominantKeywords = dominantTitleKeywords(usedTitles)
  const output = [
    '=== KONTRAK KELUARAN ===',
    'Keluaran WAJIB diawali dengan:',
    'JUDUL: <Judul Bab yang Menggugah>',
    previousTitle
      ? `- Judul bab sebelumnya adalah "${safe(previousTitle)}". DILARANG memakai judul itu lagi atau variasi yang nyaris sama. Judul bab ini WAJIB berbeda.`
      : '',
    usedTitles.length > 0
      ? `- REGISTRY JUDUL SUDAH DIPAKAI bab lain (DILARANG memakai judul yang sama atau nyaris sama): ${usedTitles.map((title) => `"${safe(title)}"`).join(', ')}.`
      : '',
    dominantKeywords.length > 0
      ? `- Kata-kata berikut sudah terlalu sering muncul di judul-judul sebelumnya (DILARANG menjadi kata utama judul baru): ${dominantKeywords.join(', ')}.`
      : '',
    '- Judul bab ini WAJIB unik (belum pernah dipakai di bab mana pun) dan memakai kosakata segar yang spesifik dengan isi bab ini.',
    '- Panjang naskah WAJIB berada dalam rentang 800–1000 kata (target ideal: 890–950 kata), dengan setiap paragraf berupa kalimat utuh sekitar 10–20 kata.',
    '<Prosa lengkap...>',
  ].filter(Boolean).join('\n')

  return {
    system: mobileDramaSystemPrompt(styleProfile),
    user: [p0, p1, context, p2, p3, p4, p5, output].join('\n\n'),
    styleProfileId: styleProfile ?? STYLE_PROFILE_ID,
    wordTarget: { ...words },
    paragraphTarget: { ...paragraphs },
  }
}

export function buildWriterPrompt(input: BuildWriterPromptInput): WriterPromptParts {
  if (!input.brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')
  return buildChapterBriefV2Prompt(input)
}
