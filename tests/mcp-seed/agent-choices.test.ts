import { describe, expect, it } from 'vitest'
import { choicesDirectiveFor, parseAgentChoices, endingLockLabels } from '@/lib/mcp-seed/agent-choices'
import { assertCatalogContract } from '@/lib/catalog/catalog-contract'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const CONTRACT = assertCatalogContract({
  title: 'Uji Choices',
  mainCharacter: { name: 'Arini' },
  endingCandidates: [
    { key: 'ending-a', kind: 'main', name: 'Kemenangan Arini', condition: 'Arini memenangkan persidangan warisan.' },
    { key: 'ending-b', kind: 'main', name: 'Kalah tapi Damai', condition: 'Arini kalah di pengadilan tapi menemukan kedamaian.' },
    { key: 'ending-s', kind: 'secret', name: 'Rahasia Ibu', condition: 'Ibu Arini ternyata masih hidup di luar negeri.' },
  ],
  chapterTargets: [],
  revealRunway: [],
  corePromise: 'p',
  mainConflict: 'c',
  finalQuestion: 'q',
  styleProfile: 'kbm_viral_v1',
  genre: 'family_drama',
} as unknown as StoryContract)

const reactionA = [
  'Arini berdiri di ambang ruang sidang sambil menggenggam map wasiat itu lebih erat, membiarkan suara bergeming di sekelilingnya menjadi latar bagi keputusan yang sudah lama ia tanam sejak malam ayahnya pergi.',
  'Ia melangkah maju satu langkah, lalu satu lagi, dan ketika hakim memanggil nomor perkara, tangannya tidak gemetar lagi untuk pertama kalinya sejak tiga tahun terakhir ini.',
]
const reactionB = [
  'Arini memilih menarik paket berkasnya dari meja pengacara dan pulang dengan jalan memutar yang lebih jauh, karena ada hal-hal kecil yang ternyata lebih berharga daripada kemenangan yang memaksanya membenci keluarganya sendiri.',
  'Di teras rumah ibu nursanya, ia akhirnya menangis — bukan karena kalah, tapi karena untuk pertama kalinya boleh lelah tanpa harus memberi alasan kepada siapa pun.',
]

const validAgentChoices = {
  choice_prompt: 'Apa langkah yang akan kamu ambil?',
  choices: [
    { label: 'Lanjutkan sidang dan tunjukkan bukti wasiat', reaction: reactionA },
    { label: 'Tarik berkas dan pulang dengan damai', reaction: reactionB },
  ],
}

describe('choicesDirectiveFor', () => {
  it('spine 44 → ending_lock; varian 45-49 → agent; bab 50 → none; spine awal → agent', () => {
    expect(choicesDirectiveFor({ chapterNumber: 44, endingKey: null, contract: CONTRACT })).toBe('ending_lock')
    expect(choicesDirectiveFor({ chapterNumber: 45, endingKey: 'ending-a', contract: CONTRACT })).toBe('agent')
    expect(choicesDirectiveFor({ chapterNumber: 49, endingKey: 'ending-a', contract: CONTRACT })).toBe('agent')
    expect(choicesDirectiveFor({ chapterNumber: 50, endingKey: 'ending-a', contract: CONTRACT })).toBe('none')
    expect(choicesDirectiveFor({ chapterNumber: 1, endingKey: null, contract: CONTRACT })).toBe('agent')
  })
})

describe('endingLockLabels', () => {
  it('tepat 3 label dari kandidat ending kontrak', () => {
    const labels = endingLockLabels(CONTRACT)
    expect(labels).toHaveLength(3)
    for (const label of labels) expect(label.length).toBeGreaterThanOrEqual(8)
  })
})

describe('parseAgentChoices', () => {
  it('directive none → null meski agent mengirim choices', () => {
    expect(parseAgentChoices(validAgentChoices, { directive: 'none', contract: CONTRACT, proseTitle: 'Bab' })).toBeNull()
  })

  it('directive agent tanpa choices → MCP_CHOICE_MISSING', () => {
    expect(() => parseAgentChoices(undefined, { directive: 'agent', contract: CONTRACT, proseTitle: 'Bab' }))
      .toThrow(/MCP_CHOICE_MISSING/)
  })

  it('directive agent 1 pilihan → MCP_CHOICE_COUNT_INVALID', () => {
    expect(() => parseAgentChoices(
      { choices: [validAgentChoices.choices[0]!] },
      { directive: 'agent', contract: CONTRACT, proseTitle: 'Bab' },
    )).toThrow(/MCP_CHOICE_COUNT_INVALID:1/)
  })

  it('directive agent valid → choices tervalidasi + reaksi terikat urutan', () => {
    const out = parseAgentChoices(validAgentChoices, { directive: 'agent', contract: CONTRACT, proseTitle: 'Bab 3' })
    expect(out?.choicePrompt).toBe('Apa langkah yang akan kamu ambil?')
    expect(out?.choices).toHaveLength(2)
    expect(out?.choices[0]!.label).toBe('Lanjutkan sidang dan tunjukkan bukti wasiat')
    expect(out?.choices[0]!.consequence.length).toBeGreaterThan(0)
  })

  it('reaksi terlalu pendek → MCP ditolak oleh validateCatalogReactions', () => {
    expect(() => parseAgentChoices(
      { choices: [
        { label: 'Lanjutkan sidang dan tunjukkan bukti', reaction: ['Terlalu pendek.'] },
        { label: 'Tarik berkas dan pulang dengan damai', reaction: reactionB },
      ] },
      { directive: 'agent', contract: CONTRACT, proseTitle: 'Bab' },
    )).toThrow(/CATALOG_REACTIONS_INVALID/)
  })

  it('label mengandung istilah terlarang → ditolak brand guard', () => {
    expect(() => parseAgentChoices(
      { choices: [
        { label: 'Tanya gemini apa yang harus dilakukan', reaction: reactionA },
        { label: 'Tarik berkas dan pulang dengan damai', reaction: reactionB },
      ] },
      { directive: 'agent', contract: CONTRACT, proseTitle: 'Bab' },
    )).toThrow()
  })

  it('directive ending_lock: label dikunci server, jumlah reaksi wajib 3', () => {
    const labels = endingLockLabels(CONTRACT)
    const three = [reactionA, reactionB, reactionA]
    const out = parseAgentChoices(
      { choices: labels.map((_, index) => ({ label: `usulan agent ${index}`, reaction: three[index]! })) },
      { directive: 'ending_lock', contract: CONTRACT, proseTitle: 'Bab 44' },
    )
    expect(out?.choices.map((choice) => choice.label)).toEqual(labels)
    expect(() => parseAgentChoices(
      { choices: [validAgentChoices.choices[0]!, validAgentChoices.choices[1]!] },
      { directive: 'ending_lock', contract: CONTRACT, proseTitle: 'Bab 44' },
    )).toThrow(/MCP_CHOICE_COUNT_INVALID:2/)
  })
})
