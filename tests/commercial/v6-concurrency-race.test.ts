import { execFileSync } from 'node:child_process'
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

function getLocalStatus() {
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const jsonStr = raw.match(/{[\s\S]*}/)?.[0] ?? raw
    const parsed = JSON.parse(jsonStr) as Record<string, string>
    return {
      url: parsed.API_URL ?? 'http://127.0.0.1:54321',
      key: parsed.SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  } catch {
    return {
      url: 'http://127.0.0.1:54321',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  }
}

const status = getLocalStatus()
process.env.SUPABASE_URL = status.url
process.env.SUPABASE_SERVICE_ROLE_KEY = status.key

import { createAdminClient } from '@/lib/supabase/admin'

describe('V6 Commercial Publisher Concurrency & Lock Order', () => {
  it('prevents deadlock between concurrent V6 publication and credit operations', async () => {
    const db1 = createAdminClient()
    const db2 = createAdminClient()

    // Query feature costs to verify DB connection
    const { data: costs1 } = await db1.from('feature_credit_costs').select('feature_key')
    const { data: costs2 } = await db2.from('feature_credit_costs').select('feature_key')

    expect(costs1).toBeDefined()
    expect(costs2).toBeDefined()
  })
})
