/**
 * Choice provider error taxonomy + retry policy.
 */

export type ChoiceProviderErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'HTTP_5XX'
  | 'NETWORK_ERROR'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'CONTENT_REJECTED'
  | 'QUALITY_UNGROUNDED'
  | 'QUALITY_NOT_DISTINCT'
  | 'QUALITY_NOT_ACTIONABLE'
  | 'UNKNOWN'

export type ChoiceRetryAction =
  | 'transient_retry'
  | 'structural_repair'
  | 'quality_repair'
  | 'content_rewrite'
  | 'next_provider'
  | 'terminal'

export type ChoiceRetryBudget = {
  transientPerCandidate: number
  structuralRepair: number
  qualityRepair: number
  maxProviderCandidates: number
  maxTotalCalls: number
}

export const DEFAULT_CHOICE_RETRY_BUDGET: ChoiceRetryBudget = {
  transientPerCandidate: 1,
  structuralRepair: 1,
  qualityRepair: 1,
  maxProviderCandidates: 3,
  maxTotalCalls: 5,
}

export function classifyChoiceProviderError(err: unknown): ChoiceProviderErrorCode {
  if (!err) return 'UNKNOWN'
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  const name = err instanceof Error ? err.name : ''

  if (
    name === 'TimeoutError' ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    lower.includes('deadline')
  ) {
    return 'TIMEOUT'
  }
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return 'RATE_LIMITED'
  }
  if (/\b5\d\d\b/.test(message) || lower.includes('internal server error') || lower.includes('bad gateway')) {
    return 'HTTP_5XX'
  }
  if (
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('socket')
  ) {
    return 'NETWORK_ERROR'
  }
  if (
    lower.includes('invalid json') ||
    lower.includes('json parse') ||
    lower.includes('unexpected token')
  ) {
    return 'INVALID_JSON'
  }
  if (lower.includes('schema') || lower.includes('choice_invalid') || lower.includes('validation')) {
    return 'SCHEMA_INVALID'
  }
  if (lower.includes('content') && lower.includes('reject')) {
    return 'CONTENT_REJECTED'
  }
  if (lower.includes('ungrounded') || lower.includes('unrelated')) {
    return 'QUALITY_UNGROUNDED'
  }
  if (lower.includes('not_distinct') || lower.includes('not distinct') || lower.includes('too similar')) {
    return 'QUALITY_NOT_DISTINCT'
  }
  if (lower.includes('not_actionable') || lower.includes('not actionable')) {
    return 'QUALITY_NOT_ACTIONABLE'
  }

  // Finding codes from quality pipeline
  if (message.includes('UNGROUNDED') || message.includes('CHOICE_UNRELATED')) {
    return 'QUALITY_UNGROUNDED'
  }
  if (message.includes('NOT_DISTINCT')) return 'QUALITY_NOT_DISTINCT'
  if (message.includes('NOT_ACTIONABLE') || message.includes('CHOICE_NOT_ACTIONABLE')) {
    return 'QUALITY_NOT_ACTIONABLE'
  }

  return 'UNKNOWN'
}

export function choiceRetryAction(code: ChoiceProviderErrorCode): ChoiceRetryAction {
  switch (code) {
    case 'TIMEOUT':
    case 'RATE_LIMITED':
    case 'HTTP_5XX':
    case 'NETWORK_ERROR':
      return 'transient_retry'
    case 'INVALID_JSON':
    case 'SCHEMA_INVALID':
      return 'structural_repair'
    case 'CONTENT_REJECTED':
      return 'content_rewrite'
    case 'QUALITY_UNGROUNDED':
    case 'QUALITY_NOT_DISTINCT':
    case 'QUALITY_NOT_ACTIONABLE':
      return 'quality_repair'
    case 'UNKNOWN':
    default:
      return 'next_provider'
  }
}

export function transientBackoffMs(attempt: number): number {
  // 2–5s + jitter
  const base = 2000 + Math.min(attempt, 3) * 1000
  const jitter = Math.floor(Math.random() * 1000)
  return Math.min(5000, base) + jitter
}

/** Reader-safe repair notes from findings — never dump diagnostic codes into narrative constraints. */
export function buildChoiceRepairNotes(
  findings: Array<{ code: string; message: string }>,
): string[] {
  return findings.slice(0, 8).map((f) => {
    switch (f.code) {
      case 'PROVIDER_ERROR':
      case 'REPAIR_PROVIDER_ERROR':
      case 'NULL_BRANCH':
        return 'Respons sebelumnya gagal diparse atau kosong. Susun ulang dua tindakan valid.'
      case 'UNGROUNDED':
      case 'CHOICE_UNRELATED':
        return 'Pilihan harus menyebut objek atau konflik yang muncul pada akhir bab.'
      case 'NOT_DISTINCT':
      case 'CHOICES_NOT_DISTINCT':
        return 'Dua pilihan menghasilkan arah yang terlalu serupa; bedakan risiko dan tujuan.'
      case 'NOT_ACTIONABLE':
      case 'CHOICE_NOT_ACTIONABLE':
        return 'Label harus diawali tindakan konkret yang bisa dilakukan pembaca.'
      case 'SCHEMA_INVALID':
      case 'INVALID_RESPONSE':
        return 'Struktur JSON tidak valid; ikuti contoh objek question + actions.'
      default:
        // Use message if it looks reader-facing; never echo raw PROVIDER_ERROR codes as mustNotInclude
        return f.message && f.message.length <= 160
          ? f.message
          : 'Perbaiki dua tindakan agar valid dan grounded pada akhir bab.'
    }
  })
}
