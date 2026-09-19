import 'server-only'
import { createAdminClient } from '@lakoku/db'
import {
  AnalyticsEventSchema,
  type AnalyticsClientPayload,
  type AnalyticsEventName,
} from './events'

export interface TrackServerEventOptions {
  userId?: string | null
  anonymousId?: string | null
}

/**
 * Server-side analytics tracker — insert ke analytics_events via admin client.
 * Pola insert admin client + anonim (user_id nullable, anonymous_id null).
 * Fire-and-forget: tidak pernah throw, tidak menunggu / memblokir caller.
 */
export function trackServerEvent(
  name: AnalyticsEventName,
  payload: AnalyticsClientPayload = {},
  options?: TrackServerEventOptions,
): void {
  try {
    const fullPayload = {
      event_name: name,
      anonymous_id: options?.anonymousId ?? null,
      created_at: new Date().toISOString(),
      ...(options?.userId ? { is_logged_in: true } : {}),
      ...payload,
    }

    const parsed = AnalyticsEventSchema.safeParse(fullPayload)
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[analytics:server] invalid event payload', parsed.error.issues)
      }
      return
    }

    const admin = createAdminClient()
    void Promise.resolve(
      admin.from('analytics_events').insert({
        user_id: options?.userId ?? null,
        anonymous_id: parsed.data.anonymous_id,
        event_name: parsed.data.event_name,
        payload: parsed.data,
      }),
    ).catch(() => {})
  } catch {
    // Non-critical — jangan pernah throw
  }
}
