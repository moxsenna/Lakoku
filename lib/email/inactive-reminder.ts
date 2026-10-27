import 'server-only'
import { sendMailketingEmail } from './mailketing'

/**
 * Kirim email re-engagement ke pembaca yang belum kembali membaca.
 * Non-intrusif, tanpa istilah teknis, langsung mengarahkan ke bab terakhir.
 */
export async function sendInactiveReadingEmail(input: {
  to: string
  userName?: string
  storyTitle: string
  deepLink: string
}): Promise<{ success: boolean; message: string }> {
  const greeting = input.userName ? `Halo ${input.userName}` : 'Halo'
  const html = `
<p>${greeting},</p>
<p>Kisahmu di <strong>${input.storyTitle}</strong> belum selesai. Pilihanmu kemarin membawa cerita ini ke titik penting yang masih menunggu keputusanmu.</p>
<p><a href="${input.deepLink}" style="display:inline-block;padding:12px 24px;background:#c94967;color:#fff7ee;text-decoration:none;border-radius:12px;font-weight:600;">Lanjutkan Cerita</a></p>
<p style="color:#6f6274;font-size:12px;margin-top:24px;">Lakoku · Kamu tokoh utamanya</p>
`
  return sendMailketingEmail({
    to: input.to,
    subject: `Kelanjutan "${input.storyTitle}" masih menunggumu`,
    html,
  })
}
