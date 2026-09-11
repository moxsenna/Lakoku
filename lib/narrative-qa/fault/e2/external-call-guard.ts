export type ExternalCallKind = 'MODEL_SDK' | 'FETCH' | 'TELEMETRY_RECORDER_FETCH' | 'CANDIDATE_EXECUTE'

export interface ExternalCallAuthority {
  recordExternalCall: (kind: ExternalCallKind) => void
}

const FETCH_GUARD_OWNER = Symbol('m10-e2-fetch-guard-owner')
type OwnedFetch = typeof fetch & { [FETCH_GUARD_OWNER]: symbol }

let globalPatchQueue: Promise<void> = Promise.resolve()

async function acquireGlobalPatchScope(): Promise<() => void> {
  const previous = globalPatchQueue
  let releaseCurrent: (() => void) | undefined
  globalPatchQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  await previous
  return () => releaseCurrent?.()
}

export async function withScopedExternalCallGuard<T>(
  authority: ExternalCallAuthority,
  run: () => Promise<T> | T,
  classifyFetch: (input: Parameters<typeof fetch>[0]) => ExternalCallKind = () => 'FETCH',
): Promise<T> {
  const release = await acquireGlobalPatchScope()
  const originalFetch = globalThis.fetch
  const ownershipToken = Symbol('m10-e2-external-call-guard')
  const blockedFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      authority.recordExternalCall(classifyFetch(input))
      throw new Error('E2_NETWORK_DENIED')
    },
    { [FETCH_GUARD_OWNER]: ownershipToken },
  ) as OwnedFetch

  globalThis.fetch = blockedFetch
  try {
    return await run()
  } finally {
    try {
      if (globalThis.fetch !== blockedFetch
        || (globalThis.fetch as Partial<OwnedFetch>)[FETCH_GUARD_OWNER] !== ownershipToken) {
        throw new Error('E2_GLOBAL_FETCH_OWNERSHIP_LOST')
      }
      globalThis.fetch = originalFetch
    } finally {
      release()
    }
  }
}
