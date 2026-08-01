'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { mapPasswordRecoveryError } from '@/lib/auth/password-recovery'
import { createClient, type SupabasePublicConfig } from '@/lib/supabase/client'

export function ForgotPasswordForm({
  supabaseConfig,
}: {
  supabaseConfig: SupabasePublicConfig
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient(supabaseConfig)
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback/recovery`,
      })
      if (recoveryError) {
        setError(mapPasswordRecoveryError(recoveryError.message))
        return
      }
      setSent(true)
    } catch (caught) {
      setError(mapPasswordRecoveryError(caught instanceof Error ? caught.message : 'unknown'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-6 pt-6">
      <Link href="/auth/login" aria-label="Kembali ke login" className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-5" />
      </Link>
      <div className="flex flex-1 flex-col justify-center pb-24">
        <h1 className="font-serif text-3xl font-bold text-foreground text-balance">Pulihkan kata sandi</h1>
        {sent ? (
          <div className="mt-4 space-y-6">
            <p role="status" className="text-sm leading-relaxed text-muted-foreground">
              Jika email terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk dan folder spam.
            </p>
            <Link href="/auth/login" className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground">
              Kembali ke login
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Masukkan email akunmu untuk menerima tautan pemulihan.</p>
            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground">EMAIL</span>
                <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary" />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading} className="mt-2 flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
                {loading ? 'Mengirim tautan...' : 'Kirim tautan pemulihan'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
