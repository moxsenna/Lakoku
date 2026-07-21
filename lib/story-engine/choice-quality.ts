/**
 * Phase 4 — Semantic choice quality validation.
 *
 * Pure-function validator that receives the full choice branch, prose context,
 * and narrative state at once. Produces bounded finding codes that callers
 * (choice-generation, repair loop) can act on.
 *
 * Kept pure (no server-only) so unit tests run without React Server conditions.
 */

import { type RouteState, RouteChoiceEffectSchema } from './route-state'

// ---- Types ----

export type ChoiceFinding = {
  code: string
  message: string
  severity: 'ERROR' | 'WARN'
}

export type ChoiceQualityInput = {
  branch: {
    choicePrompt: string
    choices: Array<{ id: string; label: string; hint?: string }>
    outcomes: Array<{
      choiceId: string
      consequence: string[]
      nextChapterNumber: number | null
      isEnding: boolean
      effect?: unknown
    }>
  }
  finalChapter: { title: string; paragraphs: string[] }
  endingParagraphs: string[]
  activeCharacters?: Array<{ id: string; name: string }>
  activeThreads?: Array<{ id: string; summary: string }>
  chapterNumber?: number
  totalChapters?: number
  previousChoice?: { choiceId: string; label: string } | null
  routeState?: RouteState
}

// ---- Tokenization & stopwords ----

const STOP_WORDS = new Set([
  'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'itu', 'ini', 'dengan', 'untuk',
  'pada', 'dalam', 'sambil', 'lalu', 'sebuah', 'akan', 'telah', 'sudah',
  'saya', 'kau', 'kamu', 'anda', 'dia', 'mereka', 'kita', 'kami',
  'the', 'a', 'an', 'and', 'or', 'to', 'from', 'with', 'for',
  'in', 'on', 'at', 'that', 'this', 'is', 'it', 'of',
  'adalah', 'ialah', 'merupakan', 'yaitu', 'yakni',
  'tidak', 'bukan', 'belum', 'jangan',
  'sangat', 'sekali', 'lebih', 'kurang',
  'bisa', 'dapat', 'harus', 'mau', 'ingin',
  'ada', 'pun', 'juga', 'saja', 'hanya', 'masih',
  'seperti', 'bagai', 'bagaimana',
  'jadi', 'maka', 'sehingga', 'karena',
  'saat', 'ketika', 'setelah', 'sebelum', 'selama',
  'apa', 'siapa', 'mana', 'kapan', 'kenapa', 'mengapa',
  'selalu', 'pernah', 'sering', 'kadang', 'baru', 'dulu', 'nanti',
  'sini', 'situ', 'sana', 'begini', 'begitu',
])

function tokenize(value: string): string[] {
  return value.toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]+/gu) ?? []
}

function contentTokens(value: string): string[] {
  return tokenize(value).filter((t) => t.length > 3 && !STOP_WORDS.has(t))
}

// ---- Prose context extraction ----

function buildProseContext(
  finalChapter: { title: string; paragraphs: string[] },
  endingParagraphs: string[],
  activeCharacters: Array<{ id: string; name: string }> | undefined,
  activeThreads: Array<{ id: string; summary: string }> | undefined,
): {
  proseTokens: Set<string>
  characterNames: Set<string>
  threadKeywords: string[]
} {
  const allProseText = [
    finalChapter.title,
    ...finalChapter.paragraphs,
    ...endingParagraphs,
  ].join(' ')

  const proseTokens = new Set(contentTokens(allProseText))

  const characterNames = new Set<string>()
  if (activeCharacters) {
    for (const char of activeCharacters) {
      for (const part of char.name.split(/\s+/)) {
        const lower = part.toLocaleLowerCase('id-ID')
        if (lower.length > 2) characterNames.add(lower)
      }
    }
  }

  const threadKeywords: string[] = []
  if (activeThreads) {
    for (const thread of activeThreads) {
      for (const token of contentTokens(thread.summary)) {
        threadKeywords.push(token)
      }
    }
  }

  return { proseTokens, characterNames, threadKeywords }
}

// ---- Generic / internal pattern detection ----

