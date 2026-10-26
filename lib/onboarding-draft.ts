import type {
  CastDraft,
  MysteryDraft,
  PremiseDraft,
  WorldDraft,
} from '@/lib/authoring/schema'

export const ONBOARDING_DRAFT_STORAGE_KEY = 'lakoku:onboarding-draft:v1'
export const ONBOARDING_DRAFT_TTL_MS = 30 * 60 * 1000

export interface OnboardingDraftPayload {
  premise: PremiseDraft
  cast: CastDraft
  mystery: MysteryDraft
  world: WorldDraft
  answers?: Record<string, string>
  /** Optional creative direction snapshot for resume (opaque JSON). */
  creativeDirection?: unknown
}

export interface OnboardingDraftStashRecord {
  version: 1
  createdAt: number
  expiresAt: number
  payload: OnboardingDraftPayload
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPayload(value: unknown): value is OnboardingDraftPayload {
  if (!isObject(value)) return false
  return (
    isObject(value.premise) &&
    isObject(value.cast) &&
    isObject(value.mystery) &&
    isObject(value.world)
  )
}

export function createOnboardingDraftStashRecord(
  payload: OnboardingDraftPayload,
  now = Date.now(),
): OnboardingDraftStashRecord {
  return {
    version: 1,
    createdAt: now,
    expiresAt: now + ONBOARDING_DRAFT_TTL_MS,
    payload,
  }
}

export function saveOnboardingDraftStash(
  storage: Pick<Storage, 'setItem'>,
  payload: OnboardingDraftPayload,
  now = Date.now(),
) {
  storage.setItem(
    ONBOARDING_DRAFT_STORAGE_KEY,
    JSON.stringify(createOnboardingDraftStashRecord(payload, now)),
  )
}

export function readOnboardingDraftStash(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): OnboardingDraftPayload | null {
  const raw = storage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)
  if (!raw) return null

  try {
    const record = JSON.parse(raw) as unknown
    if (!isObject(record) || record.version !== 1) return null
    if (typeof record.expiresAt !== 'number' || record.expiresAt <= now) {
      storage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY)
      return null
    }
    return isPayload(record.payload) ? record.payload : null
  } catch {
    storage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY)
    return null
  }
}

export function clearOnboardingDraftStash(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY)
}

// ─── Stash kuis tamu ───────────────────────────────────────────────
// Tamu boleh menjawab kuis /mulai tanpa akun. Premis baru disusun setelah
// masuk, jadi jawaban disimpan dulu lalu dipulihkan lewat `?resume=quiz`.

export const ONBOARDING_QUIZ_STORAGE_KEY = 'lakoku:onboarding-quiz:v1'

export type OnboardingQuizAnswer =
  | { mode: 'auto' }
  | { mode: 'selected'; value: string }
  | { mode: 'custom'; text: string }

export type OnboardingQuizPayload =
  | { mode: 'quick'; answers: Record<string, OnboardingQuizAnswer> }
  | { mode: 'custom'; customIdea: string }

function isQuizAnswer(value: unknown): value is OnboardingQuizAnswer {
  if (!isObject(value)) return false
  if (value.mode === 'auto') return true
  if (value.mode === 'selected') return typeof value.value === 'string' && value.value.length > 0
  if (value.mode === 'custom') return typeof value.text === 'string' && value.text.length > 0
  return false
}

function isQuizPayload(value: unknown): value is OnboardingQuizPayload {
  if (!isObject(value)) return false
  if (value.mode === 'custom') {
    return typeof value.customIdea === 'string' && value.customIdea.trim().length > 0
  }
  if (value.mode === 'quick' && isObject(value.answers)) {
    return Object.values(value.answers).every(isQuizAnswer)
  }
  return false
}

export function saveOnboardingQuizStash(
  storage: Pick<Storage, 'setItem'>,
  payload: OnboardingQuizPayload,
  now = Date.now(),
) {
  storage.setItem(
    ONBOARDING_QUIZ_STORAGE_KEY,
    JSON.stringify({ version: 1, expiresAt: now + ONBOARDING_DRAFT_TTL_MS, payload }),
  )
}

export function readOnboardingQuizStash(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): OnboardingQuizPayload | null {
  const raw = storage.getItem(ONBOARDING_QUIZ_STORAGE_KEY)
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as unknown
    if (
      !isObject(record) ||
      record.version !== 1 ||
      typeof record.expiresAt !== 'number' ||
      record.expiresAt <= now ||
      !isQuizPayload(record.payload)
    ) {
      storage.removeItem(ONBOARDING_QUIZ_STORAGE_KEY)
      return null
    }
    return record.payload
  } catch {
    storage.removeItem(ONBOARDING_QUIZ_STORAGE_KEY)
    return null
  }
}

export function clearOnboardingQuizStash(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(ONBOARDING_QUIZ_STORAGE_KEY)
}
