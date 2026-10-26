import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  displayStreak,
  getReadingStreak,
  recordReadingDay,
} from '@/lib/reading-streak'

// Modul membaca `window` — sediakan window minimal dengan localStorage map.
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
})

function dayAt(offsetDays: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - offsetDays)
  return d
}

describe('reading streak (device-local)', () => {
  it('starts at 1 on first reading day', () => {
    expect(recordReadingDay().current).toBe(1)
  })
  it('is idempotent within the same day', () => {
    recordReadingDay()
    expect(recordReadingDay().current).toBe(1)
  })
  it('continues after consecutive days and keeps best after a pause', () => {
    recordReadingDay(dayAt(2))
    expect(recordReadingDay(dayAt(1)).current).toBe(2)
    const s = recordReadingDay()
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })
  it('restarts from 1 after a long pause, keeping best', () => {
    recordReadingDay(dayAt(9))
    recordReadingDay(dayAt(8))
    const s = recordReadingDay()
    expect(s.current).toBe(1)
    expect(s.best).toBe(2)
  })
  it('displays 0 when the last reading day is too old', () => {
    recordReadingDay(dayAt(5))
    expect(displayStreak(getReadingStreak())).toBe(0)
  })
})
