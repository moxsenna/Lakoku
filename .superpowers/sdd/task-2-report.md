# Task 2 Report: Alihkan `resolveStoryCover` queries.ts ke modul baru

## Implementation
- Removed local `DEFAULT_STORY_COVER` and `resolveStoryCover` in `lib/api/queries.ts`.
- Added internal import `import { resolveStoryCover } from '@/lib/cover/url'`.
- Re-exported `DEFAULT_STORY_COVER` and `resolveStoryCover` from `@/lib/cover/url` for backward compatibility with existing callers (`lib/api/share.ts:124`, etc.).

## Gate Commands & Output
- `pnpm exec vitest run lib/cover/url.test.ts && pnpm typecheck`
  - Output: 7/7 tests passed in `lib/cover/url.test.ts`.
  - Output: `tsc --noEmit --incremental false` passed with 0 errors.
- `pnpm exec eslint lib/api/queries.ts`
  - Output: 0 errors, 0 warnings.

## Files Changed
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\lib\api\queries.ts` (1 file changed, 5 insertions(+), 8 deletions(-))

## Commit
- `d7df104` `refactor(cover): centralize cover URL resolution in lib/cover/url`

## Self-Review Findings
- Local definitions fully removed: Yes.
- Re-export and internal import present: Yes (`lib/api/queries.ts:15`, `lib/api/queries.ts:35`).
- Internal usage in `toDetail` works cleanly: Yes (`lib/api/queries.ts:85`).
- Verification command `git grep -n "DEFAULT_STORY_COVER\|resolveStoryCover" lib/api/queries.ts` shows re-export, import, and call in `toDetail` only.
- No unexpected changes.

## Concerns
- None.
