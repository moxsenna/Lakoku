import { describe, expect, it, vi } from 'vitest'
import {
  assertLocalSoakEnvironment,
  immutableJobScript,
  pollUntil,
} from '../../scripts/full-generation-worker-soak-support'

const valid = {
  apiUrl: 'http://127.0.0.1:54321',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  projectId: 'lakoku-v2',
  containerProject: 'lakoku-v2',
  marker: 'local-cli',
  explicitOptIn: '1',
  networkProbe: vi.fn(async () => undefined),
}

describe('full generation worker soak safety', () => {
  it('accepts only explicit local CLI target with matching Docker project and network probe', async () => {
    await expect(assertLocalSoakEnvironment(valid)).resolves.toBeUndefined()
    expect(valid.networkProbe).toHaveBeenCalledWith('http://127.0.0.1:54321')
  })

  it.each([
    ['explicit opt-in', { explicitOptIn: undefined }],
    ['loopback API', { apiUrl: 'https://linked.supabase.co' }],
    ['loopback DB', { dbUrl: 'postgresql://postgres@db.example.com/postgres' }],
    ['matching Docker project', { containerProject: 'other-project' }],
    ['persistent DB marker', { marker: '' }],
  ])('rejects missing %s guard', async (_label, override) => {
    await expect(assertLocalSoakEnvironment({ ...valid, ...override })).rejects.toThrow(/local worker soak/i)
  })

  it('fails closed when local API network probe fails', async () => {
    await expect(assertLocalSoakEnvironment({
      ...valid,
      networkProbe: async () => { throw new Error('offline') },
    })).rejects.toThrow(/network probe/i)
  })

  it('freezes job script and nested candidate outcomes', () => {
    const script = immutableJobScript({ prose: ['valid'], choices: ['TIMEOUT', 'valid'] })
    expect(Object.isFrozen(script)).toBe(true)
    expect(Object.isFrozen(script.prose)).toBe(true)
    expect(Object.isFrozen(script.choices)).toBe(true)
  })

  it('bounds polling waits', async () => {
    await expect(pollUntil(async () => false, { timeoutMs: 20, intervalMs: 2, label: 'job' }))
      .rejects.toThrow('job timed out')
  })
})
