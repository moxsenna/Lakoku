import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_DRAFT_TTL_MS,
  ONBOARDING_QUIZ_STORAGE_KEY,
  readOnboardingQuizStash,
  saveOnboardingQuizStash,
} from '@/lib/onboarding-draft'
import { config } from '@/middleware'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  }
}

describe('onboarding quiz stash (tamu)', () => {
  it('round-trips quick answers', () => {
    const s = memoryStorage()
    const payload = {
      mode: 'quick' as const,
      answers: { genre: { mode: 'selected' as const, value: 'romansa' }, akhir: { mode: 'auto' as const } },
    }
    saveOnboardingQuizStash(s, payload, 1_000)
    expect(readOnboardingQuizStash(s, 2_000)).toEqual(payload)
  })

  it('round-trips custom idea', () => {
    const s = memoryStorage()
    saveOnboardingQuizStash(s, { mode: 'custom', customIdea: 'Detektif di Jakarta' }, 0)
    expect(readOnboardingQuizStash(s, 1)).toEqual({ mode: 'custom', customIdea: 'Detektif di Jakarta' })
  })

  it('drops expired and malformed records', () => {
    const s = memoryStorage()
    saveOnboardingQuizStash(s, { mode: 'custom', customIdea: 'x' }, 0)
    expect(readOnboardingQuizStash(s, ONBOARDING_DRAFT_TTL_MS + 1)).toBeNull()
    expect(s.map.has(ONBOARDING_QUIZ_STORAGE_KEY)).toBe(false)

    s.setItem(ONBOARDING_QUIZ_STORAGE_KEY, JSON.stringify({ version: 1, expiresAt: 10, payload: { mode: 'quick', answers: { genre: { mode: 'selected' } } } }))
    expect(readOnboardingQuizStash(s, 1)).toBeNull()

    s.setItem(ONBOARDING_QUIZ_STORAGE_KEY, '{not json')
    expect(readOnboardingQuizStash(s, 1)).toBeNull()
  })

  it('/mulai is public in middleware matcher', () => {
    expect(config.matcher).not.toContain('/mulai/:path*')
  })
})
