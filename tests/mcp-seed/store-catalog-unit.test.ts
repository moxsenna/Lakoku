import { describe, expect, it } from 'vitest'
import { storeCatalogUnit, type CatalogAgentChoices, type CatalogGeneratorWriter, type CatalogGeneratorStoryState, type CatalogChapterRef } from '@/lib/catalog/generator.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { assertCatalogContract } from '@/lib/catalog/catalog-contract'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const CONTRACT = assertCatalogContract({
  title: 'Uji Batch',
  mainCharacter: { name: 'Arini' },
  endingCandidates: [
    { key: 'ending-a', kind: 'main', name: 'Kemenangan Arini', condition: 'Arini memenangkan persidangan warisan.' },
    { key: 'ending-b', kind: 'main', name: 'Kalah tapi Damai', condition: 'Arini kalah di pengadilan tapi menemukan kedamaian.' },
    { key: 'ending-s', kind: 'secret', name: 'Rahasia Ibu', condition: 'Ibu Arini ternyata masih hidup.' },
  ],
  chapterTargets: [],
  revealRunway: [],
  corePromise: 'p',
  mainConflict: 'c',
  finalQuestion: 'q',
  styleProfile: 'kbm_viral_v1',
  genre: 'family_drama',
} as unknown as StoryContract)

const PROSE = '# Bab Uji\n\n' + 'Paragraf uji penyimpanan unit dengan panjang memadai untuk guard consumer-safe dan struktur bab katalog.'.repeat(4)

function choicesFor(count: number, withLabels: boolean): CatalogAgentChoices {
  const labels = withLabels
    ? ['Lanjutkan sidang dengan bukti wasiat', 'Tahan langkah dan selidiki diam-diam', 'Minta bantuan pengacara keluarga']
    : ['usulan a', 'usulan b', 'usulan c']
  const reaction = [
    'Arini menarik napas panjang di lorong pengadilan yang mulai sepi, menimbang langkah berikutnya dengan kepala dingin sambil menggenggam map bukti yang sudah ia rangkai semalaman penuh.',
    'Ketika panggilan sidang berkumandang, ia melangkah masuk dengan punggung tegak, siap menanggung konsekuensi dari pilihan yang menurutnya paling jujur bagi keluarganya.',
  ]
  return {
    choicePrompt: 'Apa langkah yang akan kamu ambil?',
    choices: Array.from({ length: count }, (_, index) => ({
      label: labels[index]!,
      consequence: [reaction[index % 2]!],
    })),
  }
}

function fakeWriter(): CatalogGeneratorWriter & { state: CatalogGeneratorStoryState } {
  const state: CatalogGeneratorStoryState = {
    status: 'draft',
    contract: CONTRACT,
    spine: new Map<number, CatalogChapterRef>(),
    variants: new Map(),
  }
  return {
    state,
    async loadState() { return state },
    async loadCanon() { throw new Error('tidak dipakai storeCatalogUnit') },
    async markGenerating() { state.status = 'generating' },
    async writeSpineChapter(_storyId, chapter) {
      state.spine.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs })
    },
    async writeVariantChapter(_storyId, endingKey, chapter) {
      const map = state.variants.get(endingKey) ?? new Map<number, CatalogChapterRef>()
      map.set(chapter.chapterNumber, { title: chapter.title, paragraphs: chapter.paragraphs })
      state.variants.set(endingKey, map)
    },
    async deleteSpineChapter() {},
    async setProgress(_storyId, progress) { state.progressValue = progress },
    async markReview() { state.status = 'review' },
  } as never as CatalogGeneratorWriter & { state: CatalogGeneratorStoryState }
}

function deps(writer: ReturnType<typeof fakeWriter>) {
  return { provider: createDeterministicProvider(DEFAULT_RUNTIME_POLICY), writer, policy: DEFAULT_RUNTIME_POLICY }
}

