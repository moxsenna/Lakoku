'use client'

import { useEffect } from 'react'
import { trackEvent } from '@/lib/analytics/client'
import type { AnalyticsClientPayload, AnalyticsEventName } from '@/lib/analytics/events'

/** Kirim satu event saat halaman server dibuka. Tidak merender apa pun. */
export function TrackOnView({
  event,
  payload,
}: {
  event: AnalyticsEventName
  payload?: AnalyticsClientPayload
}) {
  const key = JSON.stringify(payload ?? {})
  useEffect(() => {
    trackEvent(event, JSON.parse(key) as AnalyticsClientPayload)
  }, [event, key])
  return null
}
