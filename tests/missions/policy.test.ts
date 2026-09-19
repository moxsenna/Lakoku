import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MISSION_POLICY,
  MISSION_KEYS,
  MISSION_LABELS,
  calculateAdBatch,
  evaluateClaimability,
  isMissionKey,
  isSsvTimestampFresh,
  jakartaDay,
  shouldRenderAdsense,
  type MissionPolicy,
  type MissionView,
} from '@/lib/missions/policy'

const policy = (over: Partial<MissionPolicy> = {}): MissionPolicy => ({
  ...DEFAULT_MISSION_POLICY,
  ...over,
})

const mission = (over: Partial<MissionView> = {}): MissionView => ({
  key: 'make_choice',
  progress: 3,
  required: 3,
  credits: 1,
  claimed: false,
  ...over,
})

describe('DEFAULT_MISSION_POLICY', () => {
  it('menonaktifkan imbalan iklan secara bawaan', () => {
    expect(DEFAULT_MISSION_POLICY.adRewardEnabled).toBe(false)
  })

  it('menonaktifkan AdSense secara bawaan', () => {
    expect(DEFAULT_MISSION_POLICY.adsenseEnabled).toBe(false)
  })

  it('tidak menyertakan id klien AdSense hardcode', () => {
    expect(DEFAULT_MISSION_POLICY.adsenseClientId).toBe('')
  })
})

describe('MISSION_KEYS', () => {
  it('hanya berisi tiga misi terbukti sisi server', () => {
    expect(MISSION_KEYS).toEqual(['daily_checkin', 'make_choice', 'watch_ad'])
  })

  it('punya label bahasa Indonesia untuk setiap kunci', () => {
    for (const key of MISSION_KEYS) {
      expect(MISSION_LABELS[key].title.length).toBeGreaterThan(0)
      expect(MISSION_LABELS[key].description.length).toBeGreaterThan(0)
    }
  })

  it('tidak membocorkan istilah terlarang ke pembaca', () => {
    const banned = /\b(AI|Narraza|RAG|token)\b/i
    for (const key of MISSION_KEYS) {
      expect(MISSION_LABELS[key].title).not.toMatch(banned)
      expect(MISSION_LABELS[key].description).not.toMatch(banned)
    }
  })
})

describe('isMissionKey', () => {
  it('menerima kunci yang dikenal', () => {
    expect(isMissionKey('watch_ad')).toBe(true)
  })

  it('menolak kunci asing', () => {
    expect(isMissionKey('read_chapter')).toBe(false)
    expect(isMissionKey('finish_story')).toBe(false)
    expect(isMissionKey('')).toBe(false)
  })
})

describe('evaluateClaimability', () => {
  it('membolehkan klaim saat kemajuan terpenuhi', () => {
    expect(evaluateClaimability(mission(), policy())).toEqual({ claimable: true, reason: null })
  })

  it('menolak saat misi global dimatikan', () => {
    expect(evaluateClaimability(mission(), policy({ missionsEnabled: false }))).toEqual({
      claimable: false,
      reason: 'disabled',
    })
  })

  it('menolak watch_ad saat imbalan iklan mati meski kemajuan penuh', () => {
    const view = mission({ key: 'watch_ad', progress: 5, required: 5 })
    expect(evaluateClaimability(view, policy({ adRewardEnabled: false })).reason).toBe('disabled')
  })

  it('membolehkan watch_ad saat imbalan iklan dinyalakan', () => {
    const view = mission({ key: 'watch_ad', progress: 5, required: 5 })
    expect(evaluateClaimability(view, policy({ adRewardEnabled: true })).claimable).toBe(true)
  })

  it('menolak klaim ganda', () => {
    expect(evaluateClaimability(mission({ claimed: true }), policy()).reason).toBe('claimed')
  })

  it('menolak saat kemajuan kurang', () => {
    expect(evaluateClaimability(mission({ progress: 2 }), policy()).reason).toBe('incomplete')
  })
})

