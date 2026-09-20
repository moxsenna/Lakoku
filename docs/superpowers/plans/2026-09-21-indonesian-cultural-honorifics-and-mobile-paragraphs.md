# Indonesian Cultural Honorifics & Mobile Paragraph Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghadirkan sapaan kekerabatan/honorifik Indonesia (Bapak/Ibu, Kak, Mas, Mbak, Dek, Sayang, Beb) yang alami dalam prosa novel interaktif, mengisolasi aturan kultural khusus untuk `language === 'id'`, serta menerapkan pemecah paragraf deterministik untuk keterbacaan mobile tanpa kehilangan kata.

**Architecture:**
1. Ekstraksi modul kultural bahasa `lib/prose/cultural-conventions.ts` yang memetakan relasi karakter (Ayah, Ibu, Kakak, Pasangan, dll.) ke honorifik sah dan menghasilkan direktif sapaan khusus bahasa Indonesia (`id`).
2. Integrasi ke prompt engine `build-writer-prompt.ts`: memperbarui P0 (memasukkan nama + peran + sapaan sah tanpa bentrok dengan larangan nama baru), P4 (suntik direktif kultural Indonesia), dan P3/P5 (menegaskan aturan keras 1–2 kalimat per blok paragraf dan dialog mandiri).
3. Modul pemecah paragraf deterministik `lib/prose/mobile-paragraph-splitter.ts` yang disematkan pada fungsi ingestion `parseChapterWriterProse` di `lib/ai-gateway/chapter-writer-contract.ts` untuk memecah dinding teks >2 kalimat dan memisahkan dialog yang menempel.

**Tech Stack:** TypeScript strict mode, Next.js App Router, Vitest.

## Global Constraints
- Language Scoping: Aturan sapaan kultural Indonesia HANYA disuntikkan bila `language === 'id'`. Jika `language === 'en'`, direktif kultural kosong dan tidak mengganggu ekspansi global.
- Zero Word Loss: Pemecah paragraf deterministik TIDAK BOLEH memotong, mengubah, atau menghilangkan kata apa pun (`countWords(before) === countWords(after)`).
- Strict Canon Invariant: Honorifik yang sah diakui di P0 sebagai sebutan resmi tokoh kanonik bersangkutan, bukan tokoh baru.
- Word Target Invariant: Tetap mematuhi batas keras 800–1000 kata.

---

### Task 1: Modul Kultural Bahasa & Deskriptor Karakter (`cultural-conventions.ts`)

**Files:**
- Create: `lib/prose/cultural-conventions.ts`
- Test: `tests/prose/cultural-conventions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SupportedLanguage = 'id' | 'en'

  export interface CharacterDescriptor {
    name: string
    role?: string
    relation?: string
    honorifics?: string[]
  }

  export function buildCharacterDescriptors(
    characters: Array<{ id?: string; canonicalName: string; role?: string }>,
    aliases?: Array<{ characterId?: string; alias: string; aliasType: string }>,
    language?: SupportedLanguage,
  ): CharacterDescriptor[]

  export function buildCulturalHonorificDirectives(
    descriptors: CharacterDescriptor[],
    language?: SupportedLanguage,
  ): string
  ```

- [ ] **Step 1: Write the failing test**

