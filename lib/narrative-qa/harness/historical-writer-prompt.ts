import type { CanonSnapshot, ContinuationContext } from '@lakoku/narrative-core'

export const HISTORICAL_WRITER_AUTHORITY_VERSION = 'HISTORICAL_V1' as const

export const historicalProjectionContract = Object.freeze({
  authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
  sourceRevision: 'HEAD@d24a52cee90d5c17dede0bbae3ddf365614b4d9f' as const,
  sourceFiles: Object.freeze([
    Object.freeze({
      path: 'lib/prose/mobile-drama-style.ts' as const,
      sha256: '67f0ee6c33e2ad5dfe0aaa945c85dc9fefce18178a2d11e6339afe4c178557be' as const,
    }),
    Object.freeze({
      path: 'lib/prose/prompt-engine/build-writer-prompt.ts' as const,
      sha256: '485d8d2b81678617c39879ac087a6bd7fb6cd7b4d98d1314483238e601cc53ed' as const,
    }),
  ]),
  activePromptImportsAllowed: false as const,
})

type HistoricalRepairFinding = Readonly<{
  severity?: string
  message: string
}>

export type HistoricalWriterPromptArgs = Readonly<{
  snapshot: CanonSnapshot
  plan: Record<string, unknown>
  continuation?: ContinuationContext | null
  repairFindings?: readonly HistoricalRepairFinding[]
}>

export type HistoricalWriterPromptProjection = Readonly<{
  authorityVersion: typeof HISTORICAL_WRITER_AUTHORITY_VERSION
  historicalProjectionContract: typeof historicalProjectionContract
  system: string
  prompt: string
}>

const HISTORICAL_MOBILE_DRAMA_RHYTHM = Object.freeze({
  words: Object.freeze({ hardMin: 800, hardMax: 1000, softMin: 850, softMax: 950 }),
  paragraphs: Object.freeze({ hardMin: 35, hardMax: 50, softMin: 38, softMax: 48 }),
})

function historicalMobileDramaSystemPrompt(): string {
  const { words, paragraphs } = HISTORICAL_MOBILE_DRAMA_RHYTHM
  return [
    'Kamu penulis serial drama mobile / web novel Indonesia.',
    'Tulis HANYA prosa cerita untuk pembaca akhir.',
    'DILARANG menyebut AI, model, prompt, token, sistem, instruksi, atau meta-komentar.',
    'DILARANG menyapa pembaca di luar narasi.',
    '',
    'GAYA WAJIB (Lakoku Mobile Drama):',
    '- POV: orang pertama "aku" (tokoh utama).',
    `- Target ${words.softMin}–${words.softMax} kata (wajib dalam ${words.hardMin}–${words.hardMax}).`,
    `- Target ${paragraphs.softMin}–${paragraphs.softMax} paragraf (wajib dalam ${paragraphs.hardMin}–${paragraphs.hardMax}).`,
    '- Mayoritas paragraf = 1 kalimat pendek (15–25 kata). Sesekali 2 kalimat (30–40 kata) untuk emosi penting.',
    '- DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
    '- Dialog: 1 baris ucapan = 1 paragraf. Selalu pisah per pembicara.',
    '- Twist/reveal: berdiri sendiri dalam 1 paragraf.',
    '- Ending bab: 3–5 paragraf pendek yang makin tajam (cliffhanger), kecuali bab terakhir cerita.',
    '- SHOW, jangan TELL: aksi, dialog, tubuh, detail sensorik. Hindari "aku merasa sedih/marah" polos.',
    '- Satu beat per paragraf. Bahasa Indonesia modern, natural, emosional—bukan puitis berat.',
    '',
    'STRUKTUR BAB (~900 kata):',
    '- Pembuka hook: 3–5 paragraf',
    '- Konflik awal: 8–10 paragraf',
    '- Dialog/konfrontasi utama: 15–20 paragraf',
    '- Reveal kecil / ubah emosi: 6–8 paragraf',
    '- Penutup cliffhanger: 4–6 paragraf',
    '',
    'DILARANG:',
    '- Eksposisi plot ke pembaca',
    '- Metafora AI generik berulang',
    '- Dialog yang hanya mengulang info yang sudah diketahui',
    '- Frasa: "pilihan menunggumu", "bab berikutnya", "keputusan itu milikmu"',
  ].join('\n')
}

function historicalMobileDramaOutputFormat(): string {
  const { paragraphs } = HISTORICAL_MOBILE_DRAMA_RHYTHM
  return [
    'FORMAT KELUARAN (WAJIB):',
    'Baris pertama tepat: JUDUL: <judul bab tanpa nomor bab>',
    'Satu baris kosong, lalu prosa.',
    `Pisahkan SETIAP paragraf dengan satu baris kosong (target ${paragraphs.softMin}–${paragraphs.softMax} paragraf).`,
    'Mayoritas 1 kalimat per paragraf. Dialog satu baris per paragraf.',
    'Jangan markdown, bullet, atau label lain.',
  ].join('\n')
}

