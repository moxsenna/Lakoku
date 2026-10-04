import { getDb, rpcOne, single } from '@lakoku/db'
import {
  DEFAULT_MISSION_POLICY,
  isMissionKey,
  type MissionKey,
  type MissionPolicy,
  type MissionView,
} from './policy'

export interface DailyMissionsSnapshot {
  enabled: boolean
  adRewardEnabled: boolean
  day: string
  adsWatched: number
  adDailyCap: number
  adsPerCredit: number
  currency?: 'lakoin' | 'tinta'
  missions: MissionView[]
}

export async function getMissionPolicy(): Promise<MissionPolicy> {
  try {
    // RLS_AUDIT: mission_policy tabel konfigurasi publik singleton
    const db = getDb()
    const { data, error } = await single(
      db
        .selectFrom('mission_policy')
        .selectAll()
        .where('id', '=', true)
        .execute()
    )

    if (error || !data) {
      return DEFAULT_MISSION_POLICY
    }

    return {
      missionsEnabled: data.missions_enabled ?? DEFAULT_MISSION_POLICY.missionsEnabled,
      adRewardEnabled: data.ad_reward_enabled ?? DEFAULT_MISSION_POLICY.adRewardEnabled,
      adsenseEnabled: data.adsense_enabled ?? DEFAULT_MISSION_POLICY.adsenseEnabled,
      checkinCredits: data.checkin_credits ?? DEFAULT_MISSION_POLICY.checkinCredits,
      choiceCredits: data.choice_credits ?? DEFAULT_MISSION_POLICY.choiceCredits,
      adBatchCredits: data.ad_batch_credits ?? DEFAULT_MISSION_POLICY.adBatchCredits,
      choiceRequired: data.choice_required ?? DEFAULT_MISSION_POLICY.choiceRequired,
      adsPerCredit: data.ads_per_credit ?? DEFAULT_MISSION_POLICY.adsPerCredit,
      adDailyCap: data.ad_daily_cap ?? DEFAULT_MISSION_POLICY.adDailyCap,
      ssvFreshnessSeconds: data.ssv_freshness_seconds ?? DEFAULT_MISSION_POLICY.ssvFreshnessSeconds,
      adsenseClientId: data.adsense_client_id ?? DEFAULT_MISSION_POLICY.adsenseClientId,
      adsenseSlotShareLanding:
        data.adsense_slot_share_landing ?? DEFAULT_MISSION_POLICY.adsenseSlotShareLanding,
      adsenseSlotEnding: data.adsense_slot_ending ?? DEFAULT_MISSION_POLICY.adsenseSlotEnding,
      adsenseSlotBeranda: data.adsense_slot_beranda ?? DEFAULT_MISSION_POLICY.adsenseSlotBeranda,
      adsenseSlotCredit: data.adsense_slot_credit ?? DEFAULT_MISSION_POLICY.adsenseSlotCredit,
    }
  } catch {
    return DEFAULT_MISSION_POLICY
  }
}

interface RawMissionPayload {
  key?: string
  progress?: number
  required?: number
  credits?: number
  claimed?: boolean
  currency?: string
}

interface RawSnapshotPayload {
  enabled?: boolean
  adRewardEnabled?: boolean
  day?: string
  adsWatched?: number
  adDailyCap?: number
  adsPerCredit?: number
  currency?: string
  missions?: RawMissionPayload[]
}