Buat file `tests/prose/cultural-conventions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  buildCharacterDescriptors,
  buildCulturalHonorificDirectives,
} from '@/lib/prose/cultural-conventions'

describe('cultural-conventions', () => {
  it('maps Indonesian parental roles to appropriate honorifics', () => {
    const characters = [
      { id: 'c1', canonicalName: 'Ragil', role: 'Ayah kandung tokoh utama' },
      { id: 'c2', canonicalName: 'Siti', role: 'Ibu tiri' },
    ]
    const descriptors = buildCharacterDescriptors(characters, [], 'id')
    expect(descriptors).toHaveLength(2)
    expect(descriptors[0].honorifics).toEqual(expect.arrayContaining(['Bapak', 'Pak', 'Ayah']))
    expect(descriptors[1].honorifics).toEqual(expect.arrayContaining(['Ibu', 'Bu']))
  })

  it('maps Indonesian siblings and romantic partners', () => {
    const characters = [
      { id: 'c1', canonicalName: 'Bima', role: 'Kakak laki-laki' },
      { id: 'c2', canonicalName: 'Nadia', role: 'Istri tokoh utama' },
    ]
    const aliases = [
      { characterId: 'c2', alias: 'Sayang', aliasType: 'RELATION' },
    ]
    const descriptors = buildCharacterDescriptors(characters, aliases, 'id')
    expect(descriptors[0].honorifics).toEqual(expect.arrayContaining(['Mas', 'Kak']))
    expect(descriptors[1].honorifics).toEqual(expect.arrayContaining(['Nadia', 'Sayang']))
  })

  it('generates cultural directives when language is id', () => {
    const characters = [
      { id: 'c1', canonicalName: 'Ragil', role: 'Ayah' },
    ]
    const descriptors = buildCharacterDescriptors(characters, [], 'id')
    const directive = buildCulturalHonorificDirectives(descriptors, 'id')
    expect(directive).toContain('Tata Krama Sapaan Kultural Indonesia')
    expect(directive).toContain('Bapak / Ibu / Ayah')
    expect(directive).toContain('DILARANG menyebut nama telanjang')
  })

  it('returns empty directives when language is en', () => {
    const characters = [
      { id: 'c1', canonicalName: 'Ragil', role: 'Father' },
    ]
    const descriptors = buildCharacterDescriptors(characters, [], 'en')
    const directive = buildCulturalHonorificDirectives(descriptors, 'en')
    expect(directive).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prose/cultural-conventions.test.ts`
Expected: FAIL ("Cannot find module '@/lib/prose/cultural-conventions'")

- [ ] **Step 3: Write minimal implementation**

