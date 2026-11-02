import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  setPassword: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/api/user-state', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({
  auth: { api: { setPassword: mocks.setPassword } },
}))
// @lakoku/db: kembalikan koneksi tiruan untuk gate credential
vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          where: () => ({
            limit: () => ({
              execute: () => mocks.query(),
            }),
          }),
        }),
      }),
    }),
  }),
  result: async (p: Promise<unknown>) => ({ data: await p, error: null }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('actSetPassword (server action profil)', () => {
  it('menolak tamu tanpa sesi', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { actSetPassword } = await import('@/app/(shell)/profil/actions')

    const result = await actSetPassword('rahasia123')

    expect(result).toEqual({ ok: false, error: 'Masuk dulu untuk mengatur akunmu.' })
    expect(mocks.setPassword).not.toHaveBeenCalled()
  })

  it('menolak kata sandi di bawah 6 karakter', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u-1', email: 'a@b.c' })
    const { actSetPassword } = await import('@/app/(shell)/profil/actions')

    const result = await actSetPassword('12345')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('6–128')
    expect(mocks.setPassword).not.toHaveBeenCalled()
  })

  it('menolak user yang sudah punya kredensial kata sandi', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u-1', email: 'a@b.c' })
    mocks.query.mockResolvedValue([{ id: 'acc-1' }])
    const { actSetPassword } = await import('@/app/(shell)/profil/actions')

    const result = await actSetPassword('rahasia123')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('sudah terpasang')
    expect(mocks.setPassword).not.toHaveBeenCalled()
  })

  it('memanggil auth.api.setPassword untuk user tanpa kredensial', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u-1', email: 'a@b.c' })
    mocks.query.mockResolvedValue([])
    mocks.setPassword.mockResolvedValue({ status: true })
    const { actSetPassword } = await import('@/app/(shell)/profil/actions')

    const result = await actSetPassword('rahasia123')

    expect(result).toEqual({ ok: true, status: true })
    expect(mocks.setPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newPassword: 'rahasia123' } }),
    )
  })
})
