import { describe, expect, it, vi } from 'vitest'
import type { Json } from '@lakoku/db'
import {
  buildCatalogUnits,
  computeCatalogBlockers,
  parseCatalogContract,
  type CatalogChapterRow,
  type CatalogChapterUnit,
  type CatalogReviewRow,
  type CatalogVariantChapterRow,
} from '@/lib/catalog/admin.server'

vi.mock('server-only', () => ({}))

const ENDING_KEYS = [
  { key: 'ending_a', name: 'Warisan Terbuka' },
  { key: 'ending_b', name: 'Kebenaran Pahit' },
  { key: 'ending_secret', name: 'Perjanjian Gaib' },
]

const VALID_CONTRACT = {
  closureRunway: { endingLockChapter: 45 },
  endingCandidates: [
    {
      key: 'ending_a',
      name: 'Warisan Terbuka',
      kind: 'main',
      condition: 'Raka memimpin pemulihan tanah leluhur.',
      requiredClosure: ['Warisan leluhur diakui warga desa.'],
      blockingConditions: [],
    },
    {
      key: 'ending_b',
      name: 'Kebenaran Pahit',
      kind: 'main',
      condition: 'Raka pergi meninggalkan segalanya.',
      requiredClosure: ['Dokumen tanah diserahkan.'],
      blockingConditions: [],
    },
    {
      key: 'ending_secret',
      name: 'Perjanjian Gaib',
      kind: 'secret',
      condition: 'Raka menemukan perjanjian rahasia.',
      requiredClosure: ['Perjanjian kuno terungkap.'],
      blockingConditions: [],
    },
  ],
}

function spineRow(number: number): CatalogChapterRow {
  return {
    number,
    title: `Bab ${number}`,
    paragraphs: [
      'Langkah demi langkah membawa Raka mendekati inti teka-teki.',
      'Udara dingin menusuk, tetapi tekadnya tak goyah.',
    ],
    choices: [
      { id: `ch${number}-1`, label: 'Hadapi rintangan' },
      { id: `ch${number}-2`, label: 'Cari jalan memutar' },
    ],
  }
}

function spineRows(count = 44): CatalogChapterRow[] {
  return Array.from({ length: count }, (_, index) => spineRow(index + 1))
}

function variantRows(): CatalogVariantChapterRow[] {
  const rows: CatalogVariantChapterRow[] = []
  for (const ending of ENDING_KEYS) {
    for (let number = 45; number <= 50; number += 1) {
      rows.push({
        ...spineRow(number),
        title: `Bab ${number} [${ending.key}]`,
        ending_key: ending.key,
      })
    }
  }
  return rows
}

function approvedUnit(
  variantKey: string,
  chapterNumber: number,
): CatalogChapterUnit {
  return {
    chapterNumber,
    variantKey,
    variantName: null,
    title: `Bab ${chapterNumber}`,
    paragraphs: ['Satu.'],
    choices: [],
    paragraphCount: 1,
    wordCount: 1,
    choiceCount: 0,
    status: 'approved',
    note: null,
    reviewedAt: null,
  }
}

describe('buildCatalogUnits', () => {
  it('derives 44 spine units followed by 6 units per ending, sorted by chapter', () => {
    const units = buildCatalogUnits({
      spineChapters: spineRows(),
      variantChapters: variantRows(),
      endingKeys: ENDING_KEYS,
      reviews: [],
    })

    expect(units).toHaveLength(62)
    expect(units[0]).toMatchObject({ variantKey: 'spine', chapterNumber: 1 })
    expect(units[43]).toMatchObject({ variantKey: 'spine', chapterNumber: 44 })
    expect(units[44]).toMatchObject({
      variantKey: 'ending_a',
      variantName: 'Warisan Terbuka',
      chapterNumber: 45,
    })
    expect(units[49]).toMatchObject({ variantKey: 'ending_a', chapterNumber: 50 })
    expect(units[50]).toMatchObject({ variantKey: 'ending_b', chapterNumber: 45 })
    expect(units[56]).toMatchObject({ variantKey: 'ending_secret', chapterNumber: 45 })
    expect(units[61]).toMatchObject({ variantKey: 'ending_secret', chapterNumber: 50 })
  })

  it('measures paragraphs, words, and choices from the stored JSON', () => {
    const [unit] = buildCatalogUnits({
      spineChapters: [
        {
          number: 1,
          title: 'Bab 1',
          paragraphs: ['Satu dua tiga.', 'Empat lima.'],
          choices: [
            { id: 'a', label: 'Pilihan A' },
            { id: 'b', label: 'Pilihan B' },
          ],
        },
      ],
      variantChapters: [],
      endingKeys: [],
      reviews: [],
    })

    expect(unit.paragraphCount).toBe(2)
    expect(unit.wordCount).toBe(5)
    expect(unit.choiceCount).toBe(2)
    expect(unit.choices).toEqual([
      { id: 'a', label: 'Pilihan A' },
      { id: 'b', label: 'Pilihan B' },
    ])
  })

  it('ignores malformed choices instead of counting them as selectable options', () => {
    const [unit] = buildCatalogUnits({
      spineChapters: [
        {
          number: 1,
          title: 'Bab 1',
          paragraphs: ['Satu.'],
          choices: [
            { id: 'a', label: 'Pilihan A' },
            { label: 'Tanpa id' },
            'bukan objek',
          ] as Json,
        },
      ],
      variantChapters: [],
      endingKeys: [],
      reviews: [],
    })

    expect(unit.choiceCount).toBe(1)
    expect(unit.choices).toEqual([{ id: 'a', label: 'Pilihan A' }])
  })

  it('maps reviews to their exact variant key, not to the same chapter of another ending', () => {
    const reviewedAt = new Date('2026-10-28T08:30:00.000Z')
    const reviews: CatalogReviewRow[] = [
      {
        chapter_number: 45,
        variant_key: 'ending_secret',
        status: 'approved',
        note: 'sudah dicek',
        updated_at: reviewedAt,
      },
    ]

    const units = buildCatalogUnits({
      spineChapters: spineRows(),
      variantChapters: variantRows(),
      endingKeys: ENDING_KEYS,
      reviews,
    })

    const secret45 = units.find(
      (unit) => unit.variantKey === 'ending_secret' && unit.chapterNumber === 45,
    )
    const main45 = units.find(
      (unit) => unit.variantKey === 'ending_a' && unit.chapterNumber === 45,
    )

    expect(secret45).toMatchObject({
      status: 'approved',
      note: 'sudah dicek',
      reviewedAt: reviewedAt.toISOString(),
    })
    expect(main45?.status).toBe('pending')
  })

  it('treats unknown stored review status as pending', () => {
    const units = buildCatalogUnits({
      spineChapters: [spineRow(1)],
      variantChapters: [],
      endingKeys: [],
      reviews: [
        {
          chapter_number: 1,
          variant_key: 'spine',
          status: 'selesai',
          note: null,
          updated_at: new Date('2026-10-28T00:00:00.000Z'),
        },
      ],
    })

    expect(units[0].status).toBe('pending')
  })
})

