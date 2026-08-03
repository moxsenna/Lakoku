import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DB_CREDENTIAL_ENV_KEYS,
  assertNoDbCredentials,
  stripDbCredentials,
} from '../../scripts/smoke-db-isolation'

/**
 * Provider-only smoke menjalankan gateway nyata. `executeObservedModelCall()`
 * SELALU menjalankan telemetry recorder — sukses maupun gagal — dan
 * `recordGenerationProviderCall` membuat `createAdminClient()` lalu insert ke
 * `generation_provider_calls` lewat RPC. Jadi "tidak menyentuh tabel story"
 * tidak cukup untuk klaim NOL DB IO.
 *
 * Guard ini membuktikan mode provider-only tidak mungkin membawa kredensial
 * service-role ke jalur provider.
 */
describe('provider-only smoke tidak bisa membawa kredensial DB', () => {
  it('mencakup service-role key, bukan hanya URL', () => {
    expect(DB_CREDENTIAL_ENV_KEYS).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(DB_CREDENTIAL_ENV_KEYS).toContain('SUPABASE_URL')
    expect(DB_CREDENTIAL_ENV_KEYS).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('menghapus seluruh kredensial DB dan melaporkan yang terhapus', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'https://prod.supabase.co',
      NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      NARRATIVE_PROVIDER: 'gateway',
    }

    const removed = stripDbCredentials(env)

    expect(removed.sort()).toEqual(
      ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'].sort(),
    )
    for (const key of DB_CREDENTIAL_ENV_KEYS) {
      expect(env[key]).toBeUndefined()
    }
    // Env non-DB tidak boleh ikut terhapus.
    expect(env.NARRATIVE_PROVIDER).toBe('gateway')
  })

  it('assert lolos setelah strip', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'https://prod.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    }
    stripDbCredentials(env)
    expect(() => assertNoDbCredentials(env)).not.toThrow()
  })

  it('assert menolak jika service-role key masih ada', () => {
    expect(() =>
      assertNoDbCredentials({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('assert menolak jika URL saja yang tersisa', () => {
    expect(() => assertNoDbCredentials({ SUPABASE_URL: 'https://prod.supabase.co' })).toThrow(
      /kredensial DB/,
    )
  })

  it('strip idempoten pada env yang sudah bersih', () => {
    const env: Record<string, string | undefined> = { NARRATIVE_PROVIDER: 'gateway' }
    expect(stripDbCredentials(env)).toEqual([])
    expect(() => assertNoDbCredentials(env)).not.toThrow()
  })

  it('smoke melucuti kredensial sebelum membuat provider', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/continuity-ab-smoke.ts'),
      'utf8',
    )
    const stripAt = source.indexOf('stripDbCredentials(process.env)')
    const assertAt = source.indexOf('assertNoDbCredentials(process.env)')
    const providerAt = source.indexOf('createGatewayProvider()')

    expect(stripAt).toBeGreaterThan(-1)
    expect(assertAt).toBeGreaterThan(stripAt)
    // Urutan penting: provider dibuat setelah env bersih, bukan sebelumnya.
    expect(providerAt).toBeGreaterThan(assertAt)
  })

  it('audit telemetry bersifat read-only', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/continuity-smoke-telemetry-audit.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/\.delete\(\)/)
    expect(source).not.toMatch(/\.update\(/)
    expect(source).not.toMatch(/\.insert\(/)
    expect(source).not.toMatch(/\.upsert\(/)
  })
})
