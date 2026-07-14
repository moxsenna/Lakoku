import { describe, expect, it } from 'vitest'
import { parseStoryContract, StoryContractSchema } from '@/lib/story-engine/story-contract'
import { buildContractFixture } from '@/fixtures/contracts/build-contract-fixture'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { romansaDramaContract } from '@/fixtures/contracts/romansa-drama'

const fixtures = [
  misteriDramaContract,
  romansaDramaContract,
  fantasiPetualanganContract,
]

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('StoryContractSchema fixtures', () => {
  it.each(fixtures.map((fixture) => [fixture.genre, fixture] as const))(
    'parses complete %s fixture',
    (_genre, fixture) => {
      const parsed = parseStoryContract(fixture)

      expect(parsed.chapterTargets).toHaveLength(50)
      expect(parsed.chapterTargets.map((target) => target.chapterNumber)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 1),
      )
      expect(parsed.actPlan[0].fromChapter).toBe(1)
      expect(parsed.actPlan.at(-1)?.toChapter).toBe(50)
      expect(parsed.actPlan.every((act, index) => (
        index === 0 || act.fromChapter === parsed.actPlan[index - 1].toChapter + 1
      ))).toBe(true)
      expect(parsed.endingCandidates.length).toBeGreaterThanOrEqual(2)
      expect(parsed.plotDebts.length).toBeGreaterThanOrEqual(2)
      expect(parsed.revealRunway.length).toBeGreaterThanOrEqual(2)
      expect(parsed.chapterTargets.every((target) => (
        target.goal.length > 0
        && target.emotionalTurn.length > 0
        && Array.isArray(target.expectedThreadMovement)
        && target.expectedThreadMovement.length > 0
        && target.expectedThreadMovement.every((movement) => movement.length > 0)
        && !target.goal.includes(`Goal chapter ${target.chapterNumber}`)
      ))).toBe(true)
      expect(parsed.closureRunway).toEqual({
        noNewMajorConflictAfter: 35,
        noNewThreadAfter: 40,
        endingLockChapter: 45,
        mainMysteryResolveBy: 48,
        emotionalResolutionChapter: 49,
        finalEndingChapter: 50,
      })
    },
  )

  it('builds fixtures without shared mutable arrays', () => {
    const first = buildContractFixture({
      storyId: 'fixture:first',
      title: 'Jejak Pertama',
      genre: 'Misteri',
      tone: 'Tegang',
      mainCharacter: {
        name: 'Nara',
        role: 'Penyelidik',
        wound: 'Gagal menyelamatkan saksi lama.',
        desire: 'Menemukan pelaku sebelum korban berikutnya jatuh.',
      },
      mainConflict: 'Nara memburu pemalsu bukti di kotanya.',
      finalQuestion: 'Akankah Nara memilih kebenaran saat keluarganya terancam?',
      corePromise: 'Misteri berlapis dengan pengungkapan emosional.',
      endingCandidates: [
        { key: 'truth', name: 'Kebenaran Terbuka', condition: 'Nara menjaga bukti.', requiredClosure: ['Kasus terungkap.'] },
        { key: 'mercy', name: 'Belas Kasih', condition: 'Nara memahami motif pelaku.', requiredClosure: ['Korban mendapat pemulihan.'] },
      ],
      plotDebts: [
        { id: 'main_mystery', question: 'Siapa pemalsu bukti?', introducedAt: 1, mustProgressBy: [12, 32], mustCloseBy: 48, status: 'open' },
      ],
      revealRunway: [
        { secretId: 'secret:first', revealGateChapter: 20 },
        { secretId: 'secret:second', revealGateChapter: 45 },
      ],
      motifs: {
        stakes: 'bukti yang terus menghilang',
        relationship: 'kepercayaan Nara kepada saksi utama',
        mystery: 'jejak tinta pada dokumen palsu',
      },
    })
    const second = buildContractFixture({
      storyId: 'fixture:second',
      title: 'Jejak Kedua',
      genre: 'Drama',
      tone: 'Melankolis',
      mainCharacter: {
        name: 'Saka',
        role: 'Pewaris',
        wound: 'Ditinggalkan keluarga saat kecil.',
        desire: 'Memulihkan nama ibunya.',
      },
      mainConflict: 'Saka menghadapi keluarga yang menghapus sejarah ibunya.',
      finalQuestion: 'Akankah Saka memperoleh rumah tanpa kehilangan dirinya?',
      corePromise: 'Drama keluarga dengan pilihan pengampunan.',
      endingCandidates: [
        { key: 'home', name: 'Pulang', condition: 'Saka berdamai.', requiredClosure: ['Nama ibu dipulihkan.'] },
        { key: 'leave', name: 'Jalan Baru', condition: 'Saka melepaskan warisan.', requiredClosure: ['Saka memilih masa depan.'] },
      ],
      plotDebts: [
        { id: 'main_mystery', question: 'Siapa yang menghapus nama ibu?', introducedAt: 2, mustProgressBy: [20, 40], mustCloseBy: 48, status: 'progressing' },
      ],
      revealRunway: [
        { secretId: 'secret:third', revealGateChapter: 20 },
        { secretId: 'secret:fourth', revealGateChapter: 45 },
      ],
      motifs: {
        stakes: 'rumah keluarga yang akan dijual',
        relationship: 'ikatan Saka dengan adiknya',
        mystery: 'halaman silsilah yang disobek',
      },
    })

    first.chapterTargets[0].mustInclude.push('Mutasi khusus fixture pertama.')
    first.chapterTargets[0].expectedThreadMovement.push('Mutasi thread fixture pertama.')
    first.actPlan[0].goal = 'Mutasi act fixture pertama.'
    first.closureRunway.noNewMajorConflictAfter = 40 as 35

    expect(second.chapterTargets[0].mustInclude).not.toContain('Mutasi khusus fixture pertama.')
    expect(second.chapterTargets[0].expectedThreadMovement).not.toContain('Mutasi thread fixture pertama.')
    expect(second.actPlan[0].goal).not.toBe('Mutasi act fixture pertama.')
    expect(second.closureRunway).toEqual({
      noNewMajorConflictAfter: 35,
      noNewThreadAfter: 40,
      endingLockChapter: 45,
      mainMysteryResolveBy: 48,
      emotionalResolutionChapter: 49,
      finalEndingChapter: 50,
    })
  })
})

