import 'server-only'

export interface MailketingSendOptions {
  to: string
  subject: string
  html: string
}

export async function sendMailketingEmail({ to, subject, html }: MailketingSendOptions): Promise<{ success: boolean; message: string }> {
  const token = process.env.MAILKETING_API_TOKEN
  const fromEmail = process.env.MAILKETING_FROM_EMAIL || 'admin@lakoku.biz.id'
  const fromName = process.env.MAILKETING_FROM_NAME || 'Lakoku'

  if (!token) {
    console.error('[mailketing] MAILKETING_API_TOKEN belum diset.')
    return { success: false, message: 'MAILKETING_API_TOKEN missing' }
  }

  try {
    const res = await fetch('https://api.mailketing.co.id/api/v2/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_name: fromName,
        from_email: fromEmail,
        recipient: to,
        subject,
        content: html,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      console.error('[mailketing] Gagal kirim email:', data)
      return { success: false, message: data.message || 'Gagal mengirim email.' }
    }
    return { success: true, message: data.message || 'Email terkirim.' }
  } catch (error) {
    console.error('[mailketing] Network error saat kirim email:', error)
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}
