import { getDb, rpcOne, single } from '@lakoku/db'
import { getMissionPolicy } from '@/lib/missions/server'
import { shouldRenderAdsense } from '@/lib/missions/policy'

export type AdSlotKey = 'shareLanding' | 'ending' | 'beranda' | 'credit'

export interface ResolvedAdSlot {
  shouldRender: boolean
  clientId: string
  slotId: string
}

/**
 * Cek apakah slot iklan AdSense harus dirender di sisi server untuk pengguna
 * saat ini. Menyembunyikan iklan sepenuhnya untuk pembeli kredit.
 */
export async function resolveAdSlot(args: {
  slotKey: AdSlotKey
  userId?: string | null
}): Promise<ResolvedAdSlot> {
  const policy = await getMissionPolicy()

  let hasPaidTopup = false
  if (args.userId) {
    try {
      // RLS_AUDIT: has_paid_topup_v1 membaca status pembayaran topup per p_user_id
      const db = getDb()
      const { data } = await single(
        rpcOne(db, 'has_paid_topup_v1', { p_user_id: args.userId }).execute()
      )
      const raw = (data as Record<string, unknown> | null)?.fn ?? data
      hasPaidTopup = Boolean(raw)
    } catch {
      hasPaidTopup = false
    }
  }

  const slotMap: Record<AdSlotKey, string> = {
    shareLanding: policy.adsenseSlotShareLanding,
    ending: policy.adsenseSlotEnding,
    beranda: policy.adsenseSlotBeranda,
    credit: policy.adsenseSlotCredit,
  }

  const slotId = slotMap[args.slotKey] ?? ''
  const shouldRender = shouldRenderAdsense({
    policy,
    slotId,
    hasPaidTopup,
    isNativeApp: false, // Pemeriksaan server; klien mengecek ulang via Capacitor.isNativePlatform()
  })

  return {
    shouldRender,
    clientId: policy.adsenseClientId,
    slotId,
  }
}
