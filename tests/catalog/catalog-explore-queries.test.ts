// tests/catalog/catalog-explore-queries.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type BinaryFilter = {
  type: 'binary'
  col: string
  op: string
  val: unknown
}

type LogicalFilter = {
  type: 'or' | 'and'
  args: FilterNode[]
}

type FilterNode = BinaryFilter | LogicalFilter

type LeftJoinCall = {
  table: string
  col1: string
  col2: string
}

type SimpleWhereCall = {
  col: string
  op: string
  val: unknown
}

const mockStories: Array<Record<string, unknown>> = []
const mockCatalogStories: Array<Record<string, unknown>> = []
const leftJoinCalls: LeftJoinCall[] = []
const whereCalls: SimpleWhereCall[] = []
const recordedAsts: FilterNode[] = []

function formatAst(node: FilterNode): string {
  if (node.type === 'binary') {
    const valStr = typeof node.val === 'string' ? `'${node.val}'` : String(node.val)
    return `${node.col} ${node.op} ${valStr}`
  }
  if (node.type === 'or') {
    return `or( ${node.args.map(formatAst).join(', ')} )`
  }
  if (node.type === 'and') {
    return `and( ${node.args.map(formatAst).join(', ')} )`
  }
  return ''
}

function evaluateFilter(node: FilterNode, row: Record<string, unknown>): boolean {
  if (node.type === 'or') {
    return node.args.some((child) => evaluateFilter(child, row))
  }
  if (node.type === 'and') {
    return node.args.every((child) => evaluateFilter(child, row))
  }
  if (node.type === 'binary') {
    const { col, op, val } = node
    const shortCol = col.includes('.') ? col.split('.').pop()! : col
    const actual = col in row ? row[col] : row[shortCol]

    if (op === '=') {
      return actual === val
    }
    if (op === '!=') {
      return actual !== val
    }
    if (op === 'is') {
      return actual === val
    }
    if (op === 'is not') {
      return actual !== val
    }
    if (op === 'like') {
      const str = String(actual ?? '')
      const pattern = String(val)
      if (pattern.endsWith('%') && !pattern.startsWith('%')) {
        return str.startsWith(pattern.slice(0, -1))
      }
      return str === pattern
    }
    if (op === 'not like') {
      const str = String(actual ?? '')
      const pattern = String(val)
      if (pattern.endsWith('%') && !pattern.startsWith('%')) {
        return !str.startsWith(pattern.slice(0, -1))
      }
      return str !== pattern
    }
  }
  return false
}

const createExpressionBuilder = () => {
  const eb = (col: string, op: string, val: unknown): BinaryFilter => ({
    type: 'binary',
    col,
    op,
    val,
  })
  eb.or = (operands: FilterNode[]): LogicalFilter => ({
    type: 'or',
    args: operands,
  })
  eb.and = (operands: FilterNode[]): LogicalFilter => ({
    type: 'and',
    args: operands,
  })
  return eb
}

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (_table: string) => {
      let isLeftJoin = false
      const filters: FilterNode[] = []

      const builder = {
        leftJoin: (table: string, col1: string, col2: string) => {
          leftJoinCalls.push({ table, col1, col2 })
          if (table === 'catalog_stories') isLeftJoin = true
          return builder
        },
        select: () => builder,
        where: (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
          if (typeof arg1 === 'function') {
            const eb = createExpressionBuilder()
            const ast = arg1(eb) as FilterNode
            recordedAsts.push(ast)
            filters.push(ast)
            return builder
          }
          if (typeof arg1 === 'string' && typeof arg2 === 'string') {
            const binaryNode: BinaryFilter = {
              type: 'binary',
              col: arg1,
              op: arg2,
              val: arg3,
            }
            whereCalls.push({ col: arg1, op: arg2, val: arg3 })
            filters.push(binaryNode)
            return builder
          }
          return builder
        },
        orderBy: () => builder,
        limit: () => builder,
        execute: async () => {
          const joined = mockStories.map((s) => {
            const cat = isLeftJoin ? mockCatalogStories.find((c) => c.story_id === s.id) : undefined
            return {
              ...s,
              'stories.id': s.id,
              'stories.title': s.title,
              'stories.visibility': s.visibility,
              'catalog_stories.status': cat?.status,
              catalog_status: cat?.status,
            }
          })
          return joined.filter((row) => filters.every((filter) => evaluateFilter(filter, row)))
        },
      }
      return builder
    },
  }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
}))

describe('catalog explore queries', () => {
  beforeEach(() => {
    mockStories.length = 0
    mockCatalogStories.length = 0
    leftJoinCalls.length = 0
    whereCalls.length = 0
    recordedAsts.length = 0
  })

  it('queryExploreStories records exact filter AST and includes only published catalog stories', async () => {
    mockStories.push(
      { id: 'demo:cinta', title: 'Demo Cinta', visibility: 'public' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public' },
      { id: 'catalog:draft-novel', title: 'Novel Draf', visibility: 'public' },
    )
    mockCatalogStories.push(
      { story_id: 'catalog:published-novel', status: 'published' },
      { story_id: 'catalog:draft-novel', status: 'draft' },
    )

    const { queryExploreStories } = await import('@/lib/api/queries')
    const stories = await queryExploreStories()

    // Assert leftJoin on catalog_stories
    expect(leftJoinCalls).toContainEqual({
      table: 'catalog_stories',
      col1: 'catalog_stories.story_id',
      col2: 'stories.id',
    })

    // Assert visibility = public where clause
    expect(whereCalls).toContainEqual({
      col: 'stories.visibility',
      op: '=',
      val: 'public',
    })

    // Assert exact filter AST data structure and formatted expression
    expect(recordedAsts).toHaveLength(1)
    expect(recordedAsts[0]).toEqual({
      type: 'or',
      args: [
        { type: 'binary', col: 'stories.id', op: 'like', val: 'demo:%' },
        { type: 'binary', col: 'stories.id', op: 'like', val: 'premium:%' },
        {
          type: 'and',
          args: [
            { type: 'binary', col: 'stories.id', op: 'like', val: 'catalog:%' },
            { type: 'binary', col: 'catalog_stories.status', op: '=', val: 'published' },
          ],
        },
      ],
    })
    expect(formatAst(recordedAsts[0])).toBe(
      "or( stories.id like 'demo:%', stories.id like 'premium:%', and( stories.id like 'catalog:%', catalog_stories.status = 'published' ) )",
    )

    // Derived from AST evaluation against rows
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('demo:cinta')
    expect(ids).toContain('catalog:published-novel')
    expect(ids).not.toContain('catalog:draft-novel')
  })

  it('queryPublicUserStories records id not like catalog:% and excludes catalog stories', async () => {
    mockStories.push(
      { id: 'user:cerita-saya', title: 'User Story', visibility: 'public', owner_user_id: 'u1' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public', owner_user_id: null },
    )

    const { queryPublicUserStories } = await import('@/lib/api/queries')
    const stories = await queryPublicUserStories()

    // Assert defense-in-depth catalog exclusion filter
    expect(whereCalls).toContainEqual({
      col: 'id',
      op: 'not like',
      val: 'catalog:%',
    })

    // Derived from AST/filter evaluation against rows
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('user:cerita-saya')
    expect(ids).not.toContain('catalog:published-novel')
  })
})
