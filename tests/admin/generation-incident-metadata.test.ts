import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  GenerationIncidentMetadataLookupSchema,
  findGenerationIncidentMetadata,
} from '@/lib/admin/generation-incident-metadata.server'

const INPUT = {
  storyId: 'jejak-yang-terlupakan-lyht91',
  chapterNumber: 1,
  from: '2026-07-31T10:00:00.000Z',
  to: '2026-07-31T10:20:00.000Z',
} as const

const ROW = {
  capture_id: '11111111-1111-4111-8111-111111111111',
  correlation_id: '22222222-2222-4222-8222-222222222222',
} as const

describe('generation incident metadata discovery', () => {
  it.each([
    { ...INPUT, chapterNumber: 50 },
    { ...INPUT, storyId: ` ${INPUT.storyId}` },
    { ...INPUT, storyId: `${INPUT.storyId} ` },
    { ...INPUT, storyId: '   ' },
  ])('rejects invalid lookup before RPC', async (lookup) => {
    const rpc = vi.fn()
    expect(() => GenerationIncidentMetadataLookupSchema.parse(lookup)).toThrow()
    await expect(findGenerationIncidentMetadata(lookup, { client: { rpc } })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns only capture and correlation IDs from exact RPC', async () => {
    const rpc = vi.fn(async () => ({ data: [ROW], error: null }))
    await expect(findGenerationIncidentMetadata(INPUT, { client: { rpc } })).resolves.toEqual({
      status: 'found',
      captureId: ROW.capture_id,
      correlationId: ROW.correlation_id,
    })
    expect(rpc).toHaveBeenCalledWith('find_generation_incident_metadata_v1', {
      p_story_id: INPUT.storyId,
      p_chapter_number: INPUT.chapterNumber,
      p_from: INPUT.from,
      p_to: INPUT.to,
    })
  })

  it('maps empty, multiple, malformed, owner denial, and RPC failures safely', async () => {
    await expect(findGenerationIncidentMetadata(INPUT, {
      client: { rpc: vi.fn(async () => ({ data: [], error: null })) },
    })).resolves.toEqual({ status: 'not_found' })

    await expect(findGenerationIncidentMetadata(INPUT, {
      client: { rpc: vi.fn(async () => ({ data: [ROW, ROW], error: null })) },
    })).resolves.toEqual({ status: 'unavailable' })

    await expect(findGenerationIncidentMetadata(INPUT, {
      client: { rpc: vi.fn(async () => ({ data: [{ ...ROW, ciphertext: 'secret' }], error: null })) },
    })).resolves.toEqual({ status: 'unavailable' })

    await expect(findGenerationIncidentMetadata(INPUT, {
      client: { rpc: vi.fn(async () => ({ data: null, error: { message: 'OWNER_REQUIRED' } })) },
    })).resolves.toEqual({ status: 'forbidden' })

    await expect(findGenerationIncidentMetadata(INPUT, {
      client: { rpc: vi.fn(async () => { throw new Error('db unavailable') }) },
    })).resolves.toEqual({ status: 'unavailable' })
  })
})
