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
