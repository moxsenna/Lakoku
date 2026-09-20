import { sanitizeNextPath } from './safe-next'

export interface SessionRedirectOptions {
  pathname: string
  isAuthenticated: boolean
  preview?: boolean
  next?: string | null
}

/**
 * Tentukan URL pengalihan untuk pengguna yang sudah login (terotentikasi).
 * - Mengembalikan string path jika harus dialihkan (misal: '/beranda').
 * - Mengembalikan null jika request boleh dilanjutkan tanpa pengalihan.
 */
export function getSessionRedirectPath({
  pathname,
  isAuthenticated,
  preview = false,
  next = null,
}: SessionRedirectOptions): string | null {
  if (!isAuthenticated) return null

  // Rute root: arahkan pengguna ber-sesi ke beranda kecuali sedang pratinjau landing page
  if (pathname === '/') {
    if (preview) return null
    return '/beranda'
  }

  // Rute auth: pengguna ber-sesi tidak perlu login/sign-up ulang
  if (pathname === '/auth/login' || pathname === '/auth/sign-up') {
    return sanitizeNextPath(next)
  }

  return null
}
