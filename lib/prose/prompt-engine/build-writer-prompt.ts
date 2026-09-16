import {
  MOBILE_DRAMA_RHYTHM,
  STYLE_PROFILE_ID,
  mobileDramaSystemPrompt,
} from '@/lib/prose/mobile-drama-style'
import type { BuildWriterPromptInput, WriterPromptParts } from './types'

function writerVisible(value: string, authorityIds: readonly string[]): string {
  let visible = value
  for (const authorityId of authorityIds) {
    visible = visible.split(authorityId).join('rahasia kanonik')
  }
  return visible
}

function buildChapterBriefV2Prompt(input: BuildWriterPromptInput): WriterPromptParts {
  const brief = input.brief
  if (!brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')

  const { words, paragraphs } = MOBILE_DRAMA_RHYTHM
  const names = input.characterNames ?? []
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

  const p0 = [
    '=== [P0] INVARIAN CANON & KEAMANAN (MANDATORI / HARUS DIPATUHI) ===',
    names.length > 0 ? `- Tokoh yang boleh tampil (nama persis): ${names.join(', ')}.` : '',
    '- DILARANG memunculkan tokoh bernama baru yang tidak ada dalam daftar di atas.',
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
  const context = [
    '=== KONTEKS: RIWAYAT PEMBACA & AKIBAT PILIHAN ===',
    'Potongan Paragraf Akhir Bab Sebelumnya:',
    previousEnding,
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
    beats.length > 0 ? '- Beat Wajib yang Harus Dijalani Tokoh:' : '',
    ...lines(beats),
    '- Urai setiap beat secara mendalam menjadi rangkaian interaksi bertahap; jangan meringkas satu beat hanya dalam 2–3 paragraf singkat.',
    '- Tulis 4 adegan berkesinambungan di lokasi fisik nyata yang mengalir tanpa lompatan waktu drastis.',
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
    '- Setiap adegan WAJIB memuat: pembukaan situasi, detail sensorik lingkungan, minimal 8–10 pertukaran dialog bolak-balik, reaksi fisik tokoh, dan pergolakan batin narator.',
    '- Kembangkan interaksi sensorik, dinamika dialog, dan ketegangan adegan secara mendalam.',
    '- Urai setiap adegan secara bertahap dan detail; perlambat tempo agar cerita tidak selesai terlalu cepat sebelum mencapai minimal 880 kata.',
    '- Sebelum menutup bab, periksa ulang: bila total naskah masih di bawah 880 kata, WAJIB kembangkan adegan yang ada dengan dialog dan detail tambahan sampai melewatinya.',
    '- DILARANG keras menutup bab atau menulis penutup sebelum panjang naskah melewati minimal 880 kata.',
  ].join('\n')

  const p4 = [
    '=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===',
    '- Pertahankan sudut pandang orang pertama ("aku") secara konsisten.',
    input.voiceGuidance ? `- Panduan Suara Karakter:\n${safe(input.voiceGuidance)}` : '',
    '- Format pergantian ucapan tokoh dipisahkan dengan jelas agar pembaca mudah mengikuti percakapan.',
    '- Keterbacaan Mobile: Utamakan kalimat tunggal yang lugas, padat, dan bertenaga (SP / SPO).',
    '- Pecah kalimat majemuk bertingkat yang panjang atau berbelit-belit menjadi kalimat-kalimat tunggal yang ringkas.',
    '- DILARANG menyambung banyak klausa atau anak kalimat dengan koma beruntun (seperti: ", merasakan...", ", membuat...", ", sehingga...", ", lalu...").',
    '- Contoh SALAH: "Aku mengusap meja kayu yang kasar, merasakan alur seratnya sambil menatap pintu."',
    '- Contoh BENAR: "Aku mengusap meja kayu yang kasar. Alur seratnya sudah kuhafal di luar kepala."',
  ].filter(Boolean).join('\n')

  const p5 = [
    '=== [P5] RITME PARAGRAF KUALITATIF ===',
    '- Paragraf Ringkas: Setiap paragraf wajib bernapas lega. Cukup satu atau dua kalimat pendek saja (1–2 kalimat per paragraf).',
    '- DILARANG menumpuk banyak kalimat dalam satu blok paragraf. Hindari paragraf berjejal atau dinding teks.',
    '- Dialog Mandiri: Setiap baris ucapan dialog tokoh WAJIB berdiri sendiri dalam paragraf terpisah. Jangan satukan dialog dengan kalimat narasi panjang.',
    '- Pemisahan Aksi & Reaksi: Pecah runtutan aksi fisik, reaksi emosi, dan detail sensorik menjadi paragraf-paragraf mandiri yang terpisah satu baris kosong.',
    '- Setiap paragraf tetap WAJIB berupa kalimat utuh yang bermakna (sekitar 10–20 kata). Paragraf pendek berarti ringkas dan bernapas, BUKAN pecahan frasa atau potongan kalimat.',
    '- Target panjang 800–1000 kata dicapai dengan memperkaya isi adegan (dialog, detail sensorik, gejolak batin), BUKAN dengan memecah kalimat menjadi banyak baris.',
  ].join('\n')

  // Judul bab sebelumnya sudah tersedia di continuation tetapi tak pernah
  // sampai ke penulis, sehingga bab berurutan bisa terbit dengan judul
  // identik (mis. Bab 4 & Bab 5 sama-sama "Jejak di Balik Pintu").
  const previousTitle = cc?.previousChapter?.title
  const output = [
    '=== KONTRAK KELUARAN ===',
    'Keluaran WAJIB diawali dengan:',
    'JUDUL: <Judul Bab yang Menggugah>',
    previousTitle
      ? `- Judul bab sebelumnya adalah "${safe(previousTitle)}". DILARANG memakai judul itu lagi atau variasi yang nyaris sama. Judul bab ini WAJIB berbeda.`
      : '',
    '- Panjang naskah WAJIB berada dalam rentang 800–1000 kata (target ideal: 890–950 kata), dengan setiap paragraf berupa kalimat utuh sekitar 10–20 kata.',
    '<Prosa lengkap...>',
  ].filter(Boolean).join('\n')

  return {
    system: mobileDramaSystemPrompt(),
    user: [p0, p1, context, p2, p3, p4, p5, output].join('\n\n'),
    styleProfileId: STYLE_PROFILE_ID,
    wordTarget: { ...words },
    paragraphTarget: { ...paragraphs },
  }
}

export function buildWriterPrompt(input: BuildWriterPromptInput): WriterPromptParts {
  if (!input.brief) throw new Error('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')
  return buildChapterBriefV2Prompt(input)
}
