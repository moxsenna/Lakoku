import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/admin/auth'

/**
 * Layout panel admin: wajib login + role admin/owner di `admin_users` DB.
 * Redirect ke /auth/login bila belum login, atau ke / bila bukan admin.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requireAdminUser()
  } catch (err) {
    const msg = (err as Error)?.message
    if (msg === 'Unauthenticated') {
      redirect('/auth/login')
    }
    // Forbidden or other — redirect ke home.
    redirect('/')
  }

  return <>{children}</>
}
