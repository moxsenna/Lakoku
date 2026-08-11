/**
 * M10-D1 authored-bank quality gate.
 *
 * Pure static inspection of hand-authored corpus prose. No provider, network,
 * DB, gateway, or runtime access. Runs incrementally: it inspects whatever bank
 * files currently exist under the banks directory, so a bank can be verified and
 * committed before the next one is written.
 *
 * Reviewer inspection of the prose remains the final authority. This gate only
 * catches mechanical failures: wrong counts, wrong chapter surface, placeholder
 * length, template reuse, label leakage, and cross-universe contamination.
 */

import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  D1_RUBRIC_CHAPTERS,
  D1_TIERS,
  D1_TIER_COUNTS,
  type D1AuthoredBank,
  type D1RubricId,
  type D1UniverseId,
} from '../../fixtures/long-horizon/semantic-calibration/corpus'
import { D1_AUTHORED_BANKS } from '../../fixtures/long-horizon/semantic-calibration/contexts'

const BANK_DIR = 'fixtures/long-horizon/semantic-calibration/banks'

/** Label, tier, partition, and evaluator-conclusion vocabulary banned in prose. */
const FORBIDDEN_PROSE: readonly RegExp[] = [
  /\bstrong\b/i,
  /\bweak\b/i,
  /\bborderline\b/i,
  /\bcalibration\b/i,
  /\bhold-?out\b/i,
  /\bvalidation\b/i,
  /\brubrik\b/i,
  /\brubric\b/i,
  /\bD-R[1-8]\b/i,
  /\btier\b/i,
  /\bskor\b/i,
  /\bambang\b/i,
  /\bpacing\b/i,
  /\bpayoff\b/i,
  /\bbab ini\b/i,
  /\badegan ini\b/i,
  /\bdi sini (laju|sikap|ketegangan|emosi|cerita)/i,
  /tidak mengubah apa pun/i,
  /mengulang adegan/i,
]