function historicalRepairBlock(findings: readonly HistoricalRepairFinding[] | undefined): string {
  if (!findings?.length) return ''
  const lines = findings
    .filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'MAJOR' || !finding.severity)
    .map((finding) => `- ${finding.message}`)
  if (!lines.length) return ''
  return [
    'PERBAIKAN WAJIB (revisi sebelumnya bermasalah):',
    ...lines,
    'Jika bab kurang kata: tulis ulang JAUH lebih panjang — tiap adegan minimal ~250 kata dengan dialog panjang, deskripsi indrawi, dan monolog batin. JANGAN meringkas; tambah adegan bila perlu, bukan filler.',
  ].join('\n')
}

function activeCharacterNames(snapshot: CanonSnapshot, chapter: number): string[] {
  return snapshot.characters
    .filter((character) => character.status !== 'DEAD' && character.introducedChapter <= chapter)
    .map((character) => character.canonicalName)
}

function voiceGuidance(snapshot: CanonSnapshot, chapter: number): string {
  const nameById = new Map(snapshot.characters.map((character) => [
    character.id,
    character.canonicalName,
  ]))
  const activeIds = new Set(
    snapshot.characters
      .filter((character) => character.status !== 'DEAD' && character.introducedChapter <= chapter)
      .map((character) => character.id),
  )
  const lines = snapshot.voiceSheets
    .filter((voice) => activeIds.has(voice.characterId))
    .sort((left, right) => left.characterId.localeCompare(right.characterId))
    .map((voice) => {
      const name = nameById.get(voice.characterId) ?? 'Tokoh'
      const parts = [`- ${name}: bicara ${voice.register}`]
      if (voice.speechHabits.length) parts.push(`kebiasaan: ${voice.speechHabits.join('; ')}`)
      if (voice.forbiddenWords.length) parts.push(`hindari kata: ${voice.forbiddenWords.join(', ')}`)
      if (voice.sampleLines.length) parts.push(`contoh nada: "${voice.sampleLines[0]}"`)
      return parts.join(' — ')
    })
  if (!lines.length) return ''
  return ['Jaga suara tiap tokoh agar khas & konsisten:', ...lines].join('\n')
}

