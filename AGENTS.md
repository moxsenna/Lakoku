# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-27
**Commit:** ab32f8e
**Branch:** main

## OVERVIEW

Lakoku is an Indonesian interactive fiction web app (novel interaktif) where readers are the main character. Next.js App Router + Supabase + AI-powered narrative generation. Mobile-first, 50-chapter branching stories.

## STRUCTURE

```
lakoku v2/
├── app/              # Next.js App Router pages & API routes
├── components/       # React UI components (shadcn/ui based)
├── lib/              # Core business logic (26 domain packages)
├── packages/         # Shared contracts (@lakoku/contracts)
├── scripts/          # Smoke tests & utilities
├── supabase/         # DB migrations & SQL tests
├── tests/            # Unit & integration tests (Vitest)
├── fixtures/         # Test fixtures (narrative, contracts)
├── docs/             # Architecture & implementation docs
├── deploy/           # VPS deployment configs
├── public/           # Static assets
└── AGENT_RULES.md    # Agent entry point (read first)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| UI components | `components/` | shadcn/ui, Tailwind, mobile-first |
| Page routing | `app/` | Next.js App Router conventions |
| Data access | `lib/api/` | LD-CONTRACT-SEAM: client → fetch → API |
| Server data | `lib/api/server.ts` | RSC direct Supabase access |
| Narrative logic | `lib/narrative/` | Story spine, threads, aliases |
| AI generation | `lib/ai-gateway/` | Model selection, safety, observability |
| Runtime engine | `lib/runtime/` | Generation lifecycle, jobs, concurrency |
| Database schema | `supabase/migrations/` | SQL migrations |
| API contracts | `packages/contracts/` | Shared type definitions |
| Deployment | `docs/VPS_DEPLOY.md` | Production VPS setup |
| Agent rules | `AGENT_RULES.md` | **READ FIRST** before any work |

## CONVENTIONS

### Package Boundaries (ARCH §5.1)

Strict import rules enforced by ESLint:

```
narrative-core → @lakoku/db only
ai-gateway → @lakoku/narrative-core only
runtime → @lakoku/{narrative-core, ai-gateway, db}
db → leaf package (no domain imports)
app/scripts → barrel @lakoku/* only (no deep imports)
```

### Code Style

- TypeScript strict mode
- ESLint with next/core-web-vitals + typescript
- Underscore prefix `_` for intentionally unused vars
- CJS files in `scripts/` exempt from no-require-imports

### Naming

- Server files: `*.server.ts` suffix
- Client components: `"use client"` directive
- API routes: `app/api/` directory structure

## ANTI-PATTERNS (THIS PROJECT)

### From AGENT_RULES.md (Non-Negotiable)

1. **NEVER call AI providers from client** — no model, prompt, or token exposure
2. **NEVER put narrative logic in client** — memori T0-T3, validators, threads stay backend
3. **ALWAYS access data via `lib/api/` seam** — components never import data sources directly
4. **ALWAYS use brand guard** — no "AI", "Narraza", "RAG", "token" strings to readers
5. **ALWAYS idempotent choices** — no double-advance on retry
6. **Mobile-first** — vertical touch, short sessions
7. **NEVER change 50-chapter structure** without product approval

### Code-Specific

- No `as any`, `@ts-ignore`, `@ts-expect-error`
- No deep imports to `lib/*` internals from `app/` or `scripts/`
- No `export default` in barrel files (use named exports)
- No empty catch blocks

## UNIQUE STYLES

### Indonesian-First

- UI strings in Bahasa Indonesia
- Comments mix Indonesian + English
- Error messages reader-safe (no technical jargon)

### Narrative Architecture

- 50-chapter fixed structure (story spine)
- Bounded branching with validator gates
- Thread lifecycle: T0 (setup) → T1 (rising) → T2 (climax) → T3 (resolution)
- Alias registry for character/plot consistency

### Production Deploy

- VPS deployment (not Vercel default)
- Docker standalone build (`LAKOKU_DEPLOY=vps`)
- Caddy reverse proxy on port 5200
- Network: `wacrm_edge` (shared with other apps)

## COMMANDS

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Build (with --webpack for VPS)
pnpm typecheck              # TypeScript check (no emit)
pnpm lint                   # ESLint

# Testing
pnpm test                   # Full test suite (typecheck + migration check + unit + smoke)
pnpm test:unit              # Vitest unit tests
pnpm smoke                  # All smoke tests (30+ individual smokes)

# Individual smoke tests
pnpm smoke:contracts        # API contracts
pnpm smoke:web-release      # Web release gate
pnpm smoke:personalized-story  # Personalized story flow

# Database
pnpm exec supabase db push --linked  # Push migrations to production
```

## NOTES

### Critical Paths

- `lib/api/client.ts` = browser data seam (only way components talk to backend)
- `lib/api/server.ts` = RSC data seam (direct Supabase, no HTTP overhead)
- `packages/contracts/` = shared types between client/server

### Environment

- `.env.local` = local development
- `.dev.vars` = Cloudflare Workers local (if applicable)
- Production: VPS environment variables in Docker

### Testing Strategy

- Unit tests: `lib/**/*.test.ts`, `tests/**/*.test.ts`
- Smoke tests: `scripts/*-smoke.ts` (run via `scripts/run-smoke.cjs`)
- DB tests: `supabase/tests/*.sql` (run via `supabase test db`)

### Gotchas

- `typescript: { ignoreBuildErrors: true }` in next.config.mjs — don't rely on build for type safety
- VPS build uses `LAKOKU_DEPLOY=vps` env var
- Worktrees in `.worktrees/` are for parallel development (ignore in analysis)
