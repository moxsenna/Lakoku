import { AdminSidebar } from './admin-sidebar'
import { AdminHeader } from './admin-header'
import type { ReactNode } from 'react'

export interface AdminShellProps {
  children: ReactNode
  admin: {
    id: string
    email: string | undefined
    role: 'owner' | 'admin'
  }
}

export function AdminShell({ children, admin }: AdminShellProps) {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <AdminSidebar />
      <div className="flex flex-1 flex-col">
        <AdminHeader admin={admin} />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
