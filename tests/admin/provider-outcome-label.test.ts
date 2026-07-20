import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('admin provider outcome labels', () => {
  it('maps SUCCEEDED to Provider OK not generic Success/Sukses end-to-end', () => {
    const badge = readFileSync(
      join(process.cwd(), 'components/admin/status-badge.tsx'),
      'utf8',
    )
    expect(badge).toMatch(/SUCCEEDED:\s*\{\s*label:\s*'Provider OK'/)
    expect(badge).not.toMatch(/SUCCEEDED:\s*\{\s*label:\s*'Succeeded'/)
  })

  it('ledger column is Hasil provider with disclaimer', () => {
    const ledger = readFileSync(
      join(process.cwd(), 'components/admin/generation/provider-call-ledger.tsx'),
      'utf8',
    )
    expect(ledger).toContain('Hasil provider')
    expect(ledger).toMatch(/tidak selalu berarti bab sudah diterbitkan/i)
  })
})