/** Exact fallback labels from fallbackChoicesFromDraft that signal ungrounded generation. */
const GENERIC_FALLBACK_LABELS = new Set([
  'hadapi langsung apa yang baru terbuka',
  'selidiki dulu jejak yang tersisa',
])

const GENERIC_LABEL_PATTERNS: RegExp[] = [
  /^hadapi(?:lah)?\s+(?:langsung\s+)?apa yang (?:baru\s+)?terbuka/i,
  /^selidiki(?:lah)?\s+(?:dulu\s+)?jejak yang tersisa/i,
]

const INTERNAL_CHOICE_PATTERN = /\b(?:prompt|tokens?|models?|llm|providers?|routes?|system|internal)\b/iu

const GENERIC_PROMPT_PATTERNS: RegExp[] = [
  /^apa yang (?:kau|kamu|anda) lakukan\??$/iu,
  /^apa yang akan (?:kau|kamu|anda) lakukan\??$/iu,
  /^apa (?:pilihan|tindakan)(?:mu|anda|kamu)\??$/iu,
  /^bagaimana (?:kau|kamu|anda) (?:menutup|mengakhiri) kisah ini\??$/iu,
]

function isGenericLabel(label: string): boolean {
  const normalized = label.trim().toLocaleLowerCase('id-ID')
  if (GENERIC_FALLBACK_LABELS.has(normalized)) return true
  for (const pattern of GENERIC_LABEL_PATTERNS) {
    if (pattern.test(normalized)) return true
  }
  return false
}

// ---- Grounding heuristics ----

function isGrounded(
  text: string,
  proseTokens: Set<string>,
  characterNames: Set<string>,
  threadKeywords: string[],
): boolean {
  const textTokens = contentTokens(text)

  // Share content tokens with prose
  if (textTokens.some((t) => proseTokens.has(t))) return true

  // Mention a known character name part
  if (textTokens.some((t) => characterNames.has(t))) return true

  // Mention a thread keyword
  const threadSet = new Set(threadKeywords)
  if (textTokens.some((t) => threadSet.has(t))) return true

  // Concrete nouns from prose (nouns are content tokens > 4 chars)
  const proseNouns = [...proseTokens].filter((t) => t.length > 4)
  if (textTokens.some((t) => proseNouns.includes(t))) return true

  return false
}

function isPromptGenericWithoutConcreteNouns(
  prompt: string,
  proseTokens: Set<string>,
): boolean {
  // Check if prompt matches generic template
  for (const pattern of GENERIC_PROMPT_PATTERNS) {
    if (pattern.test(prompt.trim())) {
      // Even if generic, it's acceptable if it references concrete prose nouns
      const promptTokens = contentTokens(prompt)
      const proseNouns = [...proseTokens].filter((t) => t.length > 4)
      if (promptTokens.some((t) => proseNouns.includes(t))) return false
      return true
    }
  }
  return false
}

// ---- Actionability ----

/** Known Indonesian root imperatives (expanded beyond Phase 1 whitelist). */
const INDO_ROOT_IMPERATIVES = new Set([
  'hadapi', 'selidiki', 'buka', 'tutup', 'ambil', 'tinggalkan', 'ikuti',
  'hadang', 'tanya', 'tolong', 'selamatkan', 'lawan', 'kejar', 'periksa',
  'baca', 'sembunyikan', 'ungkapkan', 'masuk', 'keluar', 'lari', 'panggil',
  'cari', 'pilih', 'tolak', 'terima', 'kirim', 'hancurkan', 'jaga', 'dekati',
  'hindari', 'putuskan', 'diam', 'dengar', 'lihat', 'coba', 'pegang', 'tarik',
  'dorong', 'lempar', 'tangkap', 'lepas', 'gunakan', 'pakai', 'naik', 'turun',
  'berhenti', 'mulai', 'lanjutkan', 'hentikan', 'kunci', 'kumpulkan', 'sebarkan',
  'bagikan', 'ceritakan', 'jelaskan', 'tanyakan', 'katakan', 'ucapkan',
  'beritahu', 'balas', 'tembak', 'serang', 'lompat', 'teriak', 'bisik',
  'usir', 'rayu', 'gali', 'gantung', 'bakar', 'potong', 'tancap',
  'tuang', 'isi', 'kosongkan', 'bersihkan', 'perbaiki', 'tusuk', 'tikam',
  'pukul', 'tampar', 'seret', 'jatuhkan', 'bangun', 'tidur', 'makan',
  'minum', 'bawa', 'datang', 'pergi', 'pulang', 'kembali', 'singgah',
  'hadir', 'muncul', 'tampil', 'lenyap', 'hilang',
  'bersembunyi', 'membuntuti', 'berjalan', 'berlari', 'bertanya',
  'berlindung', 'berjuang', 'berteriak', 'berbisik', 'berdoa',
])

