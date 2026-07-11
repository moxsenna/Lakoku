/** Formatting helpers untuk admin panel — IDR & tanggal. */

export function idr(n: number): string {
  return `Rp${new Intl.NumberFormat('id-ID').format(n)}`
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function isoDate(d: string | null | undefined): string {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '-'
  }
}

export function isoDatetime(d: string | null | undefined): string {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '-'
  }
}
