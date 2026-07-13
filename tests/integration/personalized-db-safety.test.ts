import { describe, expect, it } from 'vitest'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
} from '@/scripts/personalized-db-safety'

describe('personalized DB gate safety', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://[::1]:54321',
  ])('accepts loopback Supabase URL %s', (url) => {
    expect(assertLoopbackSupabaseUrl(url)).toBe(url)
  })

  it.each([
    'https://project.supabase.co',
    'https://127.0.0.1.example.com',
    'http://192.168.1.10:54321',
  ])('rejects non-loopback Supabase URL %s', (url) => {
    expect(() => assertLoopbackSupabaseUrl(url)).toThrow(
      'personalized DB test requires loopback Supabase URL',
    )
  })

  it('extracts required local status fields without accepting missing credentials', () => {
    expect(
      readLocalStatus({
        API_URL: 'http://127.0.0.1:54321',
        ANON_KEY: 'anon-secret',
        SERVICE_ROLE_KEY: 'service-secret',
      }),
    ).toEqual({
      apiUrl: 'http://127.0.0.1:54321',
      anonKey: 'anon-secret',
      serviceRoleKey: 'service-secret',
    })

    expect(() =>
      readLocalStatus({ API_URL: 'http://127.0.0.1:54321' }),
    ).toThrow('personalized DB test requires local anon and service-role keys')
  })
})