Buat file `lib/prose/cultural-conventions.ts`:
```ts
export type SupportedLanguage = 'id' | 'en'

export interface CharacterDescriptor {
  name: string
  role?: string
  relation?: string
  honorifics?: string[]
}

const PARENT_FATHER_REGEX = /\b(ayah|bapak|papa|papi|romow|abi)\b/i
const PARENT_MOTHER_REGEX = /\b(ibu|mama|mami|bunda|umi)\b/i
const SIBLING_OLDER_MALE_REGEX = /\b(kakak laki|abang|mas)\b/i
const SIBLING_OLDER_FEMALE_REGEX = /\b(kakak perempuan|mbak|teteh|uni)\b/i
const SIBLING_OLDER_GENERIC_REGEX = /\b(kakak|abang|mas|mbak)\b/i
const SIBLING_YOUNGER_REGEX = /\b(adik|adek|dek)\b/i
const PARTNER_REGEX = /\b(suami|istri|kekasih|pacar|tunangan|pasangan)\b/i

export function buildCharacterDescriptors(
  characters: Array<{ id?: string; canonicalName: string; role?: string }>,
  aliases: Array<{ characterId?: string; alias: string; aliasType: string }> = [],
  language: SupportedLanguage = 'id',
): CharacterDescriptor[] {
  return characters.map((c) => {
    const name = c.canonicalName.trim()
    const role = c.role?.trim() || ''
    const charAliases = aliases
      .filter((a) => (!a.characterId || a.characterId === c.id) && a.alias.trim() !== name)
      .map((a) => a.alias.trim())

    const honorificsSet = new Set<string>()

    if (language === 'id' && role) {
      if (PARENT_FATHER_REGEX.test(role)) {
        honorificsSet.add('Bapak')
        honorificsSet.add('Pak')
        honorificsSet.add('Ayah')
      } else if (PARENT_MOTHER_REGEX.test(role)) {
        honorificsSet.add('Ibu')
        honorificsSet.add('Bu')
        honorificsSet.add('Mama')
      } else if (SIBLING_OLDER_MALE_REGEX.test(role)) {
        honorificsSet.add('Mas')
        honorificsSet.add('Kak')
        honorificsSet.add('Bang')
      } else if (SIBLING_OLDER_FEMALE_REGEX.test(role)) {
        honorificsSet.add('Mbak')
        honorificsSet.add('Kak')
      } else if (SIBLING_OLDER_GENERIC_REGEX.test(role)) {
        honorificsSet.add('Kak')
      } else if (SIBLING_YOUNGER_REGEX.test(role)) {
        honorificsSet.add('Dek')
        honorificsSet.add('Adik')
      }

      if (PARTNER_REGEX.test(role)) {
        honorificsSet.add(name)
        honorificsSet.add('Sayang')
        honorificsSet.add('Say')
        honorificsSet.add('Dek')
        honorificsSet.add('Mas')
      }
    }

    for (const alias of charAliases) {
      honorificsSet.add(alias)
    }

    return {
      name,
      role: role || undefined,
      relation: role || undefined,
      honorifics: honorificsSet.size > 0 ? [...honorificsSet] : undefined,
    }
  })
}

export function buildCulturalHonorificDirectives(
  descriptors: CharacterDescriptor[],
  language: SupportedLanguage = 'id',
): string {
  if (language !== 'id') return ''

  const lines: string[] = [
    '=== TATA KRAMA SAPAAN KULTURAL INDONESIA (MANDATORI) ===',
    '- Sudut Pandang "Aku" Terhadap Figur Orang Tua / Generasi Atas:',
    '  * WAJIB menyebut dan menyapa tokoh ayah/ibu dengan panggilan hormat ("Bapak", "Pak", "Ayah", "Ibu", "Bu", "Mama"), baik dalam dialog langsung maupun dalam narasi batin/kalimat cerita.',
    '  * DILARANG menyebut nama telanjang untuk orang tua (CONTOH SALAH: "Ragil melangkah masuk...", "ucap Ragil"; CONTOH BENAR: "Bapak melangkah masuk...", "ucap Bapak").',
    '- Panggilan Kekerabatan & Usia:',
    '  * Gunakan sapaan "Kak", "Mas", "Mbak", atau "Bang" untuk tokoh yang lebih tua/dihormati secara wajar sebelum nama atau mandiri (mis. "Mas Bima", "ucap Kak Nadia").',
    '  * Untuk adik/tokoh lebih muda yang akrab, gunakan "Dek" atau nama panggilan.',
    '- Panggilan Pasangan / Romansa:',
    '  * Antara suami-istri atau pasangan kekasih, gunakan panggilan akrab dan sayang secara alami ("Sayang", "Mas", "Dek", "Beb") sesuai dinamika cerita, hindari kekakuan nama formal.',
  ]

  const specificRules: string[] = []
  for (const d of descriptors) {
    if (d.honorifics && d.honorifics.length > 0) {
      specificRules.push(`- Tokoh ${d.name}${d.role ? ` (${d.role})` : ''}: Sapaan sah meliputi ${d.honorifics.join(', ')}.`)
    }
  }

  if (specificRules.length > 0) {
    lines.push('- Panduan Sapaan Spesifik Tokoh Bab Ini:')
    lines.push(...specificRules)
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prose/cultural-conventions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prose/cultural-conventions.ts tests/prose/cultural-conventions.test.ts
git commit -m "feat(prose): add cultural conventions and character honorifics module"
```

---

### Task 2: Modul Pemecah Paragraf Deterministik (`mobile-paragraph-splitter.ts`)

**Files:**
- Create: `lib/prose/mobile-paragraph-splitter.ts`
- Test: `tests/prose/mobile-paragraph-splitter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function splitParagraphsForMobile(paragraphs: readonly string[]): string[]
  ```

- [ ] **Step 1: Write the failing test**