/** Cast and place names that must never cross between universes. */
const UNIVERSE_NAMES: Readonly<Record<D1UniverseId, readonly string[]>> = {
  'pesisir-utara': ['Sari', 'Damar', 'Hasnah', 'Latif', 'Uweng', 'Ratih', 'Tanjung Rembang'],
  'lembah-awan': ['Vina', 'Bagas', 'Ripto', 'Danu', 'Ningsih', 'Karsa', 'Lembah Awan'],
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function fiveGrams(text: string): string[] {
  const tokens = words(text)
  const grams: string[] = []
  for (let index = 0; index + 5 <= tokens.length; index += 1) {
    grams.push(tokens.slice(index, index + 5).join(' '))
  }
  return grams
}

function listBankFiles(): string[] {
  return readdirSync(BANK_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => join(BANK_DIR, name))
}

const bankFiles = listBankFiles()

/**
 * Banks are bound from the frozen registry, not dynamically imported, so this
 * gate inspects exactly the prose the corpus actually assembles. Disk
 * enumeration is kept as the stricter guard: a bank file present on disk but
 * absent from the registry fails instead of silently escaping inspection.
 */
const registered: { file: string, bank: D1AuthoredBank }[] = Object.values(D1_AUTHORED_BANKS)
  .flatMap((byRubric) => Object.values(byRubric))
  .map((bank) => ({ file: join(BANK_DIR, `${bank.universeId}-${bank.rubricId.toLowerCase()}.ts`), bank }))
  .sort((left, right) => left.file.localeCompare(right.file))

const loaded = registered

describe('M10-D1 authored bank quality gate', () => {
  it('inspects every bank file present on disk', () => {
    expect(loaded.map((entry) => basename(entry.file))).toEqual(bankFiles.map((file) => basename(file)))
  })

  for (const { file, bank } of loaded) {
    const label = basename(file)

    describe(label, () => {
      it('file name matches declared universe and rubric', () => {
        expect(label).toBe(`${bank.universeId}-${bank.rubricId.toLowerCase()}.ts`)
      })

      it('has exact tier counts', () => {
        for (const tier of D1_TIERS) {
          expect(bank[tier].length, `${tier} count`).toBe(D1_TIER_COUNTS[tier])
        }
      })

      it('authors the exact rubric chapter surface in order', () => {
        const required = D1_RUBRIC_CHAPTERS[bank.rubricId as D1RubricId]
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            const authored = fixture.chapters.map((chapter) => chapter.chapterNumber)
            expect(authored, `${tier}[${index}] chapters`).toEqual([...required])
          })
        }
      })

      it('has one paragraph per chapter within 40..90 words', () => {
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            for (const chapter of fixture.chapters) {
              const where = `${tier}[${index}] bab ${chapter.chapterNumber}`
              expect(chapter.paragraphs.length, `${where} paragraph count`).toBe(1)
              const count = words(chapter.paragraphs[0]).length
              expect(count, `${where} word count`).toBeGreaterThanOrEqual(40)
              expect(count, `${where} word count`).toBeLessThanOrEqual(90)
              expect(chapter.paragraphs[0], `${where} line break`).not.toMatch(/\n/)
            }
          })
        }
      })

      it('has unique 2..5 word chapter titles', () => {
        const seen = new Set<string>()
        for (const tier of D1_TIERS) {
          for (const fixture of bank[tier]) {
            for (const chapter of fixture.chapters) {
              expect(seen.has(chapter.title), `duplicate title "${chapter.title}"`).toBe(false)
              seen.add(chapter.title)
              const size = chapter.title.trim().split(/\s+/).length
              expect(size, `title "${chapter.title}" word count`).toBeGreaterThanOrEqual(2)
              expect(size, `title "${chapter.title}" word count`).toBeLessThanOrEqual(5)
            }
          }
        }
      })

      it('carries a written reviewer justification per fixture', () => {
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            expect(fixture.justification.trim().length, `${tier}[${index}] justification`).toBeGreaterThanOrEqual(40)
          })
        }
      })

      it('keeps label, tier, and evaluator vocabulary out of prose', () => {
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            for (const chapter of fixture.chapters) {
              for (const pattern of FORBIDDEN_PROSE) {
                expect(
                  pattern.test(`${chapter.title} ${chapter.paragraphs.join(' ')}`),
                  `${tier}[${index}] bab ${chapter.chapterNumber} matched ${pattern}`,
                ).toBe(false)
              }
            }
          })
        }
      })

      it('keeps injected placeholder tokens out of paragraph prose', () => {
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            for (const chapter of fixture.chapters) {
              for (const paragraph of chapter.paragraphs) {
                expect(
                  paragraph,
                  `${tier}[${index}] bab ${chapter.chapterNumber} paragraph`,
                ).not.toMatch(/\bcorak[a-z]+\d+\b/i)
              }
            }
          })
        }
      })

      it('keeps chapter-number metadata out of paragraph prose', () => {
        for (const tier of D1_TIERS) {
          bank[tier].forEach((fixture, index) => {
            for (const chapter of fixture.chapters) {
              for (const paragraph of chapter.paragraphs) {
                expect(
                  paragraph,
                  `${tier}[${index}] bab ${chapter.chapterNumber} paragraph`,
                ).not.toMatch(/\bBab\s+\d+\b/i)
              }
            }
          })
        }
      })

      it('never borrows the other universe cast or place', () => {
        for (const [universeId, names] of Object.entries(UNIVERSE_NAMES)) {
          if (universeId === bank.universeId) continue
          for (const tier of D1_TIERS) {
            bank[tier].forEach((fixture, index) => {
              for (const chapter of fixture.chapters) {
                for (const name of names) {
                  expect(
                    new RegExp(`\\b${name}\\b`).test(chapter.paragraphs.join(' ')),
                    `${tier}[${index}] bab ${chapter.chapterNumber} used foreign name "${name}"`,
                  ).toBe(false)
                }
              }
            })
          }
        }
      })
    })
  }

  it('has zero five-gram overlap across every authored paragraph on disk', () => {
    const owner = new Map<string, string>()
    const collisions: string[] = []
    for (const { file, bank } of loaded) {
      for (const tier of D1_TIERS) {
        bank[tier].forEach((fixture, index) => {
          for (const chapter of fixture.chapters) {
            const where = `${basename(file)} ${tier}[${index}] bab ${chapter.chapterNumber}`
            for (const gram of fiveGrams(chapter.paragraphs.join(' '))) {
              const previous = owner.get(gram)
              if (previous === undefined) owner.set(gram, where)
              else collisions.push(`"${gram}" :: ${where} and ${previous}`)
            }
          }
        })
      }
    }
    expect(collisions.slice(0, 20)).toEqual([])
  })
})
