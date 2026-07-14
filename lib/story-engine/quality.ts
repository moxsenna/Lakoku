export interface QualityFinding {
  code: string
  message: string
}

export interface ValidateChapterQualityInput {
  title: string
  paragraphs: string[]
  genre: string
  chapterNumber?: number
}

export interface ValidateChoiceQualityInput {
  labels: string[]
  lastParagraphs: string[]
}

export const CHAPTER_WORD_COUNT_MIN = 800
export const CHAPTER_WORD_COUNT_MAX = 1000
export const MOBILE_PARAGRAPH_WORD_MAX = 120
export const DUPLICATE_LONG_PARAGRAPH_WORD_MIN = 40
export const OPENING_CONFLICT_WORD_WINDOW = 150
export const REQUIRED_DIALOGUE_LINES = 3

// Quote detection accepts straight/curly quotes. It does not depend on em-dash usage.
const DIALOGUE_PATTERN = /(?:^|\s)["“][^"”]+["”]/u
const INTERNAL_LEAK_PATTERN = /\b(?:prompt|tokens?|models?|llm|providers?|routes?)\b/iu
const BACKSTORY_PATTERN = /\b(?:dulu|masa lalu|ketika kecil|bertahun-tahun lalu|sejak kecil|formerly|years ago|childhood|backstory)\b/iu
const HOOK_PATTERN = /\b(?:tiba-tiba|namun|tetapi|ternyata|mendadak|rahasia|ancaman|menunggu|berdiri|terbuka|menghilang|siapa|mengapa|bagaimana|belum|jangan|darah|tembakan|telepon|pesan|sosok|pintu|but|suddenly|secret|threat|waiting|vanished|who|why|how|gunshot|message|stranger)\b/iu
const CONFLICT_PATTERN = /\b(?:merebut|mengejar|menendang|melawan|menolak|mengancam|mencuri|pencuri|menyerang|terjebak|berdebat|memaksa|mencegah|melarikan|menuduh|bertarung|konflik|bahaya|polisi|musuh|korban|darah|tembakan|rebut|kejar|lawan|curi|ancam|serang|tolak|fight|steal|chase|threaten|attack|trap|argue|force|escape|danger|enemy|victim)\b/iu
const ABSTRACT_TERMS = new Set([
  'harapan', 'makna', 'perasaan', 'keyakinan', 'kesadaran', 'kehidupan',
  'takdir', 'kebebasan', 'kebenaran', 'keraguan', 'kenangan', 'kemungkinan',
  'hope', 'meaning', 'feeling', 'belief', 'awareness', 'life', 'fate', 'freedom',
  'truth', 'doubt', 'memory', 'possibility',
])
const CONCRETE_ACTION_PATTERN = /\b(?:berjalan|berlari|membuka|menutup|mengambil|meletakkan|memukul|menatap|melihat|mendengar|menyentuh|duduk|berdiri|masuk|keluar|membawa|menendang|mengejar|merebut|walk|run|open|close|take|put|hit|look|hear|touch|sit|stand|enter|leave|carry)\b/iu
const GENERIC_CHOICE_PATTERN = /^(?:lanjut(?:kan)?|terus(?:kan)?|pilihan\s*[a-z0-9]+|apa yang harus dilakukan\??|pilih ini|continue|next|choice\s*[a-z0-9]+|what should .+ do\??)$/iu
const INTERNAL_CHOICE_PATTERN = /\b(?:prompt|tokens?|models?|llm|providers?|routes?|system|internal)\b/iu
const ACTION_PREFIX_PATTERN = /^(?:buka|tutup|ambil|tinggalkan|ikuti|hadang|tanya|tolong|selamatkan|lawan|kejar|periksa|baca|sembunyikan|ungkapkan|masuk|keluar|lari|panggil|cari|pilih|tolak|terima|kirim|hancurkan|jaga|dekati|hindari|open|close|take|leave|follow|stop|ask|help|save|fight|chase|inspect|read|hide|reveal|enter|run|call|find|choose|refuse|accept|send|destroy|guard|approach|avoid)\b/iu
const STOP_WORDS = new Set([
  'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'itu', 'ini', 'dengan', 'untuk',
  'pada', 'dalam', 'sambil', 'lalu', 'sebuah', 'the', 'a', 'an', 'and', 'or',
  'to', 'from', 'with', 'for', 'in', 'on', 'at', 'that', 'this',
])
const CHOICE_ACTION_WORDS = new Set([
  'buka', 'tutup', 'ambil', 'tinggalkan', 'ikuti', 'hadang', 'tanya', 'tolong',
  'selamatkan', 'lawan', 'kejar', 'periksa', 'baca', 'sembunyikan', 'ungkapkan',
  'masuk', 'keluar', 'lari', 'panggil', 'cari', 'pilih', 'tolak', 'terima',
  'kirim', 'hancurkan', 'jaga', 'dekati', 'hindari', 'open', 'close', 'take',
  'leave', 'follow', 'stop', 'ask', 'help', 'save', 'fight', 'chase', 'inspect',
  'read', 'hide', 'reveal', 'enter', 'run', 'call', 'find', 'choose', 'refuse',
  'accept', 'send', 'destroy', 'guard', 'approach', 'avoid',
])

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]+/gu) ?? []
}

