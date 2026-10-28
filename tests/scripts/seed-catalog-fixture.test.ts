import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { assertLoopbackDatabaseUrl } from '@/scripts/personalized-db-safety'
import {
  assertSeedAllowed,
  FIXTURE_CATALOG_CONTRACT,
  FIXTURE_CATALOG_STORY_ID,
  FIXTURE_BAB_44_CHOICES,
  FIXTURE_BAB_44_OUTCOMES,
} from '@/scripts/seed-catalog-fixture'
import { CatalogContractSnapshotSchema } from '@/lib/catalog/contract-snapshot'
import { mergeChoiceEffect, RouteChoiceEffectSchema } from '@/lib/story-engine/route-state'
import { resolveEndingFromCandidates } from '@/lib/story-engine/ending-resolver'

describe('scripts/seed-catalog-fixture safety guards & candidate structure', () => {
  describe('assertLoopbackDatabaseUrl', () => {
    it('refuses execution when DATABASE_URL points to remote neon.tech without override', () => {
      expect(() =>
        assertLoopbackDatabaseUrl('postgresql://lakoku_owner:secret@ep-cool-fog-12345.ap-southeast-1.neon.tech/neondb'),
      ).toThrow('Refusing to seed non-loopback host "ep-cool-fog-12345.ap-southeast-1.neon.tech"')
    })

    it('refuses execution when DATABASE_URL is undefined', () => {
      expect(() => assertLoopbackDatabaseUrl(undefined)).toThrow('DATABASE_URL is required')
    })

    it('allows remote neon.tech URL when allowRemote flag is explicitly true', () => {
      const host = assertLoopbackDatabaseUrl(
        'postgresql://lakoku_owner:secret@ep-cool-fog-12345.ap-southeast-1.neon.tech/neondb',
        true,
      )
      expect(host).toBe('ep-cool-fog-12345.ap-southeast-1.neon.tech')
    })

    it('allows loopback hosts (127.0.0.1, localhost, ::1) without override flag', () => {
      expect(assertLoopbackDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/lakoku_local')).toBe('127.0.0.1')
      expect(assertLoopbackDatabaseUrl('postgresql://postgres:postgres@localhost:5432/lakoku_local')).toBe('localhost')
      expect(assertLoopbackDatabaseUrl('postgresql://postgres:postgres@[::1]:5432/lakoku_local')).toBe('::1')
    })
  })

  describe('assertSeedAllowed', () => {
    it('refuses when LAKOKU_SEED_CATALOG is not set or not 1', () => {
      expect(() => assertSeedAllowed({ LAKOKU_SEED_CATALOG: undefined })).toThrow('LAKOKU_SEED_CATALOG=1 is required')
      expect(() => assertSeedAllowed({ LAKOKU_SEED_CATALOG: '0' })).toThrow('LAKOKU_SEED_CATALOG=1 is required')
    })

    it('refuses when DATABASE_URL is remote neon.tech without override', () => {
      expect(() =>
        assertSeedAllowed({
          LAKOKU_SEED_CATALOG: '1',
          DATABASE_URL: 'postgresql://lakoku_owner:secret@ep-cool-fog-12345.ap-southeast-1.neon.tech/neondb',
        }),
      ).toThrow('Refusing to seed non-loopback host "ep-cool-fog-12345.ap-southeast-1.neon.tech"')
    })

    it('allows loopback DATABASE_URL when LAKOKU_SEED_CATALOG=1', () => {
      const result = assertSeedAllowed({
        LAKOKU_SEED_CATALOG: '1',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/lakoku_local',
      })
      expect(result).toEqual({ host: '127.0.0.1' })
    })

    it('allows remote DATABASE_URL when LAKOKU_ALLOW_REMOTE_FIXTURE_SEED=1', () => {
      const result = assertSeedAllowed({
        LAKOKU_SEED_CATALOG: '1',
        DATABASE_URL: 'postgresql://lakoku_owner:secret@ep-cool-fog-12345.ap-southeast-1.neon.tech/neondb',
        LAKOKU_ALLOW_REMOTE_FIXTURE_SEED: '1',
      })
      expect(result).toEqual({ host: 'ep-cool-fog-12345.ap-southeast-1.neon.tech' })
    })
  })

  describe('fixture data validation & Bab 44 ending tilt', () => {
    it('fixture story id follows catalog:{slug} convention', () => {
      expect(FIXTURE_CATALOG_STORY_ID).toBe('catalog:bayang-tak-bertuan')
    })

    it('fixture contract snapshot parses with CatalogContractSnapshotSchema', () => {
      const parsed = CatalogContractSnapshotSchema.parse(FIXTURE_CATALOG_CONTRACT)
      expect(parsed.closureRunway.endingLockChapter).toBe(45)
      expect(parsed.endingCandidates).toHaveLength(3)

      const mainEndings = parsed.endingCandidates.filter((c) => c.kind === 'main')
      const secretEndings = parsed.endingCandidates.filter((c) => c.kind === 'secret')
      expect(mainEndings).toHaveLength(2)
      expect(secretEndings).toHaveLength(1)

      for (const candidate of parsed.endingCandidates) {
        expect(candidate.key).toBeTruthy()
        expect(candidate.name).toBeTruthy()
        expect(candidate.condition).toBeTruthy()
        expect(candidate.requiredClosure.length).toBeGreaterThan(0)
        expect(candidate.blockingConditions).toEqual([])
      }
    })

    it('each Bab 44 choice effect parses with RouteChoiceEffectSchema and resolves to a distinct ending key', () => {
      const contract = CatalogContractSnapshotSchema.parse(FIXTURE_CATALOG_CONTRACT)
      expect(FIXTURE_BAB_44_CHOICES).toHaveLength(3)
      expect(FIXTURE_BAB_44_OUTCOMES).toHaveLength(3)

      const resolvedEndingKeys = new Set<string>()

      for (let i = 0; i < FIXTURE_BAB_44_CHOICES.length; i++) {
        const choice = FIXTURE_BAB_44_CHOICES[i]
        const outcome = FIXTURE_BAB_44_OUTCOMES[i]
        expect(outcome.choiceId).toBe(choice.id)

        // Must strictly parse with RouteChoiceEffectSchema
        const effect = RouteChoiceEffectSchema.parse(outcome.effectJson)

        // Starting from empty/neutral route state, merge choice effect
        const nextRouteState = mergeChoiceEffect({}, effect)

        // Resolving ending at Bab 45 (endingLockChapter)
        const resolution = resolveEndingFromCandidates({
          routeState: nextRouteState,
          endingLockChapter: contract.closureRunway.endingLockChapter,
          endingCandidates: contract.endingCandidates,
          chapterNumber: 45,
        })

        resolvedEndingKeys.add(resolution.key)
      }

      // Exactly 3 distinct ending keys, matching the contract candidates
      expect(resolvedEndingKeys.size).toBe(3)
      const expectedKeys = new Set(contract.endingCandidates.map((c) => c.key))
      expect(resolvedEndingKeys).toEqual(expectedKeys)
    })
  })
})
