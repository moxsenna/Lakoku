# Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase Google OAuth on login and sign-up (button below "atau"), harden callback `next`, merge guest taste after OAuth via `/auth/complete`.

**Architecture:** Browser `signInWithOAuth({ provider: 'google' })` → Supabase → `GET /auth/callback` exchanges code, sanitizes `next`, redirects to client `/auth/complete` which best-effort merges guest taste from localStorage then hard-navigates to destination. Shared `sanitizeNextPath` closes open-redirect. Email/password unchanged.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, Supabase Auth Google provider, Vitest, existing `actMergeGuestTasteProfile`.

**Spec:** `docs/superpowers/specs/2026-07-22-google-login-design.md`

---

## File map

| Path | Role |
|------|------|
| `lib/auth/safe-next.ts` | **Create** — pure `sanitizeNextPath` |
| `tests/auth/safe-next.test.ts` | **Create** — unit matrix |
| `app/auth/callback/route.ts` | **Modify** — sanitize + redirect to complete |
| `app/auth/complete/page.tsx` | **Create** — client post-auth merge + hard nav |
| `lib/auth/google-button.tsx` or inline SVG in forms | Prefer small shared button component to avoid duplicating SVG |
| `components/auth/google-sign-in-button.tsx` | **Create** — outline Google CTA (client) |
| `app/auth/login/login-form.tsx` | **Modify** — shared sanitize + Google button + handler |
| `app/auth/sign-up/sign-up-form.tsx` | **Modify** — same Google UX |
| `scripts/auth-config-smoke.ts` | **Modify** — source checks for Google CTA + sanitize usage |
| Ops (manual, no code) | Google Cloud + Supabase provider + redirect URLs |

---

### Task 1: `sanitizeNextPath` helper (TDD)

**Files:**
- Create: `lib/auth/safe-next.ts`
- Create: `tests/auth/safe-next.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/auth/safe-next.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

describe('sanitizeNextPath', () => {
  it('defaults empty/nullish to /beranda', () => {
    expect(sanitizeNextPath(null)).toBe('/beranda')
    expect(sanitizeNextPath(undefined)).toBe('/beranda')
    expect(sanitizeNextPath('')).toBe('/beranda')
    expect(sanitizeNextPath('   ')).toBe('/beranda')
  })

  it('accepts internal paths with query and hash', () => {
    expect(sanitizeNextPath('/beranda')).toBe('/beranda')
    expect(sanitizeNextPath('/mulai?resume=1')).toBe('/mulai?resume=1')
    expect(sanitizeNextPath('/baca/abc-123?bab=2')).toBe('/baca/abc-123?bab=2')
    expect(sanitizeNextPath('/profil#settings')).toBe('/profil#settings')
  })

  it('rejects open-redirect patterns', () => {
    expect(sanitizeNextPath('//evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('/\\evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('https://evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('http://evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('//evil.com/path')).toBe('/beranda')
    expect(sanitizeNextPath('beranda')).toBe('/beranda')
    expect(sanitizeNextPath('javascript:alert(1)')).toBe('/beranda')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm exec vitest run tests/auth/safe-next.test.ts
```

Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Implement helper**

Create `lib/auth/safe-next.ts`:

```ts
/**
 * Sanitize post-auth redirect path.
 * Only same-origin relative paths starting with a single `/`.
 * Rejects protocol-relative, absolute URLs, and backslash tricks.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (raw == null) return '/beranda'
  const next = raw.trim()
  if (!next) return '/beranda'
  if (!next.startsWith('/')) return '/beranda'
  if (next.startsWith('//')) return '/beranda'
  if (next.includes('\\')) return '/beranda'
  // Block accidental scheme smuggling after first slash edge cases
  const lower = next.toLowerCase()
  if (lower.startsWith('/http:') || lower.startsWith('/https:')) return '/beranda'
  return next
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run tests/auth/safe-next.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/safe-next.ts tests/auth/safe-next.test.ts
git commit -m "feat(auth): add sanitizeNextPath for post-login redirects"
```

---

### Task 2: Harden callback → `/auth/complete`

**Files:**
- Modify: `app/auth/callback/route.ts`
- Create: `app/auth/complete/page.tsx`

- [ ] **Step 1: Rewrite callback route**

Replace `app/auth/callback/route.ts` with:

```ts
import { createClient } from '@/lib/supabase/server'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = sanitizeNextPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Client bridge: guest taste lives in localStorage (server cannot read it).
      const complete = new URL('/auth/complete', origin)
      complete.searchParams.set('next', next)
      return NextResponse.redirect(complete)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Create complete page (client)**

Create `app/auth/complete/page.tsx`:

```tsx
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
```

- [ ] **Step 3: Typecheck touchpoints**

```bash
pnpm exec tsc --noEmit --incremental false
```

Expected: 0 errors related to new files (project may have pre-existing unrelated noise — fix only what this task introduced).

- [ ] **Step 4: Commit**

```bash
git add app/auth/callback/route.ts app/auth/complete/page.tsx
git commit -m "feat(auth): harden OAuth callback and add complete bridge"
```

---

### Task 3: Shared Google sign-in button component

**Files:**
- Create: `components/auth/google-sign-in-button.tsx`

- [ ] **Step 1: Create outline button**

```tsx
'use client'

