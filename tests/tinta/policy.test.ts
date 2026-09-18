import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TINTA_POLICY,
  calculateTintaExchange,
  authorRewardRef,
  tintaAmountBucket,
  lakoinOutBucket,
  jakartaDay,
  TINTA_SOURCES,
  AUTHOR_REWARD_STATUSES,
  type TintaPolicy,
  type TintaSource,
  type AuthorRewardStatus,
} from '@/lib/tinta/policy'

describe('lib/tinta/policy (Pure Domain)', () => {
  describe('AC2.1: TintaPolicy and default values', () => {
    it('exports DEFAULT_TINTA_POLICY with 11 exact knobs and default values', () => {
      expect(DEFAULT_TINTA_POLICY).toEqual({
        tintaPerRead: 10,
        authorDailyCap: 300,
        tintaCheckin: 5,
        tintaChoice: 10,
        tintaAdBatch: 10,
        tintaPerLakoin: 100,
        exchangeMinLakoin: 1,
        pendingHours: 24,
        authorRewardsEnabled: false,
        exchangeEnabled: false,
        missionsPayTinta: false,
      })
    })

    it('contains all required TintaSource values', () => {
      const sources: TintaSource[] = [
        'mission_checkin',
        'mission_choice',
        'mission_ad_batch',
        'author_read_reward',
      ]
      expect(TINTA_SOURCES).toEqual(sources)
    })

    it('contains all required AuthorRewardStatus values', () => {
      const statuses: AuthorRewardStatus[] = [
        'ok',
        'duplicate',
        'capped',
        'disabled',
        'ineligible',
      ]
      expect(AUTHOR_REWARD_STATUSES).toEqual(statuses)
    })
  })

  describe('AC2.2: calculateTintaExchange', () => {
    const activePolicy: TintaPolicy = {
      ...DEFAULT_TINTA_POLICY,
      exchangeEnabled: true,
    }

    it('throws reader-safe error when exchange is disabled', () => {
      expect(() => calculateTintaExchange(250, DEFAULT_TINTA_POLICY)).toThrow(
        'Penukaran sedang dinonaktifkan.',
      )
    })

    it('calculates exchange correctly: 250 Tinta @ 100 = 2 Lakoin + 50 remainder', () => {
      const result = calculateTintaExchange(250, activePolicy)
      expect(result).toEqual({
        lakoinOut: 2,
        tintaSpent: 200,
        remainderTinta: 50,
      })
    })

    it('calculates exact exchange without remainder: 100 Tinta = 1 Lakoin + 0 remainder', () => {
      const result = calculateTintaExchange(100, activePolicy)
      expect(result).toEqual({
        lakoinOut: 1,
        tintaSpent: 100,
        remainderTinta: 0,
      })
    })

    it('throws reader-safe error when amount produces less than exchangeMinLakoin (99 Tinta)', () => {
      expect(() => calculateTintaExchange(99, activePolicy)).toThrow(
        'Penukaran minimal 1 Lakoin.',
      )
    })

    it('throws reader-safe error on non-positive or invalid amounts', () => {
      expect(() => calculateTintaExchange(0, activePolicy)).toThrow(
        'Penukaran minimal 1 Lakoin.',
      )
      expect(() => calculateTintaExchange(-50, activePolicy)).toThrow(
        'Penukaran minimal 1 Lakoin.',
      )
      expect(() => calculateTintaExchange(NaN, activePolicy)).toThrow(
        'Penukaran minimal 1 Lakoin.',
      )
    })

    it('respects custom exchangeMinLakoin > 1', () => {
      const minTwoPolicy: TintaPolicy = {
        ...activePolicy,
        exchangeMinLakoin: 2,
      }

      // 150 Tinta gives 1 Lakoin < 2 -> should throw
      expect(() => calculateTintaExchange(150, minTwoPolicy)).toThrow(
        'Penukaran minimal 2 Lakoin.',
      )

      // 200 Tinta gives 2 Lakoin >= 2 -> should succeed
      const result = calculateTintaExchange(200, minTwoPolicy)
      expect(result).toEqual({
        lakoinOut: 2,
        tintaSpent: 200,
        remainderTinta: 0,
      })

      // 350 Tinta gives 3 Lakoin >= 2 -> should succeed with remainder
      const result2 = calculateTintaExchange(350, minTwoPolicy)
      expect(result2).toEqual({
        lakoinOut: 3,
        tintaSpent: 300,
        remainderTinta: 50,
      })
    })

    it('respects custom exchange rate (tintaPerLakoin)', () => {
      const customRatePolicy: TintaPolicy = {
        ...activePolicy,
        tintaPerLakoin: 50,
      }

      const result = calculateTintaExchange(125, customRatePolicy)
      expect(result).toEqual({
        lakoinOut: 2,
        tintaSpent: 100,
        remainderTinta: 25,
      })
    })

    it('throws error when exchange rate is invalid', () => {
      const invalidRatePolicy: TintaPolicy = {
        ...activePolicy,
        tintaPerLakoin: 0,
      }
      expect(() => calculateTintaExchange(100, invalidRatePolicy)).toThrow(
        'Kurs penukaran tidak valid.',
      )
    })

    it('floors decimal amounts safely', () => {
      const result = calculateTintaExchange(250.9, activePolicy)
      expect(result).toEqual({
        lakoinOut: 2,
        tintaSpent: 200,
        remainderTinta: 50,
      })
    })
  })

  describe('AC2.3: authorRewardRef & analytics buckets', () => {
    it('formats authorRewardRef exactly as author_read:{storyId}:{chapter}:{readerId}', () => {
      const ref1 = authorRewardRef('story-123', 5, 'user-456')
      expect(ref1).toBe('author_read:story-123:5:user-456')

      const ref2 = authorRewardRef('uuid-story-abc', '12', 'uuid-reader-xyz')
      expect(ref2).toBe('author_read:uuid-story-abc:12:uuid-reader-xyz')
    })

    describe('tintaAmountBucket', () => {
      it('categorizes 1_9 bucket boundaries', () => {
        expect(tintaAmountBucket(0)).toBe('1_9')
        expect(tintaAmountBucket(1)).toBe('1_9')
        expect(tintaAmountBucket(5)).toBe('1_9')
        expect(tintaAmountBucket(9)).toBe('1_9')
      })

      it('categorizes 10_49 bucket boundaries', () => {
        expect(tintaAmountBucket(10)).toBe('10_49')
        expect(tintaAmountBucket(25)).toBe('10_49')
        expect(tintaAmountBucket(49)).toBe('10_49')
      })

      it('categorizes 50_99 bucket boundaries', () => {
        expect(tintaAmountBucket(50)).toBe('50_99')
        expect(tintaAmountBucket(75)).toBe('50_99')
        expect(tintaAmountBucket(99)).toBe('50_99')
      })

      it('categorizes 100_plus bucket boundaries', () => {
        expect(tintaAmountBucket(100)).toBe('100_plus')
        expect(tintaAmountBucket(250)).toBe('100_plus')
        expect(tintaAmountBucket(10000)).toBe('100_plus')
      })
    })

    describe('lakoinOutBucket', () => {
      it('categorizes 1_4 bucket boundaries', () => {
        expect(lakoinOutBucket(0)).toBe('1_4')
        expect(lakoinOutBucket(1)).toBe('1_4')
        expect(lakoinOutBucket(4)).toBe('1_4')
      })

      it('categorizes 5_19 bucket boundaries', () => {
        expect(lakoinOutBucket(5)).toBe('5_19')
        expect(lakoinOutBucket(12)).toBe('5_19')
        expect(lakoinOutBucket(19)).toBe('5_19')
      })

      it('categorizes 20_99 bucket boundaries', () => {
        expect(lakoinOutBucket(20)).toBe('20_99')
        expect(lakoinOutBucket(50)).toBe('20_99')
        expect(lakoinOutBucket(99)).toBe('20_99')
      })

      it('categorizes 100_plus bucket boundaries', () => {
        expect(lakoinOutBucket(100)).toBe('100_plus')
        expect(lakoinOutBucket(500)).toBe('100_plus')
      })
    })
  })

  describe('AC2.4: Pure domain re-export', () => {
    it('re-exports jakartaDay function returning YYYY-MM-DD in Asia/Jakarta', () => {
      const today = jakartaDay()
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      // Test with specific known date in UTC: 2026-09-19T00:00:00Z -> 07:00 WIB
      const sampleDate = new Date('2026-09-19T00:00:00Z')
      expect(jakartaDay(sampleDate)).toBe('2026-09-19')
    })
  })
})
