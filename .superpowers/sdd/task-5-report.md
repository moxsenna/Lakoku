# Task 5 Report: Migration Script `scripts/migrate-covers-to-r2.mjs`

## Implementation Overview
- Created `scripts/migrate-covers-to-r2.mjs` implementing one-shot migration script for copying story covers from Supabase Storage (`story-covers`) to Cloudflare R2 bucket and rewriting existing database records (`stories.cover`, `story_cover_candidates.url`) from absolute Supabase public URLs to canonical object keys.
- Implemented environment parsing following `scripts/cover-rpc-smoke.mjs` pattern.
- Implemented pseudo-folder tree traversal for Supabase storage objects.
- Implemented S3 `HeadObject` check for migration idempotency (skips objects already present in R2, rethrows non-404 errors).
- Implemented `--dry-run` flag support to prevent writes to R2 (`PutObjectCommand`) and updates to DB while reporting planned operations.

## Gate Commands and Output

### Gate 1: Syntax check
Command:
```bash
node --check scripts/migrate-covers-to-r2.mjs
```
Output:
Clean (exit code 0, no output).

### Gate 2: Missing-env exit path
Command:
```bash
node -e "
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-test-'));
fs.writeFileSync(path.join(tempDir, '.env.local'), 'SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=testkey\n');

const scriptPath = path.resolve('scripts/migrate-covers-to-r2.mjs');
const nodeModulesPath = path.resolve('node_modules');

const res = spawnSync(process.execPath, [scriptPath], {
  cwd: tempDir,
  env: { ...process.env, NODE_PATH: nodeModulesPath },
  encoding: 'utf8'
});

console.log('Status:', res.status);
console.log('Stdout:', res.stdout);
console.log('Stderr:', res.stderr);

fs.rmSync(tempDir, { recursive: true, force: true });
"
```
Output:
```
Status: 1
Stdout: 
Stderr: env tidak lengkap: butuh SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_BUCKET
```

## Files Changed
- `scripts/migrate-covers-to-r2.mjs` (created)

## Self-Review Findings
- **Completeness:** List-walk handles pseudo-folders; `HeadObject` idempotency check correctly passes on 404/NotFound and skips existing objects; DB rewrites handle both `stories.cover` and `story_cover_candidates.url`; `--dry-run` writes nothing to R2 or Supabase DB.
- **Quality:** Non-404 errors rethrown; errors in S3 / DB / download surfaced properly. Plain Node ESM without extra dependencies.
- **Discipline:** Only `scripts/migrate-covers-to-r2.mjs` committed. No unnecessary files created or modified.

## Concerns
- None. Real execution will be run under PM control with valid production credentials in Task 7.
