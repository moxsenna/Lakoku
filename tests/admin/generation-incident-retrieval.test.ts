import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  retrieveGenerationIncidentLabel,
  type EncryptedGenerationIncident,
} from '@/lib/admin/generation-incident-retrieval.server'

const claimToken = '84000000-0000-4000-8000-000000000001'
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
const claimedIncident = {
  ...incident,
  claim_expires_at: '2026-07-31T00:02:00.000Z',
}

const lookup = {
  captureId: incident.capture_id,
  correlationId: incident.correlation_id,
}

const lookupArgs = {
  p_capture_id: lookup.captureId,
  p_correlation_id: lookup.correlationId,
}
const claimedMutationArgs = {
  ...lookupArgs,
  p_claim_token: claimToken,
}

describe('retrieveGenerationIncidentLabel', () => {
  it('claims, decrypts, then finalizes exactly once before returning label', async () => {
    const events: string[] = []
    const rpc = vi.fn(async (name: string) => {
      events.push(name)
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'finalize_generation_incident_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })
    const decryptLabel = vi.fn(async () => {
      events.push('decrypt')
      return 'Buka pintu terkunci'
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel },
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })

    expect(events).toEqual([
      'claim_generation_incident_v1',
      'decrypt',
      'finalize_generation_incident_v1',
    ])
    expect(rpc).toHaveBeenCalledWith('claim_generation_incident_v1', claimedMutationArgs)
    expect(rpc).toHaveBeenCalledWith('finalize_generation_incident_v1', claimedMutationArgs)
    expect(rpc.mock.calls.filter(([name]) => name === 'finalize_generation_incident_v1')).toHaveLength(1)
    expect(decryptLabel).toHaveBeenCalledWith(incident)
  })

  it('releases wrong-key or tampered decrypt failure so a later attempt can retry', async () => {
    let claimed = false
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        if (claimed) return { data: [], error: null }
        claimed = true
        return { data: [claimedIncident], error: null }
      }
      if (name === 'release_generation_incident_claim_v1') {
        claimed = false
        return { data: true, error: null }
      }
      if (name === 'finalize_generation_incident_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })
    const decryptLabel = vi.fn()
      .mockRejectedValueOnce(new Error('GENERATION_INCIDENT_DECRYPT_FAILED'))
      .mockResolvedValueOnce('Buka pintu terkunci')

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel },
    })).resolves.toEqual({ status: 'unavailable' })
    expect(rpc).toHaveBeenCalledWith('release_generation_incident_claim_v1', claimedMutationArgs)

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel },
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })
    expect(decryptLabel).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.filter(([name]) => name === 'finalize_generation_incident_v1')).toHaveLength(1)
  })

  it('returns no label and best-effort releases when finalize fails', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'finalize_generation_incident_v1') {
        return { data: null, error: { message: 'FINALIZE_FAILED' } }
      }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => 'Buka pintu terkunci' },
    })).resolves.toEqual({ status: 'unavailable' })

    expect(rpc.mock.calls.filter(([name]) => name === 'finalize_generation_incident_v1')).toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith('release_generation_incident_claim_v1', claimedMutationArgs)
  })

  it('returns no label and releases when finalize does not confirm success', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'finalize_generation_incident_v1') return { data: false, error: null }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => 'Buka pintu terkunci' },
    })).resolves.toEqual({ status: 'unavailable' })

    expect(rpc).toHaveBeenCalledWith('release_generation_incident_claim_v1', claimedMutationArgs)
  })

  it('still fails closed when best-effort release fails', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'release_generation_incident_claim_v1') throw new Error('RELEASE_FAILED')
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => { throw new Error('DECRYPT_FAILED') } },
    })).resolves.toEqual({ status: 'unavailable' })
  })

  it('maps empty atomic claim to not found', async () => {
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

  it('rejects plaintext or generic fields in claimed DB response', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...claimedIncident, label: 'plaintext must not pass' }], error: null }
      }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: vi.fn() },
    })).resolves.toEqual({ status: 'unavailable' })
  })

  it('rejects decrypted labels outside bounded label contract and releases claim', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => 'x'.repeat(91) },
    })).resolves.toEqual({ status: 'unavailable' })
    expect(rpc).toHaveBeenCalledWith('release_generation_incident_claim_v1', claimedMutationArgs)
  })
})
