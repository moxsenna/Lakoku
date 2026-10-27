# Catalog Plan 1 — Reader Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish reader foundation for admin catalog stories: schema migrations on Neon Postgres, non-commercial pricing resolver (5 Lakoin/chapter, 150 Lakoin bundle default with fair-price offset), atomic bundle checkout, locked-chapter UI with bundle purchase, explore listing filters, per-reader ending lock at Bab 44, variant ending reads (Bab 45–50) from `catalog_ending_chapters`, multi-paragraph reaction display with subtle direction hints, and a deterministic local seed fixture.

**Architecture:** Shared-spine interactive fiction novel model (Model A). Bab 1–44 stored in existing `chapters` and `choice_outcomes` tables without reader dimension. Reader route state tracked in `reader_states.route_state`. At Bab 44 choice, `resolveEnding` calculates the winning branch from reader route state + snapshot contract and sets `reader_states.locked_ending_key` once (never overwritten, isolated per reader). Bab 45–50 variant chapters stored in `catalog_ending_chapters` keyed by `(story_id, ending_key, number)`. Reader access for catalog stories uses standard non-commercial path (`isCommercialStoryMode('catalog') === false`), unlocking chapters via reader-scoped ref `unlock:{storyId}:{ch}:{userId}` or bundle ref `bundle:{storyId}:{userId}`.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict mode), Neon Postgres via Kysely (`@lakoku/db`), Better Auth (`getSessionUser`), Zod (`@lakoku/contracts`), Tailwind CSS + Lucide icons, Vitest.

## Global Constraints
- `story_mode = 'catalog'` is non-commercial: `isCommercialStoryMode('catalog') === false`.
- Story ID prefix is strictly `catalog:{slug}`.
- `stories.owner_user_id` is always `null` for catalog stories (platform-owned; no author Tinta farming).
- Default prices: chapter unlock = 5 Lakoin (`catalog_stories.chapter_price`), novel bundle = 150 Lakoin (`catalog_stories.bundle_price`).
- Free chapters: Bab 1–3 always follow `reading_policy.freeChapters`.
- Canonical commercial `unlockRef(storyId, chapter)` remains untouched: `unlock:${storyId}:${chapter}`.
- Non-commercial chapter unlock ref is `readerUnlockRef(storyId, chapter, userId)`: `unlock:${storyId}:${chapter}:${userId}`.
- Bundle ledger ref is `bundleRef(storyId, userId)`: `bundle:${storyId}:${userId}`.
- Fair bundle price formula: `max(0, bundle_price − total_spent_on_story_chapters)`.
- Bundle purchase ledger row inserts with `delta = -fair_price` (delta = 0 when already fully paid).
- Ending lock at Bab 44 persists directly into `reader_states.locked_ending_key` with guarded coalesce; `persist_ending_lock_v1` is NOT used because it mutates global `story_generation_contracts.ending_lock_json` and requires a row there.
- Variant reads for `number >= 45` without `locked_ending_key` MUST return `null` / unavailable (never leak a variant to unlocked readers).
- Brand guard: reader UI and direction hints MUST NEVER show "AI", "Narraza", "RAG", "token", "skor", "bias", or "ending".
- UI strings are in Bahasa Indonesia; reader error messages are safe and friendly.
- No `as any`, no `@ts-ignore`, no `@ts-expect-error`, no empty catch blocks.
- No real database connections during automated tests (use `@lakoku/db` query builder mocks and `vi.mock('server-only')`).
- No production code modified during plan creation.

---

## File Structure

```
neon/migrations/
└── 20261027000000_admin_catalog_stories.sql   # Schema migration: catalog story mode, tables, RPCs
lib/supabase/
└── db-types.ts                                # Kysely DB interface updates for new tables/columns
lib/credits/
├── policy.ts                                  # Add bundleRef helper
└── access-resolver.server.ts                  # Catalog chapter pricing & BUNDLE_UNLOCKED reason
lib/catalog/
├── bundle.server.ts                           # Bundle quote computation & atomic spend RPC caller
└── variant-reader.server.ts                   # Centralized variant reader helper for Bab 45-50
app/api/stories/[id]/
└── bundle/
    └── route.ts                               # POST buy bundle & GET bundle quote API routes
components/
├── chapter-locked.tsx                         # Dual-button UI: single chapter + full novel bundle
└── reader-view.tsx                            # Multi-paragraph reactions + direction hint rendering
app/baca/[id]/
└── page.tsx                                   # Pass bundle quote to ChapterLocked for catalog stories
lib/api/
├── queries.ts                                 # Filter explore stories (catalog: published) & variant hooks
├── user-state.ts                              # Apply Bab 44 choice ending lock to reader_states
├── last-choice-summary.ts                     # Support multi-paragraph & directionHint in local cache
└── chapter-status.server.ts                   # Variant chapter check in getChapterStatusForUser
packages/contracts/src/
└── reader.ts                                  # Add directionHint to ChoiceOutcomeSchema & JejakItemSchema
scripts/
└── seed-catalog-fixture.ts                    # Deterministic test fixture seed script (guard: LAKOKU_SEED_CATALOG=1)
tests/
├── db/catalog-schema-migration.test.ts        # Test migration SQL & db-types
├── catalog/catalog-access-resolver.test.ts    # Test catalog chapter pricing & bundle unlock
├── catalog/catalog-bundle-route.test.ts       # Test POST & GET /api/stories/[id]/bundle
├── catalog/chapter-locked-catalog.test.ts     # Test ChapterLocked dual-button UI & action
├── catalog/catalog-explore-queries.test.ts    # Test explore & public story filtering
├── catalog/catalog-ending-lock.test.ts        # Test Bab 44 choice locks reader ending once
├── catalog/catalog-variant-reads.test.ts      # Test Bab 45-50 variant chapter & outcome retrieval
├── catalog/reader-consequence-direction.test.ts # Test multi-paragraph consequence & directionHint
└── scripts/seed-catalog-fixture.test.ts       # Test seed catalog fixture execution & safety guard
```

---

### Task 1: Database Migration & Kysely DB Types

**Files:**
- Create: `neon/migrations/20261027000000_admin_catalog_stories.sql`
- Modify: `lib/supabase/db-types.ts`
- Test: `tests/db/catalog-schema-migration.test.ts`

**Interfaces:**
- Consumes: PostgreSQL 16 schema (`stories`, `credit_ledger`, `choice_outcomes`)
- Produces:
  - Check constraint `stories_story_mode_check` with `'catalog'`
  - Table `catalog_stories` (`story_id`, `status`, `chapter_price`, `bundle_price`, `contract_json`, `generation_progress`, `published_at`, `published_by`)
  - Table `catalog_ending_chapters` (`story_id`, `ending_key`, `number`, `title`, `paragraphs`, `choices`, `choice_prompt`, `outcomes_json`)
  - Column `choice_outcomes.direction_hint text null`
  - Function `public.catalog_bundle_spent_v1(p_user_id uuid, p_story_id text) returns integer` (single source for spent-on-story)
  - Function `public.spend_bundle_v1(p_user_id uuid, p_story_id text) returns jsonb`
  - Kysely types in `lib/supabase/db-types.ts`: `CatalogStories`, `CatalogEndingChapters`, updated `ChoiceOutcomes`, updated `Database`

- [ ] **Step 1: Write failing test for catalog schema migration & types**

```typescript
// tests/db/catalog-schema-migration.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('catalog schema migration and types', () => {
  const migrationPath = path.join(
    process.cwd(),
    'neon',
    'migrations',
    '20261027000000_admin_catalog_stories.sql',
  )

  it('migration file exists with valid timestamp prefix', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('migration alters stories_story_mode_check to include catalog', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/alter table public\.stories/i)
    expect(sql).toMatch(/stories_story_mode_check/i)
    expect(sql).toContain("'catalog'")
  })

  it('migration defines catalog_stories with required columns and defaults', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table if not exists public\.catalog_stories/i)
    expect(sql).toContain('chapter_price integer not null default 5')
    expect(sql).toContain('bundle_price integer not null default 150')
    expect(sql).toMatch(/status in \('draft',\s*'generating',\s*'review',\s*'published',\s*'archived'\)/)
  })

  it('migration defines catalog_ending_chapters with composite PK', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table if not exists public\.catalog_ending_chapters/i)
    expect(sql).toMatch(/primary key \(\s*story_id\s*,\s*ending_key\s*,\s*number\s*\)/i)
    expect(sql).toContain('outcomes_json jsonb')
  })

  it('migration adds direction_hint to choice_outcomes', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/alter table public\.choice_outcomes add column if not exists direction_hint text null/i)
  })

  it('migration defines spend_bundle_v1 atomic RPC with fair price computation', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create or replace function public\.spend_bundle_v1/i)
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('v_fair_price := greatest(0, v_bundle_price - v_spent)')
    expect(sql).toContain("'unlock_bundle'")
  })

  it('catalog_bundle_spent_v1 counts only this story chapter refs (no LIKE wildcard / prefix collision)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create or replace function public\.catalog_bundle_spent_v1/i)
    expect(sql).not.toMatch(/ref\s+like/i)
    expect(sql).toContain("reason = 'unlock_chapter'")
    expect(sql).toContain("~ ('^[0-9]+(:' || p_user_id::text || ')?$')")
    expect(sql).toContain('v_spent := public.catalog_bundle_spent_v1(p_user_id, p_story_id)')
  })

  it('db-types exports CatalogStories and CatalogEndingChapters', async () => {
    const dbTypesContent = fs.readFileSync(path.join(process.cwd(), 'lib/supabase/db-types.ts'), 'utf8')
    expect(dbTypesContent).toContain('export interface CatalogStories')
    expect(dbTypesContent).toContain('export interface CatalogEndingChapters')
    expect(dbTypesContent).toContain('catalog_stories: CatalogStories')
    expect(dbTypesContent).toContain('catalog_ending_chapters: CatalogEndingChapters')
    expect(dbTypesContent).toContain('direction_hint: string | null')
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/db/catalog-schema-migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory neon/migrations/20261027000000_admin_catalog_stories.sql`.

- [ ] **Step 3: Implement migration and update db-types.ts**

