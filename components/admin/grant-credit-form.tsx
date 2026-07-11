'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

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

export interface GrantCreditFormProps {
  targetUserId?: string
  onSuccess?: (result: GrantResult) => void
}

export function GrantCreditForm({ targetUserId: initialUserId, onSuccess }: GrantCreditFormProps) {
  // Email search
  const [emailQuery, setEmailQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [results, setResults] = useState<UserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  // Credit + reason
  const [credits, setCredits] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GrantResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Search users — debounce 300ms, min 2 karakter
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/users/search?email=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = (await res.json()) as { users: UserResult[] }
        setResults(data.users ?? [])
        setShowDropdown(true)
      }
    } catch { /* swallow */ } finally { setSearching(false) }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(emailQuery), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [emailQuery, doSearch])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
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
      if (res.ok) {
        setResult(data)
        onSuccess?.(data)
      } else {
        setErr(data.error ?? `HTTP ${res.status}`)
      }
    } catch (catchErr) {
      setErr((catchErr as Error)?.message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Grant Kredit</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {/* Email search with autocomplete */}
        {!initialUserId && (
          <div className="relative">
            <label className="mb-1 block text-[11px] text-muted-foreground">Cari User (email)</label>
            <input
              ref={inputRef}
              type="text"
              value={emailQuery}
              onChange={(e) => { setEmailQuery(e.target.value); setSelectedUser(null) }}
              onFocus={() => { if (results.length) setShowDropdown(true) }}
              placeholder="Ketik minimal 2 karakter email..."
              className="w-full rounded border border-border bg-background px-2 py-1.5 pr-7 text-xs"
              autoComplete="off"
            />
            {selectedUser && (
              <button type="button" onClick={clearUser}
                className="absolute right-1.5 top-[1.65rem] text-muted-foreground hover:text-foreground text-xs"
                title="Hapus pilihan">✕</button>
            )}
            {searching && <span className="absolute right-1.5 top-[1.65rem] text-[10px] text-muted-foreground">...</span>}

            {showDropdown && results.length > 0 && (
              <ul ref={dropdownRef}
                className="absolute left-0 top-full z-10 mt-1 w-full rounded border border-border bg-card shadow-lg max-h-40 overflow-auto">
                {results.map((u) => (
                  <li key={u.user_id}>
                    <button type="button" onClick={() => selectUser(u)}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                      <span>{u.email}</span>
                      <span className="ml-2 text-[9px] text-muted-foreground font-mono">{u.user_id.slice(0, 8)}...</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {showDropdown && emailQuery.length >= 2 && results.length === 0 && !searching && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded border border-border bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-lg">
                Tidak ditemukan.
              </div>
            )}
            {selectedUser && (
              <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ {selectedUser.email}
              </p>
            )}
          </div>
        )}

        {/* Fallback: UUID direct input */}
        {initialUserId && (
          <p className="rounded bg-muted/50 px-2 py-1 text-[10px] font-mono text-muted-foreground">
            User: {initialUserId.slice(0, 12)}...
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Kredit</span>
          <input type="number" value={credits} onChange={(e) => setCredits(e.target.value)}
            min={1} max={100000} placeholder="1..100000" required
            className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Alasan</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)}
            minLength={3} maxLength={500} rows={2} placeholder="3..500 karakter" required
            className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <button type="submit" disabled={loading || (!initialUserId && !selectedUser)}
          className="rounded bg-lavender px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {loading ? '...' : 'Grant Kredit'}
        </button>

        {err && <p className="text-[11px] text-destructive">{err}</p>}
        {result && (
          <div className={`rounded px-2 py-1 text-[11px] ${result.granted
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            {result.granted ? '✓ Grant berhasil' : '⚠ Duplikat'} —{' '}
            <code className="text-[10px]">{result.ref}</code>
          </div>
        )}
      </form>
    </div>
  )
}
