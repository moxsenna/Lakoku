import 'server-only'

const MAX_CAPTURE_WINDOW_MS = 60 * 60 * 1000

export const CHOICE_INVALID_CAPTURE_ENV = {
  enabled: 'LAKOKU_CHOICE_INVALID_CAPTURE',
  storyId: 'LAKOKU_CHOICE_INVALID_CAPTURE_STORY_ID',
  chapterNumber: 'LAKOKU_CHOICE_INVALID_CAPTURE_CHAPTER_NUMBER',
  until: 'LAKOKU_CHOICE_INVALID_CAPTURE_UNTIL',
  key: 'LAKOKU_CHOICE_INVALID_CAPTURE_KEY',
} as const

export type ChoiceInvalidCaptureConfig = Readonly<{
  storyId: string
  chapterNumber: number
  expiresAt: string
  masterKey: Uint8Array
}>

export function loadChoiceInvalidCaptureConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): ChoiceInvalidCaptureConfig | null {
  if (env[CHOICE_INVALID_CAPTURE_ENV.enabled] !== 'on') return null

  const storyId = env[CHOICE_INVALID_CAPTURE_ENV.storyId]
  const rawChapter = env[CHOICE_INVALID_CAPTURE_ENV.chapterNumber]
  const rawUntil = env[CHOICE_INVALID_CAPTURE_ENV.until]
  const rawKey = env[CHOICE_INVALID_CAPTURE_ENV.key]
  if (!storyId || !rawChapter || !rawUntil || !rawKey) return null
  if (storyId.trim() !== storyId || storyId.length > 200) return null
  if (!/^(?:[1-9]|[1-4][0-9])$/.test(rawChapter)) return null

  const chapterNumber = Number(rawChapter)
  const expiresAtMs = Date.parse(rawUntil)
  const remainingMs = expiresAtMs - now.getTime()
  if (!Number.isFinite(expiresAtMs) || remainingMs <= 0 || remainingMs > MAX_CAPTURE_WINDOW_MS) return null

  let masterKey: Buffer
  try {
    masterKey = Buffer.from(rawKey, 'base64')
  } catch {
    return null
  }
  if (masterKey.length !== 32 || masterKey.toString('base64') !== rawKey) return null

  return {
    storyId,
    chapterNumber,
    expiresAt: new Date(expiresAtMs).toISOString(),
    masterKey: new Uint8Array(masterKey),
  }
}

export function choiceInvalidCaptureMatches(
  config: ChoiceInvalidCaptureConfig,
  storyId: string,
  chapterNumber: number,
): boolean {
  return config.storyId === storyId && config.chapterNumber === chapterNumber
}
