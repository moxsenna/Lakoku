/**
 * Public API SERVER-ONLY paket @lakoku/narrative-core (ARCH §5.1).
 *
 * Berisi bagian DB-facing (`loader`) yang `server-only`. Dipisah dari barrel
 * utama agar harness/test Node murni tidak menarik `server-only`. Konsumen
 * server (runtime) mengimpor dari `@lakoku/narrative-core/server`.
 *
 * Catatan: `loadContinuationContextForChapter` TIDAK diekspor dari sini —
 * ia milik paket runtime (bergantung pada narrative-core + db + story-engine),
 * diimpor konsumen dari `@lakoku/runtime` / relative path runtime.
 */
export * from './loader'
