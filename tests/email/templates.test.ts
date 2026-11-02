import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  renderBrandEmailHtml,
  renderPasswordResetEmailHtml,
  renderVerificationEmailHtml,
} from '@/lib/email/templates'

describe('template email ber-branding Lakoku', () => {
  it('verification email memuat tombol CTA dengan url token', () => {
    const url = 'https://lakoku.biz.id/api/auth/verify-email?token=abc123&callbackURL=%2Fberanda'
    const html = renderVerificationEmailHtml('Bima Sena', url)
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('Verifikasi Email')
    expect(html).toContain('Halo Bima Sena')
    // Fallback tautan mentah untuk klien yang memblokir tombol
    expect(html).toContain(url)
  })

  it('password reset email memuat heading dan CTA yang benar', () => {
    const url = 'https://lakoku.biz.id/auth/reset-password?token=xyz'
    const html = renderPasswordResetEmailHtml('Sinta', url)
    expect(html).toContain('Atur ulang kata sandimu')
    expect(html).toContain('Buat Kata Sandi Baru')
    expect(html).toContain(url)
  })

  it('nama kosong jatuh ke sapaan generik tanpa membocorkan HTML', () => {
    const html = renderVerificationEmailHtml('  ', 'https://lakoku.biz.id/x')
    expect(html).toContain('Halo Pembaca')
    expect(html).not.toContain('undefined')
  })

  it('nama dengan karakter HTML di-escape', () => {
    const html = renderBrandEmailHtml({
      name: '<b>Admin</b>',
      heading: 'Uji',
      bodyHtml: 'Isi.',
      ctaLabel: 'Klik',
      ctaUrl: 'https://lakoku.biz.id/x',
    })
    expect(html).toContain('Halo &lt;b&gt;Admin&lt;/b&gt;')
    expect(html).not.toContain('<b>Admin</b>')
  })

  it('memakai palet brand dan layout tabel', () => {
    const html = renderVerificationEmailHtml('Bima', 'https://lakoku.biz.id/x')
    expect(html).toContain('#191319') // ink
    expect(html).toContain('#c94967') // rose (CTA)
    expect(html).toContain('#fff7ee') // cream
    expect(html).toContain('LAKOKU') // wordmark
    expect(html).toContain('role="presentation"') // table layout
  })
})
