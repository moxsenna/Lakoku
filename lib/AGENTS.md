# lib/ — Core Business Logic

## OVERVIEW

26 domain packages implementing Lakoku's narrative engine, AI generation, runtime orchestration, and data access. Strict package boundaries enforced by ESLint (ARCH §5.1).

## STRUCTURE

```
lib/
├── api/              # LD-CONTRACT-SEAM: client ↔ backend data access
├── narrative/        # @lakoku/narrative-core: story spine, threads, aliases
├── ai-gateway/       # @lakoku/ai-gateway: model selection, safety, generation
├── runtime/          # @lakoku/runtime: lifecycle, jobs, concurrency
├── authoring/        # Story bible compilation, validation, brainstorm
├── supabase/         # @lakoku/db: database clients, admin, proxy
├── story-engine/     # Chapter briefs, quality, route state
├── taste-profile/    # Reader preference catalog & resolver
├── paycore/          # Payment integration (PayCore)
├── credits/          # Credit policy & server logic
├── entitlement/      # Entitlement processing & webhooks
├── analytics/        # Event tracking
├── observability/    # Monitoring & metrics
├── onboarding/       # New user flows
├── ops/              # Operational utilities
├── prose/            # Text processing
├── reader/           # Chapter status polling
├── auth/             # Authentication helpers
├── admin/            # Admin panel logic
├── feature-flags.ts  # Feature flag definitions
├── utils.ts          # Shared utilities
└── onboarding-draft.ts  # Onboarding draft logic
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Data access (client) | `lib/api/client.ts` | Browser → fetch → /api/* |
| Data access (server) | `lib/api/server.ts` | RSC → Supabase direct |
| Data types | `lib/api/types.ts` | Shared contracts |
| Story logic | `lib/narrative/` | Pure logic, no DB |
| AI generation | `lib/ai-gateway/` | Model selection, safety |
| Generation runtime | `lib/runtime/` | Jobs, concurrency, lifecycle |
| Story authoring | `lib/authoring/` | Bible compilation, validation |
| DB access | `lib/supabase/` | Admin, client, server, proxy |
| Payment | `lib/paycore/` | PayCore integration |
| Credits | `lib/credits/` | Credit policy |
| Entitlements | `lib/entitlement/` | Access control |

## CONVENTIONS

### Package Exports

Each package has `index.ts` (pure logic) and optional `server.ts` (DB/server-only):

```typescript
// index.ts — pure logic, testable in Node
export * from './types'
export * from './compiler'

// server.ts — server-only, imports @lakoku/db
export * from './loader'
```

### File Naming

- `*.server.ts` = server-only (uses `server-only` import)
- `*.pure.ts` = pure logic (no side effects)
- `*.test.ts` = unit tests (colocated)

## ANTI-PATTERNS

- Deep imports across package boundaries
- Importing `lib/api/` from `lib/runtime/` or `lib/narrative/`
- Server-only code in pure logic files

## NOTES

- Pure logic: `lib/**/*.test.ts` (Vitest)
- Server logic: tested via smoke tests in `scripts/`
- DB logic: tested via `supabase/tests/*.sql`
