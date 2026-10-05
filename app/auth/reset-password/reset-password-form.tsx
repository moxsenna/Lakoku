'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import {
  mapPasswordRecoveryError,
  validateNewPassword,
} from '@/lib/auth/password-recovery'

type RecoveryState = 'checking' | 'ready' | 'expired'

export function ResetPasswordForm({
  initialToken,
  initialError,
}: {
  initialToken?: string
  initialError?: string
} = {}) {
  const searchParams = useSearchParams()
  const token = initialToken ?? searchParams.get('token') ?? ''
  const errorParam = initialError ?? searchParams.get('error')

  const [state, setState] = useState<RecoveryState>(() => (errorParam || !token ? 'expired' : 'ready'))
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading || state !== 'ready') return

    const validation = validateNewPassword(password, confirmation)
    if (!validation.ok) {
      setError(validation.message)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (res?.error) {
        const errorMsg = res.error.message || 'unknown'
        if (
          errorMsg.toLowerCase().includes('token') ||
          errorMsg.toLowerCase().includes('expired') ||
          errorMsg.toLowerCase().includes('invalid')
        ) {
          setState('expired')
        } else {
          setError(mapPasswordRecoveryError(errorMsg))
        }
        return
      }
      window.location.assign('/auth/login?reset=success')
    } catch (caught) {
      setError(mapPasswordRecoveryError(caught instanceof Error ? caught.message : 'unknown'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-6">
      <div className="flex flex-1 flex-col justify-center py-24">
        <h1 className="font-serif text-3xl font-bold text-foreground text-balance">Buat kata sandi baru</h1>
        {state === 'checking' && <p role="status" className="mt-4 text-sm text-muted-foreground">Memeriksa tautan pemulihan...</p>}
        {state === 'expired' && (
          <div className="mt-4 space-y-6">
            <p role="alert" className="text-sm leading-relaxed text-muted-foreground">Tautan pemulihan tidak valid atau sudah kedaluwarsa.</p>
            <Link href="/auth/forgot-password" className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground">Minta tautan baru</Link>
          </div>
        )}
        {state === 'ready' && (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">KATA SANDI BARU</span>
              <input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">KONFIRMASI KATA SANDI</span>
              <input type="password" required minLength={6} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary" />
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading} className="mt-2 flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
              {loading ? 'Menyimpan...' : 'Simpan kata sandi baru'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
