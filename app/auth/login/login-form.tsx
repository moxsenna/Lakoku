'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { createClient, type SupabasePublicConfig } from '@/lib/supabase/client'
import { ArrowLeft } from 'lucide-react'

const subscribeToMounted = () => () => {}
const getMountedSnapshot = () => true
const getServerMountedSnapshot = () => false

/** Ambil ?next= dan hanya izinkan path internal (cegah open-redirect). */
function safeNext(): string {
  if (typeof window === 'undefined') return '/beranda'
  const next = new URLSearchParams(window.location.search).get('next')
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/beranda'
}

export function LoginForm({ supabaseConfig }: { supabaseConfig: SupabasePublicConfig }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mounted = useSyncExternalStore(
    subscribeToMounted,
    getMountedSnapshot,
    getServerMountedSnapshot,
  )
  const resumeOnboarding = mounted && safeNext() === '/mulai?resume=1'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)

    try {
      if (!supabaseConfig?.url || !supabaseConfig?.anonKey) {
        setError('Login belum siap. Konfigurasi Supabase belum terbaca di browser.')
        return
      }
      const supabase = createClient(supabaseConfig)
      // Timeout agar UI tidak stuck di "Membuka pintu..." bila jaringan/Supabase hang.
      const signIn = supabase.auth.signInWithPassword({ email, password })
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), 20_000)
      })
      const { error } = await Promise.race([signIn, timeout])
      if (error) {
        setError('Email atau kata sandi salah. Coba lagi.')
        return
      }
      // Hard navigation: soft router.push + refresh sering macet di CF/OpenNext
      // sebelum cookie sesi terbaca server components (loading tetap true).
      window.location.assign(safeNext())
    } catch (err) {
      if (err instanceof Error && err.message === 'LOGIN_TIMEOUT') {
        setError('Login terlalu lama. Periksa koneksi lalu coba lagi.')
      } else {
        setError('Login belum siap. Konfigurasi Supabase belum terbaca di browser.')
      }
    } finally {
      // Jika hard nav jalan, unmount mengabaikan ini. Jika gagal, tombol bisa dipakai lagi.
      setLoading(false)
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
          {resumeOnboarding ? 'Simpan ceritamu' : 'Masuk ke ceritamu'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {resumeOnboarding
            ? 'Cerita ini sudah siap. Masuk agar rancanganmu terkunci ke akunmu.'
            : 'Jejak pilihan dan bab yang kamu capai akan tersimpan di akunmu.'}
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
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">KATA SANDI</span>
            <input
              type="password"
              required
              autoComplete="current-password"
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
            {loading ? 'Membuka pintu...' : resumeOnboarding ? 'Simpan Ceritaku' : 'Masuk'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Belum punya akun?{' '}
          <Link
            href={resumeOnboarding ? '/auth/sign-up?next=%2Fmulai%3Fresume%3D1' : '/auth/sign-up'}
            className="font-semibold text-primary"
          >
            Daftar
          </Link>
        </p>
      </div>
    </main>
  )
}
