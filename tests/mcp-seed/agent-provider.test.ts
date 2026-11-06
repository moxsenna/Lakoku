import { describe, expect, it } from 'vitest'
import {
  buildAgentInstruction,
  createAgentProseProvider,
  createAgentProseStore,
  parseAgentProse,
} from '@/lib/mcp-seed/agent-provider.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import type { WriteInput } from '@lakoku/ai-gateway'

const snapshot = {
  storyId: 'catalog:uji-agent',
  characters: [
    { id: 'ch1', canonicalName: 'Rara', status: 'ALIVE', introducedChapter: 1 },
    { id: 'ch2', canonicalName: 'Bu Sinta', status: 'ALIVE', introducedChapter: 1 },
  ],
  facts: [{ id: 'f1', subjectCharacterId: 'ch1', establishedChapter: 1, summary: 'wasiat palsu' }],
  knowledge: [],
  secrets: [{ id: 's1', description: 'rahasia wasiat', revealGateChapter: 3, revealed: false }],
  voiceSheets: [],
  timeline: [],
} as unknown as Parameters<typeof buildAgentInstruction>[0]['input']['snapshot']

function writeInput(plan: Record<string, unknown>, repairFindings?: unknown[]): WriteInput {
  return {
    snapshot,
    plan: {
      chapterNumber: 3,
      phase: 'RISING',
      plannedBeats: ['Rara menemukan kunci kamar'],
      usesReveals: ['s1'],
      proposedStateDelta: { kunci_ditemukan: true },
      introducesCharacters: [],
      ...plan,
    },
    repairFindings: repairFindings as never,
    genre: 'mystery',
  } as WriteInput
}

function instructionOf(input: WriteInput) {
  return buildAgentInstruction({
    input,
    policy: DEFAULT_RUNTIME_POLICY,
    novelTitle: 'Warisan untuk Pembantu',
    previousChapter: { title: 'Bab 2: Sidang Pertama', paragraphs: ['Para satu.', 'Para dua.'] },
    previousChapterNumber: 2,
    corePromise: 'Rara membuktikan wasiat palsu.',
    mainConflict: 'Keluarga menekan Rara menyerah.',
    finalQuestion: 'Siapa yang menipu siapa?',
  })
}

describe('parseAgentProse', () => {
  it('mengambil judul dari heading # dan paragraf dari blok kosong', () => {
    const md = '# Malam Wasiat\n\nParagraf pertama berisi adegan pengadilan yang menegangkan.\n\nParagraf kedua berisi dialog: "Kamu tahu apa yang terjadi malam itu?"'
    const out = parseAgentProse(md)
    expect(out.title).toBe('Malam Wasiat')
    expect(out.paragraphs).toHaveLength(2)
  })

  it('fallback judul dari baris Judul:', () => {
    const md = 'Judul: Malam Wasiat\n\nIsi paragraf pertama yang cukup panjang untuk dihitung kata.'
    expect(parseAgentProse(md).title).toBe('Malam Wasiat')
  })

  it('menolak prosa kosong', () => {
    expect(() => parseAgentProse('   \n\n  ')).toThrow(/MCP_PROSE_EMPTY/)
  })
})

describe('buildAgentInstruction', () => {
  it('memuat beats, anchor cerita, target kata, dan formatRules', () => {
    const instr = instructionOf(writeInput({}))
    expect(instr.chapterNumber).toBe(3)
    expect(instr.plannedBeats).toContain('Rara menemukan kunci kamar')
    expect(instr.mandatoryBeats.length).toBeGreaterThan(0)
    expect(instr.corePromise).toBe('Rara membuktikan wasiat palsu.')
    expect(instr.targetWordsMin).toBe(800)
    expect(instr.formatRules.join('\n')).toMatch(/paragraf pendek/i)
    expect(instr.previousEnding).toEqual(['Para satu.', 'Para dua.'])
  })

  it('menyertakan repairFindings pada attempt perbaikan', () => {
    const instr = instructionOf(writeInput({}, ['SHORT: prosa terlalu pendek']))
    expect(instr.repairFindings).toEqual(['SHORT: prosa terlalu pendek'])
    expect(instr.attempt).toBe(2)
  })
})

describe('createAgentProseStore', () => {
  it('park → resolve mengembalikan prosa', async () => {
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const instr = instructionOf(writeInput({}))
    const pending = store.park('spine#3', instr)
    expect(store.instruction('spine#3')?.chapterNumber).toBe(3)
    expect(store.resolve('spine#3', { title: 'X', paragraphs: ['isi.'] })).toBe(true)
    await expect(pending).resolves.toEqual({ title: 'X', paragraphs: ['isi.'] })
  })

  it('park timeout melempar MCP_PROSE_TIMEOUT', async () => {
    const store = createAgentProseStore({ timeoutMs: 20 })
    const pending = store.park('spine#1', instructionOf(writeInput({})))
    await expect(pending).rejects.toThrow(/MCP_PROSE_TIMEOUT/)
  })

  it('rejectAll membatalkan pending berdasarkan storyId', async () => {
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const pending = store.park('spine#2', instructionOf(writeInput({})))
    store.rejectAll('catalog:uji-agent', 'pump error')
    await expect(pending).rejects.toThrow(/pump error/)
  })
})

describe('createAgentProseProvider', () => {
  it('writeChapter park dan mengembalikan draft terstruktur, choices delegasi ke inner', async () => {
    const inner = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)
    const store = createAgentProseStore({ timeoutMs: 5_000 })
    const provider = createAgentProseProvider({ inner, policy: DEFAULT_RUNTIME_POLICY, store })
    expect(provider.name).toBe('mcp-gemini-agent-v1')

    const instr = instructionOf(writeInput({}))
    const input = writeInput({})
    const pending = provider.writeChapter(input, undefined)
    const key = instr.unitKey
    expect(store.resolve(key, { title: 'Malam Wasiat', paragraphs: ['Paragraf satu yang cukup panjang.', 'Paragraf dua.'] })).toBe(true)
    const draft = (await pending) as Record<string, unknown>
    expect(draft.title).toBe('Malam Wasiat')
    expect(draft.paragraphs).toHaveLength(2)
    expect(draft.hasChoiceOrGate).toBe(true)
    expect(draft.storyId).toBe('catalog:uji-agent')
    expect(Array.isArray(draft.events)).toBe(true)
    expect(provider.generateChoices).toBeDefined()
    expect(provider.generateCatalogReactions).toBeDefined()
  })
})
