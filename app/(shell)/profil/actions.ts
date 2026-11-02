'use server'

/**
 * Server action pengaturan akun (/profil).
 *
 * actSetPassword — membuat kata sandi untuk akun yang BELUM punya
 * kredensial (pendaftar Google). Endpoint `setPassword` Better Auth
 * sifatnya server-only (tanpa HTTP route), jadi dibungkus di sini.
 */

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getSessionUser } from '@/lib/api/user-state'
import { getDb, result } from '@lakoku/db'

type ActionError = { ok: false; error: string }
type ActionResult<T extends object> = ({ ok: true } & T) | ActionError

export async function actSetPassword(newPassword: string): Promise<ActionResult<{ status: boolean }>> {
  try {
    const user = await getSessionUser()
    if (!user) {
      return { ok: false, error: 'Masuk dulu untuk mengatur akunmu.' }
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      return { ok: false, error: 'Kata sandi baru harus 6–128 karakter.' }
    }

    // Gate: aksi ini hanya untuk akun yang BELUM punya kata sandi (pendaftar
    // Google). Mengganti kata sandi yang sudah ada lewat changePassword.
    const db = getDb()
    const { data: existing, error: credError } = await result(
      db
        .selectFrom('account')
        .select('id')
        .where('userId', '=', user.id)
        .where('providerId', '=', 'credential')
        .limit(1)
        .execute(),
    )
    if (!credError && existing && existing.length > 0) {
      return { ok: false, error: 'Kata sandi sudah terpasang. Gunakan menu ganti kata sandi.' }
    }

    const setResult = await auth.api.setPassword({
      body: { newPassword },
      headers: await headers(),
    })

    return { ok: true, status: setResult?.status ?? true }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Gagal membuat kata sandi. Coba lagi.',
    }
  }
}
