import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ cookie: 'better-auth.session_token=valid-token' })),
}))

import { getSessionUser } from '@/lib/api/user-state'

describe('getSessionUser with Better Auth', () => {
  it('mengembalikan objek User saat sesi valid', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'u123', email: 'test@example.com', name: 'Budi' },
      session: { id: 's123', token: 'valid-token' },
    })

    const user = await getSessionUser()
    expect(user).not.toBeNull()
    expect(user?.id).toBe('u123')
    expect(user?.email).toBe('test@example.com')
  })

  it('mengembalikan null saat sesi tidak ada atau kedaluwarsa (guest safe)', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const user = await getSessionUser()
    expect(user).toBeNull()
  })

  it('mengembalikan null jika getSession melempar error (dead cookie defense)', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('Network error'))
    const user = await getSessionUser()
    expect(user).toBeNull()
  })
})