function wordCount(value: string): number {
  return tokens(value).length
}

function finding(code: string, message: string): QualityFinding {
  return { code, message }
}

function normalizedParagraph(value: string): string {
  return tokens(value).join(' ')
}

function isAbstractParagraph(paragraph: string): boolean {
  const words = tokens(paragraph)
  const abstractCount = words.filter((word) => ABSTRACT_TERMS.has(word)).length
  return abstractCount >= 4 && !CONCRETE_ACTION_PATTERN.test(paragraph)
}

function hasDuplicateLongParagraph(paragraphs: readonly string[]): boolean {
  const seen = new Set<string>()
  for (const paragraph of paragraphs) {
    if (wordCount(paragraph) < DUPLICATE_LONG_PARAGRAPH_WORD_MIN) continue
    const normalized = normalizedParagraph(paragraph)
    if (seen.has(normalized)) return true
    seen.add(normalized)
  }
  return false
}

function hasConsecutiveAbstractParagraphs(paragraphs: readonly string[]): boolean {
  let previousAbstract = false
  for (const paragraph of paragraphs) {
    const currentAbstract = isAbstractParagraph(paragraph)
    if (previousAbstract && currentAbstract) return true
    previousAbstract = currentAbstract
  }
  return false
}

function hookText(paragraphs: readonly string[]): string {
  return paragraphs.slice(-2).join(' ')
}

