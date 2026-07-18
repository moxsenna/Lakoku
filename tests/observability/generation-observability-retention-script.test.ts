import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/generation-observability-retention.ts')

function source(): string {
  return readFileSync(scriptPath, 'utf8')
}

describe('generation observability retention script', () => {
  it('calls only the bounded retention RPC with a safe batch size', () => {
    const text = source()

    expect(text).toContain("rpc('rollup_and_purge_generation_provider_calls_v1'")
    expect(text).toMatch(/BATCH_SIZE\s*=\s*1000/)
    expect(text).toMatch(/p_batch_size:\s*BATCH_SIZE/)
    expect(text).toMatch(/MAX_BATCHES\s*=\s*100/)
    expect(text).toMatch(/batch\s*<=\s*MAX_BATCHES/)
  })

  it('stops when hasMore is false and accepts only count-shaped results', () => {
    const text = source()

    expect(text).toMatch(/if\s*\(!result\.hasMore\)\s*break/)
    expect(text).toContain('rolledUp')
    expect(text).toContain('deletedDetails')
    expect(text).toContain('deletedAggregates')
    expect(text).toContain('hasMore')
  })

  it('never logs credentials or raw RPC failures', () => {
    const text = source()

    expect(text).not.toMatch(/console\.(?:log|error)\([^\n]*(?:serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY)/)
    expect(text).not.toMatch(/console\.(?:log|error)\([^\n]*(?:error\.message|JSON\.stringify\(error)/)
    expect(text).not.toContain('hasMore=${')
    expect(text).toContain('GENERATION_OBSERVABILITY_RETENTION_RPC_FAILED')
  })
})
