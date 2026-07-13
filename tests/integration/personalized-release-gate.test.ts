import { describe, expect, it } from 'vitest'
import pkg from '@/package.json'

describe('personalized database release gate', () => {
  it('provides explicit local-only REST/Auth plus pgTAP command', () => {
    expect(pkg.scripts['test:db:personalized']).toBe(
      'node scripts/run-smoke.cjs scripts/personalized-db-rest-integration.ts && supabase test db --local supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql',
    )
    expect(pkg.scripts['release:personalized']).toBe(
      'pnpm run typecheck && pnpm run test:unit && pnpm run test:db:personalized',
    )
    expect(pkg.scripts['test:unit']).not.toContain('test:db:personalized')
  })
})
