import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CanonSnapshot, ContinuationContext } from '@lakoku/narrative-core'
import { buildProductionChapterWriterPrompt } from '@/lib/ai-gateway/chapter-writer-contract'
import {
  PreProseChapterBriefSchema,
  type PreProseChapterBrief,
} from '@/lib/story-engine/pre-prose-brief'
import { mobileDramaSystemPrompt } from '@/lib/prose/mobile-drama-style'

function mockSnapshot(overrides: Partial<CanonSnapshot> = {}): CanonSnapshot {
  return {
    storyId: 'story-test-1',
    characters: [
      {
        id: 'char:sinta',
        storyId: 'story-test-1',
        canonicalName: 'Sinta',
        role: 'protagonis',
        motivation: 'Membongkar asal buku besar.',
        introducedChapter: 1,
        status: 'ALIVE',
      },
      {
        id: 'char:arga',
        storyId: 'story-test-1',
        canonicalName: 'Arga',
        role: 'sekutu',
        motivation: 'Melindungi Sinta.',
        introducedChapter: 1,
        status: 'ALIVE',
      },
    ],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [
      {
        id: 'secret:ledger_author',
        description: 'Surya menulis catatan pengiriman',
        revealGateChapter: 12,
        revealed: false,
      },
      {
        id: 'secret:future_secret',
        description: 'Gudang ketiga adalah fiktif',
        revealGateChapter: 30,
        revealed: false,
      },
    ],
    timeline: [],
    threads: [
      {
        id: 'thread:buku_besar',
        title: 'Buku Besar',
        status: 'OPEN',
        openedChapter: 1,
        lastTouchedChapter: 10,
        payoffWindow: 15,
        isMainMystery: true,
        stale: false,
      },
    ],
    actRollups: [],
    blueprints: [],
    ...overrides,
  }
}

function mockBrief(overrides: Partial<PreProseChapterBrief> = {}): PreProseChapterBrief {
  return {
    storyId: 'story-test-1',
    chapterNumber: 12,
    phase: 'Retak',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Sinta membuka loker stasiun.',
    mustInclude: ['Sinta membuka loker stasiun.'],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: ['secret:future_secret'],
    resolvedPlotDebtIds: [],
    scheduledReveals: [
      {
        authorityId: 'secret:ledger_author',
        kind: 'SCHEDULED_REVEAL',
        writerDirective: 'Perlihatkan kartu pos bertanda tangan Surya di balik lipatan kuitansi.',
      },
    ],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: '',
    previousChoiceSummary: '',
    previousChoiceApplied: false,
    ...overrides,
  }
}

function mockPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chapterNumber: 12,
    phase: 'Retak',
    chapterGoal: 'Sinta membuka loker stasiun.',
    plannedBeats: ['Sinta memasukkan kunci ke loker nomor tujuh.'],
    targetSceneCount: 3,
    ...overrides,
  }
}