export async function getDailyMissions(userId: string): Promise<DailyMissionsSnapshot> {
  // RLS_AUDIT: get_daily_missions_v1 membaca snapshot misi pengguna p_user_id
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'get_daily_missions_v1', { p_user_id: userId }).execute()
  )
  const rawData = ((data as Record<string, unknown> | null)?.fn ?? data) as RawSnapshotPayload | null

  if (error || !rawData) {
    const fallback = await getMissionPolicy()
    return {
      enabled: fallback.missionsEnabled,
      adRewardEnabled: fallback.adRewardEnabled,
      day: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      adsWatched: 0,
      adDailyCap: fallback.adDailyCap,
      adsPerCredit: fallback.adsPerCredit,
      currency: 'lakoin',
      missions: [],
    }
  }

  const raw = rawData
  const snapshotCurrency: 'lakoin' | 'tinta' =
    raw.currency === 'tinta' ? 'tinta' : 'lakoin'
  const missions: MissionView[] = []

  for (const item of raw.missions ?? []) {
    if (!item.key || !isMissionKey(item.key)) continue
    const itemCurrency: 'lakoin' | 'tinta' =
      item.currency === 'tinta' ? 'tinta' : item.currency === 'lakoin' ? 'lakoin' : snapshotCurrency
    missions.push({
      key: item.key,
      progress: Number(item.progress ?? 0),
      required: Number(item.required ?? 1),
      credits: Number(item.credits ?? 0),
      claimed: Boolean(item.claimed),
      currency: itemCurrency,
    })
  }

  return {
    enabled: Boolean(raw.enabled),
    adRewardEnabled: Boolean(raw.adRewardEnabled),
    day: String(raw.day ?? ''),
    adsWatched: Number(raw.adsWatched ?? 0),
    adDailyCap: Number(raw.adDailyCap ?? 0),
    adsPerCredit: Number(raw.adsPerCredit ?? 0),
    currency: snapshotCurrency,
    missions,
  }
}

export type ClaimMissionResult =
  | { ok: true; status: 'ok' }
  | {
      ok: false
      reason: 'disabled' | 'duplicate' | 'incomplete' | 'unknown_mission' | 'error'
      message: string
    }

export async function claimMission(
  userId: string,
  missionKey: MissionKey,
): Promise<ClaimMissionResult> {
  if (!isMissionKey(missionKey)) {
    return {
      ok: false,
      reason: 'unknown_mission',
      message: 'Misi tidak dikenali.',
    }
  }

  // RLS_AUDIT: claim_mission_v1 memvalidasi & mengklaim hadiah misi p_user_id
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'claim_mission_v1', {
      p_user_id: userId,
      p_mission_key: missionKey,
    }).execute()
  )

  if (error) {
    return {
      ok: false,
      reason: 'error',
      message: `Gagal mengklaim misi: ${error.message}`,
    }
  }

  const status = ((data as Record<string, unknown> | null)?.fn ?? data) as string
  if (status === 'ok') {
    return { ok: true, status: 'ok' }
  }

  const messages: Record<string, string> = {
    disabled: 'Misi sedang tidak aktif.',
    duplicate: 'Misi ini sudah kamu klaim hari ini.',
    incomplete: 'Syarat misi belum terpenuhi.',
    unknown_mission: 'Misi tidak ditemukan.',
  }

  return {
    ok: false,
    reason: (status as 'disabled' | 'duplicate' | 'incomplete' | 'unknown_mission') || 'error',
    message: messages[status] ?? 'Klaim tidak dapat diproses.',
  }
}

export type RecordSsvResult =
  | { ok: true; status: 'valid' }
  | {
      ok: false
      status: 'duplicate' | 'cap_exceeded' | 'policy_disabled' | 'error'
    }

export async function recordAdMobSsv(args: {
  userId: string
  transactionId: string
  adUnit: string
  rewardAmount: number
}): Promise<RecordSsvResult> {
  // RLS_AUDIT: record_admob_ssv_v1 mencatat verifikasi server side ad mob per user
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'record_admob_ssv_v1', {
      p_user_id: args.userId,
      p_transaction_id: args.transactionId,
      p_ad_unit: args.adUnit,
      p_reward_amount: args.rewardAmount,
    }).execute()
  )

  if (error) {
    return { ok: false, status: 'error' }
  }

  const status = ((data as Record<string, unknown> | null)?.fn ?? data) as string
  if (status === 'valid') {
    return { ok: true, status: 'valid' }
  }

  return {
    ok: false,
    status: (status as 'duplicate' | 'cap_exceeded' | 'policy_disabled') || 'error',
  }
}

export async function recordAdMobRejection(args: {
  transactionId: string
  userId: string | null
  status: 'invalid_signature' | 'stale' | 'unknown_user'
}): Promise<void> {
  try {
    // RLS_AUDIT: record_admob_rejection_v1 audit kegagalan admob verifikasi
    const db = getDb()
    await rpcOne(db, 'record_admob_rejection_v1', {
      p_transaction_id: args.transactionId,
      p_user_id: args.userId,
      p_status: args.status,
    }).execute()
  } catch {
    // Audit kegagalan best-effort, jangan menutupi respons HTTP asli
  }
}
