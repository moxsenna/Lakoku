import { type ReactNode } from 'react'

export interface AdminSectionCardProps {
  title: string
  subtitle?: string
  children: ReactNode
}

export function AdminSectionCard({ title, subtitle, children }: AdminSectionCardProps) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="overflow-auto">{children}</div>
    </section>
  )
}
