/**
 * Observasi telemetri bersifat best-effort. Kegagalan observer tidak boleh
 * mengubah hasil generasi, memicu retry, atau menghabiskan budget inference.
 */
export function runObserver(observe: () => void): void {
  try {
    observe()
  } catch {
    // Sengaja diabaikan: observer tidak memiliki otoritas atas hasil generasi.
    return
  }
}
