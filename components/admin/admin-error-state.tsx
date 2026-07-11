export interface AdminErrorStateProps {
  error?: string
}

export function AdminErrorState({ error }: AdminErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 px-4 py-8 text-center">
      <span className="text-xs font-medium text-destructive">Gagal Memuat</span>
      {error && (
        <p className="max-w-md text-[11px] text-muted-foreground">{error}</p>
      )}
    </div>
  )
}
