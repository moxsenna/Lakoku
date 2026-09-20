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
