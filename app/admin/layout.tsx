import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/admin/auth'
import { AdminShell } from '@/components/admin/admin-shell'

/**
 * Layout panel admin: wajib login + role admin/owner di `admin_users` DB.
 * Redirect ke /auth/login bila belum login, atau ke / bila bukan admin.
 */
export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let admin: { id: string; email: string | undefined; role: 'owner' | 'admin' }
  try {
    admin = await requireAdminUser()
  } catch (err) {
    const msg = (err as Error)?.message
    if (msg === 'Unauthenticated') {
      redirect('/auth/login')
    }
    redirect('/')
  }

  return <AdminShell admin={admin}>{children}</AdminShell>
}
