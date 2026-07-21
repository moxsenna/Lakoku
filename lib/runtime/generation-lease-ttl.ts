import 'server-only'
import { getGenerationPolicy } from '@/lib/ops/generation-policy'

export async function resolveGenerationLeaseTtlSeconds(): Promise<number> {
  const policy = await getGenerationPolicy()
  const n = Number(policy.leaseTtlSeconds)
  if (!Number.isFinite(n)) return 300
  return Math.min(1800, Math.max(60, Math.trunc(n)))
}
