# Google Login Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Stack:** Next.js 16 + Supabase Auth (`@supabase/ssr`)  
**Approach:** Client `signInWithOAuth({ provider: 'google' })` (Approach A)

## Goal

Add **Login with Google** on login and sign-up screens. Email/password stays. Same session model, route guards, and guest-to-login preservation already used by the app.

## Non-goals

- Google One Tap / GIS `id_token` flow
- Other OAuth providers (Apple, Facebook, etc.)
- Removing email/password auth
- Custom profile mapping beyond Supabase defaults (`full_name`, avatar URL if present)
- Changing admin RBAC or middleware protected prefixes

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Placement | Login **and** sign-up |
| UI layout | Below email form, separator **"atau"**, outline Google button |
| Account linking | Automatic link when Google email matches existing email user (Supabase setting ON) |
| Environments | Local + production redirect URLs |
| OAuth start | Browser client `signInWithOAuth` |
| Post-auth side effects | Client bridge page (guest taste is in `localStorage`) |

## Current state

- Email/password: `app/auth/login/login-form.tsx`, `app/auth/sign-up/sign-up-form.tsx`
- Session cookie refresh + route protect: `lib/supabase/proxy.ts` + `middleware.ts`
- OAuth code exchange already exists: `app/auth/callback/route.ts` (`exchangeCodeForSession`)
- Guest taste merge after email login: client-only in login form via `actMergeGuestTasteProfile`
- `next` open-redirect sanitization exists only in login form (`safeNext()`), **not** in callback

## Architecture

```
[Login / Sign-up form]
  → supabase.auth.signInWithOAuth({ provider: 'google', redirectTo })
  → Google consent
  → Supabase https://<project>.supabase.co/auth/v1/callback
  → App /auth/callback?code=…&next=…
  → exchangeCodeForSession (sets session cookies)
  → redirect /auth/complete?next=<safe>
  → merge guest taste (best-effort, localStorage → server)
  → window.location.assign(next)
```

### Why `/auth/complete`?

Guest taste profile lives in **browser localStorage**. The server callback cannot read it. Email login merges in the form submit handler; OAuth never returns to that handler, so a small client bridge after session cookies exist is required.

### `redirectTo` shape

```
{origin}/auth/callback?next={encodeURIComponent(safeNext)}
```

Examples:

- `http://localhost:3000/auth/callback?next=%2Fberanda`
- `http://localhost:3000/auth/callback?next=%2Fmulai%3Fresume%3D1`
- `https://<prod-domain>/auth/callback?next=%2Fbaca%2F…`

Supabase must allow the **origin + path** of these URLs in Redirect URLs (query string is app-controlled after return).

### Safe next rules (shared helper)

Single helper, e.g. `lib/auth/safe-next.ts`:

- Accept only strings starting with `/`
- Reject `//`, protocol-relative, `http:`, `https:`, backslash tricks
- Default: `/beranda`
- Used by: login form, sign-up form, callback route, complete page

### Callback harden

Today callback does:

```ts
const next = searchParams.get('next') ?? '/beranda'
return NextResponse.redirect(`${origin}${next}`)
```

Must sanitize `next` with the shared helper before redirect. On exchange failure → `/auth/error` (existing page is fine; optional `?error=` later).

### OAuth call (client)

```ts
const supabase = createClient(supabaseConfig)
const next = sanitizeNextPath(/* from query or default */)
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
  },
})
```

Do **not** force `prompt: 'consent'` every time (poor UX). Default Supabase/Google behavior is enough.

## UI

### Layout (login + sign-up)

```
[ email / password fields … ]
[ primary submit: Masuk / Daftar ]

        atau

[ outline button: Google mark + "Masuk dengan Google" ]

[ secondary link: Daftar / Masuk ]
```

### Visual rules

- Match existing shells: `rounded-2xl`, `min-h-13`, border/card tokens
- Google button = secondary/outline (primary remains email submit)
- Inline SVG Google mark (no new dependency)
- Loading: disable both CTAs; Google label → `Mengarahkan ke Google...`
- Copy Indonesian: **"Masuk dengan Google"** on both login and sign-up (OAuth covers both)

### Error copy (client)

| Case | Message |
|------|---------|
| Missing Supabase public config | `Login Google belum siap. Konfigurasi Supabase belum terbaca di browser.` |
| `signInWithOAuth` returns error | `Login Google gagal. Coba lagi atau masuk dengan email.` |
| User cancels / provider error return | Existing `/auth/error` page |

## Components / files

| File | Change |
|------|--------|
| `lib/auth/safe-next.ts` (new) | `sanitizeNextPath(raw): string` |
| `app/auth/login/login-form.tsx` | Shared safe-next; Google button below "atau"; keep email path + client guest merge for email |
| `app/auth/sign-up/sign-up-form.tsx` | Same Google button + "atau" |
| `app/auth/callback/route.ts` | Sanitize `next`; on success redirect to `/auth/complete?next=…` (not final destination) |
| `app/auth/complete/page.tsx` (new, client) | After mount: best-effort guest taste merge; hard nav to sanitized `next` |
| `app/auth/error/page.tsx` | No required change (optional later: surface provider error) |
| Unit test for `sanitizeNextPath` | Valid paths + open-redirect rejects |
| Smoke (light) | Source/contract check that login + sign-up expose Google CTA; helper tests |

Email password path on login may keep in-form guest merge **or** also go through `/auth/complete` later for one post-auth path. Prefer minimal change: email keeps current merge; OAuth uses complete page. Both must end with hard navigation (`window.location.assign`) for CF/OpenNext cookie visibility.

## Identity linking

When a user already has email/password and later uses Google with the **same verified email**:

