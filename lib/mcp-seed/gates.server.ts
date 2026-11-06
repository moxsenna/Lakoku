/**
 * Gate MCP Seed Server: master switch, kuota volume bulanan, cap draft
 * aktif, allowlist user, dan rate limit per tool call. Murni — loader DB
 * diinjeksi agar bisa diuji tanpa koneksi.
 */
import { rateLimit } from '@/lib/security/rate-limit'

export interface SeedVolumeLoaders {
  novelsThisMonth(source: string, monthStart: Date): Promise<number>
  activeDrafts(source: string): Promise<number>
}

export interface SeedEnv {
  enabled: boolean
  maxNovelsPerMonth: number
  maxActiveDrafts: number
  allowedUserIds: string[]
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function seedEnv(): SeedEnv {
  return {
    enabled: process.env.MCP_SEED_ENABLED === '1',
    maxNovelsPerMonth: intEnv('MCP_SEED_MAX_NOVELS_PER_MONTH', 3),
    maxActiveDrafts: intEnv('MCP_SEED_MAX_ACTIVE_DRAFTS', 1),
    allowedUserIds: (process.env.MCP_SEED_ALLOWED_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  }
}

export async function assertAssignAllowed(loaders: SeedVolumeLoaders, now: Date): Promise<void> {
  const env = seedEnv()
  if (!env.enabled) throw new Error('MCP_SEED_DISABLED: fitur belum diaktifkan di server')
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const created = await loaders.novelsThisMonth('gemini-agent', monthStart)
  if (created >= env.maxNovelsPerMonth) {
    throw new Error(`MCP_SEED_VOLUME_CAP:${env.maxNovelsPerMonth} novel per bulan sudah tercapai`)
  }
  const active = await loaders.activeDrafts('gemini-agent')
  if (active >= env.maxActiveDrafts) {
    throw new Error(`MCP_SEED_ACTIVE_DRAFT_CAP:${env.maxActiveDrafts} novel masih dalam generasi`)
  }
}

export function assertToolUser(sub: string, allowedUserIds: string[]): void {
  if (!allowedUserIds.includes(sub)) {
    throw new Error(`MCP_SEED_USER_FORBIDDEN:${sub}`)
  }
}

export function toolRateLimit(sub: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
  return rateLimit(`mcp-seed:${sub}`, 60, 60_000, now)
}