describe('calculateAdBatch', () => {
  it('meminta batch penuh saat belum menonton', () => {
    expect(calculateAdBatch(0, policy())).toEqual({
      remainingToCredit: 5,
      remainingToday: 10,
      capReached: false,
    })
  })

  it('menghitung sisa dalam batch berjalan', () => {
    expect(calculateAdBatch(3, policy()).remainingToCredit).toBe(2)
  })

  it('menandai batch genap sebagai siap', () => {
    expect(calculateAdBatch(5, policy()).remainingToCredit).toBe(0)
  })

  it('menandai kuota habis saat mencapai batas harian', () => {
    const state = calculateAdBatch(10, policy())
    expect(state.capReached).toBe(true)
    expect(state.remainingToday).toBe(0)
  })

  it('tidak pernah mengembalikan sisa negatif saat data melebihi batas', () => {
    const state = calculateAdBatch(99, policy())
    expect(state.remainingToday).toBe(0)
    expect(state.capReached).toBe(true)
  })

  it('memperlakukan nilai negatif sebagai nol', () => {
    expect(calculateAdBatch(-5, policy()).remainingToCredit).toBe(5)
  })
})

describe('jakartaDay', () => {
  it('memakai zona Jakarta, bukan UTC', () => {
    // 2026-09-18T17:30:00Z = 2026-09-19 00:30 WIB
    expect(jakartaDay(new Date('2026-09-18T17:30:00Z'))).toBe('2026-09-19')
  })

  it('tetap di hari yang sama sebelum tengah malam WIB', () => {
    expect(jakartaDay(new Date('2026-09-18T16:00:00Z'))).toBe('2026-09-18')
  })
})

describe('isSsvTimestampFresh', () => {
  const now = new Date('2026-09-18T10:00:00Z')

  it('menerima stempel waktu dalam jendela', () => {
    expect(isSsvTimestampFresh(now.getTime() - 60_000, policy(), now)).toBe(true)
  })

  it('menolak stempel waktu kedaluwarsa', () => {
    expect(isSsvTimestampFresh(now.getTime() - 3_600_000, policy(), now)).toBe(false)
  })

  it('menolak stempel waktu masa depan yang jauh', () => {
    expect(isSsvTimestampFresh(now.getTime() + 3_600_000, policy(), now)).toBe(false)
  })

  it('menolak nilai tidak valid', () => {
    expect(isSsvTimestampFresh(0, policy(), now)).toBe(false)
    expect(isSsvTimestampFresh(Number.NaN, policy(), now)).toBe(false)
    expect(isSsvTimestampFresh(-1, policy(), now)).toBe(false)
  })
})

describe('shouldRenderAdsense', () => {
  const enabled = policy({ adsenseEnabled: true, adsenseClientId: 'ca-pub-123' })

  it('merender saat semua syarat terpenuhi', () => {
    expect(
      shouldRenderAdsense({
        policy: enabled,
        slotId: 'slot-1',
        hasPaidTopup: false,
        isNativeApp: false,
      }),
    ).toBe(true)
  })

  it('tidak pernah merender di aplikasi native', () => {
    expect(
      shouldRenderAdsense({
        policy: enabled,
        slotId: 'slot-1',
        hasPaidTopup: false,
        isNativeApp: true,
      }),
    ).toBe(false)
  })

  it('tidak merender untuk pembeli kredit', () => {
    expect(
      shouldRenderAdsense({
        policy: enabled,
        slotId: 'slot-1',
        hasPaidTopup: true,
        isNativeApp: false,
      }),
    ).toBe(false)
  })

  it('tidak merender saat sakelar mati', () => {
    expect(
      shouldRenderAdsense({
        policy: policy({ adsenseClientId: 'ca-pub-123' }),
        slotId: 'slot-1',
        hasPaidTopup: false,
        isNativeApp: false,
      }),
    ).toBe(false)
  })

  it('tidak merender tanpa id klien', () => {
    expect(
      shouldRenderAdsense({
        policy: policy({ adsenseEnabled: true }),
        slotId: 'slot-1',
        hasPaidTopup: false,
        isNativeApp: false,
      }),
    ).toBe(false)
  })

  it('tidak merender tanpa slot', () => {
    expect(
      shouldRenderAdsense({
        policy: enabled,
        slotId: '',
        hasPaidTopup: false,
        isNativeApp: false,
      }),
    ).toBe(false)
  })
})