export function validateChapterQuality(input: ValidateChapterQualityInput): QualityFinding[] {
  const title = text(input?.title)
  const paragraphs = stringArray(input?.paragraphs)
  const genre = text(input?.genre)
  const findings: QualityFinding[] = []
  const fullText = [title, ...paragraphs].join(' ')
  const count = wordCount(paragraphs.join(' '))

  if (count < CHAPTER_WORD_COUNT_MIN || count > CHAPTER_WORD_COUNT_MAX) {
    findings.push(finding(
      'WORD_COUNT_OUT_OF_RANGE',
      `Chapter must contain ${CHAPTER_WORD_COUNT_MIN}–${CHAPTER_WORD_COUNT_MAX} words; found ${count}.`,
    ))
  }

  if (hasDuplicateLongParagraph(paragraphs)) {
    findings.push(finding(
      'DUPLICATE_LONG_PARAGRAPH',
      `Long paragraphs of at least ${DUPLICATE_LONG_PARAGRAPH_WORD_MIN} words must not repeat.`,
    ))
  }

  if (hasConsecutiveAbstractParagraphs(paragraphs)) {
    findings.push(finding(
      'CONSECUTIVE_ABSTRACT_PARAGRAPHS',
      'No more than one abstract paragraph may appear consecutively.',
    ))
  }

  if (/\b(?:drama|misteri|mystery)\b/iu.test(genre)) {
    const dialogueLines = paragraphs.filter((paragraph) => DIALOGUE_PATTERN.test(paragraph)).length
    if (dialogueLines < REQUIRED_DIALOGUE_LINES) {
      findings.push(finding(
        'INSUFFICIENT_DIALOGUE',
        `Drama and mystery chapters require at least ${REQUIRED_DIALOGUE_LINES} dialogue lines.`,
      ))
    }
  }

  const opening = tokens(paragraphs.join(' ')).slice(0, OPENING_CONFLICT_WORD_WINDOW).join(' ')
  if (!CONFLICT_PATTERN.test(opening)) {
    findings.push(finding(
      'MISSING_OPENING_CONFLICT',
      `First ${OPENING_CONFLICT_WORD_WINDOW} words need concrete conflict or opposition.`,
    ))
  }

  if (paragraphs.some((paragraph) => wordCount(paragraph) > MOBILE_PARAGRAPH_WORD_MAX)) {
    findings.push(finding(
      'PARAGRAPH_TOO_LONG',
      `Mobile paragraphs must not exceed ${MOBILE_PARAGRAPH_WORD_MAX} words.`,
    ))
  }

  if (paragraphs.some((paragraph) => (
    wordCount(paragraph) > MOBILE_PARAGRAPH_WORD_MAX && BACKSTORY_PATTERN.test(paragraph)
  ))) {
    findings.push(finding(
      'INFO_DUMP_BACKSTORY',
      'Long backstory exposition must be broken into active scene beats.',
    ))
  }

  if (!HOOK_PATTERN.test(hookText(paragraphs))) {
    findings.push(finding(
      'MISSING_CHAPTER_HOOK',
      'Final paragraphs need an unresolved question, threat, reveal, or turn.',
    ))
  }

  if (INTERNAL_LEAK_PATTERN.test(fullText)) {
    findings.push(finding(
      'INTERNAL_LANGUAGE_LEAK',
      'Reader-facing prose must not expose generation or routing language.',
    ))
  }

  return findings
}

function meaningfulTokens(value: string, removeActions: boolean): Set<string> {
  return new Set(tokens(value).filter((token) => (
    token.length >= 3
    && !STOP_WORDS.has(token)
    && (!removeActions || !CHOICE_ACTION_WORDS.has(token))
  )))
}

export function validateChoiceQuality(input: ValidateChoiceQualityInput): QualityFinding[] {
  const labels = stringArray(input?.labels).map((label) => label.trim())
  const lastParagraphs = stringArray(input?.lastParagraphs).slice(-3)
  const findings: QualityFinding[] = []

  if (labels.length < 2 || labels.length > 4) {
    findings.push(finding('CHOICE_COUNT_INVALID', 'Choices must contain 2–4 labels.'))
  }

  const contextTokens = meaningfulTokens(lastParagraphs.join(' '), false)
  labels.forEach((label, index) => {
    const suffix = ` Choice ${index + 1}.`
    if (
      label.length === 0
      || GENERIC_CHOICE_PATTERN.test(label)
      || INTERNAL_CHOICE_PATTERN.test(label)
    ) {
      findings.push(finding(
        'CHOICE_GENERIC_OR_INTERNAL',
        `Choice labels must describe reader-facing concrete actions.${suffix}`,
      ))
      return
    }

    if (!ACTION_PREFIX_PATTERN.test(label)) {
      findings.push(finding(
        'CHOICE_NOT_ACTIONABLE',
        `Choice label must begin with a concrete action.${suffix}`,
      ))
    }

    const labelTokens = meaningfulTokens(label, true)
    const overlaps = [...labelTokens].some((token) => contextTokens.has(token))
    if (!overlaps) {
      findings.push(finding(
        'CHOICE_UNRELATED',
        `Choice label must reference a meaningful detail from the last three paragraphs.${suffix}`,
      ))
    }
  })

  return findings
}
