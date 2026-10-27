import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { sendInactiveReadingEmail } from '@/lib/email/inactive-reminder'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('sendInactiveReadingEmail', () => {
  it('formats re-engagement email with story title and deep link', async () => {
    vi.stubEnv('MAILKETING_API_TOKEN', 'mock-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'queued' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendInactiveReadingEmail({
      to: 'pembaca@example.com',
      userName: 'Nadia',
      storyTitle: 'Selasa Terakhir di Rumah Kaca',
      deepLink: 'https://lakoku.biz.id/baca/selasa-akhir?bab=5',
    })

    expect(res.success).toBe(true)
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://api.mailketing.co.id/api/v2/send')
    const body = JSON.parse(call[1].body as string)
    expect(body.recipient).toBe('pembaca@example.com')
    expect(body.subject).toContain('Selasa Terakhir di Rumah Kaca')
    expect(body.content).toContain('Nadia')
    expect(body.content).toContain('https://lakoku.biz.id/baca/selasa-akhir?bab=5')
  })
})
