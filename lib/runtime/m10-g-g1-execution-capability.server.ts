import 'server-only'
import { evaluateM10GG1RemainingAuthority } from '../narrative-qa/judges/m10-g-g1-remaining-authority'

const REGISTRY_KEY = Symbol.for('lakoku.runtime.m10g-g1-execution-capability.registry.v1')
const BRAND_KEY = Symbol.for('lakoku.runtime.m10g-g1-execution-capability.brand.v1')
const EXECUTOR_ID = 'generateNextPersonalizedChapter:m10g-g1:v1' as const

type CapabilityRecord = Readonly<{
  executorId: typeof EXECUTOR_ID
  nonce: object
}>

type CapabilityRegistry = {
  records: WeakMap<object, CapabilityRecord>
}

type GlobalWithCapabilityRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: CapabilityRegistry
}

function registry(): CapabilityRegistry {
  const root = globalThis as GlobalWithCapabilityRegistry
  const current = root[REGISTRY_KEY]
  if (current) return current
  const created: CapabilityRegistry = { records: new WeakMap() }
  Object.defineProperty(root, REGISTRY_KEY, {
    value: created,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return created
}

export type M10GG1ExecutionCapability = Readonly<{
  executorId: typeof EXECUTOR_ID
}>

/**
 * Fails closed while any A/B/C authority subgate is BLOCKED.
 *
 * Invariant NO_LIVE_CAPABILITY_WITHOUT_ABC_AUTHORITY: a capability is the only
 * key to the network-capable live executor, so issuance is the earliest point
 * where the authority state must be enforced. Blocking here guarantees no
 * network-capable executor is constructed, no budget with a hard limit is
 * issued, and no chapter is invoked.
 */
export function assertM10GG1LiveAuthorityOpen(): void {
  // Read through a widened view. The concrete return type currently narrows
  // these fields to literal `false`/`null`, which would make the guard a
  // compile-time tautology; the widened read keeps it a real runtime check that
  // survives a future ratification widening the literals.
  const authority: {
    liveExecutionReady: boolean
    economicsMayOpen: boolean
    hardInferenceLimit: number | null
    blockerCodes: readonly string[]
  } = evaluateM10GG1RemainingAuthority()

  if (authority.liveExecutionReady !== true
    || authority.economicsMayOpen !== true
    || authority.hardInferenceLimit === null
    || authority.blockerCodes.length > 0) {
    throw new Error(
      `M10G_G1_LIVE_AUTHORITY_BLOCKED:${authority.blockerCodes.join(',')}`,
    )
  }
}

/** Runtime-owned issuance. Capability carries no caller-controlled executor. */
export function issueM10GG1ExecutionCapability(): M10GG1ExecutionCapability {
  assertM10GG1LiveAuthorityOpen()
  const nonce = Object.freeze({})
  const capability = Object.freeze(Object.defineProperty({
    executorId: EXECUTOR_ID,
  }, BRAND_KEY, {
    value: nonce,
    enumerable: false,
    configurable: false,
    writable: false,
  }))
  registry().records.set(capability, { executorId: EXECUTOR_ID, nonce })
  return capability
}

export function assertM10GG1ExecutionCapability(
  capability: unknown,
): asserts capability is M10GG1ExecutionCapability {
  if (!capability || typeof capability !== 'object') {
    throw new Error('M10G_G1_EXECUTION_CAPABILITY_REQUIRED')
  }
  const record = registry().records.get(capability)
  const brandedNonce = (capability as Record<PropertyKey, unknown>)[BRAND_KEY]
  if (!record
    || record.executorId !== EXECUTOR_ID
    || record.nonce !== brandedNonce
    || (capability as { executorId?: unknown }).executorId !== EXECUTOR_ID) {
    throw new Error('M10G_G1_EXECUTION_CAPABILITY_INVALID')
  }
}
