export interface StatusBadgeProps {
  status: string
}

const statusMap: Record<string, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  created: { label: 'Created', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  duplicate: { label: 'Duplicate', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  active: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground' },
  success: { label: 'Success', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  applied: { label: 'Applied', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  REVIEW_REQUIRED: { label: 'Review Required', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  PUBLISHED: { label: 'Published', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  FAILED_REVIEW_REQUIRED: { label: 'Failed', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  none: { label: 'None', className: 'bg-muted text-muted-foreground' },
  first_topup: { label: 'First Topup', className: 'bg-lavender/10 text-lavender' },
  normal: { label: 'Normal', className: 'bg-muted text-muted-foreground' },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const m = statusMap[status]
  const label = m?.label ?? status
  const cls = m?.className ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}