describe('WRITER_PROMPT_ARCHITECTURE_V2_IMPLEMENTATION', () => {
  describe('1. Explicit Fail-Closed Authority Mode', () => {
    it('throws before provider when brief is missing in CHAPTER_BRIEF_V2 mode', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()

      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot,
          plan,
          authorityMode: 'CHAPTER_BRIEF_V2',
          brief: null,
        })
      }).toThrow(/CHAPTER_BRIEF_V2_BRIEF_REQUIRED/)
    })

    it('requires explicit authorityMode at compile time and runtime', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()
      const brief = mockBrief()

      // Valid explicit CHAPTER_BRIEF_V2 call
      const projection = buildProductionChapterWriterPrompt({
        snapshot,
        plan,
        brief,
        authorityMode: 'CHAPTER_BRIEF_V2',
      })
      expect(projection.system).toBeDefined()
      expect(projection.prompt).toBeDefined()
    })

    it('verifies static regression that no active production caller uses LEGACY', () => {
      const rootDir = join(__dirname, '../..')
      const filesToCheck = [
        'lib/runtime/story-generation.ts',
        'lib/runtime/personalized-generation.ts',
        'lib/ai-gateway/gateway-provider.ts',
        'lib/ai-gateway/generate.ts',
      ]
      for (const relPath of filesToCheck) {
        const fullPath = join(rootDir, relPath)
        const content = readFileSync(fullPath, 'utf-8')
        // Dilarang ada 'authorityMode: \'LEGACY\'' di kode produksi aktif
        expect(content).not.toMatch(/authorityMode\s*:\s*['"]LEGACY['"]/)
      }
    })
  })

  describe('2. Ending Lock Authority & Reconciliation Guards', () => {
    it('accepts brief lock when continuation is null at first lock boundary (Bab 45)', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan({ chapterNumber: 45 })
      const brief = mockBrief({
        chapterNumber: 45,
        lockedEndingKey: 'rumah-bersama',
        lockedEndingClosure: ['Warga menjaga kedai bersama Sinta.'],
      })
      const continuation: ContinuationContext = {
        storyId: 'story-test-1',
        targetChapterNumber: 45,
        previousChapter: null,
        previousChoice: null,
        routeStateSummary: '',
        openThreads: [],
        anchorFacts: [],
        recentTimeline: [],
        mustNotReveal: [],
        storyAnchors: null,
        actRollups: [],
        lockedEndingKey: null, // null di DB pada Bab 45 pertama
      }

      const projection = buildProductionChapterWriterPrompt({
        snapshot,
        plan,
        brief,
        continuation,
        authorityMode: 'CHAPTER_BRIEF_V2',
      })

      expect(projection.metadata.endingLockProjected).toBe(true)
      expect(projection.prompt).toContain('ENDING TERKUNCI')
      expect(projection.prompt).toContain('Warga menjaga kedai bersama Sinta.')
    })

    it('keeps ending authority internal while preserving its writer-safe semantic closure', () => {
      const lockedEndingKey = 'rumah-bersama'
      const semanticClosure = 'Warga ikut menjaga rumah bersama Sinta setelah bukti dibuka.'
      const projection = buildProductionChapterWriterPrompt({
        snapshot: mockSnapshot(),
        plan: mockPlan({
          chapterNumber: 45,
          plannedBeats: [`Arahkan resolusi ke ${lockedEndingKey}.`],
        }),
        brief: mockBrief({
          chapterNumber: 45,
          lockedEndingKey,
          lockedEndingClosure: [semanticClosure],
        }),
        authorityMode: 'CHAPTER_BRIEF_V2',
      })

      expect(projection.metadata.endingLockProjected).toBe(true)
      expect(projection.prompt).toContain(semanticClosure)
      expect(projection.system).not.toContain(lockedEndingKey)
      expect(projection.prompt).not.toContain(lockedEndingKey)
      expect(projection.prompt).toContain('rumah bersama')
    })

    it('fails closed when any known internal authority identifier survives projection', () => {
      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot: mockSnapshot(),
          plan: mockPlan({ chapterNumber: 45 }),
          brief: mockBrief({
            chapterNumber: 45,
            lockedEndingKey: 'paragraf',
            lockedEndingClosure: ['Warga menjaga kedai bersama Sinta.'],
          }),
          authorityMode: 'CHAPTER_BRIEF_V2',
        })
      }).toThrow(/WRITER_VISIBLE_INTERNAL_AUTHORITY_IDENTIFIER/)
    })

    it('accepts brief lock when continuation matches brief lock', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan({ chapterNumber: 46 })
      const brief = mockBrief({
        chapterNumber: 46,
        lockedEndingKey: 'rumah-bersama',
        lockedEndingClosure: ['Warga menjaga kedai bersama Sinta.'],
      })
      const continuation: ContinuationContext = {
        storyId: 'story-test-1',
        targetChapterNumber: 46,
        previousChapter: null,
        previousChoice: null,
        routeStateSummary: '',
        openThreads: [],
        anchorFacts: [],
        recentTimeline: [],
        mustNotReveal: [],
        storyAnchors: null,
        actRollups: [],
        lockedEndingKey: 'rumah-bersama',
      }

      const projection = buildProductionChapterWriterPrompt({
        snapshot,
        plan,
        brief,
        continuation,
        authorityMode: 'CHAPTER_BRIEF_V2',
      })

      expect(projection.metadata.endingLockProjected).toBe(true)
    })

    it('fails closed when brief ending lock contradicts continuation ending lock', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan({ chapterNumber: 46 })
      const brief = mockBrief({
        chapterNumber: 46,
        lockedEndingKey: 'rumah-bersama',
      })
      const continuation: ContinuationContext = {
        storyId: 'story-test-1',
        targetChapterNumber: 46,
        previousChapter: null,
        previousChoice: null,
        routeStateSummary: '',
        openThreads: [],
        anchorFacts: [],
        recentTimeline: [],
        mustNotReveal: [],
        storyAnchors: null,
        actRollups: [],
        lockedEndingKey: 'jalan-baru', // Konflik!
      }

      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot,
          plan,
          brief,
          continuation,
          authorityMode: 'CHAPTER_BRIEF_V2',
        })
      }).toThrow(/ENDING_LOCK_CONFLICT_BETWEEN_BRIEF_AND_CONTINUATION/)
    })
  })

  describe('3. Pre-Call Contradiction Guards', () => {
    it('fails closed when scheduled reveal authorityId matches a forbidden reveal ID', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()
      const brief = mockBrief({
        forbiddenRevealIds: ['secret:prohibited_now'],
        scheduledReveals: [
          {
            authorityId: 'secret:prohibited_now',
            kind: 'SCHEDULED_REVEAL',
            writerDirective: 'Ungkap rahasia yang terlarang sekarang.',
          },
        ],
      })

      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot,
          plan,
          brief,
          authorityMode: 'CHAPTER_BRIEF_V2',
        })
      }).toThrow(/SCHEDULED_REVEAL_CONTRADICTS_FORBIDDEN_REVEAL_ID/)
    })

    it('fails closed when scheduled reveal chapter is before the canon reveal gate', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan({ chapterNumber: 10 })
      const brief = mockBrief({
        chapterNumber: 10,
        scheduledReveals: [
          {
            authorityId: 'secret:ledger_author', // Gate is 12, but chapter is 10!
            kind: 'SCHEDULED_REVEAL',
            writerDirective: 'Ungkap penulis catatan sebelum gate.',
          },
        ],
      })

      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot,
          plan,
          brief,
          authorityMode: 'CHAPTER_BRIEF_V2',
        })
      }).toThrow(/SCHEDULED_REVEAL_BEFORE_GATE_CHAPTER/)
    })

    it('fails closed when plot debt to close is already RESOLVED in canon snapshot', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()
      const brief = mockBrief({
        resolvedPlotDebtIds: ['debt:already_closed'],
        plotDebtsToClose: [
          {
            authorityId: 'debt:already_closed',
            kind: 'PLOT_DEBT_CLOSE',
            writerDirective: 'Tutup hutang yang sudah selesai.',
          },
        ],
      })

      expect(() => {
        buildProductionChapterWriterPrompt({
          snapshot,
          plan,
          brief,
          authorityMode: 'CHAPTER_BRIEF_V2',
        })
      }).toThrow(/PLOT_DEBT_TO_CLOSE_ALREADY_RESOLVED/)
    })
  })

  describe('4. Two-Layer Structured Authority & Brand Guard', () => {
    it('retains authorityId in projection metadata but never leaks it into writer-visible text', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()
      const brief = mockBrief({
        scheduledReveals: [
          {
            authorityId: 'secret:ledger_author',
            kind: 'SCHEDULED_REVEAL',
            writerDirective: 'Sinta menemukan kuitansi bertanda tangan Surya di balik pintu loker.',
          },
        ],
        plotDebtsToClose: [
          {
            authorityId: 'debt:kunci_loker_stasiun',
            kind: 'PLOT_DEBT_CLOSE',
            writerDirective: 'Jelaskan mengapa Arga menyimpan kunci loker tersebut.',
          },
        ],
      })

      const projection = buildProductionChapterWriterPrompt({
        snapshot,
        plan,
        brief,
        authorityMode: 'CHAPTER_BRIEF_V2',
      })

      // Metadata wajib memuat authorityId kanonik
      expect(projection.metadata.obligations).toEqual([
        expect.objectContaining({
          authorityId: 'secret:ledger_author',
          kind: 'SCHEDULED_REVEAL',
        }),
        expect.objectContaining({
          authorityId: 'debt:kunci_loker_stasiun',
          kind: 'PLOT_DEBT_CLOSE',
        }),
      ])

      // User prompt LLM HANYA memuat writerDirective, TIDAK memuat authorityId teknis
      expect(projection.prompt).toContain('Sinta menemukan kuitansi bertanda tangan Surya di balik pintu loker.')
      expect(projection.prompt).toContain('Jelaskan mengapa Arga menyimpan kunci loker tersebut.')
      expect(projection.system).not.toContain('secret:ledger_author')
      expect(projection.system).not.toContain('debt:kunci_loker_stasiun')
      expect(projection.prompt).not.toContain('secret:ledger_author')
      expect(projection.prompt).not.toContain('debt:kunci_loker_stasiun')
    })
  })

  describe('5. Zero Silent Trimming & Capacity Invariants', () => {
    it('rejects brief obligations beyond contract capacity, never silently slices', () => {
      const excessiveReveals = Array.from({ length: 21 }, (_, i) => ({
        authorityId: `secret:excessive_${i}`,
        kind: 'SCHEDULED_REVEAL' as const,
        writerDirective: `Directive ${i}`,
      }))

      expect(() => {
        PreProseChapterBriefSchema.parse({
          ...mockBrief(),
          scheduledReveals: excessiveReveals,
        })
      }).toThrow()
    })
  })

  describe('6. Qualitative-Only P5 & Elimination of Numeric Paragraph Traps', () => {
    it('removes all numeric paragraph/sentence controllers from mobileDramaSystemPrompt', () => {
      const sys = mobileDramaSystemPrompt()

      // Dilarang ada target paragraf numerik
      expect(sys).not.toMatch(/Target \d+–\d+ paragraf/i)
      expect(sys).not.toMatch(/wajib dalam \d+–\d+/i)
      // Dilarang ada aturan 1 kalimat per paragraf kaku
      expect(sys).not.toMatch(/Mayoritas paragraf = 1 kalimat pendek/i)
      // Dilarang ada batasan 4–6 kalimat
      expect(sys).not.toMatch(/DILARANG paragraf 4–6 kalimat/i)
      // Dilarang ada breakdown struktur paragraf numerik
      expect(sys).not.toMatch(/Pembuka hook: \d+–\d+ paragraf/i)
      expect(sys).not.toMatch(/Penutup cliffhanger: \d+–\d+ paragraf/i)

      // Wajib memuat panduan kualitatif verbatim yang disahkan PM
      expect(sys).toContain('Gunakan paragraf yang nyaman dibaca di layar ponsel.')
      expect(sys).toContain('Hindari dinding teks panjang.')
      expect(sys).toContain('Pisahkan pergantian pembicara dan perubahan fokus dengan jelas.')
      expect(sys).toContain('Biarkan panjang paragraf mengikuti kebutuhan aksi, reaksi, dialog, dan tensi adegan.')
    })

    it('ensures prompt builder outputs P0-P5 precedence cleanly', () => {
      const snapshot = mockSnapshot()
      const plan = mockPlan()
      const brief = mockBrief()

      const projection = buildProductionChapterWriterPrompt({
        snapshot,
        plan,
        brief,
        authorityMode: 'CHAPTER_BRIEF_V2',
      })

      expect(projection.prompt).toContain('=== [P0] INVARIAN CANON & KEAMANAN')
      expect(projection.prompt).toContain('=== [P1] KEWAJIBAN NARATIF MANDATORI BAB INI ===')
      expect(projection.prompt).toContain('=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===')
      expect(projection.prompt).toContain('=== [P3] OTORITAS PANJANG KATA ===')
      expect(projection.prompt).toContain('=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===')
      expect(projection.prompt).toContain('=== [P5] RITME PARAGRAF KUALITATIF ===')
      expect(projection.prompt).toContain('Target utama penulisan: 850–950 kata.')
      expect(projection.prompt).toContain('Batas penerimaan keras: 800–1000 kata.')
    })
  })
})
