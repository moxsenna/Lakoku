/**
 * Rate limiter sliding-window sederhana untuk endpoint publik (audit M9/M10).
 *
 * Asumsi: SATU instance aplikasi (VPS Docker tunggal) — state in-memory cukup.
 * Bila nanti multi-instance, ganti ke penyimpanan bersama (DB/Redis) tanpa
 * mengubah kontrak pemanggil.
 *
 * Tidak melempar; selalu mengembalikan keputusan. Bersih-bersih entri basi
 * dilakukan saat insert (budget terbatas per panggilan, tanpa timer latar).
 */

const buckets = new Map<string, number[]>()

/**true = diizinkan; false = melebihi limit (retry setelah retryAfterSec). */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  if (limit <= 0 || windowMs <= 0) return { ok: true, retryAfterSec: 0 }

  const hits = buckets.get(key)
  const fresh = (hits ?? []).filter((t) => now - t < windowMs)

  if (fresh.length >= limit) {
    const oldest = fresh[0] ?? now
    buckets.set(key, fresh)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) }
  }

  fresh.push(now)
  buckets.set(key, fresh)

  // Pangkas ringan: bila bucket keseluruhan membengkak, buang entri basi.
  if (buckets.size > 10_000) {
    for (const [k, ts] of buckets) {
      const alive = ts.filter((t) => now - t < windowMs)
      if (alive.length === 0) buckets.delete(k)
      else buckets.set(k, alive)
    }
  }

  return { ok: true, retryAfterSec: 0 }
}

/** IP klien dari header standar di balik reverse proxy (Caddy). */
export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
