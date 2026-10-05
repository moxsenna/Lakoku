import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { sendMailketingEmail } from './mailketing'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('sendMailketingEmail', () => {
  it('mengirim request POST yang valid ke Mailketing API v2', async () => {
    vi.stubEnv('MAILKETING_API_TOKEN', 'test-token')
    vi.stubEnv('MAILKETING_FROM_EMAIL', 'admin@lakoku.biz.id')
    vi.stubEnv('MAILKETING_FROM_NAME', 'Lakoku')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Email queued successfully' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMailketingEmail({
      to: 'reader@example.com',
      subject: 'Halo Pembaca',
      html: '<p>Selamat datang di Lakoku</p>',
    })

    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.mailketing.co.id/api/v2/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_name: 'Lakoku',
        from_email: 'admin@lakoku.biz.id',
        recipient: 'reader@example.com',
        subject: 'Halo Pembaca',
        content: '<p>Selamat datang di Lakoku</p>',
      }),
    })
  })
})