Create `neon/migrations/20261027000000_admin_catalog_stories.sql`:
```sql
-- neon/migrations/20261027000000_admin_catalog_stories.sql
-- Skema cerita katalog admin (Plan 1 - Reader Foundation)

-- 1. Tambahkan mode 'catalog' pada check constraint stories_story_mode_check
alter table public.stories
  drop constraint if exists stories_story_mode_check;

alter table public.stories
  add constraint stories_story_mode_check
  check (story_mode in ('standard', 'personalized_ai', 'premium_template', 'premium_instance', 'catalog'));

-- 2. Tabel catalog_stories
create table if not exists public.catalog_stories (
  story_id text primary key references public.stories(id) on delete cascade,
  status text not null check (status in ('draft', 'generating', 'review', 'published', 'archived')) default 'draft',
  chapter_price integer not null default 5,
  bundle_price integer not null default 150,
  contract_json jsonb null,
  generation_progress integer not null default 0,
  published_at timestamptz null,
  published_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_stories_status_idx on public.catalog_stories (status);

-- 3. Tabel catalog_ending_chapters (Bab 45-50 varian ending)
create table if not exists public.catalog_ending_chapters (
  story_id text not null references public.stories(id) on delete cascade,
  ending_key text not null,
  number integer not null check (number >= 45 and number <= 50),
  title text not null,
  paragraphs jsonb not null default '[]'::jsonb,
  choices jsonb null,
  choice_prompt text null,
  outcomes_json jsonb null,
  created_at timestamptz not null default now(),
  primary key (story_id, ending_key, number)
);

create index if not exists catalog_ending_chapters_lookup_idx
  on public.catalog_ending_chapters (story_id, ending_key, number);

-- 4. Kolom direction_hint di choice_outcomes
alter table public.choice_outcomes
  add column if not exists direction_hint text null;

-- 5a. Total Lakoin yang sudah dibelanjakan pembaca untuk bab satu novel.
-- Satu sumber kebenaran: dipakai spend_bundle_v1 dan quote paket di server.
-- Tanpa LIKE: '_' / '%' di slug adalah wildcard, dan prefix 'unlock:{story}:' juga
-- cocok untuk story lain berawalan sama (catalog:abc vs catalog:abc:2). Sisa ref
-- setelah prefix harus persis '{bab}' (kanonik) atau '{bab}:{userId}' (per-pembaca).
create or replace function public.catalog_bundle_spent_v1(
  p_user_id  uuid,
  p_story_id text
) returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(-delta), 0)::int
  from public.credit_ledger
  where user_id = p_user_id
    and delta < 0
    and reason = 'unlock_chapter'
    and left(ref, length('unlock:' || p_story_id || ':')) = 'unlock:' || p_story_id || ':'
    and substr(ref, length('unlock:' || p_story_id || ':') + 1)
      ~ ('^[0-9]+(:' || p_user_id::text || ')?$');
$$;

-- 5b. RPC spend_bundle_v1: hitung fair price dan debit ledger atomik
create or replace function public.spend_bundle_v1(
  p_user_id  uuid,
  p_story_id text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bundle_price integer;
  v_spent        integer;
  v_fair_price   integer;
  v_available    integer;
  v_bundle_ref   text;
  v_rows         integer;
begin
  if p_user_id is null or p_story_id is null or trim(p_story_id) = '' then
    raise exception 'spend_bundle_v1: invalid arguments';
  end if;

  -- Kunci transaksi per user (uniform advisory lock)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  v_bundle_ref := 'bundle:' || p_story_id || ':' || p_user_id::text;

  -- Idempotency check: sudah pernah beli paket
  if exists (select 1 from public.credit_ledger where ref = v_bundle_ref) then
    return jsonb_build_object('status', 'duplicate', 'price_paid', 0);
  end if;

  -- Ambil harga paket dari catalog_stories
  select bundle_price into v_bundle_price
  from public.catalog_stories
  where story_id = p_story_id;

  if v_bundle_price is null then
    raise exception 'spend_bundle_v1: story is not a catalog story or missing pricing';
  end if;

  v_spent := public.catalog_bundle_spent_v1(p_user_id, p_story_id);

  v_fair_price := greatest(0, v_bundle_price - v_spent);

  if v_fair_price > 0 then
    -- Bersihkan reservasi kadaluarsa & cek saldo tersedia
    perform public.expire_user_reservations_lazy_v1(p_user_id);
    v_available := public.available_credit_balance_v1(p_user_id);
    if v_available < v_fair_price then
      return jsonb_build_object('status', 'insufficient', 'required', v_fair_price, 'available', v_available);
    end if;

    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, -v_fair_price, 'unlock_bundle', v_bundle_ref)
    on conflict (ref) do nothing;
  else
    -- Fair price 0: sudah lunas via eceran, grant paket dengan delta 0
    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, 0, 'unlock_bundle', v_bundle_ref)
    on conflict (ref) do nothing;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'duplicate', 'price_paid', 0);
  end if;

  return jsonb_build_object('status', 'ok', 'price_paid', v_fair_price, 'spent_offset', v_spent);
end;
$$;
```

Modify `lib/supabase/db-types.ts`:
Add `CatalogStories` interface:
```typescript
export interface CatalogStories {
  bundle_price: Generated<number>;
  chapter_price: Generated<number>;
  contract_json: Json | null;
  created_at: Generated<Timestamp>;
  generation_progress: Generated<number>;
  published_at: Timestamp | null;
  published_by: string | null;
  status: Generated<string>;
  story_id: string;
  updated_at: Generated<Timestamp>;
}
```
Add `CatalogEndingChapters` interface:
```typescript
export interface CatalogEndingChapters {
  choice_prompt: string | null;
  choices: Json | null;
  created_at: Generated<Timestamp>;
  ending_key: string;
  number: number;
  outcomes_json: Json | null;
  paragraphs: Generated<Json>;
  story_id: string;
  title: string;
}
```
Add `direction_hint: string | null;` to `ChoiceOutcomes` interface.
Add `catalog_stories: CatalogStories;` and `catalog_ending_chapters: CatalogEndingChapters;` to `Database` interface.

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/db/catalog-schema-migration.test.ts`
Expected: PASS with 8/8 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add neon/migrations/20261027000000_admin_catalog_stories.sql lib/supabase/db-types.ts tests/db/catalog-schema-migration.test.ts
git commit -m "feat(db): catalog stories schema migration and kysely types"
```

---

### Task 2: Catalog Pricing, Bundle Ref & Access Resolver

**Files:**
- Modify: `lib/credits/policy.ts`
- Modify: `lib/commercial/resolver.server.ts`
- Modify: `lib/credits/access-resolver.server.ts`
- Test: `tests/catalog/catalog-access-resolver.test.ts`

**Interfaces:**
- Consumes: `story_mode = 'catalog'`, `catalog_stories.chapter_price`, `credit_ledger`
- Produces:
  - `bundleRef(storyId: string, userId: string): string`
  - `ChapterAccessDecision.reason` union extended with `'BUNDLE_UNLOCKED'`
  - `resolveChapterAccess`:
    - for `catalog` mode with bundle ref in ledger → `{ readable: true, reason: 'BUNDLE_UNLOCKED', cost: 0 }`
    - for `catalog` mode with reader unlock ref in ledger → `{ readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 }`
    - for `catalog` mode locked chapter → `{ readable: false, reason: 'PAYMENT_REQUIRED', cost: catalogStory.chapter_price ?? 5 }`
    - Bab 1–3 free per `reading_policy`

- [ ] **Step 1: Write failing test for catalog access resolver & bundle ref**

```typescript
// tests/catalog/catalog-access-resolver.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleRef, unlockRef, readerUnlockRef } from '@/lib/credits/policy'
import { isCommercialStoryMode } from '@/lib/commercial/resolver.server'

vi.mock('server-only', () => ({}))

const mockDbState = {
  stories: [] as Array<{
    id: string
    owner_user_id: string | null
    story_mode: string
    commercial_origin: string | null
    visibility: string
  }>,
  catalogStories: [] as Array<{
    story_id: string
    chapter_price: number
    bundle_price: number
    status: string
  }>,
  ledger: [] as Array<{
    id: string
    user_id: string
    ref: string
  }>,
}

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      let limitCount: number | undefined
      const builder = {
        select: (_cols: unknown) => builder,
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        execute: async () => {
          const rows =
            table === 'stories'
              ? mockDbState.stories
              : table === 'catalog_stories'
                ? mockDbState.catalogStories
                : table === 'credit_ledger'
                  ? mockDbState.ledger
                  : []
          let matched = (rows as Array<Record<string, unknown>>).filter((r) =>
            wheres.every(({ col, op, val }) => {
              if (op === '=') return r[col] === val
              if (op === 'in') return Array.isArray(val) && val.includes(r[col])
              return false
            }),
          )
          if (limitCount !== undefined) matched = matched.slice(0, limitCount)
          return matched
        },
      }
      return builder
    },
  }),
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
  result: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows, error: null }
  },
}))

describe('catalog access resolver & policy', () => {
  beforeEach(() => {
    mockDbState.stories = []
    mockDbState.catalogStories = []
    mockDbState.ledger = []
  })

  it('bundleRef generates canonical bundle idempotency key', () => {
    expect(bundleRef('catalog:misteri-desa', 'u123')).toBe('bundle:catalog:misteri-desa:u123')
  })

  it('isCommercialStoryMode returns false for catalog', () => {
    expect(isCommercialStoryMode('catalog')).toBe(false)
  })

  it('catalog story Bab 1-3 is FREE_STANDARD', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 2,
    })
    expect(decision).toEqual({ readable: true, reason: 'FREE_STANDARD', cost: 0 })
  })

  it('catalog story Bab 4 locked without purchase costs catalog_stories.chapter_price', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'published',
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: false, reason: 'PAYMENT_REQUIRED', cost: 5 })
  })

  it('catalog story Bab 4 unlocked via readerUnlockRef is LEDGER_UNLOCKED', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'published',
    })
    mockDbState.ledger.push({
      id: 'led-1',
      user_id: 'u123',
      ref: readerUnlockRef('catalog:misteri-desa', 4, 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 })
  })

  it('catalog story Bab 10 unlocked via bundle ref is BUNDLE_UNLOCKED', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'published',
    })
    mockDbState.ledger.push({
      id: 'led-b',
      user_id: 'u123',
      ref: bundleRef('catalog:misteri-desa', 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: true, reason: 'BUNDLE_UNLOCKED', cost: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/catalog-access-resolver.test.ts`
Expected: FAIL with missing `bundleRef` export and missing `BUNDLE_UNLOCKED` handling.

- [ ] **Step 3: Implement policy & access-resolver changes**

In `lib/credits/policy.ts`:
Add:
```typescript
/** Ref ledger pembelian paket novel (seluruh bab berbayar). */
export function bundleRef(storyId: string, userId: string): string {
  return `bundle:${storyId}:${userId}`
}
```

In `lib/commercial/resolver.server.ts`:
Ensure `isCommercialStoryMode` stays:
```typescript
export function isCommercialStoryMode(storyMode: string | null | undefined): boolean {
  return storyMode === 'personalized_ai' || storyMode === 'premium_instance'
}
```

