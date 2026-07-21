'use client'

import { useEffect, useRef, useState } from 'react'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { readGuestTasteProfile, clearGuestTasteProfile } from '@/lib/taste-profile/storage'
import { actMergeGuestTasteProfile } from '@/app/onboarding/selera/actions'

export default function AuthCompletePage() {
  const [message, setMessage] = useState('Menyiapkan sesimu...')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    async function finish() {
      const params = new URLSearchParams(window.location.search)
      const next = sanitizeNextPath(params.get('next'))

      try {
        const guestProfile = readGuestTasteProfile()
        if (guestProfile) {
          const mergeResult = await actMergeGuestTasteProfile(guestProfile)
          if (mergeResult.ok && mergeResult.merged) {
            clearGuestTasteProfile()
          }
        }
      } catch {
        // Best-effort: never block landing after successful OAuth.
      }

      setMessage('Membuka ceritamu...')
      // Hard nav so CF/OpenNext server components see session cookies.
      window.location.assign(next)
    }

    void finish()
  }, [])

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  )
}
