export function publicErrorMessage(raw: string | undefined): string {
  const code = raw && ['access_denied', 'missing_code', 'pkce_error', 'expired'].includes(raw) ? raw : undefined
  if (!code) return 'Tautan masuk tidak valid atau sudah kedaluwarsa. Coba masuk kembali.'
  if (code === 'access_denied') return 'Login Google dibatalkan. Kamu bisa coba lagi kapan saja.'
  if (code === 'missing_code') return 'Kode login tidak diterima. Coba masuk dengan Google sekali lagi.'
  if (code === 'pkce_error') return 'Sesi login Google tidak lengkap (cookie). Coba lagi dari halaman masuk, atau nonaktifkan pemblokir cookie untuk situs ini.'
  return 'Tautan masuk tidak valid atau sudah kedaluwarsa. Coba masuk kembali.'
}
