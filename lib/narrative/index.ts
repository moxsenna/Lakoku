/**
 * Public API paket @lakoku/narrative-core (ARCH §5.1).
 *
 * Pemilik: konteks, canon checks, planner, validator, batasan repair, template,
 * dan thread lifecycle. TIDAK boleh mengimpor objek HTTP request atau konsep
 * Android. Konsumen lintas-paket (ai-gateway, runtime) HARUS mengimpor dari
 * sini, bukan deep-import ke file internal.
 *
 * Barrel ini sengaja LOGIKA MURNI (tanpa `server-only`) agar bisa dipakai
 * harness/test Node tanpa kondisi react-server. Bagian DB-facing (`loader`,
 * yang `server-only`) diekspor terpisah lewat `@lakoku/narrative-core/server`.
 */
export * from './types'
export * from './alias'
export * from './canon-id'
export * from './chapter-state-delta'
export * from './chapter-state-policy'
export * from './chapter-state-apply'
export * from './plot-debt-effective-state'
export * from './compiler'
export * from './continuation-context'
export * from './ending-excerpt'
export * from './layer-a'
export * from './layer-b'
export * from './reconciliation'
export * from './template'
export * from './threads'
export * from './continuity-checks'
