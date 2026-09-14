import { describe, expect, it } from 'vitest'
import { StoryBibleDraftSchema, type StoryBibleDraft } from '@/lib/authoring/schema'

/**
 * Writable fixture for intentional invalid mutation tests.
 * Nested access kept; values loose for schema rejection cases.
 */
type StoryBibleDraftFixture = {
  premise: {
    synopsis: string
    tropes: string[]
    [key: string]: unknown
  }
  cast: {
    characters: Array<{
      voice: unknown
      aliases: Array<{ alias: string; aliasType: string; [key: string]: unknown }>
      [key: string]: unknown
    }>
    [key: string]: unknown
  }
  mystery: {
    mainMystery: {
      providerTrace?: unknown
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  world: {
    threads: Array<{
      payoffWindow: number
      [key: string]: unknown
    }>
    facts?: Array<{
      subjectName?: unknown
      [key: string]: unknown
    }>
    [key: string]: unknown
  }
  internalConfig?: unknown
  [key: string]: unknown
}

function cloneDraft(value: StoryBibleDraft): StoryBibleDraftFixture {
  return structuredClone(value) as unknown as StoryBibleDraftFixture
}

function validDraft(): StoryBibleDraft {
  return {
    premise: {
      title: 'Warisan yang Terkubur',
      tagline: 'Sebuah surat wasiat membuka luka yang dikira sudah sembuh.',
      role: 'Rani, sang pewaris yang tak pernah diberi tahu',
      synopsis: 'Rani kembali ke rumah keluarga setelah kematian ayahnya. Ia menemukan warisan tersembunyi. Janji lama mengubah nasib banyak orang. Ia harus memilih antara kebenaran dan kedamaian.',
      tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
    },
    cast: {
      characters: [
        { canonicalName: 'Rani', role: 'protagonis', motivation: 'Membongkar kebenaran di balik warisan ayahnya.', introducedChapter: 1, aliases: [{ alias: 'Bu Rani', aliasType: 'TITLE' }], voice: { register: 'tenang namun tajam', speechHabits: ['bicara terukur'], forbiddenWords: ['sumpah'], sampleLines: ['Aku tidak akan diam kali ini.'] } },
        { canonicalName: 'Damar', role: 'antagonis', motivation: 'Menyembunyikan isi wasiat demi kuasa.', introducedChapter: 3, aliases: [], voice: { register: 'licin dan berwibawa', speechHabits: ['banyak berdalih'], forbiddenWords: [], sampleLines: ['Semua ini demi keluarga.'] } },
        { canonicalName: 'Sena', role: 'sekutu', motivation: 'Melindungi Rani dari masa lalunya sendiri.', introducedChapter: 2, aliases: [], voice: { register: 'hangat dan setia', speechHabits: ['sering menenangkan'], forbiddenWords: [], sampleLines: ['Aku di sini, apa pun yang terjadi.'] } },
      ],
    },
    mystery: {
      mainMystery: { title: 'Siapa yang memalsukan wasiat itu?', payoffWindow: 45 },
      secrets: [
        { description: 'Wasiat asli menyebut Rani sebagai pewaris tunggal.', revealGateChapter: 12 },
        { description: 'Damar terlibat pemalsuan dokumen.', revealGateChapter: 32 },
      ],
    },
    world: {
      threads: [{ title: 'Perseteruan warisan keluarga', openedChapter: 1, payoffWindow: 45 }],
      facts: [
        { statement: 'Ayah Rani menyimpan wasiat kedua secara diam-diam.', subjectName: 'Rani', establishedChapter: 1, salience: 0.9, loadBearing: true },
        { statement: 'Damar mengelola aset keluarga sejak lama.', subjectName: 'Damar', establishedChapter: 3, salience: 0.6, loadBearing: false },
        { statement: 'Rumah keluarga terletak di kota kecil dekat pesisir.', subjectName: null, establishedChapter: 1, salience: 0.3, loadBearing: false },
      ],
    },
  }
}

describe('StoryBibleDraftSchema', () => {
  it('accepts current valid fixture and trims trope elements', () => {
    const draft = cloneDraft(validDraft())
    draft.premise.tropes = ['  Rahasia Keluarga  ', ' Kebangkitan Diri ']

    const parsed = StoryBibleDraftSchema.parse(draft)

    expect(parsed.premise.tropes).toEqual(['Rahasia Keluarga', 'Kebangkitan Diri'])
  })

  it('accepts and gracefully truncates role up to 200 chars to 80 chars', () => {
    const draft = cloneDraft(validDraft())
    draft.premise.role = 'Putra sulung yang dikhianati, difitnah, dan dibuang dari kerajaan bisnis keluarga.'

    const parsed = StoryBibleDraftSchema.parse(draft)

    expect(parsed.premise.role.length).toBeLessThanOrEqual(80)
    expect(parsed.premise.role).toBe('Putra sulung yang dikhianati, difitnah, dan dibuang dari kerajaan bisnis keluarg')
  })

  it('accepts register up to 140 chars and truncates character role to 60 chars', () => {
    const draft = cloneDraft(validDraft())
    const longRegister = 'Tenang tapi penuh beban, seperti orang yang sudah lama menelan kata-katanya sendiri.'
    expect(longRegister.length).toBe(84)
    draft.cast.characters[0].voice = {
      register: longRegister,
      speechHabits: ['bicara pelan'],
      forbiddenWords: ['marah'],
      sampleLines: ['Tidak apa-apa.'],
    }
    draft.cast.characters[1].role = 'Pengusaha properti licin yang mengincar warung peninggalan orang tua sejak lama'
    draft.world.facts![2].subjectName = ''

    const parsed = StoryBibleDraftSchema.parse(draft)

    expect(parsed.cast.characters[0].voice.register).toBe(longRegister)
    expect(parsed.cast.characters[1].role.length).toBeLessThanOrEqual(60)
    expect(parsed.world.facts[2].subjectName).toBeNull()
  })

  it.each([
    ['malformed nested input', (draft: StoryBibleDraftFixture) => { draft.cast.characters[0].voice = 'secret' }],
    ['aggregate unknown key', (draft: StoryBibleDraftFixture) => { draft.internalConfig = 'secret' }],
    ['nested unknown key', (draft: StoryBibleDraftFixture) => { draft.mystery.mainMystery.providerTrace = 'secret' }],
    ['oversized string', (draft: StoryBibleDraftFixture) => { draft.premise.synopsis = 'x'.repeat(701) }],
    ['oversized cast', (draft: StoryBibleDraftFixture) => { draft.cast.characters = Array.from({ length: 9 }, () => draft.cast.characters[0]) }],
    ['oversized aliases array', (draft: StoryBibleDraftFixture) => { draft.cast.characters[0].aliases = Array.from({ length: 5 }, (_, index) => ({ alias: `Alias ${index}`, aliasType: 'NAME' })) }],
    ['undersized tropes', (draft: StoryBibleDraftFixture) => { draft.premise.tropes = ['Solo'] }],
    ['oversized tropes', (draft: StoryBibleDraftFixture) => { draft.premise.tropes = ['Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam'] }],
    ['blank trimmed trope', (draft: StoryBibleDraftFixture) => { draft.premise.tropes = ['  ', 'Valid'] }],
    ['oversized trope element', (draft: StoryBibleDraftFixture) => { draft.premise.tropes = ['x'.repeat(41), 'Valid'] }],
    ['chapter beyond fixed story length', (draft: StoryBibleDraftFixture) => { draft.world.threads[0].payoffWindow = 51 }],
  ])('rejects %s', (_name, mutate) => {
    const draft = cloneDraft(validDraft())
    mutate(draft)

    expect(StoryBibleDraftSchema.safeParse(draft).success).toBe(false)
  })
})