/** Verbs that indicate abstract feeling rather than concrete action. */
const ABSTRACT_FEELING_VERBS = new Set([
  'merasa', 'berharap', 'menginginkan', 'mendambakan', 'membayangkan',
  'merenungkan', 'memikirkan', 'menghayalkan', 'mengkhawatirkan', 'menyesali',
  'menerka', 'menduga', 'mengira', 'menyangka', 'mengkhayalkan',
  'merindukan', 'mengharapkan',
])

/** Patterns that indicate internal mechanism labels (not reader-facing). */
const INTERNAL_MECHANISM_PATTERNS: RegExp[] = [
  /\b(?:route|risk state|flag state)\b/i,
  /(?:naikkan|turunkan|set|reset)\s+(?:risk|state|flag|route)/i,
  /^set flag/i,
  /^naikkan risk state/i,
]

/**
 * Check if a label starts with an Indonesian verb.
 * Supports root imperatives, meN-, ber-, di-, ter-, ke- prefixed verbs.
 */
function startsWithVerb(label: string): boolean {
  const firstWord = tokenize(label)[0] ?? ''
  if (!firstWord) return false

  // Known root imperatives (exact match)
  if (INDO_ROOT_IMPERATIVES.has(firstWord)) return true

  // meN- prefixed verbs: membaca, menulis, mengikuti, menyelidiki, membuka
  if (/^me(?:m|n|ng|ny)[a-z]/i.test(firstWord)) return true

  // ber- prefixed verbs: berjalan, berlari, bersembunyi, bertanya
  if (/^ber[a-z]/i.test(firstWord)) return true

  // di- prefixed (passive imperative): dibuka, ditutup, diambil
  if (/^di[a-z]/i.test(firstWord)) return true

  // ter- prefixed: tertangkap, terjebak
  if (/^ter[a-z]/i.test(firstWord)) return true

  return false
}

function isAbstractFeelingLabel(label: string): boolean {
  const firstWord = tokenize(label)[0] ?? ''
  return ABSTRACT_FEELING_VERBS.has(firstWord)
}

function isInternalMechanismLabel(label: string): boolean {
  for (const pattern of INTERNAL_MECHANISM_PATTERNS) {
    if (pattern.test(label)) return true
  }
  return false
}

function isActionable(label: string): boolean {
  if (isAbstractFeelingLabel(label)) return false
  if (isInternalMechanismLabel(label)) return false
  return startsWithVerb(label)
}

// ---- Effects comparison ----

/**
 * Recursively sort object keys and stringify for deterministic comparison.
 */
function sortedStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((v) => {
      try { return JSON.parse(sortedStringify(v)) }
      catch { return v }
    }))
  }
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key]
  }
  return JSON.stringify(sorted)
}

function areEffectsIdentical(a: unknown, b: unknown): boolean {
  // Normalize through schema defaults for accurate comparison
  let normalizedA: string
  let normalizedB: string
  try {
    normalizedA = sortedStringify(RouteChoiceEffectSchema.parse(a ?? {}))
  } catch {
    normalizedA = sortedStringify(a)
  }
  try {
    normalizedB = sortedStringify(RouteChoiceEffectSchema.parse(b ?? {}))
  } catch {
    normalizedB = sortedStringify(b)
  }
  return normalizedA === normalizedB
}

// ---- Distinctness ----

