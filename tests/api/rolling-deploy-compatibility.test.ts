import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  EXPLORE_STORY_FILTER,
  STORY_READER_COLUMNS,
} from '@/lib/api/queries'

const OLD_SCHEMA_STORY_COLUMNS = [
  'id',
  'title',
  'cover',
  'tagline',
  'role',
  'tropes',
  'total_chapters',
  'synopsis',
  'status',
  'current_chapter',
  'jejak',
  'ending_name',
  'owner_user_id',
  'visibility',
] as const

describe('Task 4 rolling-deploy compatibility', () => {
  it('keeps reader projection inside ownership-era schema', () => {
    const oldColumns = new Set<string>(OLD_SCHEMA_STORY_COLUMNS)
    expect(
      STORY_READER_COLUMNS.split(',').filter((column) => !oldColumns.has(column)),
    ).toEqual([])
  })

  it('uses stable ID conventions instead of personalized migration fields', () => {
    expect(EXPLORE_STORY_FILTER).toBe('id.like.demo:%,id.like.premium:%')
    expect(EXPLORE_STORY_FILTER).not.toContain('story_mode')
    expect(STORY_READER_COLUMNS).not.toContain('generation_status')
    expect(STORY_READER_COLUMNS).not.toContain('story_contract_version')
  })
})
