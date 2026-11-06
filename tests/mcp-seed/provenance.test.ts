import { describe, expect, it } from 'vitest'
import { resolveCatalogSource } from '@/lib/catalog/catalog-source'

describe('resolveCatalogSource', () => {
  it('default cli saat tidak diberikan', () => {
    expect(resolveCatalogSource(undefined)).toBe('cli')
    expect(resolveCatalogSource(null)).toBe('cli')
  })
  it('menerima gemini-agent', () => {
    expect(resolveCatalogSource('gemini-agent')).toBe('gemini-agent')
  })
  it('menerima cli', () => {
    expect(resolveCatalogSource('cli')).toBe('cli')
  })
  it('menolak nilai asing', () => {
    expect(() => resolveCatalogSource('hacker')).toThrow(/CATALOG_SOURCE_INVALID/)
  })
})