/** Indonesian synonym groups (verbs that are interchangeable in choice labels). */
const SYNONYM_GROUPS: string[][] = [
  ['hadapi', 'lawan', 'tantang', 'hadang'],
  ['selidiki', 'periksa', 'cari', 'telusuri', 'lacak'],
  ['buka', 'singkap'],
  ['ambil', 'rebut', 'rampas', 'jemput'],
  ['sembunyi', 'lindung', 'umpet', 'bersembunyi', 'berlindung'],
  ['kejar', 'buru', 'ikut', 'ikuti', 'membuntuti'],
  ['bantu', 'tolong', 'selamatkan'],
  ['bunuh', 'habisi', 'lenyapkan'],
  ['lari', 'kabur', 'pergi', 'tinggalkan', 'berlari'],
  ['diam', 'hening', 'tenang'],
  ['lihat', 'tatap', 'pandang', 'amati'],
  ['dengar', 'dengarkan', 'simak'],
  ['tutup', 'kunci', 'segel'],
  ['hancurkan', 'rusak', 'remukkan'],
  ['jaga', 'lindungi', 'awasi'],
  ['tembak', 'dor'],
  ['pukul', 'tampar', 'hantam'],
  ['lempar', 'lontar'],
  ['tarik', 'hela', 'seret'],
  ['dorong', 'sorong'],
]

function normalizeForComparison(value: string): string {
  let result = value.toLocaleLowerCase('id-ID').trim()

  // Strip common productive prefixes (light — only first word)
  result = result.replace(
    /^(?:me(?:m|n|ng|ny)|ber|di|ter|ke)(?=[a-z])/i,
    '',
  )

  // Strip common suffixes
  result = result.replace(/(?:kan|i|nya|lah|kah|pun|tah)$/i, '')

  return result.trim()
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  const intersection = [...setA].filter((x) => setB.has(x)).length
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

function checkDistinctness(labels: string[]): ChoiceFinding[] {
  const findings: ChoiceFinding[] = []

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i].trim()
      const b = labels[j].trim()

      // Normalize
      const normA = normalizeForComparison(a)
      const normB = normalizeForComparison(b)

      // One is substring of the other after normalization
      if (
        (normA.length > 0 && normB.length > 0)
        && (normA.includes(normB) || normB.includes(normA))
      ) {
        findings.push({
          code: 'CHOICE_OPTIONS_TOO_SIMILAR',
          message: `Choices "${a}" and "${b}" are too similar after normalization.`,
          severity: 'ERROR',
        })
        continue
      }

      // Token Jaccard similarity
      const tokensA = tokenize(normA).filter((t) => t.length > 2)
      const tokensB = tokenize(normB).filter((t) => t.length > 2)

      if (tokensA.length > 0 && tokensB.length > 0) {
        const jaccard = jaccardSimilarity(tokensA, tokensB)
        if (jaccard > 0.7) {
          findings.push({
            code: 'CHOICE_OPTIONS_TOO_SIMILAR',
            message: `Choices "${a}" and "${b}" are too similar (Jaccard ${jaccard.toFixed(2)}).`,
            severity: 'ERROR',
          })
          continue
        }
      }

      // Synonym verb detection
      const verbA = tokensA[0] ?? ''
      const verbB = tokensB[0] ?? ''

      for (const group of SYNONYM_GROUPS) {
        const aInGroup = group.includes(verbA)
        const bInGroup = group.includes(verbB)
        if (aInGroup && bInGroup) {
          // Check if the rest of the phrase is also similar
          const restA = tokensA.slice(1)
          const restB = tokensB.slice(1)
          const restJaccard = restA.length > 0 || restB.length > 0
            ? jaccardSimilarity(restA, restB)
            : 1
          if (restJaccard > 0.5) {
            findings.push({
              code: 'CHOICE_OPTIONS_TOO_SIMILAR',
              message: `Choices "${a}" and "${b}" use synonymous verbs ("${verbA}" ≈ "${verbB}") with similar context.`,
              severity: 'ERROR',
            })
            break
          }
        }
      }
    }
  }

  return findings
}

// ---- Main validation ----

function finding(code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR'): ChoiceFinding {
  return { code, message, severity }
}

/**
 * Validate a choice branch for semantic quality.
 *
 * Checks:
 * - Structural: choice count, outcome ID match, effect validity, final chapter guard
 * - Grounding: prompt and labels grounded in prose / characters / threads
 * - Generic detection: fallback labels, cookie-cutter patterns
 * - Actionability: Indonesian verb patterns, no abstract feelings or internal mechanisms
 * - Distinctness: labels must differ meaningfully (not synonyms or near-duplicates)
 * - Effects: outcomes must not have identical effects
 * - Internal leaks: no model/routing terminology in reader-facing text
 */
