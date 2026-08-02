import 'server-only'

const MAX_CAPTURE_WINDOW_MS = 60 * 60 * 1000

export const CHOICE_INVALID_CAPTURE_ENV = {
  enabled: 'LAKOKU_CHOICE_INVALID_CAPTURE',
  storyId: 'LAKOKU_CHOICE_INVALID_CAPTURE_STORY_ID',
  chapterNumber: 'LAKOKU_CHOICE_INVALID_CAPTURE_CHAPTER_NUMBER',
  until: 'LAKOKU_CHOICE_INVALID_CAPTURE_UNTIL',
  key: 'LAKOKU_CHOICE_INVALID_CAPTURE_KEY',
} as const

export type ChoiceInvalidCaptureDecryptConfig = Readonly<{
  expiresAt: string
  masterKey: Uint8Array
}>

export type ChoiceInvalidCaptureWriteConfig = ChoiceInvalidCaptureDecryptConfig & Readonly<{
  storyId: string
  chapterNumber: number
}>

export type ChoiceInvalidCaptureConfig = ChoiceInvalidCaptureWriteConfig

function loadMasterKey(
  env: Readonly<Record<string, string | undefined>>,
): Uint8Array | null {
  const rawKey = env[CHOICE_INVALID_CAPTURE_ENV.key]
  if (!rawKey) return null

  let masterKey: Buffer
  try {
    masterKey = Buffer.from(rawKey, 'base64')
  } catch {
    return null
  }
  if (masterKey.length !== 32 || masterKey.toString('base64') !== rawKey) return null

  return new Uint8Array(masterKey)
}

export function loadChoiceInvalidCaptureDecryptConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): ChoiceInvalidCaptureDecryptConfig | null {
  const rawUntil = env[CHOICE_INVALID_CAPTURE_ENV.until]
  if (!rawUntil) return null

  const expiresAtMs = Date.parse(rawUntil)
  const remainingMs = expiresAtMs - now.getTime()
  if (!Number.isFinite(expiresAtMs) || remainingMs <= 0 || remainingMs > MAX_CAPTURE_WINDOW_MS) return null

  const masterKey = loadMasterKey(env)
  if (!masterKey) return null

  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    masterKey,
  }
}

export function loadChoiceInvalidCaptureWriteConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): ChoiceInvalidCaptureWriteConfig | null {
  if (env[CHOICE_INVALID_CAPTURE_ENV.enabled] !== 'on') return null

  const storyId = env[CHOICE_INVALID_CAPTURE_ENV.storyId]
  const rawChapter = env[CHOICE_INVALID_CAPTURE_ENV.chapterNumber]
  if (!storyId || !rawChapter) return null
  if (storyId.trim() !== storyId || storyId.length > 200) return null
  if (!/^(?:[1-9]|[1-4][0-9])$/.test(rawChapter)) return null

  const decryptConfig = loadChoiceInvalidCaptureDecryptConfig(env, now)
  if (!decryptConfig) return null

  return {
    storyId,
    chapterNumber: Number(rawChapter),
    ...decryptConfig,
  }
}

export const loadChoiceInvalidCaptureConfig = loadChoiceInvalidCaptureWriteConfig

export function choiceInvalidCaptureMatches(
  config: ChoiceInvalidCaptureConfig,
  storyId: string,
  chapterNumber: number,
): boolean {
  return config.storyId === storyId && config.chapterNumber === chapterNumber
}