export function renderHistoricalWriterPrompt(
  input: HistoricalWriterPromptArgs,
): HistoricalWriterPromptProjection {
  const { words, paragraphs } = HISTORICAL_MOBILE_DRAMA_RHYTHM
  const chapter = Number(input.plan.chapterNumber)
  const scenes = Math.min(Math.max(Number(input.plan.targetSceneCount ?? 3), 2), 4)
  const names = activeCharacterNames(input.snapshot, chapter)
  const beats = Array.isArray(input.plan.plannedBeats) ? input.plan.plannedBeats as string[] : []
  const cc = input.continuation
  const system = historicalMobileDramaSystemPrompt()

  const layer1CanonInvariants = [
    '=== [1] INVARIAN CANON (MANDATORI / HARUS DIPATUHI) ===',
    names.length ? `- Tokoh yang boleh tampil (nama persis): ${names.join(', ')}.` : '',
    '- JANGAN memperkenalkan tokoh bernama baru di luar daftar.',
    '- JANGAN membocorkan rahasia yang belum waktunya / belum terungkap.',
    cc?.mustNotReveal?.length
      ? `- RAHASIA DILARANG UNTUK DIKONTAMINASI/DIUNGKAP: ${cc.mustNotReveal.join(', ')}`
      : '',
    cc?.storyAnchors
      ? [
          '',
          '=== [1a] SANGKAR KISAH (JANGKAR GLOBAL — JANGAN MELANGGAR) ===',
          cc.storyAnchors.corePromise
            ? `- Janji Inti Cerita: ${cc.storyAnchors.corePromise}`
            : '',
          cc.storyAnchors.mainConflict
            ? `- Konflik Utama (harus tetap terasa di bab ini): ${cc.storyAnchors.mainConflict}`
            : '',
          cc.storyAnchors.finalQuestion
            ? chapter >= 45
              ? `- PERTANYAAN AKHIR (WAJIB diarahkan ke jawaban, ending mendekat): ${cc.storyAnchors.finalQuestion}`
              : `- Pertanyaan akhir cerita yang menggantung: ${cc.storyAnchors.finalQuestion}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    cc?.lockedEndingKey
      ? `- ENDING SUDAH TERKUNCI pada "${cc.lockedEndingKey}". Semua pilihan/akibat bab ini harus mengarah ke ending tersebut.`
      : '',
  ].filter(Boolean).join('\n')

  let layer2ReaderHistory = ''
  if (cc && cc.previousChapter) {
    const prevEnding = cc.previousChapter.endingParagraphs.map((paragraph) => `> ${paragraph}`).join('\n')
    const choiceBlock = cc.previousChoice
      ? [
          `- Pilihan Pembaca di Bab ${cc.previousChapter.number} [${cc.previousChoice.choiceId}]: "${cc.previousChoice.label}"`,
          `- Konsekuensi Kanonik Pilihan: ${cc.previousChoice.consequence.join(' / ')}`,
          cc.previousChoice.effectSummary ? `- Ringkasan Efek: ${JSON.stringify(cc.previousChoice.effectSummary)}` : '',
          '- KONSEKUENSI DI ATAS SUDAH TERJADI DAN MENGIKAT. Bab ini menuliskan AKIBATNYA.',
          '  DILARANG membatalkan, menunda, atau membalik pilihan itu. DILARANG membuat tokoh',
          '  berubah pikiran sehingga cerita kembali ke jalur pilihan yang TIDAK diambil.',
        ].filter(Boolean).join('\n')
      : `- (Bab ${cc.previousChapter.number} tidak memiliki pilihan pembaca / linear)`

    layer2ReaderHistory = [
      '=== [2] RIWAYAT PEMBACA & AKHIR BAB SEBELUMNYA ===',
      `Potongan Paragraf Terakhir Bab ${cc.previousChapter.number} ("${cc.previousChapter.title}"):`,
      prevEnding,
      '',
      choiceBlock,
    ].join('\n')
  }

  let layer3StoryState = ''
  if (cc) {
    const threadLines = cc.openThreads.map((thread) => `- Thread Aktif: ${thread.id} (${thread.status})`)
    const factLines = cc.anchorFacts.map((fact) => `- Fakta Mapan (Bab ${fact.establishedChapter}): ${fact.statement}`)
    const timelineLines = cc.recentTimeline.map((item) => `- Kronologi Pasti (Bab ${item.chapterNumber}): ${item.description}`)
    const rollupLines = cc.actRollups.length
      ? ['Ringkasan Babak Terlewati:', ...cc.actRollups.map(
          (rollup) => `- Babak ${rollup.actNumber} (Bab 1-${rollup.coversToChapter}): ${rollup.summary}`,
        )]
      : []
    const sections = [
      { id: 'threads', header: 'Thread Aktif:', lines: threadLines },
      { id: 'facts', header: 'Fakta Terbukti:', lines: factLines },
      { id: 'timeline', header: 'Kronologi Terbaru:', lines: timelineLines },
      { id: 'rollups', header: null, lines: rollupLines },
    ].filter((section) => section.lines.length > 0)
    const render = (): string => {
      const parts: string[] = [
        '=== [3] KEADAAN CERITA ===',
        `Rute & Status Pembaca: ${cc.routeStateSummary}`,
      ]
      for (const section of sections) {
        if (section.lines.length === 0) continue
        if (section.header) parts.push(section.header)
        parts.push(...section.lines)
      }
      return parts.join('\n')
    }
    const trimPriority = ['timeline', 'facts', 'threads', 'rollups']
    let content = render()
    while (content.length > 4800) {
      const target = trimPriority
        .map((id) => sections.find((section) => section.id === id))
        .find((section) => section && section.lines.length > 0)
      if (!target) break
      target.lines.pop()
      content = render()
    }
    layer3StoryState = content
  }

  const phase = String(input.plan.phase ?? '')
  const goal = String(input.plan.chapterGoal ?? '')
  const voices = voiceGuidance(input.snapshot, chapter)
  const layer4ChapterGoal = [
    '=== [4] SASARAN BAB & ALUR BEAT ===',
    `Tulis Bab ${chapter} drama interaktif berbahasa Indonesia.`,
    'POV: orang pertama "aku" sebagai tokoh utama (protagonis di daftar nama bila ada).',
    goal ? `Tujuan Bab (hubungkan langsung dengan akibat pilihan pembaca): ${goal}` : '',
    beats.length
      ? `Beat Wajib — tunjukkan lewat adegan & aksi konkret, bukan deskripsi ringkas:\n${beats.map((beat) => `- ${beat}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const layer5FrameworkAndStyle = [
    '=== [5] KERANGKA, RITME & FORMAT OUTPUT ===',
    phase ? `Fase cerita: ${phase}.` : '',
    voices,
    `Tulis ${scenes} adegan PENUH yang mengalir di lokasi konkret; tiap adegan minimal ~${Math.round(words.softMin / scenes)} kata dengan dialog panjang, deskripsi indrawi, dan monolog batin tokoh.`,
    `PANJANG WAJIB minimal ${words.softMin} kata (target ${words.softMin}–${words.softMax}; jangan lewat ${words.hardMax}). JANGAN meringkas atau mempercepat alur — jika terasa kurang dari ${words.softMin} kata, tambahkan adegan atau perpanjang dialog, bukan filler.`,
    `Jumlah paragraf ${paragraphs.softMin}–${paragraphs.softMax} (wajib ${paragraphs.hardMin}–${paragraphs.hardMax}).`,
    'Buka dengan alur langsung yang menyambung dari paragraf terakhir / akibat pilihan.',
    'Tutup dengan 3–5 paragraf cliffhanger pendek (kecuali bab akhir cerita).',
    historicalRepairBlock(input.repairFindings),
    historicalMobileDramaOutputFormat(),
  ].filter(Boolean).join('\n')

  return Object.freeze({
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    historicalProjectionContract,
    system,
    prompt: [
      layer1CanonInvariants,
      layer2ReaderHistory,
      layer3StoryState,
      layer4ChapterGoal,
      layer5FrameworkAndStyle,
    ].filter(Boolean).join('\n\n'),
  })
}
