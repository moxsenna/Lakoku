export interface AdminEmptyStateProps {
  title?: string
  message?: string
}

export function AdminEmptyState({ title = 'Belum ada data', message }: AdminEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {message && <p className="text-[11px] text-muted-foreground">{message}</p>}
    </div>
  )
}
