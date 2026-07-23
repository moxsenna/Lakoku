/**
 * Best-effort observability helpers.
 * Failures are logged with safe metadata only — never rethrown.
 */
import { safeErrorInfo } from '@/lib/observability/safe-error'

export type SafeContext = {
  storyId?: string
  chapterNumber?: number
  correlationId?: string
  stage?: string
  [key: string]: string | number | boolean | null | undefined
}

/**
 * Run a non-critical side effect. Returns null on failure; never throws.
 */
export async function bestEffort<T>(
  event: string,
  context: SafeContext,
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation()
  } catch (err) {
    const info = safeErrorInfo(err)
    console.log(event, {
      ...context,
      errorName: info.errorName,
      errorMessage: info.errorMessage,
    })
    return null
  }
}