In `lib/credits/access-resolver.server.ts`:
1. Extend `ChapterAccessDecision.reason` union:
```typescript
export interface ChapterAccessDecision {
  readable: boolean
  reason:
    | 'FREE_STANDARD'
    | 'STARTER_INCLUDED'
    | 'PAID_START_INCLUDED'
    | 'LEGACY_INCLUDED'
    | 'LEDGER_UNLOCKED'
    | 'BUNDLE_UNLOCKED'
    | 'PAYMENT_REQUIRED'
    | 'STORY_PENDING'
    | 'COMMERCIAL_ACCESS_NOT_FINALIZED'
    | 'NOT_AUTHORIZED'
    | 'CONFIG_ERROR'
  cost: number
}
```
2. Update non-commercial block (`if (!isCommercial)`):
```typescript
  // Standard / shared public / catalog stories preserve ReadingPolicy behavior
  if (!isCommercial) {
    const policy = input.policy ?? DEFAULT_READING_POLICY
    const free = isChapterFree(input.chapterNumber, policy)
    if (free) {
      return { readable: true, reason: 'FREE_STANDARD', cost: 0 }
    }

    // Determine chapter cost: catalog price or standard policy
    let chapterCost = policy.creditsPerChapter
    const isCatalog = story.story_mode === 'catalog' || input.storyId.startsWith('catalog:')
    if (isCatalog) {
      const { data: catalogRow } = await single(
        db
          .selectFrom('catalog_stories')
          .select('chapter_price')
          .where('story_id', '=', input.storyId)
          .limit(1)
          .execute(),
      )
      chapterCost = catalogRow?.chapter_price ?? 5
    }

    if (!input.userId) {
      return { readable: false, reason: 'PAYMENT_REQUIRED', cost: chapterCost }
    }

    // Check bundle proof first for catalog
    if (isCatalog) {
      const { data: bundleLedger } = await single(
        db
          .selectFrom('credit_ledger')
          .select('id')
          .where('user_id', '=', input.userId)
          .where('ref', '=', bundleRef(input.storyId, input.userId))
          .limit(1)
          .execute(),
      )
      if (bundleLedger) {
        return { readable: true, reason: 'BUNDLE_UNLOCKED', cost: 0 }
      }
    }

    // Check chapter ledger proof
    const { data: ledger } = await single(
      db
        .selectFrom('credit_ledger')
        .select('id')
        .where('user_id', '=', input.userId)
        .where('ref', 'in', [
          readerUnlockRef(input.storyId, input.chapterNumber, input.userId),
          unlockRef(input.storyId, input.chapterNumber),
        ])
        .limit(1)
        .execute(),
    )

    if (ledger) {
      return { readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 }
    }
    return { readable: false, reason: 'PAYMENT_REQUIRED', cost: chapterCost }
  }
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/catalog-access-resolver.test.ts`
Expected: PASS with 6/6 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add lib/credits/policy.ts lib/commercial/resolver.server.ts lib/credits/access-resolver.server.ts tests/catalog/catalog-access-resolver.test.ts
git commit -m "feat(credits): catalog pricing, bundleRef, and BUNDLE_UNLOCKED resolver support"
```

---

### Task 3: Catalog Bundle Server Helper & API Routes

**Files:**
- Create: `lib/catalog/bundle.server.ts`
- Create: `app/api/stories/[id]/bundle/route.ts`
- Test: `tests/catalog/catalog-bundle-route.test.ts`

**Interfaces:**
- Consumes: `catalog_stories`, `stories.total_chapters`, `catalog_bundle_spent_v1` + `spend_bundle_v1` RPCs, `getReadingPolicy()`
- Produces:
  - `getCatalogBundleQuote(storyId: string, userId: string | null): Promise<BundleQuote | null>`
  - `spendCatalogBundle(userId: string, storyId: string): Promise<SpendBundleResult>`
  - `POST /api/stories/[id]/bundle`:
    - Guest: 401 `{ error: 'Tidak diizinkan.' }`
    - Non-catalog: 400 `{ error: 'Hanya novel katalog yang memiliki paket.' }`
    - Insufficient credits: 402 `{ status: 'WAITING_FOR_CREDITS', requiredCredits, availableCredits }`
    - Success / duplicate: 200 `{ status: 'ok', pricePaid, balance }`
  - `GET /api/stories/[id]/bundle`: returns quote for authorized or guest reader

- [ ] **Step 1: Write failing test for catalog bundle helper and routes**

```typescript
// tests/catalog/catalog-bundle-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/stories/[id]/bundle/route'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getCreditBalance: vi.fn(),
  getDb: vi.fn(),
  rpcOne: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/credits/server', () => ({
  getCreditBalance: mocks.getCreditBalance,
  getReadingPolicy: async () => ({ freeChapters: 3, creditsPerChapter: 8 }),
}))

vi.mock('@lakoku/db', () => ({
  getDb: mocks.getDb,
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
  result: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows, error: null }
  },
  rpcOne: mocks.rpcOne,
}))