Buat file `tests/prose/mobile-paragraph-splitter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { splitParagraphsForMobile } from '@/lib/prose/mobile-paragraph-splitter'
import { countParagraphWords } from '@/lib/prose/clamp-chapter-prose'

describe('mobile-paragraph-splitter', () => {
  it('splits long narrative paragraphs exceeding 2 sentences', () => {
    const input = [
      'Kalimat pertama berjalan di sini. Kalimat kedua menyusul dengan cepat. Kalimat ketiga mulai membuat paragraf terlalu padat. Kalimat keempat harusnya berada di blok baru. Kalimat kelima menutup adegan.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output.length).toBeGreaterThan(1)
    // Every block should have at most 2 sentences
    for (const block of output) {
      const sentences = block.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g) || []
      expect(sentences.length).toBeLessThanOrEqual(2)
    }
  })

  it('keeps short paragraphs (<= 2 sentences) intact', () => {
    const input = [
      'Hujan turun deras di luar jendela. Udara dingin merayap masuk.',
      '"Kamu yakin mau pergi sekarang?" tanya Bapak.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output).toEqual(input)
  })

  it('isolates dialogue lines stuck in narrative', () => {
    const input = [
      'Aku menatap pintu yang terbuka perlahan. "Siapa di sana?" tanyaku gemetar. Langkah kaki terdengar mendekat.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output.length).toBe(3)
    expect(output[0]).toBe('Aku menatap pintu yang terbuka perlahan.')
    expect(output[1]).toBe('"Siapa di sana?" tanyaku gemetar.')
    expect(output[2]).toBe('Langkah kaki terdengar mendekat.')
  })

  it('preserves exact word count with zero word loss', () => {
    const input = [
      'Paragraf ini cukup panjang dan memuat banyak sekali informasi penting. Kalimat kedua menambahkan rincian yang tak kalah berbobot. Kalimat ketiga mengunci perhatian pembaca pada detail meja kerja. Kalimat keempat menutup pengamatan dengan helaan napas panjang.',
      '"Bapak sudah menunggu sejak tadi," ucap Nadia lirih. Tatapannya tertuju pada amplop cokelat di sudut ruangan. "Sebaiknya kamu buka sekarang."',
    ]
    const output = splitParagraphsForMobile(input)
    expect(countParagraphWords(output)).toBe(countParagraphWords(input))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prose/mobile-paragraph-splitter.test.ts`
Expected: FAIL ("Cannot find module '@/lib/prose/mobile-paragraph-splitter'")

- [ ] **Step 3: Write minimal implementation**

Buat file `lib/prose/mobile-paragraph-splitter.ts`:
```ts
/**
 * Deterministic Mobile Paragraph Splitter for Lakoku Reader.
 *
 * Rules:
 * 1. Chunks narrative into at most 2 sentences per paragraph block.
 * 2. Dialogue lines (starting with quotes) stand alone as independent paragraphs.
 * 3. ZERO WORD LOSS: Total words before and after split are 100% identical.
 */

function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g)
  if (!matches) return [paragraph]
  return matches.map((s) => s.trim()).filter(Boolean)
}

function isDialogueSentence(sentence: string): boolean {
  return /^[“"']/.test(sentence.trim())
}

export function splitParagraphsForMobile(paragraphs: readonly string[]): string[] {
  const result: string[] = []

  for (const rawParagraph of paragraphs) {
    const trimmed = rawParagraph.trim()
    if (!trimmed) continue

    const sentences = splitSentences(trimmed)
    if (sentences.length <= 2 && !sentences.some(isDialogueSentence)) {
      result.push(trimmed)
      continue
    }

    let currentChunk: string[] = []

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const isDialogue = isDialogueSentence(sentence)

      if (isDialogue) {
        if (currentChunk.length > 0) {
          result.push(currentChunk.join(' '))
          currentChunk = []
        }
        result.push(sentence)
        continue
      }

      currentChunk.push(sentence)
      if (currentChunk.length >= 2) {
        result.push(currentChunk.join(' '))
        currentChunk = []
      }
    }

    if (currentChunk.length > 0) {
      result.push(currentChunk.join(' '))
    }
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prose/mobile-paragraph-splitter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prose/mobile-paragraph-splitter.ts tests/prose/mobile-paragraph-splitter.test.ts
git commit -m "feat(prose): add deterministic mobile paragraph splitter"
```

---

### Task 3: Integrasi ke Ingestion Pipeline (`parseChapterWriterProse`)

**Files:**
- Modify: `lib/ai-gateway/chapter-writer-contract.ts`
- Create: `tests/ai-gateway/chapter-writer-prose-parser.test.ts`

**Interfaces:**
- Consumes: `splitParagraphsForMobile` from `lib/prose/mobile-paragraph-splitter.ts`
- Modifies: `parseChapterWriterProse(text: string): ParsedChapterWriterProse`

- [ ] **Step 1: Write the failing test**

