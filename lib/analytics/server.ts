import 'server-only'
import { getDb } from '@lakoku/db'
import type { Json } from '@/lib/supabase/db-types'
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

    const db = getDb()
    void Promise.resolve(
      db
        .insertInto('analytics_events')
        .values({
          user_id: options?.userId ?? null,
          anonymous_id: parsed.data.anonymous_id,
          event_name: parsed.data.event_name,
          payload: parsed.data as unknown as Json,
        })
        .execute(),
    ).catch(() => {})
  } catch {
    // Non-critical — jangan pernah throw
  }
}