describe('StoryContractSchema rejection', () => {
  it('rejects 49 chapter targets', () => {
    const input = clone(misteriDramaContract)
    input.chapterTargets.pop()
    expect(StoryContractSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    ['duplicate chapter target', (input: any) => { input.chapterTargets[1].chapterNumber = 1 }],
    ['out-of-order chapter target', (input: any) => { [input.chapterTargets[0], input.chapterTargets[1]] = [input.chapterTargets[1], input.chapterTargets[0]] }],
    ['non-50 total', (input: any) => { input.totalChapters = 49 }],
    ['unknown root field', (input: any) => { input.provider = 'hidden' }],
    ['unknown nested field', (input: any) => { input.mainCharacter.providerTrace = 'hidden' }],
    ['duplicate ending keys', (input: any) => { input.endingCandidates[1].key = input.endingCandidates[0].key }],
    ['duplicate debt IDs', (input: any) => { input.plotDebts[1].id = input.plotDebts[0].id }],
    ['missing main_mystery debt', (input: any) => { input.plotDebts[0].id = 'debt:replacement' }],
    ['duplicate reveal secrets', (input: any) => { input.revealRunway[1].secretId = input.revealRunway[0].secretId }],
    ['unsorted debt progression', (input: any) => { input.plotDebts[0].mustProgressBy = [32, 12] }],
    ['duplicate debt progression', (input: any) => { input.plotDebts[0].mustProgressBy = [12, 12] }],
    ['progression before debt introduction', (input: any) => { input.plotDebts[0].introducedAt = 20; input.plotDebts[0].mustProgressBy = [12, 32] }],
    ['progression after debt closure', (input: any) => { input.plotDebts[0].mustCloseBy = 20; input.plotDebts[0].mustProgressBy = [12, 32] }],
    ['invalid debt closure chapter', (input: any) => { input.plotDebts[0].mustCloseBy = 51 }],
    ['invalid reveal gate', (input: any) => { input.revealRunway[0].revealGateChapter = 0 }],
    ['fewer than two ending candidates', (input: any) => { input.endingCandidates = input.endingCandidates.slice(0, 1) }],
    ['bad closure literal', (input: any) => { input.closureRunway.mainMysteryResolveBy = 47 }],
    ['unknown closure field', (input: any) => { input.closureRunway.internal = 50 }],
    ['scalar expected thread movement', (input: any) => { input.chapterTargets[0].expectedThreadMovement = 'scalar' }],
    ['empty expected thread movement', (input: any) => { input.chapterTargets[0].expectedThreadMovement = [] }],
    ['oversized string', (input: any) => { input.title = 'x'.repeat(161) }],
    ['oversized array', (input: any) => { input.chapterTargets[0].mustInclude = Array.from({ length: 9 }, (_, index) => `Beat ${index}`) }],
    ['oversized thread movement array', (input: any) => { input.chapterTargets[0].expectedThreadMovement = Array.from({ length: 9 }, (_, index) => `Movement ${index}`) }],
    ['unknown chapter target field', (input: any) => { input.chapterTargets[0].internal = true }],
    ['gapped act plan', (input: any) => { input.actPlan[1].fromChapter += 1 }],
    ['overlapping act plan', (input: any) => { input.actPlan[1].fromChapter -= 1 }],
    ['unordered acts', (input: any) => { input.actPlan[1].actNumber = input.actPlan[0].actNumber }],
  ])('rejects %s', (_name, mutate) => {
    const input = clone(misteriDramaContract) as any
    mutate(input)
    expect(StoryContractSchema.safeParse(input).success).toBe(false)
  })

  it('trims every accepted string', () => {
    const input = clone(misteriDramaContract) as any
    input.title = `  ${input.title}  `
    input.chapterTargets[0].mustInclude[0] = `  ${input.chapterTargets[0].mustInclude[0]}  `

    const parsed = parseStoryContract(input)

    expect(parsed.title).toBe(misteriDramaContract.title)
    expect(parsed.chapterTargets[0].mustInclude[0]).toBe(
      misteriDramaContract.chapterTargets[0].mustInclude[0],
    )
  })
})