Buat file `tests/ai-gateway/chapter-writer-prose-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseChapterWriterProse } from '@/lib/ai-gateway/chapter-writer-contract'

describe('parseChapterWriterProse mobile paragraph integration', () => {
  it('parses title and splits bulky narrative paragraphs automatically', () => {
    const raw = [
      'JUDUL: Bayang-Bayang Senja',
      '',
      'Matahari mulai tenggelam di ufuk barat. Angin sore bertiup cukup kencang. Debu jalanan beterbangan menyapu dedaunan kering. Aku merapatkan jaket hitamku.',
    ].join('\n')

    const parsed = parseChapterWriterProse(raw)
    expect(parsed.title).toBe('Bayang-Bayang Senja')
    expect(parsed.hasExplicitTitle).toBe(true)
    expect(parsed.paragraphs.length).toBe(2)
    expect(parsed.paragraphs[0]).toBe('Matahari mulai tenggelam di ufuk barat. Angin sore bertiup cukup kencang.')
    expect(parsed.paragraphs[1]).toBe('Debu jalanan beterbangan menyapu dedaunan kering. Aku merapatkan jaket hitamku.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/ai-gateway/chapter-writer-prose-parser.test.ts`
Expected: FAIL (`parsed.paragraphs.length` is 1, expected 2)

- [ ] **Step 3: Modify `lib/ai-gateway/chapter-writer-contract.ts`**

Import `splitParagraphsForMobile` di `lib/ai-gateway/chapter-writer-contract.ts`:
```ts
import { splitParagraphsForMobile } from '@/lib/prose/mobile-paragraph-splitter'
```

Pada fungsi `parseChapterWriterProse`:
```ts
  const rawParagraphs = blocks
    .flatMap((block) => block.split(/\n+/))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const paragraphs = splitParagraphsForMobile(rawParagraphs)

  if (!title) title = 'Tanpa Judul'
  return { title, paragraphs, hasExplicitTitle }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/ai-gateway/chapter-writer-prose-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai-gateway/chapter-writer-contract.ts tests/ai-gateway/chapter-writer-prose-parser.test.ts
git commit -m "feat(ai-gateway): integrate mobile paragraph splitter into parseChapterWriterProse"
```

---

### Task 4: Integrasi Prompt Engine (`build-writer-prompt.ts` & `types.ts`)

**Files:**
- Modify: `lib/prose/prompt-engine/types.ts`
- Modify: `lib/prose/prompt-engine/build-writer-prompt.ts`
- Modify: `lib/ai-gateway/chapter-writer-contract.ts`
- Test: `tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`

**Interfaces:**
- Consumes: `CharacterDescriptor`, `SupportedLanguage`, `buildCharacterDescriptors`, `buildCulturalHonorificDirectives` from `lib/prose/cultural-conventions.ts`
- Updates `BuildWriterPromptInput`:
  ```ts
  characterDescriptors?: CharacterDescriptor[]
  language?: SupportedLanguage
  ```

- [ ] **Step 1: Write the failing test**

Tambahkan uji coba sapaan dan ritme paragraf pada `tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`:
```ts
  it('includes character role and valid honorifics in P0 and P4 when language is id', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      language: 'id',
      characterDescriptors: [
        {
          name: 'Ragil',
          role: 'Ayah kandung',
          honorifics: ['Bapak', 'Pak', 'Ayah'],
        },
      ],
    })

    expect(prompt.user).toContain('Ragil (Peran: Ayah kandung, sapaan sah: Bapak / Pak / Ayah)')
    expect(prompt.user).toContain('Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan')
    expect(prompt.user).toContain('TATA KRAMA SAPAAN KULTURAL INDONESIA')
    expect(prompt.user).toContain('DILARANG menyebut nama telanjang untuk orang tua')
  })

  it('omits Indonesian cultural directives when language is en', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      language: 'en',
      characterDescriptors: [
        {
          name: 'Ragil',
          role: 'Father',
        },
      ],
    })

    expect(prompt.user).not.toContain('TATA KRAMA SAPAAN KULTURAL INDONESIA')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `types.ts` & `build-writer-prompt.ts`**

Di `lib/prose/prompt-engine/types.ts`:
```ts
import type { CharacterDescriptor, SupportedLanguage } from '../cultural-conventions'

