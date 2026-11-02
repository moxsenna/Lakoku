/**
 * Peta kode error OAuth Better Auth → pesan reader-safe (Bahasa Indonesia).
 *
 * Kode datang dari query param `?error=` pada redirect callback OAuth.
 * Sumber kode: better-auth OAUTH_CALLBACK_ERROR_CODES + string error
 * yang di-snake-case oleh callback route (mis. "account not linked"
 * → "account_not_linked").
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  // Gate linking menolak: akun password dengan email sama ada, tapi
  // emailVerified=false di baris user lokal (satu-satunya penyebab yang
  // terjangkau untuk Google, yang selalu mengirim email terverifikasi).
  account_not_linked:
    'Email Google ini sama dengan akunmu yang terdaftar lewat kata sandi, tetapi email itu belum diverifikasi. Buka tautan verifikasi di inbox, lalu coba masuk dengan Google lagi — atau masuk dengan kata sandi.',
  email_not_verified:
    'Emailmu belum diverifikasi. Buka tautan verifikasi di inbox, lalu coba lagi.',
}

/** Pesan generik untuk kode OAuth yang tidak dipetakan. */
export const OAUTH_GENERIC_ERROR_MESSAGE =
  'Login Google gagal. Coba lagi atau masuk dengan email.'

export function mapOAuthErrorMessage(
  errorCode: string | null | undefined,
): string | null {
  if (!errorCode) return null
  return OAUTH_ERROR_MESSAGES[errorCode] ?? OAUTH_GENERIC_ERROR_MESSAGE
}
