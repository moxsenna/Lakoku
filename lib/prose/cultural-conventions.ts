export type SupportedLanguage = 'id' | 'en'

export interface CharacterDescriptor {
  name: string
  role?: string
  relation?: string
  honorifics?: string[]
}

const PARENT_FATHER_REGEX = /\b(ayah|bapak|papa|papi|romo|abi)\b/i
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
    '=== Tata Krama Sapaan Kultural Indonesia (MANDATORI) ===',
    '- Sudut Pandang "Aku" Terhadap Figur Orang Tua / Generasi Atas:',
    '  * WAJIB menyebut dan menyapa tokoh ayah/ibu dengan panggilan hormat (Bapak / Ibu / Ayah, Pak, Bu, Mama), baik dalam dialog langsung maupun dalam narasi batin/kalimat cerita.',
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
