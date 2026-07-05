/**
 * Public API server-only paket @lakoku/ai-gateway.
 *
 * Berisi seam yang menyentuh env/rahasia atau memilih "otak" penulis nyata,
 * sehingga tak boleh masuk bundel klien. Konsumen: runtime.
 */
export * from './select-provider'
