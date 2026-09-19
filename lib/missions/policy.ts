/**
 * Logika murni domain Misi Harian & Iklan Rewarded (bebas I/O dan server-only).
 *
 * Catatan desain: hanya tiga misi di v1, semuanya punya bukti sisi server.
 * `read_chapter` ditunda karena membuka halaman bukan bukti membaca, dan
 * `finish_story` ditunda sebagai misi harian karena cerita Lakoku 50 bab.
 */

export type MissionKey = 'daily_checkin' | 'make_choice' | 'watch_ad'

export const MISSION_KEYS: readonly MissionKey[] = [
  'daily_checkin',
  'make_choice',
  'watch_ad',
] as const

export interface MissionPolicy {
  missionsEnabled: boolean
  adRewardEnabled: boolean
  adsenseEnabled: boolean
  checkinCredits: number
  choiceCredits: number
  adBatchCredits: number
  choiceRequired: number
  adsPerCredit: number
  adDailyCap: number
  ssvFreshnessSeconds: number
  adsenseClientId: string
  adsenseSlotShareLanding: string
  adsenseSlotEnding: string
  adsenseSlotBeranda: string
  adsenseSlotCredit: string
}

export const DEFAULT_MISSION_POLICY: MissionPolicy = {
  missionsEnabled: true,
  adRewardEnabled: false, // default mati: tiap kredit didanai inferensi berbayar
  adsenseEnabled: false,
  checkinCredits: 1,
  choiceCredits: 1,
  adBatchCredits: 1,
  choiceRequired: 3,
  adsPerCredit: 5,
  adDailyCap: 10,
  ssvFreshnessSeconds: 600,
  adsenseClientId: '',
  adsenseSlotShareLanding: '',
  adsenseSlotEnding: '',
  adsenseSlotBeranda: '',
  adsenseSlotCredit: '',
}

export interface MissionLabel {
  title: string
  description: string
}

/** Teks tampilan misi dalam Bahasa Indonesia, tanpa istilah teknis. */
export const MISSION_LABELS: Record<MissionKey, MissionLabel> = {
  daily_checkin: {
    title: 'Hadir Hari Ini',
    description: 'Buka Lakoku hari ini dan ambil hadiah kehadiranmu.',
  },
  make_choice: {
    title: 'Tentukan Langkahmu',
    description: 'Ambil keputusan di dalam cerita untuk menggerakkan kisahmu.',
  },
  watch_ad: {
    title: 'Tonton Sekilas',
    description: 'Tonton tayangan singkat untuk menambah hadiahmu.',
  },
}

export interface MissionView {
  key: MissionKey
  progress: number
  required: number
  credits: number
  claimed: boolean
  currency?: 'lakoin' | 'tinta'
}

export type ClaimBlockReason = 'disabled' | 'claimed' | 'incomplete' | null

/** Tentukan apakah sebuah misi siap diklaim, beserta alasan bila tidak. */
export function evaluateClaimability(
  mission: MissionView,
  policy: MissionPolicy,
): { claimable: boolean; reason: ClaimBlockReason } {
  if (!policy.missionsEnabled) return { claimable: false, reason: 'disabled' }
  if (mission.key === 'watch_ad' && !policy.adRewardEnabled) {
    return { claimable: false, reason: 'disabled' }
  }
  if (mission.claimed) return { claimable: false, reason: 'claimed' }
  if (mission.progress < mission.required) return { claimable: false, reason: 'incomplete' }
  return { claimable: true, reason: null }
}

export interface AdBatchState {
  /** Berapa tayangan lagi sampai satu kredit penuh. */
  remainingToCredit: number
  /** Sisa kuota tayangan hari ini. */
  remainingToday: number
  /** Kuota harian sudah habis. */
  capReached: boolean
}

/** Hitung posisi pembaca dalam batch iklan hari ini. */
export function calculateAdBatch(adsWatched: number, policy: MissionPolicy): AdBatchState {
  const watched = Math.max(0, adsWatched)
  const withinBatch = watched % policy.adsPerCredit
  const remainingToCredit = withinBatch === 0 && watched > 0 ? 0 : policy.adsPerCredit - withinBatch
  const remainingToday = Math.max(0, policy.adDailyCap - watched)

  return {
    remainingToCredit,
    remainingToday,
    capReached: remainingToday === 0,
  }
}

/** Tanggal hari ini dalam zona Asia/Jakarta sebagai `YYYY-MM-DD`. */
export function jakartaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Callback AdMob dianggap basi bila stempel waktunya di luar jendela kesegaran.
 * Ini mempersempit peluang pemutaran ulang callback yang dicuri.
 */
export function isSsvTimestampFresh(
  timestampMs: number,
  policy: MissionPolicy,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false
  const driftMs = Math.abs(now.getTime() - timestampMs)
  return driftMs <= policy.ssvFreshnessSeconds * 1000
}

/** Cek apakah sebuah kunci misi dikenali. */
export function isMissionKey(value: string): value is MissionKey {
  return (MISSION_KEYS as readonly string[]).includes(value)
}

/**
 * AdSense hanya boleh dimuat bila dinyalakan, punya client id, punya slot, dan
 * pembaca bukan pembeli kredit. Dipakai sisi server sebelum merender apa pun.
 */
export function shouldRenderAdsense(args: {
  policy: MissionPolicy
  slotId: string
  hasPaidTopup: boolean
  isNativeApp: boolean
}): boolean {
  if (args.isNativeApp) return false // AdSense di WebView melanggar kebijakan penerbit
  if (!args.policy.adsenseEnabled) return false
  if (!args.policy.adsenseClientId) return false
  if (!args.slotId) return false
  if (args.hasPaidTopup) return false
  return true
}
