import { describe, expect, it } from 'vitest'
import pkg from '@/package.json'

describe('personalized database release gate', () => {
  it('provides explicit local-only REST/Auth plus pgTAP command', () => {
    expect(pkg.scripts['test:db:personalized']).toBe(
      'node scripts/run-smoke.cjs scripts/personalized-db-rest-integration.ts && supabase test db --local supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql supabase/tests/publish_chapter_v2_test.sql supabase/tests/authoring_story_claim_test.sql supabase/tests/authoring_story_bible_replace_test.sql && pnpm run test:db:authoring-race-cleanup && node scripts/run-smoke.cjs scripts/authoring-story-claim-race.ts && node scripts/run-smoke.cjs scripts/authoring-story-bible-race.ts',
    )
    expect(pkg.scripts['release:personalized']).toBe(
      'pnpm run typecheck && pnpm run test:unit && pnpm run test:db:personalized',
    )
    expect(pkg.scripts['test:db:personalized']).toContain('publish_chapter_v2_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring_story_claim_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('test:db:authoring-race-cleanup')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring-story-claim-race.ts')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring_story_bible_replace_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring-story-bible-race.ts')
    expect(pkg.scripts['test:unit']).not.toContain('test:db:personalized')
  })
})
