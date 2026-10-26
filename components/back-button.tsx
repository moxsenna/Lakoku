'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Kembali ke halaman sebelumnya bila pengguna datang dari dalam Lakoku;
 * bila halaman dibuka langsung (tautan luar, tab baru), ke `fallbackHref`.
 */
export function BackButton({
  fallbackHref,
  label,
  className,
  children,
}: {
  fallbackHref: string
  label: string
  className?: string
  children: ReactNode
}) {
  const router = useRouter()

  function goBack() {
    const cameFromApp =
      window.history.length > 1 &&
      document.referrer !== '' &&
      new URL(document.referrer).origin === window.location.origin
    if (cameFromApp) router.back()
    else router.push(fallbackHref)
  }

  return (
    <button type="button" onClick={goBack} aria-label={label} className={className}>
      {children}
    </button>
  )
}
