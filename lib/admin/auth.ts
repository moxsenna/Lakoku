import 'server-only'
import { getDb, single } from '@lakoku/db'
import { getSessionUser } from '@/lib/api/user-state'

/**
 * Admin auth helpers — berbasis role di DB (tabel `admin_users`),
 * bukan hardcode email di kode.
 *
 * Arsitektur:
 *  - DB = source of truth (`admin_users` table, service-role read).
 *  - Session = identitas user terotentikasi (Supabase Auth cookie).
 *  - Role = owner/admin (owner bisa segalanya, admin bisa grant kredit dll).
 */

/** Cek apakah userId adalah admin/owner yang terdaftar di DB. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const db = getDb()

  const { data, error } = await single(
    db
      .selectFrom('admin_users')
      .select('role')
      .where('user_id', '=', userId)
      .where('role', 'in', ['owner', 'admin'])
      .limit(1)
      .execute(),
  )

  if (error) {
    throw new Error(`isAdminUser: ${error.message}`)
  }

  return Boolean(data)
}

/** Dapatkan role admin user (owner | admin), atau null bila bukan admin. */
export async function getAdminRole(
  userId: string,
): Promise<'owner' | 'admin' | null> {
  const db = getDb()

  const { data, error } = await single(
    db
      .selectFrom('admin_users')
      .select('role')
      .where('user_id', '=', userId)
      .limit(1)
      .execute(),
  )

  if (error) {
    throw new Error(`getAdminRole: ${error.message}`)
  }

  return (data?.role as 'owner' | 'admin') ?? null
}

/**
 * Wajibkan user login + terdaftar sebagai admin/owner.
 * Return user session object. Throw bila tidak memenuhi syarat.
 */
export async function requireAdminUser(): Promise<{
  id: string
  email: string | undefined
  role: 'owner' | 'admin'
}> {
  const user = await getSessionUser()

  if (!user) {
    throw new Error('Unauthenticated')
  }

  const role = await getAdminRole(user.id)

  if (!role) {
    throw new Error('Forbidden')
  }

  return {
    id: user.id,
    email: user.email,
    role,
  }
}
