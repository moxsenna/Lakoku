'use client'

/**
 * GlobalPendingIndicator — lapisan "app sedang bekerja, bukan ngefreeze".
 *
 * Cara kerja: patch `window.fetch` SEKALI di browser, hitung request yang
 * termasuk aksi app (server action POST, mutasi API, panggilan Supabase).
 * Bila ada aksi menggantung lebih dari SHOW_DELAY_MS, bar tipis bermerek
 * muncul di tepi atas layar; hilang saat semua selesai (minimum tampil
 * MIN_VISIBLE_MS supaya tidak berkedip).
 *
 * Sengaja TIDAK dilacak (biar bar tidak menyala terus):
 * - aset & prefetch router (/_next/*, font, gambar, header next-router-prefetch)
 * - telemetri fire-and-forget (/api/analytics/track)
 * - HEAD/OPTIONS dan ping dev (HMR)
 *
 * Konsumsi dari komponen lain: `useGlobalPending()` (useSyncExternalStore,
 * aman SSR — selalu false di server).
 */
import { useEffect, useSyncExternalStore } from 'react'

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
    if (store.visible) document.documentElement.dataset.lkPending = '1'
    else delete document.documentElement.dataset.lkPending
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

function enter() {
  store.count += 1
  scheduleShow()
  emit()
}

function exit() {
  store.count = Math.max(0, store.count - 1)
  scheduleHide()
  emit()
}

function shouldTrackUrl(url: URL, init: RequestInit | undefined, method: string): boolean {
  // Telemetri fire-and-forget — jangan pernah nyalakan bar.
  if (url.pathname === '/api/analytics/track') return false
  // Aset statis & plumbing dev.
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__')) return false
  // Prefetch router: navigasi di hover — bukan aksi user.
  const headers = new Headers(init?.headers)
  if (headers.has('next-router-prefetch')) return false
  const isSameOrigin = url.origin === window.location.origin
  if (isSameOrigin) {
    if (method !== 'GET') return true // server action + mutasi API
    return url.pathname.startsWith('/api/') // GET data via API route
  }
  // Lintas origin: hanya backend data kita (Supabase) — bukan pihak ketiga sembarangan.
  return url.hostname.endsWith('.supabase.co')
}

const PATCH_FLAG = '__lkFetchPatched' as const

function installFetchWatcher() {
  const w = window as unknown as { [PATCH_FLAG]?: boolean }
  if (w[PATCH_FLAG]) return
  w[PATCH_FLAG] = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = (...args: Parameters<typeof fetch>) => {
    const input = args[0]
    const init = args[1]
    try {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? String(input) : input.url,
        window.location.origin,
      )
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (shouldTrackUrl(url, init, method)) {
        enter()
        return originalFetch(...args).finally(exit)
      }
    } catch {
      // URL parse gagal — lewatkan tanpa tracking, jangan pernah block fetch.
    }
    return originalFetch(...args)
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

export function GlobalPendingIndicator() {
  const visible = useGlobalPending()

  useEffect(() => {
    installFetchWatcher()
  }, [])

  return (
    <>
      {visible && (
        <div
          data-testid="lk-global-pending"
          role="status"
          aria-label="Sedang memuat"
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-start"
        >
          <span className="lk-pending-bar" />
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {visible ? 'Sedang memuat…' : ''}
      </span>
    </>
  )
}
