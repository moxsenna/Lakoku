import { createAdminClient } from '@lakoku/db'
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
    const db = createAdminClient()
    const { data, error } = await db
      .from('mission_policy')
      .select('*')
      .eq('id', true)
      .maybeSingle()

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
  const db = createAdminClient()
  const { data, error } = await db.rpc('get_daily_missions_v1', { p_user_id: userId })

  if (error || !data) {
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

  const raw = data as RawSnapshotPayload
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

  const db = createAdminClient()
  const { data, error } = await db.rpc('claim_mission_v1', {
    p_user_id: userId,
    p_mission_key: missionKey,
  })

  if (error) {
    return {
      ok: false,
      reason: 'error',
      message: `Gagal mengklaim misi: ${error.message}`,
    }
  }

  const status = data as string
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
  const db = createAdminClient()
  const { data, error } = await db.rpc('record_admob_ssv_v1', {
    p_user_id: args.userId,
    p_transaction_id: args.transactionId,
    p_ad_unit: args.adUnit,
    p_reward_amount: args.rewardAmount,
  })

  if (error) {
    return { ok: false, status: 'error' }
  }

  const status = data as string
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
    const db = createAdminClient()
    await db.rpc('record_admob_rejection_v1', {
      p_transaction_id: args.transactionId,
      p_user_id: args.userId,
      p_status: args.status,
    })
  } catch {
    // Audit kegagalan best-effort, jangan menutupi respons HTTP asli
  }
}
