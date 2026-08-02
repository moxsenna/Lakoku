import 'server-only'
import { getGenerationPolicy } from '@/lib/ops/generation-policy'

export async function resolveGenerationLeaseTtlSeconds(): Promise<number> {
  const policy = await getGenerationPolicy()
  const n = Number(policy.leaseTtlSeconds)
  if (!Number.isFinite(n)) return 300
  // Hotfix: worker input + job-lease RPC cap p_ttl_seconds at max 600
  // (see generation-jobs TtlSecondsSchema + acquire_generation_job_lease_v1).
  // generation_policy.lease_ttl_seconds up to 1800 remains valid storage;
  // effective runtime TTL must always stay <= 600 to be accepted downstream.
  return Math.min(600, Math.max(60, Math.trunc(n)))
}
