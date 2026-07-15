import 'server-only'
import { createAdminClient } from '@lakoku/db'

export interface AdminDashboardMetrics {
  totalUsers: number
  newUsersToday: number
  totalCreditsCirculating: number
  creditsUsedToday: number
  paidOrdersToday: number
  revenueTodayIdr: number
  generationAttemptsToday: number
  generationFailuresToday: number
  consistencyCriticalRate: number | null
}

export async function loadAdminDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const metrics: AdminDashboardMetrics = {
    totalUsers: 0,
    newUsersToday: 0,
    totalCreditsCirculating: 0,
    creditsUsedToday: 0,
    paidOrdersToday: 0,
    revenueTodayIdr: 0,
    generationAttemptsToday: 0,
    generationFailuresToday: 0,
    consistencyCriticalRate: null,
  }

  // --- Users (auth.users via admin API) ---
  try {
    const { count: totalUsers } = await db
      .from('reader_taste_profiles')
      .select('*', { count: 'exact', head: true })
    metrics.totalUsers = totalUsers ?? 0
  } catch { /* No-op */ }

  try {
    const { count: newToday } = await db
      .from('reader_taste_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`)
    metrics.newUsersToday = newToday ?? 0
  } catch { /* No-op */ }

  // --- Credit totals ---
  // Note: credit_balance_v1 is per-user; circulating total uses ledger sum below.

  try {
    const { data: circ } = await db
      .from('credit_ledger')
      .select('delta')
    if (circ) {
      metrics.totalCreditsCirculating = (circ as { delta: number }[]).reduce(
        (s, r) => s + r.delta, 0,
      )
    }
  } catch { /* No-op */ }

  try {
    const { data: used } = await db
      .from('credit_ledger')
      .select('delta')
      .lt('delta', 0)
      .gte('created_at', `${today}T00:00:00`)
    if (used) {
      metrics.creditsUsedToday = (used as { delta: number }[]).reduce(
        (s, r) => s + Math.abs(r.delta), 0,
      )
    }
  } catch { /* No-op */ }

  // --- Orders ---
  try {
    const { count: paidToday } = await db
      .from('credit_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid')
      .gte('paid_at', `${today}T00:00:00`)
    metrics.paidOrdersToday = paidToday ?? 0

    const { data: revenueRows } = await db
      .from('credit_orders')
      .select('price_idr')
      .eq('status', 'paid')
      .gte('paid_at', `${today}T00:00:00`)
    if (revenueRows) {
      metrics.revenueTodayIdr = (revenueRows as { price_idr: number }[]).reduce(
        (s, r) => s + r.price_idr, 0,
      )
    }
  } catch { /* No-op */ }

  // --- Generation (via observability) ---
  try {
    const { data: gen } = await db
      .from('story_events')
      .select('payload')
      .eq('event_name', 'GENERATION_ATTEMPT')
      .gte('created_at', `${today}T00:00:00`)
    if (gen) {
      metrics.generationAttemptsToday = gen.length
      const failures = gen.filter((e) => {
        const p = (e.payload as Record<string, unknown>)?.outcome
        return p !== 'PUBLISHED'
      }).length
      metrics.generationFailuresToday = failures
    }
  } catch { /* No-op */ }

  return metrics
}
