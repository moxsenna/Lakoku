/**
 * Bounded error projection for server logs.
 * Never include prompts, prose, cookies, keys, or full provider payloads.
 */

export type SafeErrorInfo = {
  errorName: string
  errorMessage: string
  errorStack?: string
}

const MAX_MESSAGE = 400
const MAX_STACK = 2_000

function scrub(text: string): string {
  return text
    .replace(/postgresql:\/\/[^\s"']+/gi, 'postgresql://[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/(api[_-]?key|service[_-]?role|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}

export function safeErrorInfo(error: unknown): SafeErrorInfo {
  if (error instanceof Error) {
    const message = scrub(error.message).slice(0, MAX_MESSAGE)
    const stack = error.stack ? scrub(error.stack).slice(0, MAX_STACK) : undefined
    return {
      errorName: error.name || 'Error',
      errorMessage: message || 'unknown_error',
      errorStack: stack,
    }
  }
  if (typeof error === 'string') {
    return {
      errorName: 'StringError',
      errorMessage: scrub(error).slice(0, MAX_MESSAGE),
    }
  }
  return {
    errorName: 'UnknownError',
    errorMessage: 'non_error_thrown',
  }
}
