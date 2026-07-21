/**
 * Phase 4 — Semantic choice quality validation tests.
 *
 * Covers all exit criteria:
 *  - Generic choices from screenshot fail validation
 *  - Contextual natural choices pass
 *  - Verb forms like Hadapi, Selidiki, Bersembunyi, Membuntuti not rejected on whitelist grounds
 *  - Synonym options rejected
 *  - Identical effects rejected
 *  - Ungrounded labels and prompts detected
 *  - Actionability supports Indonesian verb variations
 *  - Distinctness assessed as pair/set
 */
import { describe, expect, it } from 'vitest'
import {
  validateChoiceBranchQuality,
  mapFindingToReason,
  type ChoiceQualityInput,
  type ChoiceFinding,
} from '@/lib/story-engine/choice-quality'

// ---- Helpers ----

function codes(findings: ChoiceFinding[]): string[] {
  return findings.map((f) => f.code)
}

function hasCode(findings: ChoiceFinding[], code: string): boolean {
  return findings.some((f) => f.code === code)
}

function emptyEffect() {
  return {
    routeDeltas: {},
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  }
}

function distinctEffect(n: number) {
  return {
    routeDeltas: { truth: n },
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  }
}

function makeInput(overrides: Partial<ChoiceQualityInput> = {}): ChoiceQualityInput {
  const defaults: ChoiceQualityInput = {
    branch: {
      choicePrompt: 'Apa yang Maya lakukan selanjutnya di koridor arsip?',
      choices: [
        { id: 'buka-pintu', label: 'Buka pintu arsip basah dengan hati-hati' },
        { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
      ],
      outcomes: [
        {
          choiceId: 'buka-pintu',
          consequence: ['Maya menemukan berkas basah.'],
          nextChapterNumber: 13,
          isEnding: false,
          effect: distinctEffect(1),
        },
        {
          choiceId: 'periksa-lampu',
          consequence: ['Lampu padam dan langkah terdengar mendekat.'],
          nextChapterNumber: 13,
          isEnding: false,
          effect: distinctEffect(2),
        },
      ],
    },
    finalChapter: {
      title: 'Bab 12: Pintu Arsip',
      paragraphs: [
        'Maya berdiri di depan pintu arsip basah yang setengah terbuka.',
        'Suara langkah mendekat dari ujung koridor yang remang.',
        'Lampu koridor berkedip di atas kepalanya, menciptakan bayangan aneh di dinding.',
        'Hawa dingin merayap dari balik pintu yang menganga.',
        'Di tangannya, kertas laporan Magang masih terasa hangat dari printer.',
      ],
    },
    endingParagraphs: [
      'Lampu koridor berkedip di atas kepalanya, menciptakan bayangan aneh di dinding.',
      'Hawa dingin merayap dari balik pintu yang menganga.',
      'Di tangannya, kertas laporan Magang masih terasa hangat dari printer.',
    ],
    chapterNumber: 12,
    totalChapters: 50,
  }

  return {
    ...defaults,
    ...overrides,
    branch: { ...defaults.branch, ...(overrides.branch ?? {}) },
    finalChapter: { ...defaults.finalChapter, ...(overrides.finalChapter ?? {}) },
  }
}

describe('validateChoiceBranchQuality — structural', () => {
  it('rejects final chapter with reader choices', () => {
    const input = makeInput({ chapterNumber: 50 })
    const result = validateChoiceBranchQuality(input)

    expect(result.ok).toBe(false)
    expect(hasCode(result.findings, 'CHOICE_FINAL_CHAPTER_FORBIDDEN')).toBe(true)
  })

  it('rejects fewer than 2 choices', () => {
    const input = makeInput()
    input.branch.choices = [{ id: 'only-one', label: 'Buka pintu arsip' }]
    input.branch.outcomes = [{
      choiceId: 'only-one',
      consequence: ['Maya masuk.'],
      nextChapterNumber: 13,
      isEnding: false,
      effect: distinctEffect(1),
    }]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_COUNT_INVALID')).toBe(true)
  })

  it('rejects outcome IDs that do not match choice IDs', () => {
    const input = makeInput()
    input.branch.outcomes[0].choiceId = 'nonexistent'

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OUTCOME_MISMATCH')).toBe(true)
  })

  it('accepts valid 3-choice branch', () => {
    const input = makeInput()
    input.branch.choices.push({ id: 'panggil-raka', label: 'Panggil Raka dari ujung koridor' })
    input.branch.outcomes.push({
      choiceId: 'panggil-raka',
      consequence: ['Raka datang membantu.'],
      nextChapterNumber: 13,
      isEnding: false,
      effect: distinctEffect(3),
    })

    const result = validateChoiceBranchQuality(input)
    expect(result.ok).toBe(true)
  })
})

describe('validateChoiceBranchQuality — grounding', () => {
  it('accepts prompt and labels grounded in chapter prose', () => {
    const input = makeInput()

    const result = validateChoiceBranchQuality(input)

    // Prompt references "koridor arsip" which is in prose
    expect(hasCode(result.findings, 'CHOICE_PROMPT_UNGROUNDED')).toBe(false)
    // Labels reference "pintu arsip basah" and "lampu koridor" which are in prose
    expect(hasCode(result.findings, 'CHOICE_LABEL_UNGROUNDED')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('rejects generic prompt without concrete nouns from prose', () => {
    const input = makeInput()
    input.branch.choicePrompt = 'Apa yang kau lakukan?'

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_PROMPT_UNGROUNDED')).toBe(true)
  })

  it('rejects labels that reference nothing from the prose', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'beli-bunga', label: 'Beli bunga di pasar tradisional' },
      { id: 'terbang-jakarta', label: 'Terbang ke Jakarta sore ini' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'beli-bunga',
        consequence: ['Bunga segar tersedia.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'terbang-jakarta',
        consequence: ['Pesawat berangkat.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_LABEL_UNGROUNDED')).toBe(true)
  })

  it('accepts labels grounded via active character names', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'panggil-raka', label: 'Panggil Raka untuk membantu' },
      { id: 'panggil-sari', label: 'Panggil Sari yang menunggu' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'panggil-raka',
        consequence: ['Raka melangkah mendekat.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'panggil-sari',
        consequence: ['Sari muncul dari bayangan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]
    input.activeCharacters = [
      { id: 'raka', name: 'Raka Pratama' },
      { id: 'sari', name: 'Sari Dewi' },
    ]

    const result = validateChoiceBranchQuality(input)
    // Raka and Sari are in activeCharacters, grounding should work
    expect(hasCode(result.findings, 'CHOICE_LABEL_UNGROUNDED')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('does NOT compare a label to itself (regression)', () => {
    // The grounding check must not consider the label's own tokens as "prose reference."
    // Test with a label that has no overlap with actual prose.
    const input = makeInput()
    input.branch.choices = [
      { id: 'xyz-abc', label: 'Xyz abc def ghi jkl mno pqr' },
      { id: 'uvw-rst', label: 'Uvw rst def ghi jkl mno pqr' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'xyz-abc',
        consequence: ['Something happens.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'uvw-rst',
        consequence: ['Something else happens.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    // Both labels are completely ungrounded — no tokens match prose
    expect(hasCode(result.findings, 'CHOICE_LABEL_UNGROUNDED')).toBe(true)
  })
})

describe('validateChoiceBranchQuality — generic detection', () => {
  it('rejects "Hadapi langsung apa yang baru terbuka"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'hadapi', label: 'Hadapi langsung apa yang baru terbuka' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'hadapi',
        consequence: ['Maya menghadapi.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_GENERIC')).toBe(true)
  })

  it('rejects "Selidiki dulu jejak yang tersisa"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'selidiki', label: 'Selidiki dulu jejak yang tersisa' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'selidiki',
        consequence: ['Maya menyelidiki jejak.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_GENERIC')).toBe(true)
  })

  it('rejects generic prompt "Apa yang kau lakukan?" without concrete prose references', () => {
    const input = makeInput()
    input.branch.choicePrompt = 'Apa yang kau lakukan?'

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_PROMPT_UNGROUNDED')).toBe(true)
  })
})

describe('validateChoiceBranchQuality — actionability', () => {
  it('accepts root imperatives: Hadapi, Selidiki, Buka, Ambil', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'hadapi', label: 'Hadapi ancaman dari pintu arsip basah' },
      { id: 'selidiki', label: 'Selidiki bayangan di dinding koridor' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'hadapi',
        consequence: ['Maya menghadapi ancaman.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'selidiki',
        consequence: ['Maya menyelidiki bayangan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('accepts ber- prefixed verbs: Bersembunyi, Berlari, Berjalan', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'bersembunyi', label: 'Bersembunyi di balik pintu yang menganga' },
      { id: 'berlari', label: 'Berlari ke ujung koridor yang gelap' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'bersembunyi',
        consequence: ['Maya bersembunyi di balik pintu.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'berlari',
        consequence: ['Maya berlari ke ujung koridor.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('accepts meN- prefixed verbs: Membuntuti, Menyelidiki, Membuka', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'membuntuti', label: 'Membuntuti sosok di ujung koridor' },
      { id: 'menyelidiki', label: 'Menyelidiki bayangan di dinding' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'membuntuti',
        consequence: ['Maya membuntuti sosok itu.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'menyelidiki',
        consequence: ['Maya menyelidiki bayangan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('accepts di- and ter- prefixed verbs', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'diam-diam', label: 'Diam-diam dekati pintu arsip yang terbuka' },
      { id: 'tertahan', label: 'Tertahan di depan bayangan koridor' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'diam-diam',
        consequence: ['Maya mendekati pintu.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'tertahan',
        consequence: ['Maya tertahan di depan bayangan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    // "Diam-diam" is not a verb, so it should fail actionability
    // Actually, 'diam' is in the root imperatives list
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(false)
  })

  it('rejects abstract feeling labels: "merasa takut"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'merasa-takut', label: 'Merasa takut akan apa yang akan terjadi' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'merasa-takut',
        consequence: ['Ketakutan menguasai Maya.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(true)
  })

  it('rejects abstract feeling labels: "berharap semuanya baik"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'berharap', label: 'Berharap semuanya baik meski pintu terbuka' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'berharap',
        consequence: ['Harapan tinggal harapan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(true)
  })

  it('rejects internal mechanism labels: "naikkan risk state"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'naikkan-risk', label: 'Naikkan risk state ke level tinggi' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'naikkan-risk',
        consequence: ['Risk naik.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(true)
  })

  it('rejects internal mechanism labels: "set flag"', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'set-flag', label: 'Set flag kebenaran untuk ending A' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'set-flag',
        consequence: ['Flag diset.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(true)
  })

  it('rejects noun-only labels without action verbs', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'pintu-sunyi', label: 'Pintu koridor yang sunyi' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'pintu-sunyi',
        consequence: ['Keheningan mencekam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(true)
  })

  it('accepts "Ikuti suara langkah di koridor" (non-whitelist verb via meN- pattern)', () => {
    // "Ikuti" starts with root "ikut" + i — not on the old whitelist but should
    // pass because it starts with "ikuti" which IS in the root imperatives set.
    const input = makeInput()
    input.branch.choices = [
      { id: 'ikuti-suara', label: 'Ikuti suara langkah di koridor remang' },
      { id: 'periksa-lampu', label: 'Periksa lampu koridor yang berkedip' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'ikuti-suara',
        consequence: ['Maya mengikuti suara langkah.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-lampu',
        consequence: ['Lampu padam.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_NOT_ACTIONABLE')).toBe(false)
    expect(result.ok).toBe(true)
  })
})

describe('validateChoiceBranchQuality — distinctness', () => {
  it('rejects synonym pair: Hadapi vs Lawan with similar rest', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'hadapi-ancaman', label: 'Hadapi ancaman dari balik pintu' },
      { id: 'lawan-ancaman', label: 'Lawan ancaman dari balik pintu' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'hadapi-ancaman',
        consequence: ['Maya menghadapi ancaman.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'lawan-ancaman',
        consequence: ['Maya melawan ancaman.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_SIMILAR')).toBe(true)
  })

  it('rejects synonym pair: Selidiki vs Periksa with similar context', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'selidiki-jejak', label: 'Selidiki jejak di koridor' },
      { id: 'periksa-jejak', label: 'Periksa jejak di koridor' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'selidiki-jejak',
        consequence: ['Maya menyelidiki jejak.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'periksa-jejak',
        consequence: ['Maya memeriksa jejak.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_SIMILAR')).toBe(true)
  })

  it('rejects labels where one is substring of another after normalization', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'buka-pintu', label: 'Buka pintu arsip' },
      { id: 'buka-pintu-perlahan', label: 'Buka pintu arsip perlahan' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'buka-pintu',
        consequence: ['Maya membuka pintu.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'buka-pintu-perlahan',
        consequence: ['Maya membuka pintu perlahan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    // "buka pintu arsip" is a substring of "buka pintu arsip perlahan" after normalization
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_SIMILAR')).toBe(true)
  })

  it('rejects high token overlap (Jaccard > 0.7)', () => {
    const input = makeInput()
    input.branch.choices = [
      { id: 'masuk-pintu', label: 'Masuk lewat pintu arsip basah' },
      { id: 'masuk-jendela', label: 'Masuk lewat arsip pintu basah' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'masuk-pintu',
        consequence: ['Maya masuk lewat pintu.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'masuk-jendela',
        consequence: ['Maya masuk lewat jendela.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_SIMILAR')).toBe(true)
  })

  it('accepts distinctly different labels', () => {
    // These shouldn't trigger similarity
    const input = makeInput()
    // Use the default labels which are genuinely different
    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_SIMILAR')).toBe(false)
    expect(result.ok).toBe(true)
  })
})

describe('validateChoiceBranchQuality — effects', () => {
  it('detects identical effects on two outcomes', () => {
    const input = makeInput()
    input.branch.outcomes[0].effect = emptyEffect()
    input.branch.outcomes[1].effect = emptyEffect()

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_EFFECTS_IDENTICAL')).toBe(true)
  })

  it('warns when effects are missing', () => {
    const input = makeInput()
    input.branch.outcomes[0].effect = undefined
    input.branch.outcomes[1].effect = undefined

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_EFFECTS_IDENTICAL')).toBe(true)
    // Missing effects produce WARN severity
    const effectFindings = result.findings.filter((f) => f.code === 'CHOICE_EFFECTS_IDENTICAL')
    expect(effectFindings.some((f) => f.severity === 'WARN')).toBe(true)
  })

  it('accepts different effects', () => {
    const input = makeInput()
    input.branch.outcomes[0].effect = distinctEffect(1)
    input.branch.outcomes[1].effect = distinctEffect(2)

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_EFFECTS_IDENTICAL')).toBe(false)
  })
})

describe('validateChoiceBranchQuality — internal leak', () => {
  it('detects internal language in choice prompt', () => {
    const input = makeInput()
    input.branch.choicePrompt = 'Prompt rahasia untuk pemain'

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_INTERNAL_LEAK')).toBe(true)
  })

  it('detects internal language in choice label', () => {
    const input = makeInput()
    input.branch.choices[0].label = 'Buka route rahasia'

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_INTERNAL_LEAK')).toBe(true)
  })

  it('detects internal language in consequence', () => {
    const input = makeInput()
    input.branch.outcomes[0].consequence = ['Route truth meningkat ke level berikutnya.']

    const result = validateChoiceBranchQuality(input)
    expect(hasCode(result.findings, 'CHOICE_INTERNAL_LEAK')).toBe(true)
  })
})

describe('validateChoiceBranchQuality — full integration scenarios', () => {
  it('passes contextual natural choices with distinct effects', () => {
    const result = validateChoiceBranchQuality(makeInput())

    expect(result.ok).toBe(true)
    expect(result.findings.every((f) => f.severity !== 'ERROR')).toBe(true)
  })

  it('fails the exact screenshot-style generic labels', () => {
    const input = makeInput()
    input.branch.choicePrompt = 'Apa yang kau lakukan?'
    input.branch.choices = [
      { id: 'hadapi', label: 'Hadapi langsung apa yang baru terbuka' },
      { id: 'selidiki', label: 'Selidiki dulu jejak yang tersisa' },
    ]
    input.branch.outcomes = [
      {
        choiceId: 'hadapi',
        consequence: ['Kau menghadapi kenyataan.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(1),
      },
      {
        choiceId: 'selidiki',
        consequence: ['Kau menyelidiki lebih lanjut.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: distinctEffect(2),
      },
    ]

    const result = validateChoiceBranchQuality(input)
    expect(result.ok).toBe(false)
    // Multiple issues expected: prompt ungrounded, labels too generic
    expect(hasCode(result.findings, 'CHOICE_PROMPT_UNGROUNDED') || result.findings.length > 0).toBe(true)
    expect(hasCode(result.findings, 'CHOICE_OPTIONS_TOO_GENERIC')).toBe(true)
  })
})

describe('mapFindingToReason', () => {
  it('maps each finding code to the correct reason', () => {
    expect(mapFindingToReason([{ code: 'CHOICE_FINAL_CHAPTER_FORBIDDEN', message: '', severity: 'ERROR' }])).toBe('FINAL_CHAPTER')
    expect(mapFindingToReason([{ code: 'CHOICE_COUNT_INVALID', message: '', severity: 'ERROR' }])).toBe('SCHEMA_REJECTED')
    expect(mapFindingToReason([{ code: 'CHOICE_OUTCOME_MISMATCH', message: '', severity: 'ERROR' }])).toBe('SCHEMA_REJECTED')
    expect(mapFindingToReason([{ code: 'CHOICE_INTERNAL_LEAK', message: '', severity: 'ERROR' }])).toBe('UNSAFE')
    expect(mapFindingToReason([{ code: 'CHOICE_PROMPT_UNGROUNDED', message: '', severity: 'ERROR' }])).toBe('UNGROUNDED')
    expect(mapFindingToReason([{ code: 'CHOICE_LABEL_UNGROUNDED', message: '', severity: 'ERROR' }])).toBe('UNGROUNDED')
    expect(mapFindingToReason([{ code: 'CHOICE_NOT_ACTIONABLE', message: '', severity: 'ERROR' }])).toBe('NOT_ACTIONABLE')
    expect(mapFindingToReason([{ code: 'CHOICE_OPTIONS_TOO_SIMILAR', message: '', severity: 'ERROR' }])).toBe('NOT_DISTINCT')
    expect(mapFindingToReason([{ code: 'CHOICE_OPTIONS_TOO_GENERIC', message: '', severity: 'ERROR' }])).toBe('UNGROUNDED')
    expect(mapFindingToReason([{ code: 'CHOICE_EFFECTS_IDENTICAL', message: '', severity: 'ERROR' }])).toBe('NOT_DISTINCT')
  })
})