- **Desired:** Supabase automatic identity linking → one `auth.users` row, multiple identities
- **App behavior:** no custom merge UI; session is normal after callback
- **Ops requirement:** enable automatic linking in Supabase Auth settings (see checklist below)
- If linking is off and conflict occurs: user lands on `/auth/error` with existing friendly copy

## Environments

| Env | App origin (example) | Must allow in Supabase Redirect URLs |
|-----|----------------------|-------------------------------------|
| Local | `http://localhost:3000` | `http://localhost:3000/auth/callback` |
| Production | `https://<prod-domain>` | `https://<prod-domain>/auth/callback` |

Also set Supabase **Site URL** to production origin for prod project (staging project uses staging origin).

Secrets stay out of git: Google Client ID/Secret live in Supabase Dashboard (or secret manager for hosted Supabase config). App only needs existing public Supabase URL + anon key.

---

## Ops: step-by-step setup

Do this **before** expecting the button to work end-to-end. Order matters.

### A. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and pick (or create) a project used for Lakoku auth.
2. **APIs & Services → OAuth consent screen**
   - User type: **External** (unless Workspace-only).
   - App name: e.g. `Lakoku`
   - User support email + developer contact: your email
   - Scopes: default (`email`, `profile`, `openid`) is enough — no sensitive scopes required for basic login
   - Test users: add your Google accounts while app is in **Testing**
   - For public prod: complete verification if Google requires it for your brand/domain (email-only OAuth often stays simple; follow Console prompts)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: e.g. `Lakoku Web`
   - **Authorized JavaScript origins** (optional for pure redirect flow; add if Console asks):
     - `http://localhost:3000`
     - `https://<prod-domain>`
   - **Authorized redirect URIs** — **must** be the Supabase Auth callback, **not** the Next.js route:
     - `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
     - For local Supabase CLI (if using local GoTrue): also the local API auth callback, e.g. `http://127.0.0.1:55321/auth/v1/callback` (match `supabase status` API URL + `/auth/v1/callback`)
4. Create → copy **Client ID** and **Client Secret**. Store in password manager; paste into Supabase next.

### B. Supabase Dashboard (hosted project used by the app)

1. Open project → **Authentication → Providers → Google**
2. Enable Google
3. Paste **Client ID** and **Client Secret** from Google Cloud
4. Save
5. **Authentication → URL Configuration**
   - **Site URL:** production origin, e.g. `https://<prod-domain>` (local project/dev: `http://localhost:3000` if this project is only for local)
   - **Redirect URLs** allow list (add all that apply):
     - `http://localhost:3000/auth/callback`
     - `https://<prod-domain>/auth/callback`
     - staging URL if any
6. **Authentication → Providers / Settings** (wording varies by dashboard version)
   - Enable **automatic linking** / link identities when email matches (required for “same email = one account”)
   - Confirm email confirmation policy still matches product (Google emails are typically verified by Google)
7. Optional local stack: if `supabase/config.toml` has `[auth.external.google]`, set `enabled = true` and wire client id/secret via env for CLI — only needed when testing OAuth fully against local GoTrue. Hosted Supabase + local Next.js is the common path: local app origin still listed in hosted Redirect URLs.

### C. App env (already required for Supabase)

No new public env vars for Google Client Secret (secret stays in Supabase).

Ensure browser can read:

- Supabase URL
- Supabase anon key

Same as current email login (`lib/supabase/env`, public config passed into forms).

### D. Smoke checklist after wiring code

1. Local: open `/auth/login` → Google → consent → land on `/beranda` (or `?next=` target)
2. Local: `/auth/login?next=/mulai?resume=1` → Google → resume path preserved
3. Sign-up page Google button same flow
4. Email/password still works
5. Malicious `next` (`//evil.com`, `https://evil.com`) → forced to `/beranda`
6. Cancel Google consent → friendly error page, not blank 500
7. Existing email user + same Google email → single account (with linking ON)

---

## Testing

| Layer | Coverage |
|-------|----------|
| Unit | `sanitizeNextPath` accept/reject matrix |
| Smoke / source | Login + sign-up render/contain Google CTA strings; callback uses sanitize + complete bridge |
| Manual E2E | Local + one prod/staging pass with real Google account |
| Regression | Guest taste merge after Google; middleware still protects `/baca`, `/mulai`, etc. |

## Definition of done

- [ ] Google button under "atau" on login and sign-up
- [ ] OAuth establishes Supabase session cookies and lands on safe `next`
- [ ] Guest taste merge runs after Google login (complete page)
- [ ] Callback open-redirect closed via shared helper
- [ ] Email/password path unchanged in behavior
- [ ] Error path remains friendly
- [ ] Local + production redirect URLs documented and configured
- [ ] Automatic identity linking enabled in Supabase
- [ ] Unit tests for safe-next; light smoke/source checks green

## Risks

| Risk | Mitigation |
|------|------------|
| Open redirect via `next` | Shared sanitizer on every consumer |
| Guest taste skipped on OAuth | `/auth/complete` client bridge |
| Soft nav before cookie visible (CF/OpenNext) | Hard `window.location.assign` after complete |
| Google console redirect wrong | Document: Google URI = Supabase `/auth/v1/callback`, not app `/auth/callback` |
| Account conflict without linking | Ops: enable automatic linking; error page fallback |
| Consent screen in Testing | Add test users; promote to production when ready |

## Implementation notes for planner

1. Extract `sanitizeNextPath` first + unit tests (TDD-friendly)
2. Harden callback → redirect to complete
3. Add complete page (merge + hard nav)
4. Add Google button + handler on login and sign-up
5. Document/verify ops checklist (no secrets in repo)
6. Smoke/source checks; manual OAuth once Google+Supabase configured
