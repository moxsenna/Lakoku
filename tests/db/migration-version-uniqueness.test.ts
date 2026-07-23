import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findDuplicateMigrationVersions,
  listMigrationFilenames,
} from '../../scripts/check-migration-version-uniqueness'

describe('migration version uniqueness', () => {
  it('detects duplicate 14-digit prefixes in synthetic filenames', () => {
    const duplicates = findDuplicateMigrationVersions([
      '20260722090000_align_choices_and_runtime_policy.sql',
      '20260722090000_story_creative_directions.sql',
      '20260723010000_ai_model_route_reasoning_effort.sql',
    ])
    expect(duplicates).toEqual([
      {
        version: '20260722090000',
        files: [
          '20260722090000_align_choices_and_runtime_policy.sql',
          '20260722090000_story_creative_directions.sql',
        ],
      },
    ])
  })

  it('accepts unique prefixes', () => {
    const duplicates = findDuplicateMigrationVersions([
      '20260722090000_align_choices_and_runtime_policy.sql',
      '20260722090001_story_creative_directions.sql',
      '20260724100000_reconcile_choice_routes_and_creative_direction.sql',
    ])
    expect(duplicates).toEqual([])
  })

  it('repo migrations have unique version prefixes', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
    expect(fs.existsSync(migrationsDir)).toBe(true)
    const files = listMigrationFilenames(migrationsDir)
    expect(files.length).toBeGreaterThan(0)
    const duplicates = findDuplicateMigrationVersions(files)
    expect(duplicates).toEqual([])
  })

  it('repair migration file exists with unique version', () => {
    const repair = path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260724100000_reconcile_choice_routes_and_creative_direction.sql',
    )
    expect(fs.existsSync(repair)).toBe(true)
    const sql = fs.readFileSync(repair, 'utf8')
    expect(sql).toMatch(/create table if not exists public\.story_creative_directions/i)
    expect(sql).not.toMatch(/story_contract_json\s*:\s*\{\}/)
    expect(sql.toLowerCase()).not.toContain('drop table')
  })
})
