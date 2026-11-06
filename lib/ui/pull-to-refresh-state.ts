export const PULL_THRESHOLD_PX = 60
export const MAX_PULL_OFFSET_PX = 80
export const REFRESH_TIMEOUT_MS = 2500

/**
 * Menghitung jarak tarikan dengan redaman gesekan 0.4, batas maksimal 80px.
 */
export function calculatePullOffset(diffY: number): number {
  if (diffY <= 0) return 0
  return Math.min(MAX_PULL_OFFSET_PX, Math.round(diffY * 0.4))
}

/**
 * Menentukan apakah tarikan telah melewati ambang batas untuk memicu reload.
 */
export function isPullThresholdMet(offset: number): boolean {
  return offset >= PULL_THRESHOLD_PX
}

/**
 * Menghitung derajat rotasi panah indikator (proporsional terhadap jarak tarikan).
 */
export function calculateRotationDegrees(offset: number): number {
  if (offset <= 0) return 0
  return Math.round((offset / PULL_THRESHOLD_PX) * 180)
}
