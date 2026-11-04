/**
 * Circuit breaker ringan untuk upstream authoring (T-setup-fix).
 *
 * Saat upstream (9Router/provider) rusak beruntun (403 pool-wide, response
 * kosong, timeout), pemanggil harus fail FAST dengan pesan ramah pembaca —
 * bukan membiarkan user menunggu puluhan detik untuk gagal.
 *
 * Pola: N kegagalan rantai beruntun → OPEN selama cooldown → setelah itu
 * "half-open" implisit (1 keberhasilan menutup, 1 kegagalan membuka lagi).
 *
 * Modul ini murni (tanpa 'server-only', jam dapat diinjeksi) agar mudah
 * diuji unit. Singleton dipasang di model.ts.
 */

export interface CircuitBreakerOptions {
  /** Jumlah kegagalan beruntun sebelum membuka. Default 3. */
  threshold?: number
  /** Lama OPEN sebelum mencoba lagi. Default 5 menit. */
  cooldownMs?: number
  /** Sumber waktu (injeksi untuk test). Default Date.now. */
  now?: () => number
}

export type CircuitBreakerState = 'closed' | 'open'

export class AuthoringCircuitBreaker {
  private failures = 0
  private openUntil = 0
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = Math.max(1, options.threshold ?? 3)
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? 5 * 60_000)
    this.now = options.now ?? (() => Date.now())
  }

  /** true = boleh melanjutkan panggilan upstream. */
  tryAcquire(): boolean {
    return this.openUntil <= this.now()
  }

  get state(): CircuitBreakerState {
    return this.openUntil > this.now() ? 'open' : 'closed'
  }

  /** Sisa ms sampai boleh mencoba lagi (0 bila closed). */
  get msUntilRetry(): number {
    return Math.max(0, this.openUntil - this.now())
  }

  recordSuccess(): void {
    this.failures = 0
    this.openUntil = 0
  }

  recordFailure(): void {
    this.failures += 1
    const isOpen = this.openUntil > this.now()
    if (!isOpen && this.openUntil > 0) {
      // Half-open: breaker pernah terbuka dan cooldown habis. Satu kegagalan
      // saja cukup membuka kembali — upstream belum sehat, jangan pungut
      // threshold penuh lagi.
      this.openUntil = this.now() + this.cooldownMs
      this.failures = 0
      return
    }
    if (this.failures >= this.threshold) {
      this.openUntil = this.now() + this.cooldownMs
      // Reset counter; status OPEN yang menjaga sampai cooldown habis.
      this.failures = 0
    }
  }
}