type Props = {
  loading: boolean
  disabled?: boolean
  onClick: () => void
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function GoogleSignInButton({ loading, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-6 text-sm font-semibold text-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <GoogleMark className="size-5 shrink-0" />
      {loading ? 'Mengarahkan ke Google...' : 'Masuk dengan Google'}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/auth/google-sign-in-button.tsx
git commit -m "feat(auth): add Google sign-in button component"
```

---

### Task 4: Wire Google on login form

**Files:**
- Modify: `app/auth/login/login-form.tsx`

- [ ] **Step 1: Update imports and remove local `safeNext`**

At top of `app/auth/login/login-form.tsx`:

- Keep existing imports for react, Link, createClient, taste profile, actMerge, ArrowLeft
- Add:

```ts
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
```

- Delete the local function:

```ts
function safeNext(): string {
  if (typeof window === 'undefined') return '/beranda'
  const next = new URLSearchParams(window.location.search).get('next')
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/beranda'
}
```

- Add shared reader used by client only:

```ts
function readSafeNextFromWindow(): string {
  if (typeof window === 'undefined') return '/beranda'
  return sanitizeNextPath(new URLSearchParams(window.location.search).get('next'))
}
```

- [ ] **Step 2: Update resume check and email success nav**

Replace `safeNext()` usages:

```ts
const resumeOnboarding = mounted && readSafeNextFromWindow() === '/mulai?resume=1'
```

In email success path:

```ts
window.location.assign(readSafeNextFromWindow())
```

- [ ] **Step 3: Add Google handler state + function**

Inside `LoginForm`, after existing state, track shared loading is enough (`loading` already exists). Add:

```ts
async function handleGoogle() {
  if (loading) return
  setLoading(true)
  setError(null)
  try {
    if (!supabaseConfig?.url || !supabaseConfig?.anonKey) {
      setError('Login Google belum siap. Konfigurasi Supabase belum terbaca di browser.')
      setLoading(false)
      return
    }
    const supabase = createClient(supabaseConfig)
    const next = readSafeNextFromWindow()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (error) {
      setError('Login Google gagal. Coba lagi atau masuk dengan email.')
      setLoading(false)
    }
    // On success browser navigates away to Google; keep loading true.
  } catch {
    setError('Login Google belum siap. Konfigurasi Supabase belum terbaca di browser.')
    setLoading(false)
  }
}
```

- [ ] **Step 4: UI — separator + button after form, before sign-up link**

After the closing `</form>` and **before** the "Belum punya akun?" paragraph, insert:

```tsx
<div className="mt-6 flex items-center gap-3">
  <div className="h-px flex-1 bg-border" />
  <span className="text-xs font-medium text-muted-foreground">atau</span>
  <div className="h-px flex-1 bg-border" />
</div>

<div className="mt-6">
  <GoogleSignInButton loading={loading} onClick={() => void handleGoogle()} />
</div>
```

Keep the existing sign-up link block after that (`mt-6` as now).

- [ ] **Step 5: Smoke-read mentally**

- Email path still merges guest taste then hard nav
- Google path does **not** merge in form (complete page does)
- Primary submit still "Masuk" / "Simpan Ceritaku"

- [ ] **Step 6: Commit**

```bash
git add app/auth/login/login-form.tsx
git commit -m "feat(auth): add Google OAuth button on login form"
```

---

### Task 5: Wire Google on sign-up form

**Files:**
- Modify: `app/auth/sign-up/sign-up-form.tsx`

- [ ] **Step 1: Imports + helpers**

Add:

```ts
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
```

Add:

```ts
function readSafeNextFromWindow(): string {
  if (typeof window === 'undefined') return '/beranda'
  return sanitizeNextPath(new URLSearchParams(window.location.search).get('next'))
}
```

- [ ] **Step 2: Google handler**

Inside `SignUpForm` (reuse `loading` / `error` / `setLoading` / `setError`):

```ts
async function handleGoogle() {
  if (loading) return
  setLoading(true)
  setError(null)
  try {
    if (!supabaseConfig?.url || !supabaseConfig?.anonKey) {
      setError('Login Google belum siap. Konfigurasi Supabase belum terbaca di browser.')
      setLoading(false)
      return
    }
    const supabase = createClient(supabaseConfig)
    const next = readSafeNextFromWindow()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (error) {
      setError('Login Google gagal. Coba lagi atau masuk dengan email.')
      setLoading(false)
    }
  } catch {
    setError('Login Google belum siap. Konfigurasi Supabase belum terbaca di browser.')
    setLoading(false)
  }
}
```

- [ ] **Step 3: UI after form**

After `</form>`, before "Sudah punya akun?":

```tsx
<div className="mt-6 flex items-center gap-3">
  <div className="h-px flex-1 bg-border" />
  <span className="text-xs font-medium text-muted-foreground">atau</span>
  <div className="h-px flex-1 bg-border" />
</div>

<div className="mt-6">
  <GoogleSignInButton loading={loading} onClick={() => void handleGoogle()} />
</div>
```

- [ ] **Step 4: Commit**

```bash
git add app/auth/sign-up/sign-up-form.tsx
git commit -m "feat(auth): add Google OAuth button on sign-up form"
```

---

### Task 6: Extend auth-config smoke (source contracts)

**Files:**
- Modify: `scripts/auth-config-smoke.ts`

- [ ] **Step 1: Add file-read checks**

After existing client config check, append source assertions (Node `fs` + `path`):

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// inside main(), after existing check:
const root = join(__dirname, '..')
const loginSrc = readFileSync(join(root, 'app/auth/login/login-form.tsx'), 'utf8')
const signUpSrc = readFileSync(join(root, 'app/auth/sign-up/sign-up-form.tsx'), 'utf8')
const callbackSrc = readFileSync(join(root, 'app/auth/callback/route.ts'), 'utf8')
const safeNextSrc = readFileSync(join(root, 'lib/auth/safe-next.ts'), 'utf8')
const completeSrc = readFileSync(join(root, 'app/auth/complete/page.tsx'), 'utf8')

check('login form exposes Google CTA copy', loginSrc.includes('Masuk dengan Google') || loginSrc.includes('GoogleSignInButton'))
check('sign-up form exposes Google CTA', signUpSrc.includes('GoogleSignInButton') || signUpSrc.includes('Masuk dengan Google'))
check('login uses signInWithOAuth google', loginSrc.includes("provider: 'google'") || loginSrc.includes('provider: "google"'))
check('sign-up uses signInWithOAuth google', signUpSrc.includes("provider: 'google'") || signUpSrc.includes('provider: "google"'))
check('callback sanitizes next', callbackSrc.includes('sanitizeNextPath'))
check('callback routes to complete bridge', callbackSrc.includes('/auth/complete'))
check('safe-next helper exports sanitizeNextPath', safeNextSrc.includes('export function sanitizeNextPath'))
check('complete page merges guest taste', completeSrc.includes('actMergeGuestTasteProfile'))
check('complete page hard-navigates', completeSrc.includes('window.location.assign'))
```

Ensure `import` lines are valid at top of the smoke file (merge with existing imports).

- [ ] **Step 2: Run smoke**

```bash
pnpm run smoke:auth-config
```

Expected: all PASS, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/auth-config-smoke.ts
git commit -m "test(auth): smoke-check Google OAuth wiring contracts"
```

---

### Task 7: Verification + ops checklist

**Files:** none required (manual / commands)

- [ ] **Step 1: Unit + smoke + typecheck**

```bash
pnpm exec vitest run tests/auth/safe-next.test.ts
pnpm run smoke:auth-config
pnpm exec tsc --noEmit --incremental false
```

Expected: tests PASS; smoke PASS; no new type errors from this feature.

- [ ] **Step 2: Ops — Google Cloud (manual)**

Follow spec section **Ops: step-by-step setup → A. Google Cloud Console**:

1. OAuth consent screen
2. OAuth client type **Web**
3. Authorized redirect URI = `https://<PROJECT_REF>.supabase.co/auth/v1/callback`  
   (NOT the Next.js `/auth/callback`)
4. Copy Client ID + Secret

- [ ] **Step 3: Ops — Supabase (manual)**

1. Auth → Providers → Google ON + paste credentials
2. URL Configuration Redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://<prod-domain>/auth/callback`
3. Site URL correct for env
4. Enable automatic identity linking by email

- [ ] **Step 4: Manual browser pass (local)**

1. `pnpm dev`
2. `/auth/login` → Google → land `/beranda`
3. `/auth/login?next=/mulai?resume=1` → Google → resume path
4. `/auth/sign-up` → Google works
5. Email/password still works
6. Cancel Google → `/auth/error` friendly
7. Craft URL `/auth/callback?next=//evil.com` without valid code → error; with code only after real OAuth (sanitize still forces safe path when exchange succeeds)

- [ ] **Step 5: Final commit only if residual docs/notes**

If you added a short note under `docs/` (optional), commit separately. Prefer **not** committing secrets.

If everything already committed in prior tasks:

```bash
git status
```

Expected: clean for Google-login files (ignore unrelated WIP).

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Google on login + sign-up | 4, 5 |
| UI below form + "atau" | 4, 5 |
| `signInWithOAuth` client | 4, 5 |
| Shared `sanitizeNextPath` | 1 |
| Callback harden | 2 |
| `/auth/complete` guest taste | 2 |
| Hard nav post-auth | 2 (complete); login email path keeps hard nav |
| Email/password kept | 4 (no removal) |
| Local + prod redirect docs | Spec + Task 7 ops |
| Automatic linking | Task 7 ops |
| Unit tests safe-next | 1 |
| Light smoke | 6 |
| No new public Google secrets in app | Spec / Task 7 |

No TBD placeholders. Function name `sanitizeNextPath` consistent across tasks. Complete path always `/auth/complete`.

---

## Out of plan (do not implement)

- One Tap / GIS
- Other providers
- Removing email auth
- Changing middleware protected prefixes
- Forcing email path through `/auth/complete` (optional later cleanup)
