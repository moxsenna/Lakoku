import { describe, expect, it } from 'vitest'
import { parseToolArguments, toolInputSchema } from '@/lib/mcp-seed/tools.server'

describe('parseToolArguments', () => {
  it('seed_assign_novel wajib genre, judul, premis, protagonis', () => {
    const schema = toolInputSchema('seed_assign_novel')
    const out = schema.parse({ genre: 'misteri', judul: 'Kamar 304', premis: 'Sebuah kamar berbisik.', protagonis: 'Laras' })
    expect(out.judul).toBe('Kamar 304')
    expect(() => schema.parse({ genre: 'misteri' })).toThrow()
    expect(parseToolArguments('seed_assign_novel', { genre: 'misteri', judul: 'Kamar 304', premis: 'Sebuah kamar berbisik.', protagonis: 'Laras' })).toEqual(out)
  })

  it('seed_submit_unit wajib novel_id, unit_index 0-61, prose_markdown', () => {
    const schema = toolInputSchema('seed_submit_unit')
    const sampleProse = '# Judul Bab\n\n' + 'Paragraf cerita ini cukup panjang untuk memenuhi batas minimum dua ratus karakter skema validasi. '.repeat(3)
    const out = schema.parse({ novel_id: 'catalog:x', unit_index: 5, prose_markdown: sampleProse })
    expect(out.unit_index).toBe(5)
    expect(() => schema.parse({ novel_id: 'catalog:x', unit_index: 62, prose_markdown: sampleProse })).toThrow()
    expect(() => schema.parse({ novel_id: 'catalog:x', unit_index: 5, prose_markdown: 'Terlalu pendek' })).toThrow()
  })

  it('seed_get_unit_spec unit_index opsional', () => {
    const schema = toolInputSchema('seed_get_unit_spec')
    expect(schema.parse({ novel_id: 'catalog:x' }).unit_index).toBeUndefined()
  })
})
