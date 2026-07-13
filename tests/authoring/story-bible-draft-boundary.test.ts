import { describe, expect, it } from 'vitest'
import { StoryBibleDraftSchema } from '@/lib/authoring/schema'

function validDraft(): unknown {
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
    const draft = validDraft() as Record<string, any>
    draft.premise.tropes = ['  Rahasia Keluarga  ', ' Kebangkitan Diri ']

    const parsed = StoryBibleDraftSchema.parse(draft)

    expect(parsed.premise.tropes).toEqual(['Rahasia Keluarga', 'Kebangkitan Diri'])
  })

  it.each([
    ['malformed nested input', (draft: Record<string, any>) => { draft.cast.characters[0].voice = 'secret' }],
    ['aggregate unknown key', (draft: Record<string, any>) => { draft.internalConfig = 'secret' }],
    ['nested unknown key', (draft: Record<string, any>) => { draft.mystery.mainMystery.providerTrace = 'secret' }],
    ['oversized string', (draft: Record<string, any>) => { draft.premise.synopsis = 'x'.repeat(701) }],
    ['oversized cast', (draft: Record<string, any>) => { draft.cast.characters = Array.from({ length: 9 }, () => draft.cast.characters[0]) }],
    ['oversized aliases array', (draft: Record<string, any>) => { draft.cast.characters[0].aliases = Array.from({ length: 5 }, (_, index) => ({ alias: `Alias ${index}`, aliasType: 'NAME' })) }],
    ['undersized tropes', (draft: Record<string, any>) => { draft.premise.tropes = ['Solo'] }],
    ['oversized tropes', (draft: Record<string, any>) => { draft.premise.tropes = ['Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam'] }],
    ['blank trimmed trope', (draft: Record<string, any>) => { draft.premise.tropes = ['  ', 'Valid'] }],
    ['oversized trope element', (draft: Record<string, any>) => { draft.premise.tropes = ['x'.repeat(41), 'Valid'] }],
    ['chapter beyond fixed story length', (draft: Record<string, any>) => { draft.world.threads[0].payoffWindow = 51 }],
  ])('rejects %s', (_name, mutate) => {
    const draft = validDraft() as Record<string, any>
    mutate(draft)

    expect(StoryBibleDraftSchema.safeParse(draft).success).toBe(false)
  })
})
