import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { CHOICE_INVALID_CAPTURE_ENV } from '@/lib/observability/choice-invalid-capture-config.server'
import { encryptChoiceLexicalEvidence } from '@/lib/observability/choice-invalid-capture-crypto.server'
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

const captureEnvKeys = Object.values(CHOICE_INVALID_CAPTURE_ENV)
const savedCaptureEnv = new Map(captureEnvKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of captureEnvKeys) {
    const previous = savedCaptureEnv.get(key)
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

function createProductionIncident(
  masterKey: Uint8Array,
  label = 'Buka pintu terkunci',
): EncryptedGenerationIncident {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const record = encryptChoiceLexicalEvidence({
    masterKey,
    identity: {
      id: incident.capture_id,
      correlationId: incident.correlation_id,
      storyId: incident.story_id,
      chapterNumber: incident.chapter_number,
      index: incident.choice_index,
      stage: incident.stage,
      code: incident.code,
      expiresAt,
    },
    label,
  })
  return {
    capture_id: record.id,
    correlation_id: record.correlationId,
    incident_key: record.incidentKey,
    label_fingerprint: record.labelFingerprint,
    version: record.version,
    story_id: record.storyId,
    chapter_number: record.chapterNumber,
    choice_index: record.index,
    stage: record.stage,
    code: record.code,
    expires_at: record.expiresAt,
    ciphertext: record.ciphertext,
    nonce: record.nonce,
    auth_tag: record.authTag,
  }
}

function setSoftDisarmedDecryptMaterial(masterKey: Uint8Array, expiresAt: string): void {
  process.env[CHOICE_INVALID_CAPTURE_ENV.enabled] = 'off'
  delete process.env[CHOICE_INVALID_CAPTURE_ENV.storyId]
  delete process.env[CHOICE_INVALID_CAPTURE_ENV.chapterNumber]
  process.env[CHOICE_INVALID_CAPTURE_ENV.until] = expiresAt
  process.env[CHOICE_INVALID_CAPTURE_ENV.key] = Buffer.from(masterKey).toString('base64')
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

  it('decrypts with production path after soft disarm and absent write target', async () => {
    const masterKey = randomBytes(32)
    const productionIncident = createProductionIncident(masterKey)
    setSoftDisarmedDecryptMaterial(masterKey, productionIncident.expires_at)
    const productionClaimedIncident = {
      ...productionIncident,
      claim_expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    }
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [productionClaimedIncident], error: null }
      if (name === 'finalize_generation_incident_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_generation_incident_v1',
      'finalize_generation_incident_v1',
    ])
  })

  it('returns not found after a successful retrieval is consumed', async () => {
    let consumed = false
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: consumed ? [] : [claimedIncident], error: null }
      }
      if (name === 'finalize_generation_incident_v1') {
        consumed = true
        return { data: true, error: null }
      }
      throw new Error(`unexpected RPC: ${name}`)
    })
    const decryptor = { decryptLabel: async () => 'Buka pintu terkunci' }

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc }, createClaimToken: () => claimToken, decryptor,
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc }, createClaimToken: () => claimToken, decryptor,
    })).resolves.toEqual({ status: 'not_found' })
  })

  it('emits only decrypt unavailable for invalid production label after decryption', async () => {
    const masterKey = randomBytes(32)
    const productionIncident = createProductionIncident(masterKey, 'x'.repeat(91))
    setSoftDisarmedDecryptMaterial(masterKey, productionIncident.expires_at)
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...productionIncident, claim_expires_at: new Date(Date.now() + 120_000).toISOString() }], error: null }
      }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc }, createClaimToken: () => claimToken, telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT_CONFIG', outcome: 'SUCCESS' },
      { stage: 'DECRYPT', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'SUCCESS' },
    ])
  })

  it('releases wrong production decrypt material without finalizing', async () => {
    const productionIncident = createProductionIncident(randomBytes(32))
    setSoftDisarmedDecryptMaterial(randomBytes(32), productionIncident.expires_at)
    const productionClaimedIncident = {
      ...productionIncident,
      claim_expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    }
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [productionClaimedIncident], error: null }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_generation_incident_v1',
      'release_generation_incident_claim_v1',
    ])
  })

  it('emits bounded stage telemetry for production decrypt success', async () => {
    const masterKey = randomBytes(32)
    const productionIncident = createProductionIncident(masterKey)
    setSoftDisarmedDecryptMaterial(masterKey, productionIncident.expires_at)
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...productionIncident, claim_expires_at: new Date(Date.now() + 120_000).toISOString() }], error: null }
      }
      if (name === 'finalize_generation_incident_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      telemetry,
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })

    expect(telemetry).toHaveBeenCalledTimes(5)
    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT_CONFIG', outcome: 'SUCCESS' },
      { stage: 'DECRYPT', outcome: 'SUCCESS' },
      { stage: 'FINALIZE', outcome: 'SUCCESS' },
    ])
  })

  it('emits unavailable decrypt config then releases when material is absent', async () => {
    delete process.env[CHOICE_INVALID_CAPTURE_ENV.enabled]
    delete process.env[CHOICE_INVALID_CAPTURE_ENV.storyId]
    delete process.env[CHOICE_INVALID_CAPTURE_ENV.chapterNumber]
    delete process.env[CHOICE_INVALID_CAPTURE_ENV.until]
    delete process.env[CHOICE_INVALID_CAPTURE_ENV.key]
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT_CONFIG', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'SUCCESS' },
    ])
  })

  it('keeps successful claim decrypt finalize behavior when telemetry sink throws', async () => {
    const masterKey = randomBytes(32)
    const productionIncident = createProductionIncident(masterKey)
    setSoftDisarmedDecryptMaterial(masterKey, productionIncident.expires_at)
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...productionIncident, claim_expires_at: new Date(Date.now() + 120_000).toISOString() }], error: null }
      }
      if (name === 'finalize_generation_incident_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      telemetry: () => { throw new Error('TELEMETRY_FAILED') },
    })).resolves.toEqual({ status: 'found', label: 'Buka pintu terkunci' })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_generation_incident_v1',
      'finalize_generation_incident_v1',
    ])
  })

  it('emits decrypt unavailable then release for wrong production key', async () => {
    const productionIncident = createProductionIncident(randomBytes(32))
    setSoftDisarmedDecryptMaterial(randomBytes(32), productionIncident.expires_at)
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...productionIncident, claim_expires_at: new Date(Date.now() + 120_000).toISOString() }], error: null }
      }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc }, createClaimToken: () => claimToken, telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT_CONFIG', outcome: 'SUCCESS' },
      { stage: 'DECRYPT', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'SUCCESS' },
    ])
  })

  it('releases when production decrypt material is expired without finalizing', async () => {
    const productionIncident = createProductionIncident(randomBytes(32))
    setSoftDisarmedDecryptMaterial(randomBytes(32), new Date(Date.now() - 1_000).toISOString())
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...productionIncident, claim_expires_at: new Date(Date.now() + 120_000).toISOString() }], error: null }
      }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc }, createClaimToken: () => claimToken, telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_generation_incident_v1',
      'release_generation_incident_claim_v1',
    ])
    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT_CONFIG', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'SUCCESS' },
    ])
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

  it('emits finalize unavailable then release when finalization fails', async () => {
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'finalize_generation_incident_v1') return { data: null, error: { message: 'FINALIZE_FAILED' } }
      if (name === 'release_generation_incident_claim_v1') return { data: true, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => 'Buka pintu terkunci' },
      telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT', outcome: 'SUCCESS' },
      { stage: 'FINALIZE', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'SUCCESS' },
    ])
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

  it('emits release unavailable when release RPC throws', async () => {
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') return { data: [claimedIncident], error: null }
      if (name === 'release_generation_incident_claim_v1') throw new Error('RELEASE_FAILED')
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      decryptor: { decryptLabel: async () => { throw new Error('DECRYPT_FAILED') } },
      telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'SUCCESS' },
      { stage: 'DECRYPT', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'UNAVAILABLE' },
    ])
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

  it('emits bounded telemetry for malformed claimed rows and failed release confirmation', async () => {
    const telemetry = vi.fn()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_generation_incident_v1') {
        return { data: [{ ...claimedIncident, label: 'plaintext must not pass' }], error: null }
      }
      if (name === 'release_generation_incident_claim_v1') return { data: false, error: null }
      throw new Error(`unexpected RPC: ${name}`)
    })

    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc },
      createClaimToken: () => claimToken,
      telemetry,
    })).resolves.toEqual({ status: 'unavailable' })

    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'SUCCESS' },
      { stage: 'ROW_SCHEMA', outcome: 'UNAVAILABLE' },
      { stage: 'RELEASE', outcome: 'UNAVAILABLE' },
    ])
  })

  it('emits claim not found for empty atomic claim', async () => {
    const telemetry = vi.fn()
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: { rpc: async () => ({ data: [], error: null }) },
      decryptor: { decryptLabel: vi.fn() },
      telemetry,
    })).resolves.toEqual({ status: 'not_found' })
    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'NOT_FOUND' },
    ])
  })

  it('emits claim forbidden for exact DB owner denial', async () => {
    const telemetry = vi.fn()
    await expect(retrieveGenerationIncidentLabel(lookup, {
      client: {
        rpc: async () => ({ data: null, error: { message: 'OWNER_REQUIRED' } }),
      },
      telemetry,
    })).resolves.toEqual({ status: 'forbidden' })
    expect(telemetry.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'CLAIM', outcome: 'FORBIDDEN' },
    ])
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
