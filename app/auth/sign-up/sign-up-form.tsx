'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { ArrowLeft } from 'lucide-react'

function readSafeNextFromWindow(): string {
  if (typeof window === 'undefined') return '/beranda'
  return sanitizeNextPath(new URLSearchParams(window.location.search).get('next'))
}

export function SignUpForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const busy = emailLoading || googleLoading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setEmailLoading(true)
    setError(null)

    try {
      const res = await authClient.signUp.email({
        email,
        password,
        name: name.trim() || email.split('@')[0],
      })
      if (res.error) {
        const msg = res.error.message?.toLowerCase() || ''
        if (
          msg.includes('exist') ||
          msg.includes('registered') ||
          res.error.code === 'USER_ALREADY_EXISTS'
        ) {
          setError('Email ini sudah terdaftar. Coba masuk.')
        } else {
          setError(res.error.message || 'Pendaftaran gagal. Coba lagi.')
        }
        setEmailLoading(false)
        return
      }
      router.push('/auth/sign-up-success')
    } catch {
      setError('Pendaftaran gagal. Periksa koneksi lalu coba lagi.')
      setEmailLoading(false)
    }
  }

  async function handleGoogle() {
    if (busy) return
    setGoogleLoading(true)
    setError(null)
    try {
      const next = readSafeNextFromWindow()
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: next,
      })
      if (res?.error) {
        setError('Login Google gagal. Coba lagi atau masuk dengan email.')
        setGoogleLoading(false)
      }
    } catch {
      setError('Login Google gagal. Coba lagi atau masuk dengan email.')
      setGoogleLoading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-6 pt-6">
      <Link
        href="/beranda"
        aria-label="Kembali ke beranda"
        className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
      </Link>

      <div className="flex flex-1 flex-col justify-center pb-24">
        <h1 className="font-serif text-3xl font-bold text-foreground text-balance">
          Mulai kisahmu sendiri
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Buat akun agar setiap pilihanmu tersimpan - di mana pun kamu membaca.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">NAMA</span>
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">EMAIL</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">
              KATA SANDI
            </span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {emailLoading ? 'Menyiapkan halamanmu...' : 'Daftar'}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">atau</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="mt-6">
          <GoogleSignInButton
            loading={googleLoading}
            disabled={busy}
            onClick={() => void handleGoogle()}
          />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Sudah punya akun?{' '}
          <Link href="/auth/login" className="font-semibold text-primary">
            Masuk
          </Link>
        </p>
      </div>
    </main>
  )
}