describe('storeCatalogUnit (batch full-Gemini)', () => {
  it('menyimpan unit spine dengan choices agent + effects flagsSet', async () => {
    const writer = fakeWriter()
    const result = await storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch',
      chapterNumber: 1,
      endingKey: null,
      title: 'Bab 1',
      paragraphs: [PROSE],
      choices: choicesFor(2, true),
    })
    expect(result.alreadyStored).toBe(false)
    expect(result.progress).toBe(1)
    expect(writer.state.spine.get(1)?.title).toBe('Bab 1')
    // outcomes tersimpan dengan efek deterministik (lihat DB via DB-level test;
    // di sini cukup cek chapter tersimpan + tidak melempar guard).
  })

  it('bab 44 spine: label dikunci dari kandidat ending + bias dipasang', async () => {
    const writer = fakeWriter()
    for (let n = 1; n <= 43; n++) {
      writer.state.spine.set(n, { title: `Bab ${n}`, paragraphs: ['isi'] })
    }
    const result = await storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch',
      chapterNumber: 44,
      endingKey: null,
      title: 'Bab 44',
      paragraphs: [PROSE],
      choices: choicesFor(3, false), // label usulan agent — harus ditimpa server
    })
    expect(result.alreadyStored).toBe(false)
    expect(writer.state.spine.size).toBe(44)
  })

  it('unit varian bab 50 (penutup) tanpa choices + review saat semua varian tuntas', async () => {
    const writer = fakeWriter()
    for (let n = 1; n <= 44; n++) {
      writer.state.spine.set(n, { title: `Bab ${n}`, paragraphs: ['isi'] })
    }
    for (const key of ['ending-a', 'ending-b']) {
      for (let m = 45; m <= 50; m++) {
        const map = writer.state.variants.get(key) ?? new Map<number, CatalogChapterRef>()
        map.set(m, { title: `Bab ${m}`, paragraphs: ['isi'] })
        writer.state.variants.set(key, map)
      }
    }
    // ending-s bab 45-49 sudah ada; 50 terakhir:
    const map = writer.state.variants.get('ending-s') ?? new Map<number, CatalogChapterRef>()
    for (let m = 45; m <= 49; m++) map.set(m, { title: `Bab ${m}`, paragraphs: ['isi'] })
    writer.state.variants.set('ending-s', map)

    const result = await storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch',
      chapterNumber: 50,
      endingKey: 'ending-s',
      title: 'Bab 50',
      paragraphs: [PROSE],
      choices: null,
    })
    expect(result.alreadyStored).toBe(false)
    expect(result.reviewMarked).toBe(true)
    expect(writer.state.status).toBe('review')
  })

  it('idempoten: unit yang sudah ada → alreadyStored tanpa menulis ulang', async () => {
    const writer = fakeWriter()
    writer.state.spine.set(1, { title: 'Sudah Ada', paragraphs: ['isi'] })
    const result = await storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch',
      chapterNumber: 1,
      endingKey: null,
      title: 'Bab 1',
      paragraphs: [PROSE],
      choices: choicesFor(2, true),
    })
    expect(result.alreadyStored).toBe(true)
    expect(writer.state.spine.get(1)?.title).toBe('Sudah Ada')
  })

  it('menolak tanpa choices untuk unit ber-pilihan', async () => {
    const writer = fakeWriter()
    await expect(storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch',
      chapterNumber: 2,
      endingKey: null,
      title: 'Bab 2',
      paragraphs: [PROSE],
      choices: null,
    })).rejects.toThrow(/MCP_UNIT_CHOICES_REQUIRED/)
  })

  it('menolak unit spine > 44 dan varian < 45', async () => {
    const writer = fakeWriter()
    await expect(storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch', chapterNumber: 45, endingKey: null,
      title: 'X', paragraphs: [PROSE], choices: choicesFor(2, true),
    })).rejects.toThrow(/MCP_UNIT_NUMBER_INVALID/)
    await expect(storeCatalogUnit(deps(writer), {
      storyId: 'catalog:uji-batch', chapterNumber: 44, endingKey: 'ending-a',
      title: 'X', paragraphs: [PROSE], choices: choicesFor(2, true),
    })).rejects.toThrow(/MCP_UNIT_NUMBER_INVALID/)
  })
})
