# tests/ — Unit & Integration Tests

## OVERVIEW

Vitest-based test suite covering runtime, narrative, AI gateway, and integration tests. Colocated with `lib/**/*.test.ts` for unit tests.

## STRUCTURE

```
tests/
├── runtime/          # Runtime engine tests (20 files)
├── narrative/        # Narrative logic tests
├── ai-gateway/       # AI gateway tests
├── api/              # API route tests
├── auth/             # Authentication tests
├── authoring/        # Story authoring tests
├── contracts/        # Contract validation tests
├── db/               # Database tests
├── integration/      # Integration tests
├── observability/    # Monitoring tests
├── onboarding/       # Onboarding flow tests
├── ops/              # Operations tests
├── privacy/          # Privacy tests
├── prose/            # Text processing tests
├── reader/           # Reader experience tests
├── story-engine/     # Story engine tests
├── taste-profile/    # Taste profile tests
└── *.test.ts         # Root-level tests
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Runtime tests | `tests/runtime/` | Generation, jobs, concurrency |
| Narrative tests | `tests/narrative/` | Story logic, threads |
| AI gateway tests | `tests/ai-gateway/` | Model selection, safety |
| API tests | `tests/api/` | Route handler tests |
| Integration tests | `tests/integration/` | End-to-end flows |
| Unit tests | `lib/**/*.test.ts` | Colocated with source |

## CONVENTIONS

### Test Structure

```typescript
import { describe, it, expect } from 'vitest'

describe('FeatureName', () => {
  it('should do something', () => {
    expect(result).toBe(expected)
  })
})
```

### Naming

- `*.test.ts` for unit tests
- `*.test.tsx` for component tests
- Descriptive test names (what is being tested)

## ANTI-PATTERNS

- Tests that depend on external services
- Tests with hardcoded dates/times
- Tests that modify global state
- Skipped tests without reason

## NOTES

- Runtime: 20 test files (comprehensive)
- Narrative: 1 test file (minimal)
- AI Gateway: 5 test files (moderate)
- DB tests: `supabase/tests/*.sql`
