import 'server-only'
import { createAdminClient } from '@lakoku/db'

export interface AdminGenerationMetric {
  attemptsToday: number
  successToday: number
  failedToday: number
  failureRate: number
}

export interface AdminGenerationEvent {
  id: string
  createdAt: string
  userId: string | null
  storyId: string | null
  chapterId: string | null
  status: string
  error: string | null
  durationMs: number | null
}

export async function loadAdminGenerationMetrics(): Promise<AdminGenerationMetric> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  try {
    const { data } = await db
      .from('story_events')
      .select('payload')
      .eq('event_name', 'GENERATION_ATTEMPT')
      .gte('created_at', `${today}T00:00:00`)

    if (!data) {
      return { attemptsToday: 0, successToday: 0, failedToday: 0, failureRate: 0 }
    }

    const attempts = data.length
    const success = data.filter((e) => {
      const p = (e.payload as Record<string, unknown>)?.outcome
      return p === 'PUBLISHED'
    }).length
    const failed = attempts - success

    return {
      attemptsToday: attempts,
      successToday: success,
      failedToday: failed,
      failureRate: attempts > 0 ? failed / attempts : 0,
    }
  } catch {
    return { attemptsToday: 0, successToday: 0, failedToday: 0, failureRate: 0 }
  }
}

export async function listAdminGenerationEvents(
  limit = 30,
): Promise<AdminGenerationEvent[]> {
  const db = createAdminClient()

  try {
    const { data } = await db
      .from('story_events')
      .select('id,created_at,payload')
      .eq('event_name', 'GENERATION_ATTEMPT')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!data) return []

    return (data as { id: string; created_at: string; payload: Record<string, unknown> }[]).map(
      (e) => {
        const p = e.payload ?? {}
        return {
          id: e.id,
          createdAt: e.created_at,
          userId: (p.user_id as string) ?? null,
          storyId: (p.story_id as string) ?? null,
          chapterId: p.chapter != null ? String(p.chapter) : null,
          status: (p.outcome as string) ?? 'UNKNOWN',
          error: (p.error as string) ?? null,
          durationMs: null,
        }
      },
    )
  } catch {
    return []
  }
}
