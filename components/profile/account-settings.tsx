'use client'

/**
 * Pengaturan akun pembaca di halaman profil:
 * 1. Nama tampilan — inline edit (authClient.updateUser).
 * 2. Email — tampil + badge verifikasi; ubah email lewat dialog
 *    (authClient.changeEmail; email baru diverifikasi lewat tautan email).
 * 3. Kata sandi — percabangan berdasarkan keberadaan kredensial:
 *    akun email → ganti kata sandi (changePassword),
 *    akun Google tanpa kata sandi → buat kata sandi (actSetPassword).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AtSign,
  Check,
  KeyRound,
  Loader2,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  UserRound,
  X,
} from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { validateNewPassword } from '@/lib/auth/password-recovery'
import { actSetPassword } from '@/app/(shell)/profil/actions'

type ApiError = { error?: { code?: string; message?: string } | null } | null | undefined

function friendlyAuthError(err: ApiError, fallback: string): string {
  const code = err?.error?.code ?? ''
  const message = err?.error?.message ?? ''
  if (code === 'INVALID_PASSWORD' || /incorrect\s+password/i.test(message)) {
    return 'Kata sandi lama salah.'
  }
  if (code === 'USER_EMAIL_ALREADY_EXISTS' || /already\s+(exist|used)/i.test(message)) {
    return 'Email sudah dipakai akun lain.'
  }
  if (code === 'PASSWORD_TOO_SHORT' || /password.*short|minimal/i.test(message)) {
    return 'Kata sandi baru terlalu pendek — minimal 6 karakter.'
  }
  if (code === 'USER_ALREADY_EXISTS' && /email/i.test(message)) {
    return 'Email sudah dipakai akun lain.'
  }
  return message || fallback
}

const FORM_LABEL = 'flex flex-col gap-1.5'
const FORM_INPUT =
  'min-h-13 rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-primary'
const PRIMARY_BTN =
  'flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60'

export function AccountSettings() {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  const [hasCredential, setHasCredential] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    authClient
      .listAccounts()
      .then((res) => {
        if (cancelled) return
        // Client better-auth bisa membungkus respons dalam { data, error }.
        const list = Array.isArray(res) ? res : res?.data
        setHasCredential(
          Array.isArray(list) && list.some((a) => a?.providerId === 'credential'),
        )
      })
      .catch(() => {
        if (cancelled) return
        setHasCredential(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (isPending || !user) return null

  return (
    <section aria-label="Pengaturan Akun" className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pengaturan Akun
      </h2>

      <NameRow name={user.name ?? ''} />
      <EmailRow email={user.email} verified={Boolean(user.emailVerified)} />
      <PasswordRow hasCredential={hasCredential} />
    </section>
  )
}

// ─── Nama tampilan ──────────────────────────────────────────────

function NameRow({ name }: { name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === name) {
      setEditing(false)
      return
    }
    setLoading(true)
    setMessage(null)
    const res = await authClient.updateUser({ name: trimmed })
    setLoading(false)
    if (res?.error) {
      setMessage(friendlyAuthError(res, 'Gagal menyimpan nama. Coba lagi.'))
      return
    }
    setEditing(false)
    setMessage('Nama tersimpan.')
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <UserRound className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">Nama Tampilan</span>
        {editing ? (
          <div className="mt-2 flex gap-2">
            <input
              ref={inputRef}
              value={value}
              maxLength={60}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
              className={`${FORM_INPUT} min-h-11 flex-1`}
              aria-label="Nama tampilan baru"
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={loading}
              className={`${PRIMARY_BTN} min-h-11 px-4`}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : 'Simpan'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setValue(name)
                setMessage(null)
              }}
              className="flex min-h-11 items-center rounded-2xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-secondary"
              aria-label="Batal ubah nama"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <p className="truncate text-xs text-muted-foreground">{name || 'Belum diatur'}</p>
        )}
        {message && (
          <p role="status" className="mt-1.5 text-xs text-primary">
            {message}
          </p>
        )}
      </div>
      {!editing && (
        <button
          type="button"
          onClick={() => {
            setValue(name)
            setEditing(true)
            setMessage(null)
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Ubah nama tampilan"
        >
          <Pencil className="size-4" />
        </button>
      )}
    </div>
  )
}

// ─── Email ──────────────────────────────────────────────────────

function EmailRow({ email, verified }: { email: string; verified: boolean }) {
  const [open, setOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleChangeEmail() {
    const trimmed = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Format email tidak valid.')
      return
    }
    setLoading(true)
    setError(null)
    const res = await authClient.changeEmail({ newEmail: trimmed, callbackURL: '/profil' })
    setLoading(false)
    if (res?.error) {
      setError(friendlyAuthError(res, 'Gagal mengubah email. Coba lagi.'))
      return
    }
    setSent(true)
  }

  function handleClose() {
    setOpen(false)
    setNewEmail('')
    setError(null)
    setSent(false)
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <AtSign className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">Email</span>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
        <span
          className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            verified
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-gold/15 text-gold'
          }`}
        >
          {verified ? (
            <>
              <ShieldCheck className="size-3" /> Terverifikasi
            </>
          ) : (
            <>
              <ShieldAlert className="size-3" /> Belum diverifikasi — cek kotak masukmu
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-primary hover:bg-secondary"
      >
        Ubah
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
            <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl">
              <div className="flex items-center justify-between pb-4">
                <h2 className="text-base font-semibold text-foreground">Ubah Email</h2>
                <button
                  onClick={handleClose}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
                  aria-label="Tutup"
                >
                  <X className="size-5" />
                </button>
              </div>

              {sent ? (
                <div className="flex flex-col gap-4 pb-2">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Tautan verifikasi dikirim ke <strong className="text-foreground">{newEmail.trim().toLowerCase()}</strong>.
                    Buka tautan itu agar email baru aktif.
                  </p>
                  <button type="button" onClick={handleClose} className={PRIMARY_BTN}>
                    Mengerti
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4 pb-2">
                  <label className={FORM_LABEL}>
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                      EMAIL BARU
                    </span>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className={FORM_INPUT}
                      autoFocus
                    />
                  </label>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleChangeEmail()}
                    disabled={loading || !newEmail.trim()}
                    className={PRIMARY_BTN}
                  >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : 'Kirim Tautan Verifikasi'}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

// ─── Kata sandi ─────────────────────────────────────────────────

function PasswordRow({ hasCredential }: { hasCredential: boolean | null }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const isSetMode = hasCredential === false

  async function handleSubmit() {
    const validation = validateNewPassword(next, confirm)
    if (!validation.ok) {
      setError(validation.message)
      return
    }
    setLoading(true)
    setError(null)

    if (isSetMode) {
      const res = await actSetPassword(next)
      setLoading(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setDone(true)
      setOpen(false)
      return
    }

    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: false,
    })
    setLoading(false)
    if (res?.error) {
      setError(friendlyAuthError(res, 'Gagal mengganti kata sandi. Coba lagi.'))
      return
    }
    setDone(true)
    setOpen(false)
  }

  function handleClose() {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  const statusLabel =
    hasCredential === null
      ? 'Memuat…'
      : hasCredential
        ? 'Terpasang — tap untuk mengganti'
        : 'Belum ada — pakai Google untuk masuk'

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <KeyRound className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">
          {isSetMode ? 'Buat Kata Sandi' : 'Kata Sandi'}
        </span>
        <p className="truncate text-xs text-muted-foreground">
          {done ? 'Kata sandi tersimpan.' : statusLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={hasCredential === null}
        className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-primary hover:bg-secondary disabled:opacity-50"
      >
        {isSetMode ? 'Buat' : 'Ganti'}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
            <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl">
              <div className="flex items-center justify-between pb-4">
                <h2 className="text-base font-semibold text-foreground">
                  {isSetMode ? 'Buat Kata Sandi' : 'Ganti Kata Sandi'}
                </h2>
                <button
                  onClick={handleClose}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
                  aria-label="Tutup"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex flex-col gap-4 pb-2">
                {!isSetMode && (
                  <label className={FORM_LABEL}>
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                      KATA SANDI LAMA
                    </span>
                    <input
                      type="password"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      className={FORM_INPUT}
                      autoComplete="current-password"
                    />
                  </label>
                )}
                <label className={FORM_LABEL}>
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                    KATA SANDI BARU
                  </span>
                  <input
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className={FORM_INPUT}
                    autoComplete="new-password"
                    minLength={6}
                  />
                </label>
                <label className={FORM_LABEL}>
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                    ULANGI KATA SANDI BARU
                  </span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={FORM_INPUT}
                    autoComplete="new-password"
                    minLength={6}
                  />
                </label>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={loading || !next || !confirm || (!isSetMode && !current)}
                  className={PRIMARY_BTN}
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : isSetMode ? 'Buat Kata Sandi' : 'Simpan Kata Sandi'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
