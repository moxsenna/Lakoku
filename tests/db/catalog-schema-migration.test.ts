import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('catalog schema migration and types', () => {
  const migrationPath = path.join(
    process.cwd(),
    'neon',
    'migrations',
    '20261027000000_admin_catalog_stories.sql',
  )

  it('migration file exists with valid timestamp prefix', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('migration alters stories_story_mode_check to include catalog', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/alter table public\.stories/i)
    expect(sql).toMatch(/stories_story_mode_check/i)
    expect(sql).toContain("'catalog'")
  })

  it('migration defines catalog_stories with required columns and defaults', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table if not exists public\.catalog_stories/i)
    expect(sql).toContain('chapter_price integer not null default 5')
    expect(sql).toContain('bundle_price integer not null default 150')
    expect(sql).toMatch(/status in \('draft',\s*'generating',\s*'review',\s*'published',\s*'archived'\)/)
  })

  it('migration defines catalog_ending_chapters with composite PK', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table if not exists public\.catalog_ending_chapters/i)
    expect(sql).toMatch(/primary key \(\s*story_id\s*,\s*ending_key\s*,\s*number\s*\)/i)
    expect(sql).toContain('outcomes_json jsonb')
  })

  it('migration adds direction_hint to choice_outcomes', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/alter table public\.choice_outcomes add column if not exists direction_hint text null/i)
  })

  it('migration defines spend_bundle_v1 atomic RPC with fair price computation', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create or replace function public\.spend_bundle_v1/i)
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('v_fair_price := greatest(0, v_bundle_price - v_spent)')
    expect(sql).toContain("'unlock_bundle'")
  })

  it('catalog_bundle_spent_v1 counts only this story chapter refs (no LIKE wildcard / prefix collision)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create or replace function public\.catalog_bundle_spent_v1/i)
    expect(sql).not.toMatch(/ref\s+like/i)
    expect(sql).toContain("reason = 'unlock_chapter'")
    expect(sql).toContain("~ ('^[0-9]+(:' || p_user_id::text || ')?$')")
    expect(sql).toContain('v_spent := public.catalog_bundle_spent_v1(p_user_id, p_story_id)')
  })

  it('db-types exports CatalogStories and CatalogEndingChapters', async () => {
    const dbTypesContent = fs.readFileSync(path.join(process.cwd(), 'lib/supabase/db-types.ts'), 'utf8')
    expect(dbTypesContent).toContain('export interface CatalogStories')
    expect(dbTypesContent).toContain('export interface CatalogEndingChapters')
    expect(dbTypesContent).toContain('catalog_stories: CatalogStories')
    expect(dbTypesContent).toContain('catalog_ending_chapters: CatalogEndingChapters')
    expect(dbTypesContent).toContain('direction_hint: string | null')
  })
})
