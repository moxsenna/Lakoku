/**
 * Client-side analytics tracker — fire-and-forget ke /api/analytics/track.
 *
 * trackEvent() tidak pernah throw, tidak pernah block UI, tidak await.
 * Anonymous ID digenerate sekali dan disimpan di localStorage.
 */
import type { AnalyticsEventName, AnalyticsClientPayload } from './events'

const ANONYMOUS_ID_KEY = 'lakoku:anonymous-id:v1'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function getAnonymousId(): string | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    let id = storage.getItem(ANONYMOUS_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      storage.setItem(ANONYMOUS_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

/**
 * Kirim event analytics ke server.
 * Fire-and-forget — tidak await, tidak throw, tidak block UI.
 */
export function trackEvent(
  name: AnalyticsEventName,
  payload: AnalyticsClientPayload = {},
): void {
  if (typeof window === 'undefined') return

  try {
    const anonymousId = getAnonymousId()

    const body = JSON.stringify({
      event_name: name,
      anonymous_id: anonymousId,
      created_at: new Date().toISOString(),
      ...payload,
    })

    void fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Analytics must never block UI.
  }
}
