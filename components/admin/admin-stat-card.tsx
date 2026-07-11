export type StatTone = 'default' | 'good' | 'warn' | 'bad'

const toneBg: Record<StatTone, string> = {
  default: 'bg-card',
  good: 'bg-emerald-500/5 border-emerald-500/20',
  warn: 'bg-amber-500/5 border-amber-500/20',
  bad: 'bg-red-500/5 border-red-500/20',
}

const toneText: Record<StatTone, string> = {
  default: 'text-foreground',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
}

export interface AdminStatCardProps {
  title: string
  value: string | number
  description?: string
  tone?: StatTone
}

export function AdminStatCard({ title, value, description, tone = 'default' }: AdminStatCardProps) {
  return (
    <div className={`rounded-xl border p-4 ${toneBg[tone]}`}>
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className={`mt-1 text-2xl font-semibold ${toneText[tone]}`}>{value}</div>
      {description && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
