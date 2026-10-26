'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'

/**
 * Pembeli Lakoin dari bab terkunci perlu jalan pulang ke bab itu, termasuk
 * setelah pembayaran (return_url PayCore tidak membawa konteks bab).
 * Jalurnya disimpan di sessionStorage lalu dibaca halaman /payment/return.
 */
const STORAGE_KEY = 'lakoku:reading-return:v1'

function isReadingPath(value: string | null): value is string {
  return !!value && value.startsWith('/baca/') && !value.startsWith('//')
}

export function RememberReadingReturn({ path }: { path: string }) {
  useEffect(() => {
    if (!isReadingPath(path)) return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, path)
    } catch {
      // Storage ditolak: tombol kembali di header tetap berfungsi.
    }
  }, [path])
  return null
}

const subscribe = () => () => {}
function readStoredPath(): string | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    return isReadingPath(value) ? value : null
  } catch {
    return null
  }
}

export function ContinueReadingLink() {
  const path = useSyncExternalStore(subscribe, readStoredPath, () => null)
  if (!path) return null
  return (
    <Link
      href={path}
      onClick={() => {
        try {
          window.sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          // Tidak kritis.
        }
      }}
      className="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      <BookOpen className="size-4" aria-hidden="true" />
      Lanjutkan membaca
    </Link>
  )
}
