# Task 4 Report: Jalur tulis & baca konsumen mengikuti kontrak key

## Implementation

### 1. `lib/cover/server.ts`
- Imported `coverKeyFromPublicUrl` and `resolveStoryCover` from `@/lib/cover/url`.
- Updated `setStoryCover(storyId, userId, coverPath)` to normalize `coverPath` via `coverKeyFromPublicUrl(coverPath) ?? coverPath` so `stories.cover` consistently stores an object key.
- Updated `getStoryCoverCandidates(storyId, userId)` mapping so `url` is resolved with `resolveStoryCover(String(r.url))` before returning to callers.

### 2. `app/api/stories/[id]/cover/generate/route.ts`
- Added import `resolveStoryCover` from `@/lib/cover/url`.
- Updated `setStoryCover` call to pass `stored.key` instead of `stored.url`.
- Updated `recordStoryCoverCandidate` call to store `url: stored.key`.
- Updated JSON response to return `cover: resolveStoryCover(stored.key)`.

### 3. `app/api/stories/[id]/cover/upload/route.ts`
- Added import `resolveStoryCover` from `@/lib/cover/url`.
- Updated `setStoryCover` call to pass `stored.key` instead of `stored.url`.
- Updated `recordStoryCoverCandidate` call to store `url: stored.key`.
- Updated JSON response to return `cover: resolveStoryCover(stored.key)`.

### 4. `app/api/stories/[id]/cover/apply/route.ts`
- Added import `coverKeyFromPublicUrl, resolveStoryCover` from `@/lib/cover/url`.
- Updated JSON response to return `cover: resolveStoryCover(coverKeyFromPublicUrl(url) ?? url)`.

## Static Gates

### 1. `grep -rn "stored.url" app/api/stories/`
Command:
```bash
grep -rn "stored.url" app/api/stories/
```
Output:
*(empty)*

### 2. `pnpm typecheck`
Command:
```bash
pnpm typecheck
```
Output:
```
$ tsc --noEmit --incremental false
```
Exit code: 0

### 3. ESLint on Modified Files
Command:
```bash
pnpm eslint lib/cover/server.ts app/api/stories/[id]/cover/generate/route.ts app/api/stories/[id]/cover/upload/route.ts app/api/stories/[id]/cover/apply/route.ts
```
Output:
*(clean, exit code 0)*

### 4. Vitest Unit Suite for Cover
Command:
```bash
node node_modules/vitest/vitest.mjs run lib/cover/
```
Output:
```
Test Files  4 passed (4)
     Tests  25 passed (25)
```

## Files Changed
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\lib\cover\server.ts`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\app\api\stories\[id]\cover\generate\route.ts`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\app\api\stories\[id]\cover\upload\route.ts`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\app\api\stories\[id]\cover\apply\route.ts`

## Commit
- `89db2ee` `feat(cover): store object keys across cover write paths, resolve URLs at read`

## Self-Review Findings
- Completeness: All 4 files modified exactly per brief specification. All references to `stored.url` eliminated. `setStoryCover` handles both raw keys and public URLs seamlessly.
- Quality: Strict TypeScript types preserved without casting, `@ts-ignore`, or `any`.
- Discipline: Only specified paths modified.
- Gates: `pnpm typecheck` passes with 0 errors; eslint on touched files reports 0 warnings/errors; `stored.url` grep is completely empty.

## Concerns
- None.
