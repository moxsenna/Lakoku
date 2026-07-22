'use client'

/**
 * First-run gate: redirect ke /onboarding/selera jika user belum pernah
 * complete/skip Taste Profile. Hanya redirect logic, tidak render apapun.
 *
 * Guest: cek localStorage dual-read v2→v1 (storage.ts)
 * Login: panggil actGetTasteProfile()
 *
 * Bonus: jika login user punya guest profile di localStorage tapi belum di DB,
 * merge otomatis (fallback untuk OAuth users yang tidak lewat login-form.tsx).
 *
 * Guard: jangan redirect dari /onboarding/selera, /baca, /auth/login.
 * Paling aman dipasang hanya di BerandaPage.
 */
import { useEffect, useRef, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { readGuestTasteProfile, clearGuestTasteProfile } from '@/lib/taste-profile/storage'
import { actGetTasteProfile, actMergeGuestTasteProfile } from '@/app/onboarding/selera/actions'

const GUARDED_PATHS = ['/onboarding/selera', '/baca', '/auth/login']

export function TasteProfileFirstRunGate({ next = '/beranda' }: { next?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const checkedRef = useRef(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    // Guard: jangan redirect dari path tertentu.
    if (GUARDED_PATHS.some((p) => pathname.startsWith(p))) return

    // 1. Cek localStorage dulu (instant, guest atau login).
    const guest = readGuestTasteProfile()
    if (guest && (guest.completedAt || guest.skippedAt)) {
      // Guest punya profile → coba merge ke server (best-effort, untuk OAuth users).
      startTransition(async () => {
        try {
          const mergeResult = await actMergeGuestTasteProfile(guest)
          if (mergeResult.ok && mergeResult.merged) {
            clearGuestTasteProfile()
          }
        } catch {
          // Best-effort.
        }
      })
      return
    }

    // 2. Cek server (login user mungkin punya profile di DB).
    startTransition(async () => {
      try {
        const result = await actGetTasteProfile()
        if (result.ok && result.profile) {
          if (result.profile.completedAt || result.profile.skippedAt) return
        }
      } catch {
        // Gagal cek server → jangan block user, diam saja.
        return
      }

      // Belum pernah complete/skip → redirect ke onboarding selera.
      router.push(`/onboarding/selera?next=${encodeURIComponent(next)}`)
    })
  }, [next, pathname, router, startTransition])

  return null
}
