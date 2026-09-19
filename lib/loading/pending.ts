'use client'

/**
 * Sinyal pending GLOBAL untuk bar "app sedang bekerja, bukan ngefreeze".
 *
 * Sumber sinyal EKSPLISIT (bukan monkey-patch fetch — rapuh terhadap wrapper
 * lain): titik cekung data browser memanggil begin()/end() di sekeliling
 * request — `lib/api/client.ts` (seluruh Reader API), klaim misi, dan login.
 *
 * Histeresis: bar muncul hanya bila ada aksi menggantung > SHOW_DELAY_MS,
 * dan tetap tampil minimal MIN_VISIBLE_MS — aksi cepat tidak berkedip.
 *
 * Konsumsi: `useGlobalPending()` (useSyncExternalStore, aman SSR — selalu
 * false di server). Bar dirender `GlobalPendingIndicator` di root layout.
 */
import { useSyncExternalStore } from 'react'

const SHOW_DELAY_MS = 250
const MIN_VISIBLE_MS = 500

interface PendingStore {
  count: number
  visible: boolean
  shownAt: number
  hideTimer: ReturnType<typeof setTimeout> | null
  showTimer: ReturnType<typeof setTimeout> | null
  listeners: Set<() => void>
}

const store: PendingStore = {
  count: 0,
  visible: false,
  shownAt: 0,
  hideTimer: null,
  showTimer: null,
  listeners: new Set(),
}

function emit() {
  store.listeners.forEach((fn) => fn())
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.lkPending = store.visible ? '1' : '0'
  }
}

function scheduleShow() {
  if (store.visible || store.showTimer) return
  store.showTimer = setTimeout(() => {
    store.showTimer = null
    if (store.count === 0 || store.visible) return
    store.visible = true
    store.shownAt = Date.now()
    if (store.hideTimer) {
      clearTimeout(store.hideTimer)
      store.hideTimer = null
    }
    emit()
  }, SHOW_DELAY_MS)
}

function scheduleHide() {
  if (store.count > 0) return
  if (store.showTimer) {
    clearTimeout(store.showTimer)
    store.showTimer = null
  }
  if (!store.visible) return
  const elapsed = Date.now() - store.shownAt
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
  if (store.hideTimer) clearTimeout(store.hideTimer)
  store.hideTimer = setTimeout(() => {
    store.hideTimer = null
    if (store.count > 0) return
    store.visible = false
    emit()
  }, wait)
}

/** Tandai satu aksi mulai. Kembalikan token untuk endPending(token). */
export function beginPending(): number {
  store.count += 1
  scheduleShow()
  emit()
  return store.count
}

/** Tandai satu aksi selesai (sukses maupun gagal — panggil di finally). */
export function endPending(): void {
  store.count = Math.max(0, store.count - 1)
  scheduleHide()
  emit()
}

/**
 * Bungkus promise aksi dengan sinyal pending:
 * `withPending(fetch(...))` — begin sekarang, end saat settle.
 */
export async function withPending<T>(task: Promise<T>): Promise<T> {
  beginPending()
  try {
    return await task
  } finally {
    endPending()
  }
}

function subscribe(listener: () => void) {
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

function getSnapshot() {
  return store.visible
}

function getServerSnapshot() {
  return false
}

/** Baca status pending global (untuk tombol/overlay yang ingin ikut merespons). */
export function useGlobalPending() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
