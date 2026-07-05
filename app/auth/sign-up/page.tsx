'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft } from 'lucide-react'

export default function SignUpPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ??
          `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(
        error.message.includes('already registered')
          ? 'Email ini sudah terdaftar. Coba masuk.'
          : 'Pendaftaran gagal. Periksa email dan kata sandi (min. 6 karakter).',
      )
      setLoading(false)
      return
    }
    router.push('/auth/sign-up-success')
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
          Buat akun agar setiap pilihanmu tersimpan — di mana pun kamu membaca.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
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
            disabled={loading}
            className="mt-2 flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Menyiapkan halamanmu…' : 'Daftar'}
          </button>
        </form>

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

export const dynamic = 'force-dynamic';
