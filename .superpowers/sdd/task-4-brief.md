### Task 4: Migrasi Seam Sesi Server & Middleware

**Files:**
- Modify: `lib/api/user-state.ts`
- Modify: `middleware.ts`
- Modify: `components/logout-button.tsx`
- Delete: `lib/supabase/proxy.ts` (ganti dengan middleware Better Auth)
- Test: `tests/auth/session-seam.test.ts`

**Interfaces:**
- Consumes: `auth.api.getSession` dari `lib/auth.ts`.
- Produces:
  - `getSessionUser()`: mengembalikan user aktif (berisi `id` dan `email`), mendukung cookie browser dan bearer token Android/API. Jika tidak login, mengembalikan `null` (dead cookie/guest).
  - `middleware.ts`: proteksi rute dan auto-redirect `/beranda` untuk pengguna terotentikasi.
  - `LogoutButton`: memanggil `authClient.signOut()`.

- [ ] **Step 1: Tulis test seam sesi**

```ts
// tests/auth/session-seam.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getSessionMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ cookie: 'better-auth.session_token=valid-token' })),
}))

import { getSessionUser } from '@/lib/api/user-state'

describe('getSessionUser with Better Auth', () => {
  it('mengembalikan objek User saat sesi valid', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'u123', email: 'test@example.com', name: 'Budi' },
      session: { id: 's123', token: 'valid-token' },
    })

    const user = await getSessionUser()
    expect(user).not.toBeNull()
    expect(user?.id).toBe('u123')
    expect(user?.email).toBe('test@example.com')
  })

  it('mengembalikan null saat sesi tidak ada atau kedaluwarsa (guest safe)', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const user = await getSessionUser()
    expect(user).toBeNull()
  })

  it('mengembalikan null jika getSession melempar error (dead cookie defense)', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('Network error'))
    const user = await getSessionUser()
    expect(user).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run tests/auth/session-seam.test.ts`
Expected: FAIL — `getSessionUser` masih memanggil Supabase.

- [ ] **Step 3: Ubah `lib/api/user-state.ts`**

Ganti blok pembaca sesi Supabase di `lib/api/user-state.ts` (sekitar baris 70–125) dengan integrasi Better Auth:

```ts
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export interface User {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

/**
 * Pintu tunggal pembaca sesi pengguna di server (RSC & API route).
 * Membaca cookie browser dan Authorization Bearer token secara otomatis via Better Auth.
 * Pertahanan mati: sesi tidak valid mengembalikan null (guest), tanpa crash RSC.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<User | null> {
  try {
    const h = await headers()
    const session = await auth.api.getSession({ headers: h })
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      user_metadata: { name: session.user.name },
    }
  } catch (error) {
    console.warn('[user-state] Gagal membaca sesi Better Auth:', error)
    return null
  }
})
```

- [ ] **Step 4: Ubah `middleware.ts` dan hapus dependensi `lib/supabase/proxy.ts`**

Perbarui `middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PREFIXES = ['/beranda', '/profil', '/kredit', '/payment', '/s/']
const AUTH_ROUTES = ['/auth/login', '/auth/sign-up']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Cek keberadaan cookie sesi Better Auth
  const sessionCookie =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const hasSession = !!sessionCookie

  // 1. Auto-redirect root dan auth routes ke /beranda jika sudah login
  if (hasSession && (pathname === '/' || AUTH_ROUTES.some((r) => pathname.startsWith(r)))) {
    return NextResponse.redirect(new URL('/beranda', request.url))
  }

  // 2. Proteksi rute privat jika belum login
  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/beranda/:path*',
    '/profil/:path*',
    '/kredit/:path*',
    '/payment/:path*',
    '/s/:path*',
    '/auth/login',
    '/auth/sign-up',
  ],
}
```

- [ ] **Step 5: Perbarui `components/logout-button.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { clearStoredWebPush } from '@/components/push/web-registration'
import { clearAndroidPush } from '@/lib/android/push-bridge'

export function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await clearStoredWebPush()
    await clearAndroidPush()
    await authClient.signOut()
    router.push('/beranda')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
    >
      Keluar
    </button>
  )
}
```

- [ ] **Step 6: Jalankan test seam dan pastikan lulus**

Run: `pnpm exec vitest run tests/auth/session-seam.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Commit**

```bash
git add lib/api/user-state.ts middleware.ts components/logout-button.tsx tests/auth/session-seam.test.ts
git rm lib/supabase/proxy.ts
git commit -m "feat(auth): migrate getSessionUser, middleware, and logout to Better Auth"
```

---