export function validateChoiceBranchQuality(
  input: ChoiceQualityInput,
): { ok: boolean; findings: ChoiceFinding[] } {
  const findings: ChoiceFinding[] = []
  const { branch, finalChapter, endingParagraphs, chapterNumber, totalChapters } = input

  // ---- Structural ----

  // Final chapter guard
  const effectiveTotal = totalChapters ?? 50
  if (chapterNumber !== undefined && chapterNumber >= effectiveTotal) {
    findings.push(finding(
      'CHOICE_FINAL_CHAPTER_FORBIDDEN',
      `Final chapter ${chapterNumber} must not have reader choices.`,
    ))
    return { ok: false, findings }
  }

  // Choice count
  if (!branch.choices || branch.choices.length < 2 || branch.choices.length > 3) {
    findings.push(finding(
      'CHOICE_COUNT_INVALID',
      `Branch must have 2–3 choices; found ${branch.choices?.length ?? 0}.`,
    ))
  }

  // Outcome ID match
  const choiceIds = new Set(branch.choices.map((c) => c.id))
  const outcomeIds = new Set(branch.outcomes.map((o) => o.choiceId))
  const setsMatch = choiceIds.size === outcomeIds.size
    && [...choiceIds].every((id) => outcomeIds.has(id))
  if (!setsMatch) {
    findings.push(finding(
      'CHOICE_OUTCOME_MISMATCH',
      'Outcome choice IDs must exactly match the choice IDs.',
    ))
  }

  // Effect schema validation (soft check — schema already enforces at parse time)
  for (let i = 0; i < branch.outcomes.length; i++) {
    const outcome = branch.outcomes[i]
    if (outcome.effect !== undefined) {
      const parsed = RouteChoiceEffectSchema.safeParse(outcome.effect)
      if (!parsed.success) {
        findings.push(finding(
          'CHOICE_EFFECTS_IDENTICAL', // reused code for effect issues
          `Outcome ${i} effect does not match RouteChoiceEffect schema: ${parsed.error.issues.map((iss) => iss.message).join('; ')}`,
          'WARN',
        ))
      }
    }
  }

  // ---- Prose context ----

  const { proseTokens, characterNames, threadKeywords } = buildProseContext(
    finalChapter,
    endingParagraphs,
    input.activeCharacters,
    input.activeThreads,
  )

  // ---- Grounding: prompt ----

  // Check for generic prompt patterns without concrete nouns
  if (isPromptGenericWithoutConcreteNouns(branch.choicePrompt, proseTokens)) {
    findings.push(finding(
      'CHOICE_PROMPT_UNGROUNDED',
      `Choice prompt "${branch.choicePrompt}" is a generic template without concrete references to the story.`,
    ))
  } else if (!isGrounded(branch.choicePrompt, proseTokens, characterNames, threadKeywords)) {
    findings.push(finding(
      'CHOICE_PROMPT_UNGROUNDED',
      `Choice prompt "${branch.choicePrompt}" does not reference any concrete element from the chapter prose.`,
    ))
  }

  // ---- Per-label checks ----

  for (let i = 0; i < branch.choices.length; i++) {
    const choice = branch.choices[i]
    const label = choice.label.trim()
    const suffix = ` (choice ${i + 1})`

    // Internal leak check (reader-facing text must not contain model/routing terms)
    if (INTERNAL_CHOICE_PATTERN.test(label)) {
      findings.push(finding(
        'CHOICE_INTERNAL_LEAK',
        `Choice label "${label}" contains internal language.${suffix}`,
      ))
    }

    // Generic label check
    if (isGenericLabel(label)) {
      findings.push(finding(
        'CHOICE_OPTIONS_TOO_GENERIC',
        `Choice label "${label}" is a generic fallback template.${suffix}`,
      ))
      continue // Don't check grounding/actionability for already-rejected labels
    }

    // Grounding check
    if (!isGrounded(label, proseTokens, characterNames, threadKeywords)) {
      findings.push(finding(
        'CHOICE_LABEL_UNGROUNDED',
        `Choice label "${label}" does not reference any concrete element from the chapter prose.${suffix}`,
      ))
    }

    // Actionability check
    if (!isActionable(label)) {
      if (isAbstractFeelingLabel(label)) {
        findings.push(finding(
          'CHOICE_NOT_ACTIONABLE',
          `Choice label "${label}" describes an abstract feeling, not a concrete action.${suffix}`,
        ))
      } else if (isInternalMechanismLabel(label)) {
        findings.push(finding(
          'CHOICE_NOT_ACTIONABLE',
          `Choice label "${label}" describes an internal mechanism, not a reader-facing action.${suffix}`,
        ))
      } else {
        findings.push(finding(
          'CHOICE_NOT_ACTIONABLE',
          `Choice label "${label}" does not start with a concrete action verb.${suffix}`,
        ))
      }
    }
  }

  // ---- Distinctness (pair/set) ----

  const distinctnessFindings = checkDistinctness(branch.choices.map((c) => c.label))
  findings.push(...distinctnessFindings)

  // ---- Effects identical ----

  if (branch.outcomes.length >= 2) {
    for (let i = 0; i < branch.outcomes.length; i++) {
      for (let j = i + 1; j < branch.outcomes.length; j++) {
        if (areEffectsIdentical(branch.outcomes[i].effect, branch.outcomes[j].effect)) {
          findings.push(finding(
            'CHOICE_EFFECTS_IDENTICAL',
            `Outcomes for choices "${branch.outcomes[i].choiceId}" and "${branch.outcomes[j].choiceId}" have identical effects. At minimum, route deltas should differ.`,
          ))
        }
      }
    }
  }

  // Also check for missing effects
  for (let i = 0; i < branch.outcomes.length; i++) {
    const outcome = branch.outcomes[i]
    if (outcome.effect === undefined || outcome.effect === null) {
      findings.push(finding(
        'CHOICE_EFFECTS_IDENTICAL',
        `Outcome for choice "${outcome.choiceId}" is missing an effect object.`,
        'WARN',
      ))
    }
  }

  // ---- Prompt internal leak ----

  if (INTERNAL_CHOICE_PATTERN.test(branch.choicePrompt)) {
    findings.push(finding(
      'CHOICE_INTERNAL_LEAK',
      `Choice prompt "${branch.choicePrompt}" contains internal language.`,
    ))
  }

  // ---- Consequence internal leak ----

  for (let i = 0; i < branch.outcomes.length; i++) {
    for (let j = 0; j < branch.outcomes[i].consequence.length; j++) {
      const cons = branch.outcomes[i].consequence[j]
      if (INTERNAL_CHOICE_PATTERN.test(cons)) {
        findings.push(finding(
          'CHOICE_INTERNAL_LEAK',
          `Outcome ${i} consequence ${j} contains internal language.`,
        ))
      }
    }
  }

  const hasError = findings.some((f) => f.severity === 'ERROR')

  return {
    ok: !hasError,
    findings,
  }
}

