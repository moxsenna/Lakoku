/**
 * Ketersediaan login Google (server-side).
 *
 * Provider Google hanya didaftarkan ke Better Auth bila kedua kredensial ada.
 * Halaman login/daftar memakai fungsi ini agar tombol Google tidak pernah
 * dirender sebagai tombol mati saat kredensial belum dipasang.
 */
export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

/** Host kanonis untuk OAuth: redirect URI Google selalu memakai origin ini. */
export function getGoogleCallbackOrigin(): string {
  const configured =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://lakoku.biz.id'
  try {
    return new URL(configured).origin
  } catch {
    return 'https://lakoku.biz.id'
  }
}

export function getGoogleCallbackUrl(): string {
  return `${getGoogleCallbackOrigin()}/api/auth/callback/google`
}
