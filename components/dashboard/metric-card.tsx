import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type MetricTone = 'neutral' | 'good' | 'warn' | 'bad'

const toneRing: Record<MetricTone, string> = {
  neutral: 'border-border',
  good: 'border-primary/30',
  warn: 'border-accent/50',
  bad: 'border-destructive/50',
}

const toneValue: Record<MetricTone, string> = {
  neutral: 'text-foreground',
  good: 'text-primary',
  warn: 'text-accent',
  bad: 'text-destructive',
}

/**
 * Kartu metrik ops (T8.1). Menampilkan satu angka utama + pembagi (num/denom)
 * dan tone semantik. Netral secara aksesibilitas: tone hanya bumbu warna, makna
 * tetap ada di teks.
 */
export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  tone?: MetricTone
}) {
  return (
    <Card className={cn('gap-2', toneRing[tone])}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground text-pretty">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className={cn('font-serif text-3xl leading-none', toneValue[tone])}>{value}</span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </CardContent>
    </Card>
  )
}
