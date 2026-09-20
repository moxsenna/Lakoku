'use client'

import { useState } from 'react'
import { sendBroadcast } from '@/app/admin/push/actions'

/**
 * Formulir siaran push: judul, isi, audiens, tautan opsional.
 * Mengirim lewat server action (RBAC admin) — bukan API bertoken.
 */

const AUDIENCES = [
  { value: 'all', label: 'Semua perangkat' },
  { value: 'android', label: 'Android saja' },
  { value: 'web', label: 'Web saja' },
] as const

export function BroadcastForm() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<string>('all')
  const [deepLink, setDeepLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const result = await sendBroadcast({
      title: title.trim(),
      body: body.trim(),
      audience,
      ...(deepLink.trim() ? { deepLink: deepLink.trim() } : {}),
    })
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error ?? 'Gagal mengirim siaran.')
      return
    }
    setNotice(
      `Terkirim: ${result.successCount ?? 0} berhasil, ${result.failureCount ?? 0} gagal (${result.status ?? ''}).`,
    )
    setTitle('')
    setBody('')
    setDeepLink('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-4 py-4">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-foreground">Judul (maks 60)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          required
          className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          placeholder="Contoh: Bab baru sudah siap"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-foreground">Isi (maks 160)</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={160}
          required
          rows={3}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Contoh: Lanjutan favoritmu menunggumu."
        />
      </label>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold text-foreground">Audiens</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold text-foreground">Tautan (opsional)</span>
          <input
            value={deepLink}
            onChange={(e) => setDeepLink(e.target.value)}
            placeholder="/baca/…"
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
      </div>
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? 'Mengirim…' : 'Kirim siaran'}
      </button>
    </form>
  )
}