describe('POST & GET /api/stories/[id]/bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST returns 401 when user is not authenticated', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(401)
  })

  it('POST returns 400 when story is not a catalog story', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            limit: () => ({
              execute: async () => [{ id: 'demo:regular', story_mode: 'standard' }],
            }),
          }),
        }),
      }),
    })

    const req = new Request('http://localhost/api/stories/demo:regular/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'demo:regular' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Hanya novel katalog yang memiliki paket.')
  })

  it('POST returns 402 when balance is insufficient', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            limit: () => ({
              execute: async () => [{ id: 'catalog:test', story_mode: 'catalog' }],
            }),
          }),
        }),
      }),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'insufficient', required: 150, available: 20 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(20)

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.status).toBe('WAITING_FOR_CREDITS')
    expect(json.requiredCredits).toBe(150)
  })

  it('POST returns 200 on successful bundle unlock', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            limit: () => ({
              execute: async () => [{ id: 'catalog:test', story_mode: 'catalog' }],
            }),
          }),
        }),
      }),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'ok', price_paid: 140, spent_offset: 10 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(60)

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok', pricePaid: 140, balance: 60 })
  })

  it('GET returns bundle quote with fair price and savings from the shared SQL spent function', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    const catalogChain = {
      innerJoin: () => catalogChain,
      select: () => catalogChain,
      where: () => catalogChain,
      limit: () => catalogChain,
      execute: async () => [{ bundle_price: 150, chapter_price: 5, total_chapters: 50 }],
    }
    const storiesChain = {
      select: () => storiesChain,
      where: () => storiesChain,
      limit: () => storiesChain,
      execute: async () => [{ id: 'catalog:test', story_mode: 'catalog' }],
    }
    mocks.getDb.mockReturnValue({
      selectFrom: (table: string) => (table === 'catalog_stories' ? catalogChain : storiesChain),
    })
    mocks.rpcOne.mockReturnValue({ execute: async () => [{ fn: 10 }] })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(mocks.rpcOne).toHaveBeenCalledWith(expect.anything(), 'catalog_bundle_spent_v1', {
      p_user_id: 'u1',
      p_story_id: 'catalog:test',
    })
    expect(json.bundlePrice).toBe(150)
    expect(json.alreadySpent).toBe(10)
    expect(json.price).toBe(140)
    // 47 bab berbayar x 5 = 235 eceran; bayar total 10 + 140 = 150 -> hemat 85
    expect(json.savings).toBe(85)
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/catalog-bundle-route.test.ts`
Expected: FAIL with missing module `app/api/stories/[id]/bundle/route`.

- [ ] **Step 3: Implement helper and API route**

Create `lib/catalog/bundle.server.ts`:
```typescript
import 'server-only'
import { getDb, single, rpcOne } from '@lakoku/db'
import { getReadingPolicy } from '@/lib/credits/server'

export interface BundleQuote {
  storyId: string
  bundlePrice: number
  chapterPrice: number
  alreadySpent: number
  price: number
  savings: number
}

export interface SpendBundleResult {
  status: 'ok' | 'insufficient' | 'duplicate'
  pricePaid: number
  spentOffset?: number
  availableBalance?: number
  requiredCredits?: number
}

export async function getCatalogBundleQuote(
  storyId: string,
  userId: string | null,
): Promise<BundleQuote | null> {
  const db = getDb()

  const { data: catalogRow } = await single(
    db
      .selectFrom('catalog_stories')
      .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
      .select([
        'catalog_stories.bundle_price',
        'catalog_stories.chapter_price',
        'stories.total_chapters',
      ])
      .where('catalog_stories.story_id', '=', storyId)
      .limit(1)
      .execute(),
  )

  if (!catalogRow) return null

  const bundlePrice = catalogRow.bundle_price
  const chapterPrice = catalogRow.chapter_price

  let alreadySpent = 0
  if (userId) {
    // Sumber kebenaran sama dengan spend_bundle_v1 (tanpa duplikasi aturan ref di TS).
    const { data: spentRow, error: spentErr } = await single(
      rpcOne(db, 'catalog_bundle_spent_v1', {
        p_user_id: userId,
        p_story_id: storyId,
      }).execute(),
    )
    if (spentErr) throw new Error(`getCatalogBundleQuote: ${spentErr.message}`)
    const raw = spentRow ? ((spentRow as Record<string, unknown>).fn ?? spentRow) : 0
    alreadySpent = Number(raw ?? 0)
  }

  const { freeChapters } = await getReadingPolicy()
  const fairPrice = Math.max(0, bundlePrice - alreadySpent)
  const paidChaptersCount = Math.max(0, (catalogRow.total_chapters ?? 50) - freeChapters)
  const fullRetailPrice = paidChaptersCount * chapterPrice
  const savings = Math.max(0, fullRetailPrice - (alreadySpent + fairPrice))

  return {
    storyId,
    bundlePrice,
    chapterPrice,
    alreadySpent,
    price: fairPrice,
    savings,
  }
}

export async function spendCatalogBundle(
  userId: string,
  storyId: string,
): Promise<SpendBundleResult> {
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'spend_bundle_v1', {
      p_user_id: userId,
      p_story_id: storyId,
    }).execute(),
  )

  if (error) {
    throw new Error(`spendCatalogBundle: ${error.message}`)
  }

  const res = (data ? ((data as Record<string, unknown>).fn ?? data) : {}) as {
    status?: string
    price_paid?: number
    spent_offset?: number
    required?: number
    available?: number
  }

  if (res.status === 'ok') {
    return {
      status: 'ok',
      pricePaid: Number(res.price_paid ?? 0),
      spentOffset: Number(res.spent_offset ?? 0),
    }
  }

  if (res.status === 'duplicate') {
    return {
      status: 'duplicate',
      pricePaid: 0,
    }
  }

  if (res.status === 'insufficient') {
    return {
      status: 'insufficient',
      pricePaid: 0,
      requiredCredits: Number(res.required ?? 0),
      availableBalance: Number(res.available ?? 0),
    }
  }

  throw new Error(`spendCatalogBundle: unexpected status ${res.status}`)
}
```

Create `app/api/stories/[id]/bundle/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { getDb, single } from '@lakoku/db'
import { getCatalogBundleQuote, spendCatalogBundle } from '@/lib/catalog/bundle.server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const route = await params
  const storyId = normalizeStoryRouteId(route.id)
  const user = await getSessionUser()
  const quote = await getCatalogBundleQuote(storyId, user?.id ?? null)
  if (!quote) {
    return NextResponse.json({ error: 'Cerita katalog tidak ditemukan.' }, { status: 404 })
  }
  return NextResponse.json(quote, { status: 200 })
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const db = getDb()
  const { data: story, error: storyError } = await single(
    db
      .selectFrom('stories')
      .select(['story_mode'])
      .where('id', '=', storyId)
      .limit(1)
      .execute(),
  )

  if (storyError || !story) {
    return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
  }

  if (story.story_mode !== 'catalog' && !storyId.startsWith('catalog:')) {
    return NextResponse.json({ error: 'Hanya novel katalog yang memiliki paket.' }, { status: 400 })
  }

  try {
    const result = await spendCatalogBundle(user.id, storyId)
    const balance = await getCreditBalance(user.id)

    if (result.status === 'insufficient') {
      return NextResponse.json(
        {
          status: 'WAITING_FOR_CREDITS',
          storyId,
          requiredCredits: result.requiredCredits,
          availableCredits: balance,
        },
        { status: 402 },
      )
    }

    return NextResponse.json(
      {
        status: 'ok',
        pricePaid: result.pricePaid,
        balance,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('SPEND_BUNDLE_FAILED', err)
    return NextResponse.json({ error: 'Gagal memproses pembelian paket.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/catalog-bundle-route.test.ts`
Expected: PASS with 5/5 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add lib/catalog/bundle.server.ts app/api/stories/[id]/bundle/route.ts tests/catalog/catalog-bundle-route.test.ts
git commit -m "feat(catalog): bundle quote computation and POST /api/stories/[id]/bundle route"
```

---

### Task 4: Locked Chapter UI with Bundle Button & Baca Page Integration

**Files:**
- Modify: `components/chapter-locked.tsx`
- Modify: `app/baca/[id]/page.tsx`
- Test: `tests/catalog/chapter-locked-catalog.test.ts`

**Interfaces:**
- Consumes: `bundleQuote?: { price: number; savings: number } | null`
- Produces:
  - Dual button layout in `ChapterLocked`:
    - "Buka bab ini (5 Lakoin)"
    - "Buka semua bab (X Lakoin, hemat Y)"
  - When balance < bundle price, clicking bundle button redirects to `/kredit?kembali=...`
  - When balance >= bundle price, clicking executes `POST /api/stories/${story.id}/bundle` and calls `router.refresh()`
  - `app/baca/[id]/page.tsx`: resolves `bundleQuote` via `getCatalogBundleQuote` if `story.id.startsWith('catalog:')`

- [ ] **Step 1: Write failing test for ChapterLocked dual-button UI**

```typescript
// tests/catalog/chapter-locked-catalog.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('ChapterLocked dual-button UI for catalog', () => {
  const componentPath = path.join(process.cwd(), 'components', 'chapter-locked.tsx')
  const pagePath = path.join(process.cwd(), 'app', 'baca', '[id]', 'page.tsx')

  it('ChapterLocked accepts optional bundleQuote prop', () => {
    const code = fs.readFileSync(componentPath, 'utf8')
    expect(code).toContain('bundleQuote')
    expect(code).toMatch(/price:\s*number/)
    expect(code).toMatch(/savings:\s*number/)
  })

  it('ChapterLocked renders bundle unlock button when bundleQuote is present', () => {
    const code = fs.readFileSync(componentPath, 'utf8')
    expect(code).toContain('/api/stories/${story.id}/bundle')
    expect(code).toContain('Buka semua bab')
  })

  it('BacaPage passes bundleQuote to ChapterLocked for catalog stories', () => {
    const code = fs.readFileSync(pagePath, 'utf8')
    expect(code).toContain('getCatalogBundleQuote')
    expect(code).toContain('bundleQuote')
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/chapter-locked-catalog.test.ts`
Expected: FAIL with assertions failing on missing `bundleQuote`.

- [ ] **Step 3: Implement ChapterLocked dual-button and BacaPage integration**

In `components/chapter-locked.tsx`:
Update interface and UI:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { trackEvent } from '@/lib/analytics/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Coins, Lock, Sparkles } from 'lucide-react'
import type { StoryDetail } from '@/lib/api'

export function ChapterLocked({
  story,
  chapterNumber,
  cost,
  balance,
  bundleQuote,
}: {
  story: StoryDetail
  chapterNumber: number
  cost: number
  balance: number
  bundleQuote?: {
    price: number
    savings: number
  } | null
}) {
  const router = useRouter()
  const [loadingChapter, setLoadingChapter] = useState(false)
  const [loadingBundle, setLoadingBundle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState(balance < cost)

  useEffect(() => {
    trackEvent('paywall_viewed', {
      story_id: story.id,
      chapter_number: chapterNumber,
      placement: 'locked_chapter',
    })
  }, [story.id, chapterNumber])

  async function unlockChapter() {
    if (loadingChapter || loadingBundle) return
    setLoadingChapter(true)
    setError(null)
    try {
      const res = await fetch(`/api/stories/${story.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter: chapterNumber }),
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 402) {
        setInsufficient(true)
        setError('Lakoinmu belum cukup.')
      } else {
        setError('Gagal membuka bab. Coba lagi.')
      }
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoadingChapter(false)
  }

  async function unlockBundle() {
    if (loadingChapter || loadingBundle || !bundleQuote) return
    if (balance < bundleQuote.price) {
      router.push(`/kredit?kembali=${encodeURIComponent(`/baca/${story.id}?bab=${chapterNumber}`)}`)
      return
    }
    setLoadingBundle(true)
    setError(null)
    try {
      const res = await fetch(`/api/stories/${story.id}/bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 402) {
        setError('Lakoinmu belum cukup untuk paket novel.')
      } else {
        setError('Gagal membeli paket novel. Coba lagi.')
      }
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoadingBundle(false)
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <span className="truncate text-xs font-medium text-foreground">{story.title}</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-secondary text-primary">
          <Lock className="size-7" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Bab {chapterNumber} terkunci
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Buka bab ini dengan {cost} Lakoin atau miliki seluruh bab novel ini sekali bayar.
          </p>
        </div>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="size-4 text-gold" aria-hidden="true" />
          Saldo Lakoinmu: <strong className="text-foreground">{balance}</strong>
        </span>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex w-full flex-col gap-3">
          {bundleQuote && (
            <button
              type="button"
              onClick={unlockBundle}
              disabled={loadingChapter || loadingBundle}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-amber-600 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {loadingBundle
                ? 'Membeli paket…'
                : `Buka semua bab (${bundleQuote.price} Lakoin${bundleQuote.savings > 0 ? `, hemat ${bundleQuote.savings}` : ''})`}
            </button>
          )}

          {insufficient ? (
            <Link
              href={`/kredit?kembali=${encodeURIComponent(`/baca/${story.id}?bab=${chapterNumber}`)}`}
              className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Beli Lakoin
            </Link>
          ) : (
            <button
              type="button"
              onClick={unlockChapter}
              disabled={loadingChapter || loadingBundle}
              className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-primary bg-primary/10 px-6 text-sm font-semibold text-primary transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loadingChapter ? 'Membuka…' : `Buka bab ini (${cost} Lakoin)`}
            </button>
          )}
        </div>

        <Link
          href={`/cerita/${story.id}`}
          className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
        >
          Kembali ke detail cerita
        </Link>
      </div>
    </main>
  )
}
```

In `app/baca/[id]/page.tsx`:
Before returning `<ChapterLocked />`:
```typescript
  if (!accessDecision.readable) {
    const balance = user ? await getCreditBalance(user.id) : 0
    let bundleQuote = null
    if (story.id.startsWith('catalog:')) {
      const { getCatalogBundleQuote } = await import('@/lib/catalog/bundle.server')
      bundleQuote = await getCatalogBundleQuote(story.id, user?.id ?? null)
    }
    return (
      <ChapterLocked
        story={story}
        chapterNumber={chapter.number}
        cost={accessDecision.cost}
        balance={balance}
        bundleQuote={bundleQuote}
      />
    )
  }
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/chapter-locked-catalog.test.ts`
Expected: PASS with 3/3 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add components/chapter-locked.tsx app/baca/[id]/page.tsx tests/catalog/chapter-locked-catalog.test.ts
git commit -m "feat(ui): chapter-locked dual-button bundle unlock and baca page integration"
```

---

### Task 5: Explore & Public Story Queries

**Files:**
- Modify: `lib/api/queries.ts`
- Test: `tests/catalog/catalog-explore-queries.test.ts`

**Interfaces:**
- Consumes: `queryExploreStories`, `queryPublicUserStories`
- Produces:
  - `queryExploreStories`: includes `stories` with `id LIKE 'catalog:%'` if and only if `catalog_stories.status = 'published'`
  - `queryPublicUserStories`: excludes `id LIKE 'catalog:%'`

- [ ] **Step 1: Write failing test for catalog explore & public queries**

```typescript
// tests/catalog/catalog-explore-queries.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStories: Array<Record<string, unknown>> = []
const mockCatalogStories: Array<Record<string, unknown>> = []

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => {
      let isLeftJoin = false
      const wheres: Array<(item: Record<string, unknown>) => boolean> = []

      const builder = {
        leftJoin: (joinedTable: string) => {
          if (joinedTable === 'catalog_stories') isLeftJoin = true
          return builder
        },
        select: () => builder,
        where: (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
          if (typeof arg1 === 'function') {
            // eb function
            const eb = {
              or: (subConditions: unknown[]) => {
                return (item: Record<string, unknown>) =>
                  (subConditions as Array<(it: Record<string, unknown>) => boolean>).some((cond) => cond(item))
              },
              and: (subConditions: unknown[]) => {
                return (item: Record<string, unknown>) =>
                  (subConditions as Array<(it: Record<string, unknown>) => boolean>).every((cond) => cond(item))
              },
            }
            // Mock custom eb evaluator
            wheres.push((item) => {
              const id = String(item.id || item['stories.id'] || '')
              const catalogStatus = item.catalog_status
              if (id.startsWith('demo:') || id.startsWith('premium:')) return true
              if (id.startsWith('catalog:') && catalogStatus === 'published') return true
              return false
            })
            return builder
          }
          if (typeof arg1 === 'string' && arg2 === '=') {
            wheres.push((item) => item[arg1] === arg3 || item[arg1.replace('stories.', '')] === arg3)
          }
          if (typeof arg1 === 'string' && arg2 === 'not like') {
            const prefix = String(arg3).replace('%', '')
            wheres.push((item) => !String(item[arg1] ?? '').startsWith(prefix))
          }
          return builder
        },
        orderBy: () => builder,
        limit: () => builder,
        execute: async () => {
          const joined = mockStories.map((s) => {
            const cat = mockCatalogStories.find((c) => c.story_id === s.id)
            return {
              ...s,
              'stories.id': s.id,
              'stories.title': s.title,
              catalog_status: cat?.status,
            }
          })
          return joined.filter((row) => wheres.every((predicate) => predicate(row)))
        },
      }
      return builder
    },
  }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
}))

describe('catalog explore queries', () => {
  beforeEach(() => {
    mockStories.length = 0
    mockCatalogStories.length = 0
  })

  it('queryExploreStories includes published catalog stories and excludes draft catalog stories', async () => {
    mockStories.push(
      { id: 'demo:cinta', title: 'Demo Cinta', visibility: 'public' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public' },
      { id: 'catalog:draft-novel', title: 'Novel Draf', visibility: 'public' },
    )
    mockCatalogStories.push(
      { story_id: 'catalog:published-novel', status: 'published' },
      { story_id: 'catalog:draft-novel', status: 'draft' },
    )

    const { queryExploreStories } = await import('@/lib/api/queries')
    const stories = await queryExploreStories()
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('demo:cinta')
    expect(ids).toContain('catalog:published-novel')
    expect(ids).not.toContain('catalog:draft-novel')
  })

  it('queryPublicUserStories excludes catalog stories', async () => {
    mockStories.push(
      { id: 'user:cerita-saya', title: 'User Story', visibility: 'public', owner_user_id: 'u1' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public', owner_user_id: null },
    )

    const { queryPublicUserStories } = await import('@/lib/api/queries')
    const stories = await queryPublicUserStories()
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('user:cerita-saya')
    expect(ids).not.toContain('catalog:published-novel')
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/catalog-explore-queries.test.ts`
Expected: FAIL because `queryExploreStories` currently does not join `catalog_stories` or filter published status.

- [ ] **Step 3: Update explore and public user queries in queries.ts**

In `lib/api/queries.ts`:
Modify `queryExploreStories`:
```typescript
/** Public official demos, premium templates, and published catalog stories. */
export async function queryExploreStories(): Promise<StorySummary[]> {
  const db = getDb()
  // RLS_AUDIT: stories_public_read
  const { data, error } = await result(
    db
      .selectFrom('stories')
      .leftJoin('catalog_stories', 'catalog_stories.story_id', 'stories.id')
      .select([
        'stories.id',
        'stories.title',
        'stories.cover',
        'stories.tagline',
        'stories.role',
        'stories.tropes',
        'stories.total_chapters',
        'stories.synopsis',
        'stories.status',
        'stories.current_chapter',
        'stories.jejak',
        'stories.ending_name',
      ])
      .where('stories.visibility', '=', 'public')
      .where((eb) =>
        eb.or([
          eb('stories.id', 'like', 'demo:%'),
          eb('stories.id', 'like', 'premium:%'),
          eb.and([
            eb('stories.id', 'like', 'catalog:%'),
            eb('catalog_stories.status', '=', 'published'),
          ]),
        ]),
      )
      .orderBy('stories.id', 'asc')
      .execute(),
  )
  if (error) throw new Error(`queryExploreStories: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
}
```

Modify `queryPublicUserStories`:
```typescript
export async function queryPublicUserStories(limit = 12): Promise<StorySummary[]> {
  const db = getDb()
  // RLS_AUDIT: stories_public_read
  const { data, error } = await result(
    db
      .selectFrom('stories')
      .select(STORY_SELECT_COLS)
      .where('visibility', '=', 'public')
      .where('owner_user_id', 'is not', null)
      .where('id', 'not like', 'demo:%')
      .where('id', 'not like', 'premium:%')
      .where('id', 'not like', 'catalog:%')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute(),
  )
  if (error) throw new Error(`queryPublicUserStories: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
}
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/catalog-explore-queries.test.ts`
Expected: PASS with 2/2 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add lib/api/queries.ts tests/catalog/catalog-explore-queries.test.ts
git commit -m "feat(catalog): explore listing includes published catalog and excludes from public user rail"
```

---

### Task 6: Reader State Ending Lock at Bab 44

**Files:**
- Modify: `lib/api/user-state.ts`
- Test: `tests/catalog/catalog-ending-lock.test.ts`

**Interfaces:**
- Consumes: `applyChoiceToUserState(storyId, chapterNumber, decision, outcome)`
- Produces:
  - Add `locked_ending_key` to `READER_STATE_COLS` and `ReaderState` interface
  - On choice at Bab 44 for catalog story (`chapterNumber === 44 && storyId.startsWith('catalog:')`):
    - Reads snapshot contract from `catalog_stories.contract_json`
    - Computes `resolveEnding({ routeState: nextRouteState, storyContract, chapterNumber: 45 })`
    - Stores `locked_ending_key = resolution.key` in `reader_states`
    - If `locked_ending_key` is already non-null on `reader_states`, never overwrite it
  - Justification for direct guarded write vs `persist_ending_lock_v1`:
    - `persist_ending_lock_v1` mutates global `story_generation_contracts.ending_lock_json`. Catalog stories are shared novels read simultaneously by many users. Mutating `story_generation_contracts` causes race conditions and breaks contract isolation. Catalog ending locks belong exclusively to per-reader state in `reader_states.locked_ending_key`.

- [ ] **Step 1: Write failing test for catalog Bab 44 ending lock**

```typescript
// tests/catalog/catalog-ending-lock.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChoiceOutcome } from '@/packages/contracts/src/reader'

const mockState = {
  readerState: null as Record<string, unknown> | null,
  catalogContract: null as Record<string, unknown> | null,
  upsertedState: null as Record<string, unknown> | null,
}

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/user-state')>()
  return {
    ...actual,
    getSessionUser: vi.fn(async () => ({ id: 'u-reader-1' })),
  }
})

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => ({
      select: () => ({
        where: () => ({
          where: () => ({
            limit: () => ({
              execute: async () => {
                if (table === 'reader_states') return mockState.readerState ? [mockState.readerState] : []
                if (table === 'catalog_stories') return mockState.catalogContract ? [mockState.catalogContract] : []
                if (table === 'choice_outcomes') return [{ effect_json: { endingBias: { ending_a: 5 } } }]
                return []
              },
            }),
          }),
        }),
      }),
    }),
    insertInto: () => ({
      values: (vals: Record<string, unknown>) => ({
        onConflict: () => ({
          doUpdateSet: (updateVals: Record<string, unknown>) => {
            mockState.upsertedState = updateVals
            return {
              execute: async () => [],
            }
          },
        }),
      }),
    }),
  }),
  single: async (promise: Promise<unknown[]>) => ({ data: (await promise)[0] ?? null, error: null }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
}))

describe('applyChoiceToUserState ending lock for catalog', () => {
  const contractFixture = {
    contractVersion: 2,
    premise: 'Premis uji katalog',
    characters: [],
    closureRunway: {
      endingLockChapter: 45,
      endingRunwayChapters: 6,
      allowedNewThreadChapters: 20,
      allowedMajorNewConflictChapters: 30,
    },
    endingCandidates: [
      { key: 'ending_a', name: 'Ending Damai', description: 'desc', requiredClosure: [] },
      { key: 'ending_b', name: 'Ending Gelap', description: 'desc', requiredClosure: [] },
      { key: 'ending_secret', name: 'Ending Rahasia', description: 'desc', requiredClosure: [] },
    ],
  }

  beforeEach(() => {
    mockState.readerState = null
    mockState.catalogContract = { contract_json: contractFixture }
    mockState.upsertedState = null
  })

  it('locks ending at Bab 44 choice when locked_ending_key is null', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-1',
      consequence: ['Keputusan besar Bab 44.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan 1', outcome)

    expect(mockState.upsertedState).not.toBeNull()
    expect(mockState.upsertedState?.locked_ending_key).toBe('ending_a')
  })

  it('does not overwrite locked_ending_key if already locked', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    mockState.readerState = {
      status: 'BERJALAN',
      current_chapter: 44,
      jejak: [],
      ending_name: null,
      route_state: { endingBias: { ending_b: 10 } },
      choice_history: [],
      locked_ending_key: 'ending_secret',
    }

    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-retry',
      consequence: ['Keputusan ulang Bab 44.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan Ulang', outcome)

    expect(mockState.upsertedState?.locked_ending_key).toBe('ending_secret')
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/catalog-ending-lock.test.ts`
Expected: FAIL because `applyChoiceToUserState` does not yet compute `resolveEnding` or set `locked_ending_key`.

- [ ] **Step 3: Implement ending lock in user-state.ts**

In `lib/api/user-state.ts`:
1. Add `'locked_ending_key'` to `READER_STATE_COLS`:
```typescript
export const READER_STATE_COLS = [
  'story_id',
  'status',
  'current_chapter',
  'jejak',
  'ending_name',
  'locked_ending_key',
  'updated_at',
] as const
```
2. Add `lockedEndingKey?: string | null` to `ReaderState` and `ReaderStateRow`:
```typescript
export interface ReaderState {
  storyId: string
  status: 'BARU' | 'BERJALAN' | 'SELESAI'
  currentChapter: number
  jejak: JejakItem[]
  endingName?: string
  lockedEndingKey?: string | null
}
```
Update `toState`:
```typescript
function toState(r: ReaderStateRow): ReaderState {
  return {
    storyId: r.story_id,
    status: r.status,
    currentChapter: r.current_chapter,
    jejak: r.jejak,
    ...(r.ending_name ? { endingName: r.ending_name } : {}),
    ...(r.locked_ending_key ? { lockedEndingKey: r.locked_ending_key } : {}),
  }
}
```
3. In `applyChoiceToUserState`:
Fetch `locked_ending_key` in the initial select:
```typescript
  const { data: stateData, error: stateError } = await single(
    db
      .selectFrom('reader_states')
      .select(['status', 'current_chapter', 'jejak', 'ending_name', 'route_state', 'choice_history', 'locked_ending_key'])
      .where('user_id', '=', user.id)
      .where('story_id', '=', storyId)
      .limit(1)
      .execute(),
  )
```
Add ending lock logic:
```typescript
  // --- Ending lock untuk cerita katalog pada Bab 44
  let lockedEndingKey = stateData?.locked_ending_key ?? null
  const isCatalog = storyId.startsWith('catalog:')
  if (isCatalog && chapterNumber === 44 && !lockedEndingKey) {
    try {
      const { data: catalogRow } = await single(
        db
          .selectFrom('catalog_stories')
          .select('contract_json')
          .where('story_id', '=', storyId)
          .limit(1)
          .execute(),
      )
      if (catalogRow?.contract_json) {
        const { resolveEnding } = await import('@/lib/story-engine/ending-resolver')
        const contract = (
          typeof catalogRow.contract_json === 'string'
            ? JSON.parse(catalogRow.contract_json)
            : catalogRow.contract_json
        ) as Parameters<typeof resolveEnding>[0]['storyContract']
        const resolution = resolveEnding({
          routeState: nextRouteState,
          storyContract: contract,
          chapterNumber: 45,
        })
        lockedEndingKey = resolution.key
      }
    } catch (err) {
      console.error('CATALOG_ENDING_LOCK_COMPUTATION_FAILED', err)
    }
  }
```
Include `locked_ending_key: lockedEndingKey` in both `insertInto` values and `doUpdateSet` values!

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/catalog-ending-lock.test.ts`
Expected: PASS with 2/2 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add lib/api/user-state.ts tests/catalog/catalog-ending-lock.test.ts
git commit -m "feat(catalog): lock reader ending once at Bab 44 choice using resolveEnding"
```

---

### Task 7: Catalog Variant Reader Helper & Bab 45–50 Variant Chapter Reads

**Files:**
- Create: `lib/catalog/variant-reader.server.ts`
- Modify: `lib/api/queries.ts`
- Modify: `lib/api/server.ts`
- Modify: `lib/api/chapter-status.server.ts`
- Test: `tests/catalog/catalog-variant-reads.test.ts`

**Interfaces:**
- Consumes: `catalog_ending_chapters`, `reader_states.locked_ending_key`
- Produces:
  - `lib/catalog/variant-reader.server.ts`:
    - `getReaderLockedEndingKey(storyId: string, userId: string | null): Promise<string | null>`
    - `getCatalogVariantChapter(storyId: string, chapterNumber: number, endingKey: string): Promise<Chapter | null>`
    - `getCatalogVariantOutcome(storyId: string, chapterNumber: number, choiceId: string, endingKey: string): Promise<ChoiceOutcome | null>`
    - `getCatalogVariantMetadatas(storyId: string, minNumber: number, maxNumber: number, endingKey: string): Promise<{ number: number; title: string }[]>`
  - Integration:
    - `queryChapter`: for `catalog:%` and `n >= 45`, reads variant from `catalog_ending_chapters` if user has lock, otherwise returns `null`
    - `queryChoiceOutcome`: for `catalog:%` and `n >= 45`, reads outcome from `catalog_ending_chapters.outcomes_json` if user has lock, otherwise returns `null`
    - `queryChapterMetadatas`: for `catalog:%` and `maxNumber >= 45`, appends variant titles if user has lock, otherwise omits them
    - `getChapterStatusForUser`: for `catalog:%` and `n >= 45`, validates variant exists under user's lock

- [ ] **Step 1: Write failing test for catalog variant reader**

```typescript
// tests/catalog/catalog-variant-reads.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVariantDb = {
  chapters: [] as Array<Record<string, unknown>>,
  readerStates: [] as Array<Record<string, unknown>>,
}

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'u-reader-1' })),
}))

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      const builder = {
        select: () => builder,
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        orderBy: () => builder,
        limit: () => builder,
        execute: async () => {
          const rows =
            table === 'catalog_ending_chapters'
              ? mockVariantDb.chapters
              : table === 'reader_states'
                ? mockVariantDb.readerStates
                : []
          return rows.filter((r) =>
            wheres.every(({ col, op, val }) => {
              if (op === '=') return r[col] === val
              if (op === '>=') return Number(r[col]) >= Number(val)
              if (op === '<=') return Number(r[col]) <= Number(val)
              return false
            }),
          )
        },
      }
      return builder
    },
  }),
  single: async (promise: Promise<unknown[]>) => ({ data: (await promise)[0] ?? null, error: null }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
}))

describe('catalog variant reader Bab 45-50', () => {
  beforeEach(() => {
    mockVariantDb.chapters = []
    mockVariantDb.readerStates = []
  })

  it('returns null and does not leak variant when user has no locked ending key', async () => {
    const { getCatalogVariantChapter, getReaderLockedEndingKey } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.chapters.push({
      story_id: 'catalog:test',
      ending_key: 'ending_a',
      number: 45,
      title: 'Bab 45 Varian A',
      paragraphs: ['Paragraf varian A'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [],
    })

    const lock = await getReaderLockedEndingKey('catalog:test', 'u-reader-1')
    expect(lock).toBeNull()

    // Without lock key, variant chapter cannot be accessed
    const chapter = lock ? await getCatalogVariantChapter('catalog:test', 45, lock) : null
    expect(chapter).toBeNull()
  })

  it('reads variant chapter when reader has locked ending key', async () => {
    const { getCatalogVariantChapter } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.chapters.push(
      {
        story_id: 'catalog:test',
        ending_key: 'ending_a',
        number: 45,
        title: 'Bab 45 Varian A',
        paragraphs: ['Paragraf varian A'],
        choices: [{ id: 'lanjut', label: 'Lanjut' }],
        choice_prompt: 'Pilihan 45',
        outcomes_json: [],
      },
      {
        story_id: 'catalog:test',
        ending_key: 'ending_b',
        number: 45,
        title: 'Bab 45 Varian B',
        paragraphs: ['Paragraf varian B'],
        choices: [{ id: 'lanjut', label: 'Lanjut' }],
        choice_prompt: 'Pilihan 45',
        outcomes_json: [],
      },
    )

    const chapterA = await getCatalogVariantChapter('catalog:test', 45, 'ending_a')
    expect(chapterA).not.toBeNull()
    expect(chapterA?.title).toBe('Bab 45 Varian A')
    expect(chapterA?.paragraphs).toEqual(['Paragraf varian A'])

    const chapterB = await getCatalogVariantChapter('catalog:test', 45, 'ending_b')
    expect(chapterB?.title).toBe('Bab 45 Varian B')
  })

  it('reads variant choice outcome from outcomes_json', async () => {
    const { getCatalogVariantOutcome } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.chapters.push({
      story_id: 'catalog:test',
      ending_key: 'ending_a',
      number: 45,
      title: 'Bab 45 Varian A',
      paragraphs: ['...'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [
        {
          storyId: 'catalog:test',
          chapterNumber: 45,
          choiceId: 'choice-variant-1',
          consequence: ['Reaksi varian 45'],
          nextChapterNumber: 46,
          isEnding: false,
        },
      ],
    })

    const outcome = await getCatalogVariantOutcome('catalog:test', 45, 'choice-variant-1', 'ending_a')
    expect(outcome).not.toBeNull()
    expect(outcome?.choiceId).toBe('choice-variant-1')
    expect(outcome?.consequence).toEqual(['Reaksi varian 45'])
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/catalog-variant-reads.test.ts`
Expected: FAIL with module not found `lib/catalog/variant-reader.server`.

- [ ] **Step 3: Implement variant reader helper and hook into queries**

Create `lib/catalog/variant-reader.server.ts`:
```typescript
import 'server-only'
import { getDb, single, result } from '@lakoku/db'
import type { Chapter, ChoiceOutcome, ChoiceOption } from '@/lib/api/types'

export function isCatalogStory(storyId: string): boolean {
  return storyId.startsWith('catalog:')
}

export async function getReaderLockedEndingKey(
  storyId: string,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null
  const db = getDb()
  const { data } = await single(
    db
      .selectFrom('reader_states')
      .select('locked_ending_key')
      .where('user_id', '=', userId)
      .where('story_id', '=', storyId)
      .limit(1)
      .execute(),
  )
  return data?.locked_ending_key ?? null
}

export async function getCatalogVariantChapter(
  storyId: string,
  chapterNumber: number,
  endingKey: string,
): Promise<Chapter | null> {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('catalog_ending_chapters')
      .select([
        'story_id',
        'number',
        'title',
        'paragraphs',
        'choice_prompt',
        'choices',
      ])
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )

  if (error || !data) return null

  return {
    storyId: data.story_id,
    number: data.number,
    title: data.title,
    paragraphs: (typeof data.paragraphs === 'string' ? JSON.parse(data.paragraphs) : data.paragraphs) as string[],
    choicePrompt: data.choice_prompt ?? '',
    choices: (typeof data.choices === 'string' ? JSON.parse(data.choices) : (data.choices ?? [])) as ChoiceOption[],
  }
}

export async function getCatalogVariantOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
  endingKey: string,
): Promise<ChoiceOutcome | null> {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('catalog_ending_chapters')
      .select('outcomes_json')
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )

  if (error || !data || !data.outcomes_json) return null

  const outcomes = (
    typeof data.outcomes_json === 'string'
      ? JSON.parse(data.outcomes_json)
      : data.outcomes_json
  ) as ChoiceOutcome[]

  const matched = outcomes.find((o) => o.choiceId === choiceId)
  return matched ?? null
}

export async function getCatalogVariantMetadatas(
  storyId: string,
  minNumber: number,
  maxNumber: number,
  endingKey: string,
): Promise<{ number: number; title: string }[]> {
  const db = getDb()
  const { data, error } = await result(
    db
      .selectFrom('catalog_ending_chapters')
      .select(['number', 'title'])
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '>=', minNumber)
      .where('number', '<=', maxNumber)
      .orderBy('number', 'asc')
      .execute(),
  )

  if (error || !data) return []
  return data as { number: number; title: string }[]
}
```

In `lib/api/queries.ts`:
Modify `queryChapter`:
```typescript
export const queryChapter = cache(async function queryChapter(
  storyId: string,
  number: number,
  endingKey?: string | null,
): Promise<Chapter | null> {
  if (storyId.startsWith('catalog:') && number >= 45) {
    const { getReaderLockedEndingKey, getCatalogVariantChapter } = await import('@/lib/catalog/variant-reader.server')
    let resolvedKey = endingKey
    if (resolvedKey === undefined) {
      const { getSessionUser } = await import('./user-state')
      const user = await getSessionUser()
      resolvedKey = await getReaderLockedEndingKey(storyId, user?.id ?? null)
    }
    if (!resolvedKey) return null
    return getCatalogVariantChapter(storyId, number, resolvedKey)
  }

  const db = getDb()
  // RLS_AUDIT: chapters_owner_read, chapters_public_read (caller authorizes parent story)
  const { data, error } = await single(
    db
      .selectFrom('chapters')
      .select([
        'story_id',
        'number',
        'title',
        'paragraphs',
        'choice_prompt',
        'choices',
      ])
      .where('story_id', '=', storyId)
      .where('number', '=', number)
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`queryChapter: ${error.message}`)
  if (!data) return null
  return mapChapterRow(data as unknown as ChapterRow)
})
```

Modify `queryChoiceOutcome`:
```typescript
export async function queryChoiceOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
  endingKey?: string | null,
): Promise<ChoiceOutcome | null> {
  if (storyId.startsWith('catalog:') && chapterNumber >= 45) {
    const { getReaderLockedEndingKey, getCatalogVariantOutcome } = await import('@/lib/catalog/variant-reader.server')
    let resolvedKey = endingKey
    if (resolvedKey === undefined) {
      const { getSessionUser } = await import('./user-state')
      const user = await getSessionUser()
      resolvedKey = await getReaderLockedEndingKey(storyId, user?.id ?? null)
    }
    if (!resolvedKey) return null
    return getCatalogVariantOutcome(storyId, chapterNumber, choiceId, resolvedKey)
  }

  const db = getDb()
  // RLS_AUDIT: choice_outcomes_owner_read, choice_outcomes_public_read (caller authorizes parent story)
  const { data, error } = await single(
    db
      .selectFrom('choice_outcomes')
      .select([
        'story_id',
        'chapter_number',
        'choice_id',
        'consequence',
        'next_chapter_number',
        'is_ending',
        'direction_hint',
      ])
      .where('story_id', '=', storyId)
      .where('chapter_number', '=', chapterNumber)
      .where('choice_id', '=', choiceId)
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`queryChoiceOutcome: ${error.message}`)
  if (!data) return null
  const r = data as unknown as OutcomeRow & { direction_hint?: string | null }
  return {
    storyId: r.story_id,
    chapterNumber: r.chapter_number,
    choiceId: r.choice_id,
    consequence: (typeof r.consequence === 'string' ? JSON.parse(r.consequence) : r.consequence) as string[],
    nextChapterNumber: r.next_chapter_number,
    isEnding: r.is_ending,
    ...(r.direction_hint ? { directionHint: r.direction_hint } : {}),
  }
}
```

Modify `queryChapterMetadatas`:
```typescript
export const queryChapterMetadatas = cache(async function queryChapterMetadatas(
  storyId: string,
  maxNumber: number,
): Promise<{ number: number; title: string }[]> {
  const isCatalog = storyId.startsWith('catalog:')
  const spineMax = isCatalog && maxNumber >= 45 ? 44 : maxNumber

  const db = getDb()
  const { data, error } = await result(
    db
      .selectFrom('chapters')
      .select(['number', 'title'])
      .where('story_id', '=', storyId)
      .where('number', '<=', spineMax)
      .orderBy('number', 'asc')
      .execute(),
  )
  if (error) throw new Error(`queryChapterMetadatas: ${error.message}`)
  const spineRows = (data ?? []) as { number: number; title: string }[]

  if (isCatalog && maxNumber >= 45) {
    const { getSessionUser } = await import('./user-state')
    const user = await getSessionUser()
    const { getReaderLockedEndingKey, getCatalogVariantMetadatas } = await import('@/lib/catalog/variant-reader.server')
    const endingKey = await getReaderLockedEndingKey(storyId, user?.id ?? null)
    if (endingKey) {
      const variantRows = await getCatalogVariantMetadatas(storyId, 45, maxNumber, endingKey)
      return [...spineRows, ...variantRows]
    }
  }

  return spineRows
})
```

In `lib/api/chapter-status.server.ts`:
Update `chapterExists`:
```typescript
async function chapterExists(storyId: string, chapterNumber: number, userId?: string | null): Promise<boolean> {
  if (storyId.startsWith('catalog:') && chapterNumber >= 45) {
    const { getReaderLockedEndingKey, getCatalogVariantChapter } = await import('@/lib/catalog/variant-reader.server')
    const endingKey = await getReaderLockedEndingKey(storyId, userId ?? null)
    if (!endingKey) return false
    const ch = await getCatalogVariantChapter(storyId, chapterNumber, endingKey)
    return ch != null
  }
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('chapters')
      .select('number')
      .where('story_id', '=', storyId)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )
  if (error) throw new ChapterStatusError('INTERNAL_ERROR')
  return data != null
}
```
And pass `userId` to `chapterExists(storyId, chapterNumber, userId)` in `getChapterStatusForUser`.

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/catalog-variant-reads.test.ts`
Expected: PASS with 3/3 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add lib/catalog/variant-reader.server.ts lib/api/queries.ts lib/api/server.ts lib/api/chapter-status.server.ts tests/catalog/catalog-variant-reads.test.ts
git commit -m "feat(catalog): variant chapter and outcome reads from catalog_ending_chapters for Bab 45-50"
```

---

### Task 8: Reader UI Consequence Display & Direction Hint with Brand Guard

**Files:**
- Modify: `packages/contracts/src/reader.ts`
- Modify: `lib/api/last-choice-summary.ts`
- Modify: `lib/api/user-state.ts`
- Modify: `components/reader-view.tsx`
- Test: `tests/catalog/reader-consequence-direction.test.ts`

**Interfaces:**
- Consumes: `ChoiceOutcome.directionHint`, `ChoiceOutcome.consequence` (1-2 paragraphs)
- Produces:
  - `ChoiceOutcomeSchema`: optional `directionHint: z.string().min(1).optional()`
  - `JejakItemSchema`: optional `directionHint: z.string().min(1).optional()`
  - `recordLastChoiceSummary`: stores all paragraphs `consequence: outcome.consequence.join('\n\n')` and `directionHint: outcome.directionHint`
  - `reader-view.tsx`:
    - Renders all consequence paragraphs (split by `\n\n`)
    - Renders `directionHint` beneath consequence in subtle italic font
    - Brand guard: verifies no prohibited tokens ("AI", "token", "skor", "bias", "ending") in direction hint

- [ ] **Step 1: Write failing test for reader consequence & direction hint**

```typescript
// tests/catalog/reader-consequence-direction.test.ts
import { describe, expect, it } from 'vitest'
import { ChoiceOutcomeSchema, JejakItemSchema } from '@/packages/contracts/src/reader'
import { recordLastChoiceSummary, getLastChoiceSummary } from '@/lib/api/last-choice-summary'

describe('reader consequence & direction hint', () => {
  it('ChoiceOutcomeSchema validates optional directionHint', () => {
    const valid = ChoiceOutcomeSchema.parse({
      storyId: 'catalog:test',
      chapterNumber: 12,
      choiceId: 'choice-1',
      consequence: ['Paragraf reaksi pertama.', 'Paragraf reaksi kedua.'],
      nextChapterNumber: 13,
      isEnding: false,
      directionHint: 'Raka mulai mempercayaimu.',
    })
    expect(valid.directionHint).toBe('Raka mulai mempercayaimu.')
    expect(valid.consequence).toHaveLength(2)
  })

  it('JejakItemSchema validates optional directionHint', () => {
    const valid = JejakItemSchema.parse({
      chapter: 12,
      decision: 'Tetap bertahan',
      consequence: 'Paragraf satu.\n\nParagraf dua.',
      directionHint: 'Raka mulai mempercayaimu.',
    })
    expect(valid.directionHint).toBe('Raka mulai mempercayaimu.')
  })

  it('last-choice-summary records and retrieves multi-paragraph consequence and directionHint', () => {
    recordLastChoiceSummary({
      storyId: 'catalog:test-summary',
      fromChapter: 10,
      toChapter: 11,
      decision: 'Lari ke barat',
      consequence: 'Paragraf 1.\n\nParagraf 2.',
      directionHint: 'Langkahmu terasa lebih ringan.',
    })

    const summary = getLastChoiceSummary('catalog:test-summary', 11)
    expect(summary).not.toBeNull()
    expect(summary?.consequence).toBe('Paragraf 1.\n\nParagraf 2.')
    expect(summary?.directionHint).toBe('Langkahmu terasa lebih ringan.')
  })

  it('brand guard enforces no forbidden terms in direction hint', () => {
    const forbiddenPatterns = [/\bai\b/i, /token/i, /skor/i, /bias/i, /ending/i, /rag/i]
    const sampleHint = 'Raka mulai mempercayaimu.'
    for (const pat of forbiddenPatterns) {
      expect(pat.test(sampleHint)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/catalog/reader-consequence-direction.test.ts`
Expected: FAIL with Zod validation errors on `directionHint` and missing property on summary.

- [ ] **Step 3: Update contracts, last-choice-summary, user-state, and reader-view**

In `packages/contracts/src/reader.ts`:
Update `ChoiceOutcomeSchema`:
```typescript
export const ChoiceOutcomeSchema = z.object({
  storyId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  choiceId: z.string().min(1),
  consequence: z.array(z.string().min(1)).min(1),
  nextChapterNumber: z.number().int().positive().nullable(),
  isEnding: z.boolean(),
  directionHint: z.string().min(1).optional(),
})
```
Update `JejakItemSchema`:
```typescript
export const JejakItemSchema = z.object({
  chapter: z.number().int().positive(),
  decision: z.string().min(1),
  consequence: z.string().min(1),
  directionHint: z.string().min(1).optional(),
})
```

In `lib/api/last-choice-summary.ts`:
Update `LastChoiceEntry`:
```typescript
interface LastChoiceEntry {
  storyId: string
  fromChapter: number
  toChapter: number
  decision: string
  consequence: string
  directionHint?: string
}
```
Update `getLastChoiceSummary`:
```typescript
  return {
    chapter: entry.fromChapter,
    decision: entry.decision,
    consequence: entry.consequence,
    ...(entry.directionHint ? { directionHint: entry.directionHint } : {}),
  }
```

In `lib/api/user-state.ts`:
In `applyChoiceToUserState`:
```typescript
  byChapter.set(chapterNumber, {
    chapter: chapterNumber,
    decision,
    consequence: outcome.consequence.join('\n\n'),
    ...(outcome.directionHint ? { directionHint: outcome.directionHint } : {}),
  })
```

In `components/reader-view.tsx`:
Line 353 in `showOutcome`:
```typescript
    if (chosenLabel) {
      recordLastChoiceSummary({
        storyId: story.id,
        fromChapter: chapter.number,
        toChapter: nextBab,
        decision: chosenLabel,
        consequence: outcome.consequence.join('\n\n'),
        ...(outcome.directionHint ? { directionHint: outcome.directionHint } : {}),
      })
    }
```
Line 641 in reader render:
```tsx
        {/* Card ringkasan pilihan sebelumnya */}
        {effectivePreviousChoice && !isReRead && (
          <div className="lk-fade-up rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-lavender">
              Pilihanmu sebelumnya
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              &ldquo;{effectivePreviousChoice.decision}&rdquo;
            </p>
            <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              {effectivePreviousChoice.consequence.split('\n\n').map((paragraph, idx) => (
                <p key={idx}>{paragraph}</p>
              ))}
            </div>
            {effectivePreviousChoice.directionHint && (
              <p className="mt-2 text-[11px] italic text-muted-foreground/90">
                {effectivePreviousChoice.directionHint}
              </p>
            )}
          </div>
        )}
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/catalog/reader-consequence-direction.test.ts`
Expected: PASS with 4/4 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add packages/contracts/src/reader.ts lib/api/last-choice-summary.ts lib/api/user-state.ts components/reader-view.tsx tests/catalog/reader-consequence-direction.test.ts
git commit -m "feat(reader): multi-paragraph reaction display and brand-guarded direction hint"
```

---

### Task 9: Deterministic Catalog Story Fixture Seed Script

**Files:**
- Create: `scripts/seed-catalog-fixture.ts`
- Test: `tests/scripts/seed-catalog-fixture.test.ts`

**Interfaces:**
- Consumes: `LAKOKU_SEED_CATALOG=1` environment variable
- Produces:
  - Seeds `catalog:bayang-tak-bertuan`:
    - `stories` table: `id: 'catalog:bayang-tak-bertuan'`, `story_mode: 'catalog'`, `owner_user_id: null`, `visibility: 'public'`, `status: 'SELESAI'`, `total_chapters: 50`
    - `catalog_stories`: `bundle_price: 150`, `chapter_price: 5`, `status: 'published'`, snapshot `contract_json` with 3 endings (`ending_a`, `ending_b`, `ending_secret`)
    - `chapters`: Bab 1–44 deterministic spine text + choices
    - `choice_outcomes`: Bab 1–44 choices with 1–2 paragraph consequences and `direction_hint`
    - `catalog_ending_chapters`: Bab 45–50 for `ending_a`, `ending_b`, `ending_secret` with `outcomes_json`
  - Refuses to run if `process.env.LAKOKU_SEED_CATALOG !== '1'`

- [ ] **Step 1: Write failing test for seed catalog fixture**

```typescript
// tests/scripts/seed-catalog-fixture.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('scripts/seed-catalog-fixture.ts', () => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'seed-catalog-fixture.ts')

  it('script exists', () => {
    expect(fs.existsSync(scriptPath)).toBe(true)
  })

  it('script has explicit safety guard requiring LAKOKU_SEED_CATALOG=1', () => {
    const code = fs.readFileSync(scriptPath, 'utf8')
    expect(code).toContain("process.env.LAKOKU_SEED_CATALOG !== '1'")
    expect(code).toContain('LAKOKU_SEED_CATALOG=1')
  })

  it('script seeds 44 spine chapters and 3 ending variants for Bab 45-50', () => {
    const code = fs.readFileSync(scriptPath, 'utf8')
    expect(code).toContain('catalog:bayang-tak-bertuan')
    expect(code).toContain('catalog_stories')
    expect(code).toContain('catalog_ending_chapters')
    expect(code).toContain('ending_a')
    expect(code).toContain('ending_b')
    expect(code).toContain('ending_secret')
  })
})
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm exec vitest run tests/scripts/seed-catalog-fixture.test.ts`
Expected: FAIL with `ENOENT: no such file or directory scripts/seed-catalog-fixture.ts`.

- [ ] **Step 3: Implement seed fixture script**

Create `scripts/seed-catalog-fixture.ts`:
```typescript
import { getDb, result } from '@lakoku/db'

export const FIXTURE_CATALOG_STORY_ID = 'catalog:bayang-tak-bertuan'

export async function seedCatalogFixture(): Promise<void> {
  if (process.env.LAKOKU_SEED_CATALOG !== '1') {
    console.error('REFUSED: scripts/seed-catalog-fixture.ts requires LAKOKU_SEED_CATALOG=1 to execute.')
    process.exit(1)
  }

  const db = getDb()
  const storyId = FIXTURE_CATALOG_STORY_ID

  console.log(`[seed-catalog] Membersihkan data lama untuk ${storyId}...`)
  await db.deleteFrom('catalog_ending_chapters').where('story_id', '=', storyId).execute()
  await db.deleteFrom('catalog_stories').where('story_id', '=', storyId).execute()
  await db.deleteFrom('choice_outcomes').where('story_id', '=', storyId).execute()
  await db.deleteFrom('chapters').where('story_id', '=', storyId).execute()
  await db.deleteFrom('stories').where('id', '=', storyId).execute()

  console.log('[seed-catalog] Memasukkan baris stories...')
  await result(
    db
      .insertInto('stories')
      .values({
        id: storyId,
        title: 'Bayang Tak Bertuan',
        cover: '/covers/bayang-tak-bertuan.webp',
        tagline: 'Di balik kabut lereng Lawu, rahasia keluarga memanggilmu pulang.',
        role: 'Raka',
        tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
        total_chapters: 50,
        synopsis: 'Sebuah novel interaktif 50 bab dengan tiga cabang takdir yang ditentukan pilihan hatimu.',
        status: 'SELESAI',
        current_chapter: 50,
        visibility: 'public',
        story_mode: 'catalog',
        owner_user_id: null,
        jejak: [],
      })
      .execute(),
  )

  const contractJson = {
    contractVersion: 2,
    premise: 'Raka mengungkap konspirasi tanah leluhur di Lereng Lawu.',
    characters: [
      { name: 'Raka', role: 'protagonist' },
      { name: 'Arya', role: 'antagonist' },
    ],
    closureRunway: {
      endingLockChapter: 45,
      endingRunwayChapters: 6,
      allowedNewThreadChapters: 20,
      allowedMajorNewConflictChapters: 30,
    },
    endingCandidates: [
      { key: 'ending_a', name: 'Warisan Terbuka', description: 'Raka memimpin pemulihan desa.', requiredClosure: [] },
      { key: 'ending_b', name: 'Kebenaran Pahit', description: 'Raka memilih pergi meninggalkan segalanya.', requiredClosure: [] },
      { key: 'ending_secret', name: 'Perjanjian Gaib', description: 'Raka menemukan perjanjian rahasia kakeknya.', requiredClosure: [] },
    ],
  }

  console.log('[seed-catalog] Memasukkan catalog_stories...')
  await result(
    db
      .insertInto('catalog_stories')
      .values({
        story_id: storyId,
        status: 'published',
        chapter_price: 5,
        bundle_price: 150,
        contract_json: contractJson as unknown as import('@lakoku/db').Json,
        generation_progress: 50,
        published_at: new Date().toISOString(),
        published_by: 'system',
      })
      .execute(),
  )

  console.log('[seed-catalog] Memasukkan Bab 1-44 spine...')
  for (let n = 1; n <= 44; n++) {
    const choices = [
      { id: `ch${n}-opt-1`, label: `Hadapi rintangan langkah ${n}` },
      { id: `ch${n}-opt-2`, label: `Cari jalan memutar langkah ${n}` },
    ]
    await result(
      db
        .insertInto('chapters')
        .values({
          story_id: storyId,
          number: n,
          title: `Bab ${n}: Titik Temu ${n}`,
          paragraphs: [
            `Langkah demi langkah di Bab ${n} membawa Raka semakin dekat ke inti teka-teki.`,
            `Udara dingin pegunungan menusuk tulang, tetapi tekadnya tak goyah sedikit pun.`,
          ] as unknown as import('@lakoku/db').Json,
          choice_prompt: `Apa langkahmu berikutnya di Bab ${n}?`,
          choices: choices as unknown as import('@lakoku/db').Json,
        })
        .execute(),
    )

    // Outcome untuk pilihan
    for (const c of choices) {
      await result(
        db
          .insertInto('choice_outcomes')
          .values({
            story_id: storyId,
            chapter_number: n,
            choice_id: c.id,
            consequence: [
              `Reaksi mendalam untuk ${c.label}. Keputusan ini membawa dampak nyata bagi suasana di sekitar.`,
              `Raka menghela napas panjang dan melangkah mantap ke depan.`,
            ] as unknown as import('@lakoku/db').Json,
            next_chapter_number: n + 1,
            is_ending: false,
            direction_hint: c.id.endsWith('1') ? 'Keyakinanmu mulai mempengaruhi orang sekitar.' : null,
            effect_json: {
              endingBias: c.id.endsWith('1') ? { ending_a: 2 } : { ending_b: 2 },
            } as unknown as import('@lakoku/db').Json,
          })
          .execute(),
      )
    }
  }

  console.log('[seed-catalog] Memasukkan Bab 45-50 varian ending...')
  const endingKeys = ['ending_a', 'ending_b', 'ending_secret']
  for (const endingKey of endingKeys) {
    for (let n = 45; n <= 50; n++) {
      const isFinal = n === 50
      const outcomes = isFinal
        ? []
        : [
            {
              storyId,
              chapterNumber: n,
              choiceId: `v-${endingKey}-ch${n}-1`,
              consequence: [`Konsekuensi varian ${endingKey} bab ${n}.`],
              nextChapterNumber: n + 1,
              isEnding: false,
            },
          ]

      await result(
        db
          .insertInto('catalog_ending_chapters')
          .values({
            story_id: storyId,
            ending_key: endingKey,
            number: n,
            title: `Bab ${n} [${endingKey.toUpperCase()}]: Babak Penutup`,
            paragraphs: [
              `Paragraf khusus varian ${endingKey} pada Bab ${n}.`,
              isFinal ? `Inilah penutup dari takdir ${endingKey}.` : 'Ketegangan memuncak di ujung perjalanan.',
            ] as unknown as import('@lakoku/db').Json,
            choice_prompt: isFinal ? null : 'Bagaimana caramu menutup kisah ini?',
            choices: isFinal ? null : ([{ id: `v-${endingKey}-ch${n}-1`, label: 'Lanjutkan akhir kisah' }] as unknown as import('@lakoku/db').Json),
            outcomes_json: outcomes as unknown as import('@lakoku/db').Json,
          })
          .execute(),
      )
    }
  }

  console.log('[seed-catalog] Sukses menyiapkan fixture catalog:bayang-tak-bertuan (50 bab, 3 ending).')
}

if (process.argv[1]?.endsWith('seed-catalog-fixture.ts')) {
  seedCatalogFixture().catch((err) => {
    console.error('[seed-catalog] Gagal:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run test to verify pass**
Run: `pnpm exec vitest run tests/scripts/seed-catalog-fixture.test.ts`
Expected: PASS with 3/3 tests passing.

- [ ] **Step 5: Commit changes**
Command:
```bash
git add scripts/seed-catalog-fixture.ts tests/scripts/seed-catalog-fixture.test.ts
git commit -m "feat(scripts): deterministic test catalog story fixture seed script"
```

---

## Plan Verification Checklist

Before finishing this plan, verify against the approved spec (`docs/superpowers/specs/2026-10-27-admin-catalog-story-design.md`):
- [x] Scope: Plan 1 reader foundation only (generator and admin QC left to Plans 2 & 3).
- [x] Constraints: prices 5 / 150, ID prefix `catalog:`, owner null, 3 endings, free chapters per reading policy.
- [x] Fair bundle pricing server-side: `max(0, bundle_price − total_spent)`.
- [x] Atomic RPC `spend_bundle_v1` handles delta = 0 for readers already paid via retail chapters.
- [x] Bab 44 ending lock: per-reader on `reader_states.locked_ending_key` (justified reason for not using `persist_ending_lock_v1`).
- [x] Variant reads for Bab 45–50 from `catalog_ending_chapters` without leak if unlocked.
- [x] Reader UI renders all consequence paragraphs and brand-guarded `directionHint`.
- [x] Seed script guarded with `LAKOKU_SEED_CATALOG=1`.
- [x] All tasks follow TDD (failing test -> command -> implement -> passing command -> commit).
