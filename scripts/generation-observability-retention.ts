import { createClient } from '@supabase/supabase-js'

const MAX_BATCHES = 100
const BATCH_SIZE = 1000

interface RetentionResult {
  rolledUp: number
  deletedDetails: number
  deletedAggregates: number
  hasMore: boolean
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('GENERATION_OBSERVABILITY_RETENTION_CONFIG_MISSING')
  return value
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function parseRetentionResult(value: unknown): RetentionResult {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    throw new Error('GENERATION_OBSERVABILITY_RETENTION_RESULT_INVALID')
  }

  const record = value as Record<string, unknown>
  if (
    !nonnegativeInteger(record.rolledUp)
    || !nonnegativeInteger(record.deletedDetails)
    || !nonnegativeInteger(record.deletedAggregates)
    || typeof record.hasMore !== 'boolean'
  ) {
    throw new Error('GENERATION_OBSERVABILITY_RETENTION_RESULT_INVALID')
  }

  return {
    rolledUp: record.rolledUp,
    deletedDetails: record.deletedDetails,
    deletedAggregates: record.deletedAggregates,
    hasMore: record.hasMore,
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim()
    || requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const totals: RetentionResult = {
    rolledUp: 0,
    deletedDetails: 0,
    deletedAggregates: 0,
    hasMore: true,
  }

  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { data, error } = await client
      .rpc('rollup_and_purge_generation_provider_calls_v1', {
        p_batch_size: BATCH_SIZE,
      })

    if (error) {
      throw new Error('GENERATION_OBSERVABILITY_RETENTION_RPC_FAILED')
    }

    const result = parseRetentionResult(data)
    totals.rolledUp += result.rolledUp
    totals.deletedDetails += result.deletedDetails
    totals.deletedAggregates += result.deletedAggregates
    totals.hasMore = result.hasMore

    console.log(
      `generation-observability-retention batch=${batch} rolledUp=${result.rolledUp} deletedDetails=${result.deletedDetails} deletedAggregates=${result.deletedAggregates}`,
    )

    if (!result.hasMore) break
  }

  console.log(
    `generation-observability-retention total rolledUp=${totals.rolledUp} deletedDetails=${totals.deletedDetails} deletedAggregates=${totals.deletedAggregates}`,
  )
}

main().catch((error: unknown) => {
  const code = error instanceof Error
    && error.message.startsWith('GENERATION_OBSERVABILITY_RETENTION_')
    ? error.message
    : 'GENERATION_OBSERVABILITY_RETENTION_FAILED'
  console.error(code)
  process.exitCode = 1
})
