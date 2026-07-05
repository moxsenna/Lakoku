/**
 * Public API paket @lakoku/ai-gateway (ARCH §5.1).
 *
 * Pemilik: kode spesifik-provider dan structured outputs. Paket lain HANYA
 * merujuk kontrak tugas internal seperti `generatePlan()` / `writeChapter()`
 * dan `generateChapter()`, serta boundary consumer-safe. Boleh mengimpor
 * @lakoku/narrative-core; TIDAK boleh mengimpor runtime atau api.
 *
 * Barrel ini sengaja LOGIKA MURNI (tanpa `server-only`) agar bisa dipakai
 * harness/test Node tanpa kondisi react-server. Seam server (`selectProvider`,
 * yang `server-only`) diekspor terpisah lewat `@lakoku/ai-gateway/server`.
 */
export * from './schemas'
export * from './provider'
export * from './gateway'
export * from './generate'