describe('computeCatalogBlockers', () => {
  const completeUnits = buildCatalogUnits({
    spineChapters: spineRows(),
    variantChapters: variantRows(),
    endingKeys: ENDING_KEYS,
    reviews: [],
  })

  it('returns no blocker when every unit is approved and the novel is complete', () => {
    const approved = completeUnits.map((unit) =>
      approvedUnit(unit.variantKey, unit.chapterNumber),
    )
    const blockers = computeCatalogBlockers({
      spineChapters: spineRows(),
      variantChapters: variantRows(),
      endingKeys: ENDING_KEYS,
      contractError: null,
      units: approved,
    })
    expect(blockers).toEqual([])
  })

  it('blocks publishing while any unit is still pending', () => {
    const blockers = computeCatalogBlockers({
      spineChapters: spineRows(),
      variantChapters: variantRows(),
      endingKeys: ENDING_KEYS,
      contractError: null,
      units: completeUnits,
    })
    expect(blockers).toEqual(['UNITS_NOT_APPROVED'])
  })

  it('reports a missing spine chapter', () => {
    const approved = completeUnits.map((unit) =>
      approvedUnit(unit.variantKey, unit.chapterNumber),
    )
    const blockers = computeCatalogBlockers({
      spineChapters: spineRows().filter((row) => row.number !== 44),
      variantChapters: variantRows(),
      endingKeys: ENDING_KEYS,
      contractError: null,
      units: approved,
    })
    expect(blockers).toContain('SPINE_INCOMPLETE')
  })

  it('reports incomplete ending variants', () => {
    const approved = completeUnits.map((unit) =>
      approvedUnit(unit.variantKey, unit.chapterNumber),
    )
    const blockers = computeCatalogBlockers({
      spineChapters: spineRows(),
      variantChapters: variantRows().filter(
        (row) => !(row.ending_key === 'ending_b' && row.number === 50),
      ),
      endingKeys: ENDING_KEYS,
      contractError: null,
      units: approved,
    })
    expect(blockers).toContain('ENDING_VARIANTS_INCOMPLETE')
  })

  it('reports missing chapters and missing variants when nothing was written', () => {
    const blockers = computeCatalogBlockers({
      spineChapters: [],
      variantChapters: [],
      endingKeys: [],
      contractError: 'CONTRACT_MISSING',
      units: [],
    })
    expect(blockers).toEqual([
      'CONTRACT_MISSING',
      'SPINE_INCOMPLETE',
      'ENDING_VARIANTS_INCOMPLETE',
      'CHAPTERS_MISSING',
    ])
  })
})

describe('parseCatalogContract', () => {
  it('reports CONTRACT_MISSING when contract_json is null', () => {
    expect(parseCatalogContract(null)).toEqual({ endingKeys: [], error: 'CONTRACT_MISSING' })
  })

  it('reports CONTRACT_INVALID for a non-contract object', () => {
    expect(parseCatalogContract({ foo: 'bar' })).toEqual({
      endingKeys: [],
      error: 'CONTRACT_INVALID',
    })
  })

  it('returns ending keys in contract order for a valid contract', () => {
    const parsed = parseCatalogContract(VALID_CONTRACT as unknown as Json)
    expect(parsed.error).toBeNull()
    expect(parsed.endingKeys).toEqual(ENDING_KEYS)
  })

  it('parses a contract stored as a JSON string', () => {
    const parsed = parseCatalogContract(JSON.stringify(VALID_CONTRACT) as unknown as Json)
    expect(parsed.error).toBeNull()
    expect(parsed.endingKeys.map((ending) => ending.key)).toEqual([
      'ending_a',
      'ending_b',
      'ending_secret',
    ])
  })
})
