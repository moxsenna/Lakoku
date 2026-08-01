import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  retrieveGenerationIncidentLabel,
  type EncryptedGenerationIncident,
} from '@/lib/admin/generation-incident-retrieval.server'

const incident: EncryptedGenerationIncident = {
  capture_id: '82000000-0000-4000-8000-000000000001',
  correlation_id: '83000000-0000-4000-8000-000000000001',
  incident_key: 'a'.repeat(44),
  label_fingerprint: 'b'.repeat(44),
  version: 1,
  story_id: 'story-incident-a',
  chapter_number: 7,
  choice_index: 0,
  stage: 'FINAL_BRANCH_SCHEMA',
  code: 'CHOICE_NOT_ACTIONABLE',
  expires_at: '2026-07-31T01:00:00.000Z',
  ciphertext: 'Y2lwaGVydGV4dA==',
  nonce: 'bm9uY2UxMjM0NTY=',
  auth_tag: 'YXV0aHRhZzEyMzQ1Ng==',
}

const lookup = {
  captureId: incident.capture_id,
  correlationId: incident.correlation_id,
}

describe('retrieveGenerationIncidentLabel', () => {
  it('uses cookie-scoped consume RPC and returns only decrypted label', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [incident], error: null })
    const decryptLabel = vi.fn().mockResolvedValue('Buka pintu terkunci')

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      decryptor: { decryptLabel },
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })

    expect(rpc).toHaveBeenCalledWith('consume_generation_incident_v1', {
      p_capture_id: lookup.captureId,
      p_correlation_id: lookup.correlationId,
    })
    expect(decryptLabel).toHaveBeenCalledWith(incident)
  })

  it('maps empty atomic consume to not found', async () => {
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc: async () => ({ data: [], error: null }) },
      decryptor: { decryptLabel: vi.fn() },
    })).resolves.toEqual({ status: 'not_found' })
  })

  it('maps exact DB owner denial to forbidden', async () => {
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: {
        rpc: async () => ({ data: null, error: { message: 'OWNER_REQUIRED' } }),
      },
    })).resolves.toEqual({ status: 'forbidden' })
  })

  it('fails closed when decryptor integration is unavailable', async () => {
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc: async () => ({ data: [incident], error: null }) },
    })).resolves.toEqual({ status: 'unavailable' })
  })

  it('rejects plaintext or generic fields in DB response', async () => {
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: {
        rpc: async () => ({
          data: [{ ...incident, label: 'plaintext must not pass' }],
          error: null,
        }),
      },
      decryptor: { decryptLabel: vi.fn() },
    })).resolves.toEqual({ status: 'unavailable' })
  })

  it('rejects decrypted labels outside bounded reader label contract', async () => {
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc: async () => ({ data: [incident], error: null }) },
      decryptor: { decryptLabel: async () => 'x'.repeat(91) },
    })).resolves.toEqual({ status: 'unavailable' })
  })
})