/**
 * Map semantic validation findings to a ChoiceBuildFailureReason for callers.
 */
export function mapFindingToReason(findings: ChoiceFinding[]): string {
  const codes = new Set(findings.map((f) => f.code))

  if (codes.has('CHOICE_FINAL_CHAPTER_FORBIDDEN')) return 'FINAL_CHAPTER'
  if (codes.has('CHOICE_COUNT_INVALID')) return 'SCHEMA_REJECTED'
  if (codes.has('CHOICE_OUTCOME_MISMATCH')) return 'SCHEMA_REJECTED'
  if (codes.has('CHOICE_INTERNAL_LEAK')) return 'UNSAFE'
  if (codes.has('CHOICE_PROMPT_UNGROUNDED') || codes.has('CHOICE_LABEL_UNGROUNDED')) return 'UNGROUNDED'
  if (codes.has('CHOICE_NOT_ACTIONABLE')) return 'NOT_ACTIONABLE'
  if (codes.has('CHOICE_OPTIONS_TOO_SIMILAR')) return 'NOT_DISTINCT'
  if (codes.has('CHOICE_OPTIONS_TOO_GENERIC')) return 'UNGROUNDED'
  if (codes.has('CHOICE_EFFECTS_IDENTICAL')) return 'NOT_DISTINCT'

  return 'SCHEMA_REJECTED'
}