export interface BuildWriterPromptInput {
  // ...
  characterNames?: string[]
  characterDescriptors?: CharacterDescriptor[]
  language?: SupportedLanguage
  // ...
}
```

Di `lib/prose/prompt-engine/build-writer-prompt.ts`:
1. Import helper:
```ts
import {
  buildCulturalHonorificDirectives,
  type CharacterDescriptor,
  type SupportedLanguage,
} from '@/lib/prose/cultural-conventions'
```
2. Di `buildChapterBriefV2Prompt`:
- Ambil `language = input.language ?? 'id'`.
- Susun presentasi tokoh di P0:
```ts
  const descriptors = input.characterDescriptors ?? (input.characterNames ?? []).map((name) => ({ name }))
  const characterDisplayList = descriptors.map((d) => {
    const parts = [safe(d.name)]
    if (d.role) parts.push(`Peran: ${safe(d.role)}`)
    if (d.honorifics && d.honorifics.length > 0) parts.push(`sapaan sah: ${d.honorifics.map(safe).join(' / ')}`)
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]
  })

  const p0 = [
    '=== [P0] INVARIAN CANON & KEAMANAN (MANDATORI / HARUS DIPATUHI) ===',
    characterDisplayList.length > 0 ? `- Tokoh yang boleh tampil: ${characterDisplayList.join('; ')}.` : '',
    '- DILARANG memunculkan tokoh bernama baru yang tidak ada dalam daftar di atas.',
    language === 'id' ? '- Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan, BUKAN tokoh baru.' : '',
    brief.mustNotReveal.length > 0
      ? '- RAHASIA DILARANG UNTUK DIUNGKAP/DIBOCORKAN:'
      : '',
    ...lines(brief.mustNotReveal),
    '- DILARANG membocorkan istilah teknis atau metadata internal.',
  ].filter(Boolean).join('\n')
```
3. Perbarui P3 & P5 untuk ketegasan paragraf mobile:
- Di P3:
```ts
    '- Batas Keras Paragraf Mobile: Setiap paragraf narasi HANYA boleh berisi 1–2 kalimat pendek (maksimal 25–30 kata per paragraf).',
    '- DILARANG menumpuk 3 kalimat atau lebih dalam 1 blok narasi.',
    '- Dialog Mandiri Mutlak: Satu baris dialog tokoh WAJIB berdiri sendiri dalam 1 paragraf terpisah (tidak boleh digabung narasi panjang).',
```
- Di P4:
```ts
  const culturalDirective = buildCulturalHonorificDirectives(descriptors, language)
  const p4 = [
    '=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===',
    '- Pertahankan sudut pandang orang pertama ("aku") secara konsisten.',
    input.voiceGuidance ? `- Panduan Suara Karakter:\n${safe(input.voiceGuidance)}` : '',
    culturalDirective ? safe(culturalDirective) : '',
    genreDirective ? safe(genreDirective) : '',
    // ...
  ].filter(Boolean).join('\n')
```

Di `lib/ai-gateway/chapter-writer-contract.ts`:
- Di `buildProductionChapterWriterPrompt`:
  Bangun deskriptor dari snapshot:
  ```ts
  const activeChars = snapshot.characters.filter((c) => c.status !== 'DEAD' && c.introducedChapter <= chapter)
  const descriptors = buildCharacterDescriptors(activeChars, snapshot.aliases, 'id')
  ```
  Teruskan `characterDescriptors: descriptors` dan `language: 'id'` ke `buildWriterPrompt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prose/prompt-engine/ lib/ai-gateway/chapter-writer-contract.ts tests/prose/prompt-engine/writer-prompt-architecture-v2.test.ts
git commit -m "feat(prose): integrate cultural honorifics and mobile rhythm into writer prompt engine"
```

---

### Task 5: Verifikasi Menyeluruh & Gates Suite

**Files:**
- Test: All touched files and regression tests

- [ ] **Step 1: Jalankan typecheck**
Run: `pnpm typecheck`
Expected: Exit 0 tanpa error

- [ ] **Step 2: Jalankan unit test prose & ai-gateway**
Run: `pnpm vitest run tests/prose tests/ai-gateway`
Expected: All tests pass

- [ ] **Step 3: Jalankan seluruh test unit**
Run: `pnpm test:unit`
Expected: Semua unit test lolos

- [ ] **Step 4: Commit hasil verifikasi jika ada perubahan**
```bash
git status
```
