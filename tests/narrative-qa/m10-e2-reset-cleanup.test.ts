import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  E1_EXACT_CLEANUP_TARGETS,
  FAULT_STORY_IDS,
  cleanupAndVerifyFaultHarnessStories,
} from '../../lib/narrative-qa/fault/scenarios'

interface Operation {
  table: string
  action: 'delete' | 'select'
  column?: string
  values?: readonly string[]
}

function adminSeam(input: {
  residueByTable?: Record<string, unknown[]>
  deleteErrorTable?: string
} = {}) {
  const operations: Operation[] = []
  return {
    operations,
    admin: {
      from(table: string) {
        let action: Operation['action'] = 'select'
        const result = () => Promise.resolve({
          data: action === 'select' ? input.residueByTable?.[table] ?? [] : [],
          error: action === 'delete' && input.deleteErrorTable === table ? { message: `${table} denied` } : null,
        })
        const chain = {
          delete() { action = 'delete' as const; return chain },
          select() { action = 'select' as const; return chain },
          in(column: string, values: readonly string[]) {
            operations.push({ table, action, column, values: [...values] })
            return result()
          },
          eq(column: string, value: string) {
            operations.push({ table, action, column, values: [value] })
            return result()
          },
        }
        return chain
      },
    },
  }
}

describe('M10-E1 exact final fixture cleanup', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:57321'
  })
  it('deletes and verifies exhaustive story-owned surfaces using exact harness IDs', async () => {
    const seam = adminSeam()
    const proof = await cleanupAndVerifyFaultHarnessStories(seam.admin as never)

    expect(proof.completed).toBe(true)
    expect(proof.targets.map((target) => target.target)).toEqual([...FAULT_STORY_IDS, 'outbox'])
    for (const target of E1_EXACT_CLEANUP_TARGETS) {
      expect(seam.operations).toContainEqual({
        table: target.table,
        action: 'delete',
        column: target.column,
        values: [...target.values],
      })
      expect(seam.operations).toContainEqual({
        table: target.table,
        action: 'select',
        column: target.column,
        values: [...target.values],
      })
    }
    expect(seam.operations.some((operation) => operation.values?.some((value) => value.includes('%')))).toBe(false)
  })

  it.each(['choice_outcomes', 'generation_job_attempts', 'facts_ledger', 'credit_reservations', 'outbox']) (
    'fails reset proof when exact %s residue remains',
    async (table) => {
      const seam = adminSeam({ residueByTable: { [table]: [{ id: `${table}-residue` }] } })
      await expect(cleanupAndVerifyFaultHarnessStories(seam.admin as never)).rejects.toThrow(
        `reset verification found mutable story residue: ${table}`,
      )
    },
  )

  it('propagates exact table deletion errors', async () => {
    const seam = adminSeam({ deleteErrorTable: 'story_events' })
    await expect(cleanupAndVerifyFaultHarnessStories(seam.admin as never)).rejects.toThrow(
      'story_events cleanup failed: story_events denied',
    )
  })
})
