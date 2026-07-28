# scripts/ — Smoke Tests & Utilities

## OVERVIEW

Smoke tests, race condition tests, and utility scripts. Run via `scripts/run-smoke.cjs` (CJS) which uses jiti for TypeScript execution.

## STRUCTURE

```
scripts/
├── run-smoke.cjs           # Smoke test runner (CJS, jiti-based)
├── *-smoke.ts              # Smoke test scripts (30+ files)
├── *-race.ts               # Race condition tests
├── *.ts                    # Utility scripts
├── sql/                    # SQL audit scripts
└── demo-prose/             # Demo prose data
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Smoke test runner | `run-smoke.cjs` | CJS, jiti-based TypeScript runner |
| Smoke tests | `*-smoke.ts` | Individual feature smoke tests |
| Race tests | `*-race.ts` | Concurrency/race condition tests |
| SQL audits | `sql/` | Database audit queries |
| Demo data | `demo-prose/` | Sample prose content |

## CONVENTIONS

### Smoke Tests

- Named: `*[feature]-smoke.ts`
- Run via: `node scripts/run-smoke.cjs scripts/[feature]-smoke.ts`
- Package.json aliases: `pnpm smoke:[feature]`

### Race Tests

- Named: `*[feature]-race.ts`
- Test concurrent operations
- Verify idempotency and consistency

### Script Structure

```typescript
// scripts/my-feature-smoke.ts
import { createClient } from '@supabase/supabase-js'

async function main() {
  // Test logic here
  console.log('✅ Feature smoke test passed')
}

main().catch((error) => {
  console.error('❌ Feature smoke test failed:', error)
  process.exit(1)
})
```

## ANTI-PATTERNS

- Tests that modify production data
- Hardcoded credentials
- Tests without cleanup
- Silent failures (always log errors)

## NOTES

- `run-smoke.cjs` uses jiti for TypeScript execution
- Aliases configured for `@lakoku/*` imports
- `server-only` mapped to empty module for Node execution
