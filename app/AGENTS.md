# app/ — Next.js App Router Pages & API Routes

## OVERVIEW

Next.js App Router pages and API route handlers. Indonesian-first UI, mobile-first design, dark theme default.

## STRUCTURE

```
app/
├── (shell)/          # Authenticated layout group
│   ├── beranda/      # Home/dashboard
│   ├── cerita/       # Story detail
│   ├── koleksiku/    # My collection
│   ├── kredit/       # Credits/top-up
│   ├── payment/      # Payment flow
│   └── profil/       # Profile settings
├── admin/            # Admin panel (protected)
├── akhir/            # Story ending
├── api/              # API route handlers
│   ├── admin/        # Admin API
│   ├── analytics/    # Analytics events
│   ├── checkout/     # Payment checkout
│   ├── credits/      # Credit operations
│   ├── generation/   # AI generation triggers
│   └── stories/      # Story CRUD & choices
├── auth/             # Authentication (login/signup)
├── baca/             # Reader view ([id]/[chapter])
├── brainstorm/       # Story brainstorm flow
├── mulai/            # Story creation start
├── onboarding/       # New user onboarding
├── privacy/          # Privacy policy
├── s/                # Short URLs/redirects
├── share/            # Share links
├── terms/            # Terms of service
├── layout.tsx        # Root layout (ThemeProvider, FontSizeProvider)
├── page.tsx          # Landing page
└── globals.css       # Global styles (Tailwind)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Reader view | `app/baca/[id]/` | Main reading experience |
| Story creation | `app/mulai/` | Start new story |
| API routes | `app/api/` | Backend endpoints |
| Auth flows | `app/auth/` | Login/signup |
| Admin | `app/admin/` | Protected admin panel |
| Root layout | `app/layout.tsx` | Theme, fonts, providers |
| Global styles | `app/globals.css` | Tailwind + custom CSS |

## CONVENTIONS

### Route Groups

- `(shell)/` = authenticated pages (shared layout)
- `[id]/` = dynamic routes (story/chapter IDs)
- `api/` = JSON API endpoints (no UI)

### API Routes

- Use `lib/api/` for data access
- Return JSON with proper status codes
- Validate with Zod schemas

## ANTI-PATTERNS

- Direct Supabase imports in pages (use `lib/api/`)
- AI/model imports in client components
- `export default` in route handlers

## NOTES

- `middleware.ts` protects: `/baca`, `/akhir`, `/koleksiku`, `/mulai`, `/brainstorm`, `/admin`
- Vercel Analytics enabled only when `VERCEL=1`
