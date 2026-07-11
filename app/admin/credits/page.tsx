'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Halaman admin grant kredit manual (ops internal).
 *
 * Halaman ini diproteksi oleh layout.tsx — hanya user dengan role
 * admin/owner di tabel `admin_users` yang bisa mengakses.
 *
 * UI: search email user (autocomplete) → pilih → isi kredit + alasan → grant.
 * Tidak ada istilah AI/model/token/provider di UI ini.
 */

interface UserResult {
  user_id: string
  email: string
}

interface GrantResult {
  ok: boolean
  granted: boolean
  ref: string
  message?: string
  error?: string
  targetUserId?: string
  credits?: number
}

export default function AdminCreditsPage() {
  const [emailQuery, setEmailQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [results, setResults] = useState<UserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [credits, setCredits] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GrantResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Search users — debounce 300ms, min 2 karakter.
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setShowDropdown(false)
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/users/search?email=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = (await res.json()) as { users: UserResult[] }
        setResults(data.users ?? [])
        setShowDropdown(true)
      }
    } catch {
      // swallow
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(emailQuery), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [emailQuery, doSearch])

  // Tutup dropdown bila klik di luar.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectUser(u: UserResult) {
    setSelectedUser(u)
    setEmailQuery(u.email)
    setShowDropdown(false)
    setErr(null)
    setResult(null)
  }

  function clearUser() {
    setSelectedUser(null)
    setEmailQuery('')
    setResults([])
    setShowDropdown(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser) return
    setLoading(true)
    setErr(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: selectedUser.user_id,
          credits: Number(credits),
          reason: reason.trim(),
        }),
      })

      const data = (await res.json()) as GrantResult

      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (catchErr) {
      setErr((catchErr as Error)?.message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl text-foreground">Grant Kredit Manual</h1>
        <p className="text-sm text-muted-foreground">
          Cari user berdasarkan email, lalu beri kredit. Semua grant tercatat di audit trail.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form Grant</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* ---- Email search dengan autocomplete ---- */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Cari User (email)</span>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={emailQuery}
                  onChange={(e) => {
                    setEmailQuery(e.target.value)
                    setSelectedUser(null)
                  }}
                  onFocus={() => { if (results.length) setShowDropdown(true) }}
                  placeholder="Ketik minimal 2 karakter email..."
                  className="w-full rounded border border-border bg-background px-3 py-2 pr-8 text-sm"
                />
                {selectedUser && (
                  <button
                    type="button"
                    onClick={clearUser}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                    title="Hapus pilihan"
                  >
                    ✕
                  </button>
                )}
                {searching && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    ...
                  </span>
                )}

                {showDropdown && results.length > 0 && (
                  <ul
                    ref={dropdownRef}
                    className="absolute left-0 top-full z-10 mt-1 w-full rounded border border-border bg-card shadow-lg max-h-48 overflow-auto"
                  >
                    {results.map((u) => (
                      <li key={u.user_id}>
                        <button
                          type="button"
                          onClick={() => selectUser(u)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="font-medium">{u.email}</span>
                          <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                            {u.user_id.slice(0, 8)}...
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {showDropdown && emailQuery.length >= 2 && results.length === 0 && !searching && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-lg">
                    Tidak ditemukan.
                  </div>
                )}
              </div>
              {selectedUser && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ Dipilih: <span className="font-medium">{selectedUser.email}</span>
                </p>
              )}
            </label>

            {/* ---- Jumlah kredit ---- */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Jumlah Kredit</span>
              <input
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="1..100000"
                min={1}
                max={100000}
                required
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            {/* ---- Alasan ---- */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Alasan</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan grant (wajib, 3..500 karakter)"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={loading || !selectedUser}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? 'Memproses...' : 'Grant Kredit'}
            </button>
          </form>
        </CardContent>
      </Card>

      {err && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Gagal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{err}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-500/50">
          <CardHeader>
            <CardTitle className="text-base text-emerald-600">
              {result.granted ? 'Grant Berhasil' : 'Grant Duplikat'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-medium">Ref ledger:</span>{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{result.ref}</code>
            </p>
            {selectedUser && (
              <p className="text-sm">
                <span className="font-medium">User:</span>{' '}
                {selectedUser.email} <code className="rounded bg-muted px-1.5 py-0.5 text-xs ml-1">{selectedUser.user_id}</code>
              </p>
            )}
            {result.credits != null && (
              <p className="text-sm">
                <span className="font-medium">Kredit:</span> {result.credits}
              </p>
            )}
            {result.message && (
              <p className="text-sm text-muted-foreground">{result.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
