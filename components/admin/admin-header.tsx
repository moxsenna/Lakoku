export interface AdminHeaderProps {
  admin: {
    id: string
    email: string | undefined
    role: 'owner' | 'admin'
  }
}

export function AdminHeader({ admin }: AdminHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      <span className="text-sm font-medium text-foreground">
        Admin Panel
      </span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{admin.email}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            admin.role === 'owner'
              ? 'bg-gold/20 text-gold'
              : 'bg-lavender/20 text-lavender'
          }`}
        >
          {admin.role}
        </span>
      </div>
    </header>
  )
}
