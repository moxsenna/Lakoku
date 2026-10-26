/**
 * Lakoku — Streak baca harian (client-only, device-local).
 *
 * Hari aktif dicatat saat pembaca membuka bab (panggil recordReadingDay dari
 * klien). Disimpan di localStorage: streak adalah motivasi, bukan data akun —
 * tidak ada sinkronisasi, tidak ada tabel baru, tidak ada telemetri tambahan.
 *
 * Bentuk: { last: 'YYYY-MM-DD', best, current } — tanggal lokal perangkat.
 */

export interface ReadingStreak {
  /** Tanggal terakhir membaca (lokal). */
  last: string
  best: number
  current: number
}

const STORAGE_KEY = 'lakoku:streak:v1'

function localDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function getReadingStreak(): ReadingStreak | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ReadingStreak>
    if (
      typeof parsed.last !== 'string' ||
      typeof parsed.best !== 'number' ||
      typeof parsed.current !== 'number'
    ) {
      return null
    }
    return { last: parsed.last, best: parsed.best, current: parsed.current }
  } catch {
    return null
  }
}

/**
 * Catat aktivitas baca hari ini. Idempoten per hari: membaca beberapa bab
 * dalam hari yang sama tidak mengubah streak. Kembali setelah ≤1 hari kosong
 * melanjutkan; lebih dari itu mengulang dari 1.
 */
export function recordReadingDay(now = new Date()): ReadingStreak {
  const today = localDateKey(now)
  const existing = getReadingStreak()

  if (existing?.last === today) return existing

  const gap = existing ? daysBetween(existing.last, today) : Infinity
  const current = gap === 1 ? existing!.current + 1 : 1
  const streak: ReadingStreak = {
    last: today,
    best: Math.max(existing?.best ?? 0, current),
    current,
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(streak))
  } catch {
    // Storage ditolak — streak sesi ini saja.
  }
  listeners.forEach((l) => l())
  return streak
}

const listeners = new Set<() => void>()

/** Berlangganan perubahan streak (untuk useSyncExternalStore). */
export function subscribeStreak(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', listener)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', listener)
    }
  }
  return () => {
    listeners.delete(listener)
  }
}

/** Streak yang sudah kedaluwarsa (terakhir baca >1 hari) tampil sebagai 0. */
export function displayStreak(streak: ReadingStreak | null, now = new Date()): number {
  if (!streak) return 0
  return daysBetween(streak.last, localDateKey(now)) <= 1 ? streak.current : 0
}
