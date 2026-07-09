import {
  clearOnboardingDraftStash,
  createOnboardingDraftStashRecord,
  readOnboardingDraftStash,
  saveOnboardingDraftStash,
  type OnboardingDraftPayload,
} from '@/lib/onboarding-draft'
import {
  clampReaderFontSize,
  DEFAULT_READER_FONT_SIZE,
  MAX_READER_FONT_SIZE,
  MIN_READER_FONT_SIZE,
} from '@/lib/reader-font-size'

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`${name} gagal${detail ? `: ${JSON.stringify(detail)}` : ''}`)
  console.log(`[ux-batch-b] ${name}: OK`)
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const payload: OnboardingDraftPayload = {
  premise: {
    title: 'Jejak Uji',
    tagline: 'Tagline',
    role: 'Tokoh uji',
    synopsis: 'Sinopsis uji',
    tropes: ['uji'],
  },
  cast: {
    characters: [
      {
      canonicalName: 'Rani',
      role: 'protagonis',
      motivation: 'Menguji alur',
      introducedChapter: 1,
      aliases: [],
      voice: {
        register: 'hangat',
        speechHabits: [],
        forbiddenWords: [],
        sampleLines: ['Aku siap menguji alur ini.'],
      },
    },
      {
      canonicalName: 'Dimas',
      role: 'sekutu',
      motivation: 'Membantu',
      introducedChapter: 2,
      aliases: [],
      voice: {
        register: 'tenang',
        speechHabits: [],
        forbiddenWords: [],
        sampleLines: ['Kita simpan ini dulu.'],
      },
    },
      {
      canonicalName: 'Ratna',
      role: 'antagonis',
      motivation: 'Menahan rahasia',
      introducedChapter: 1,
      aliases: [],
      voice: {
        register: 'dingin',
        speechHabits: [],
        forbiddenWords: [],
        sampleLines: ['Tidak semua hal perlu kau tahu.'],
      },
    },
    ],
  },
  mystery: {
    mainMystery: {
      title: 'Siapa yang menyembunyikan draft?',
      payoffWindow: 45,
    },
    secrets: [
      {
        description: 'Draft tersimpan lokal',
        revealGateChapter: 12,
      },
      {
        description: 'Login mengunci cerita ke akun',
        revealGateChapter: 20,
      },
    ],
  },
  world: {
    threads: [
      {
        title: 'Draft tersimpan',
        openedChapter: 1,
        payoffWindow: 12,
      },
    ],
    facts: [
      {
        statement: 'Draft dibuat sebelum login',
        subjectName: 'Rani',
        establishedChapter: 1,
        salience: 0.8,
        loadBearing: true,
      },
      {
        statement: 'Login diperlukan sebelum persist',
        subjectName: null,
        establishedChapter: 1,
        salience: 0.8,
        loadBearing: true,
      },
      {
        statement: 'Stash tidak menyimpan kredensial',
        subjectName: null,
        establishedChapter: 1,
        salience: 0.5,
        loadBearing: false,
      },
    ],
  },
  answers: { trope: 'uji' },
}

const now = 1_000
const storage = new MemoryStorage()
const record = createOnboardingDraftStashRecord(payload, now)

check('draft stash punya expiry masa depan', record.expiresAt > now)
check('draft stash tidak menyimpan email', !JSON.stringify(record).includes('@'))

saveOnboardingDraftStash(storage, payload, now)
check('draft stash valid bisa dibaca', readOnboardingDraftStash(storage, now)?.premise.title === 'Jejak Uji')
check('draft stash expired diabaikan', readOnboardingDraftStash(storage, record.expiresAt + 1) === null)
clearOnboardingDraftStash(storage)
check('draft stash cleanup', readOnboardingDraftStash(storage, now) === null)

check('font default 17', DEFAULT_READER_FONT_SIZE === 17)
check('font min 16', MIN_READER_FONT_SIZE === 16)
check('font max 22', MAX_READER_FONT_SIZE === 22)
check('font clamp bawah', clampReaderFontSize(8) === MIN_READER_FONT_SIZE)
check('font clamp atas', clampReaderFontSize(99) === MAX_READER_FONT_SIZE)
