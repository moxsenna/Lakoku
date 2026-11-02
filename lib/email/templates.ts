import 'server-only'

/**
 * Template email HTML ber-branding Lakoku (reader-safe, table-layout
 * agar konsisten di klien email lama). Palet diambil dari globals.css:
 * ink #191319, plum #3d1f3d, rose #c94967, gold #a87933, cream #fff7ee,
 * lavender #6f6274.
 */

export interface BrandEmailContent {
  /** Nama pembaca untuk sapaan; boleh kosong → "Pembaca". */
  name?: string
  heading: string
  bodyHtml: string
  ctaLabel: string
  ctaUrl: string
  /** Catatan kecil di bawah tombol (opsional). */
  footnote?: string
}

const CREAM = '#fff7ee'
const INK = '#191319'
const CARD = '#241b24'
const ROSE = '#c94967'
const GOLD = '#a87933'
const MUTED = '#b9a8c2'
const FAINT = '#6f6274'

export function renderBrandEmailHtml(content: BrandEmailContent): string {
  const displayName = content.name?.trim() || 'Pembaca'
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${content.heading}</title>
</head>
<body style="margin:0; padding:0; background-color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${INK};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-family:Georgia,'Times New Roman',serif; font-size:15px; letter-spacing:0.28em; color:${CREAM};">LAKOKU</span>
            </td>
          </tr>
          <!-- Kartu utama -->
          <tr>
            <td bgcolor="${CARD}" style="background-color:${CARD}; border:1px solid #3a2c3a; border-radius:20px; padding:40px 32px;">
              <h1 style="margin:0 0 20px; font-family:Georgia,'Times New Roman',serif; font-size:26px; line-height:1.3; color:${CREAM};">${content.heading}</h1>
              <p style="margin:0 0 20px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:${MUTED};">Halo ${escapeHtml(displayName)},</p>
              <div style="margin:0 0 28px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:${MUTED};">${content.bodyHtml}</div>
              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" bgcolor="${ROSE}" style="border-radius:14px;">
                    <a href="${content.ctaUrl}" style="display:block; padding:15px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:${CREAM}; text-decoration:none; border-radius:14px;">${content.ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:${FAINT}; word-break:break-all;">Tombol tidak berfungsi? Salin tautan ini ke peramban:<br><a href="${content.ctaUrl}" style="color:${GOLD}; text-decoration:underline;">${content.ctaUrl}</a></p>
              ${content.footnote ? `<p style="margin:16px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:${FAINT};">${content.footnote}</p>` : ''}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <span style="font-family:Arial,Helvetica,sans-serif; font-size:11px; color:${FAINT};">Lakoku — Novel Interaktif. Kamu tokoh utamanya.</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Email verifikasi akun. */
export function renderVerificationEmailHtml(name: string | undefined, url: string): string {
  return renderBrandEmailHtml({
    name,
    heading: 'Satu langkah lagi sebelum mulai',
    bodyHtml:
      'Terima kasih telah bergabung di Lakoku. Klik tombol di bawah untuk memverifikasi alamat emailmu — setiap jejak pilihanmu akan tersimpan di akun ini.',
    ctaLabel: 'Verifikasi Email',
    ctaUrl: url,
    footnote: 'Tautan ini hanya berlaku terbatas. Kalau kamu tidak merasa mendaftar, abaikan email ini.',
  })
}

/** Email atur ulang kata sandi. */
export function renderPasswordResetEmailHtml(name: string | undefined, url: string): string {
  return renderBrandEmailHtml({
    name,
    heading: 'Atur ulang kata sandimu',
    bodyHtml:
      'Kami menerima permintaan untuk mengatur ulang kata sandi akun Lakokumu. Klik tombol di bawah untuk membuat kata sandi baru.',
    ctaLabel: 'Buat Kata Sandi Baru',
    ctaUrl: url,
    footnote: 'Kalau kamu tidak meminta pengaturan ulang, abaikan email ini — kata sandimu tidak berubah.',
  })
}
