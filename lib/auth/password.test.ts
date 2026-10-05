import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from './password'

describe('Password hashing & verification', () => {
  it('memverifikasi hash bcrypt warisan Supabase ($2a$)', async () => {
    const raw = 'lakoku-uji-123'
    const legacyHash = await bcrypt.hash(raw, 10)
    const valid = await verifyPassword({ password: raw, hash: legacyHash })
    expect(valid).toBe(true)

    const invalid = await verifyPassword({ password: 'wrong-password', hash: legacyHash })
    expect(invalid).toBe(false)
  })

  it('menghasilkan hash bcrypt baru yang dapat diverifikasi ulang', async () => {
    const raw = 'password-baru-2026'
    const newHash = await hashPassword(raw)
    expect(newHash.startsWith('$2a$') || newHash.startsWith('$2b$')).toBe(true)
    const valid = await verifyPassword({ password: raw, hash: newHash })
    expect(valid).toBe(true)
  })
})
