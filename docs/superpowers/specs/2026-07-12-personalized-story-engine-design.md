# Personalized Story Engine — Design Spec

**Date:** 2026-07-12
**Status:** Approved (with 12 mandatory revisions integrated)
**Revision:** v2 — 2026-07-12
**Scope:** Dual-track story engine (Personalized AI Story + Seed Premium)

---

## 0. Goal

Ubah engine Lakoku agar mendukung dua jalur cerita:

1. **Personalized AI Story** — cerita dibuat dari onboarding/taste user; 1 user = 1 story_id; pilihan user memengaruhi bab dan ending; 50 bab; dikontrol story contract + blueprint + plot debt + route_state + ending resolver.

2. **Seed Premium** — cerita premium sebagai template/canon awal; saat user mulai, buat private story instance; lanjut dengan personalized engine.

**Bukan:** full branching tree, `chapter_variants`, 3^50 cabang.

---

## 1. Architecture Model

```
stories              = story shell / story instance
chapters             = bab untuk story_id tertentu
reader_states        = progress user pada story_id tertentu
choice_outcomes      = pilihan + konsekuensi + nextChapterNumber + effect_json
story_generation_contracts = kontrak struktur 50 bab, ending, plot debt, route schema
route_state          = state pilihan user (in reader_states.route_state)
```

### Story ID Conventions

| Mode | ID Pattern | `source_story_id` |
|------|-----------|-------------------|
| `standard` | `demo:selasa-akhir` etc | `null` |
| `personalized_ai` | `ai:<uuid>` | `null` (unless from seed) |
| `premium_template` | `premium:bilik-ketujuh-v2` | `null` |
| `premium_instance` | `ai:premium:bilik-ketujuh-v2:<uuid>` | `premium:bilik-ketujuh-v2` |

---

## 2. Do Not Break

- `packages/contracts/src/reader.ts`
- `components/reader-view.tsx`
- `lib/api/client.ts`
- Credit/unlock system
- `publish_chapter` RPC (keep as-is, add v2)
- `generateChapter()` plan → write → Layer A → Layer B → repair
- `@lakoku/narrative-core` as canon validator
- `generateNextChapterReal()` for standard/demo stories

---

## 3. Database Migration

File: `supabase/migrations/20260712000000_personalized_story_engine.sql`

All changes are **additive**. No DROP, no destructive ALTER.

### 3.1 ALTER `stories`

```sql
alter table public.stories
  add column if not exists source_story_id text null,
  add column if not exists story_mode text not null default 'standard',
  add column if not exists generation_status text not null default 'idle',
  add column if not exists story_contract_version integer not null default 1;

-- story_mode constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stories_story_mode_check'
  ) then
    alter table public.stories
      add constraint stories_story_mode_check
      check (story_mode in ('standard', 'personalized_ai', 'premium_template', 'premium_instance'));
  end if;
end $$;

-- generation_status constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stories_generation_status_check'
  ) then
    alter table public.stories
      add constraint stories_generation_status_check
      check (generation_status in ('idle', 'creating_contract', 'generating_chapter', 'ready', 'failed', 'needs_review'));
  end if;
end $$;
```

### 3.2 ALTER `reader_states`

```sql
alter table public.reader_states
  add column if not exists route_state jsonb not null default '{}'::jsonb,
  add column if not exists choice_history jsonb not null default '[]'::jsonb,
  add column if not exists locked_ending_key text null;
```

### 3.3 ALTER `choice_outcomes`

```sql
alter table public.choice_outcomes
  add column if not exists effect_json jsonb not null default '{}'::jsonb,
  add column if not exists choice_kind text not null default 'normal';
```

### 3.4 CREATE `story_generation_contracts`

```sql
create table if not exists public.story_generation_contracts (
  story_id text primary key references public.stories(id) on delete cascade,
  mode text not null check (mode in ('personalized_ai', 'premium_template', 'premium_instance')),
  total_chapters integer not null default 50 check (total_chapters = 50),
  contract_source text not null default 'template_fallback'
    check (contract_source in ('llm', 'llm_repaired', 'template_fallback')),
  onboarding_json jsonb not null default '{}'::jsonb,
  story_contract_json jsonb not null default '{}'::jsonb,
  route_schema_json jsonb not null default '{}'::jsonb,
  plot_debts_json jsonb not null default '[]'::jsonb,
  ending_candidates_json jsonb not null default '[]'::jsonb,
  ending_lock_json jsonb null,
  quality_profile text not null default 'lakoku_mobile_drama_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 3.5 Indexes

```sql
create index if not exists stories_source_story_idx
  on public.stories(source_story_id);

create index if not exists stories_owner_mode_idx
  on public.stories(owner_user_id, story_mode, created_at desc);

create index if not exists choice_outcomes_effect_idx
  on public.choice_outcomes(story_id, chapter_number);
```

### 3.6 RLS — Core Tables (BLOCKER)

Private personalized stories without RLS = data leak. RLS policies are **mandatory** before enabling personalized stories.

**Defensive pattern:** All policy creation wrapped in DO blocks checking `pg_policies` to avoid failure if policy already exists (Dashboard-created tables may have pre-existing policies).

**Testing requirement:** Before deploying to production, verify:
- Explore can read public stories (anon + authenticated)
- Library user can read their private owned stories
- Server/admin (service_role) can insert/update all tables
- Private story of user A not readable by user B
- Private story not readable by anon

#### `stories`

```sql
alter table public.stories enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'stories' and policyname = 'stories_public_read') then
    create policy stories_public_read on public.stories
      for select to anon, authenticated
      using (visibility = 'public');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'stories' and policyname = 'stories_owner_read') then
    create policy stories_owner_read on public.stories
      for select to authenticated
      using (owner_user_id = auth.uid());
  end if;
end $$;

-- Insert/update only via service role (server-side)
-- No direct anon/authenticated insert/update policies
```

#### `chapters`

```sql
alter table public.chapters enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'chapters' and policyname = 'chapters_public_read') then
    create policy chapters_public_read on public.chapters
      for select to anon, authenticated
      using (
        exists (
          select 1 from public.stories s
          where s.id = chapters.story_id
          and s.visibility = 'public'
        )
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'chapters' and policyname = 'chapters_owner_read') then
    create policy chapters_owner_read on public.chapters
      for select to authenticated
      using (
        exists (
          select 1 from public.stories s
          where s.id = chapters.story_id
          and s.owner_user_id = auth.uid()
        )
      );
  end if;
end $$;

-- Insert/update only via service role
```

#### `choice_outcomes`

```sql
alter table public.choice_outcomes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'choice_outcomes' and policyname = 'choice_outcomes_public_read') then
    create policy choice_outcomes_public_read on public.choice_outcomes
      for select to anon, authenticated
      using (
        exists (
          select 1 from public.stories s
          where s.id = choice_outcomes.story_id
          and s.visibility = 'public'
        )
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'choice_outcomes' and policyname = 'choice_outcomes_owner_read') then
    create policy choice_outcomes_owner_read on public.choice_outcomes
      for select to authenticated
      using (
        exists (
          select 1 from public.stories s
          where s.id = choice_outcomes.story_id
          and s.owner_user_id = auth.uid()
        )
      );
  end if;
end $$;

-- Insert/update only via service role
```

**Important:** RLS cannot hide columns. API queries MUST use explicit column selection — never `select *`. Internal server queries use service role client to access `effect_json`.

#### `reader_states`

```sql
-- Already has RLS enabled via Dashboard (owner-only).
-- Defensive: create policy only if missing
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'reader_states' and policyname = 'reader_states_owner') then
    alter table public.reader_states enable row level security;
    create policy reader_states_owner on public.reader_states
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;
```

#### `story_generation_contracts`

```sql
alter table public.story_generation_contracts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'story_generation_contracts' and policyname = 'sgc_owner_read') then
    create policy sgc_owner_read on public.story_generation_contracts
      for select to authenticated
      using (
        exists (
          select 1 from public.stories s
          where s.id = story_generation_contracts.story_id
          and s.owner_user_id = auth.uid()
        )
      );
  end if;
end $$;

-- Write only via service role
```

### 3.7 `publish_chapter_v2` RPC

```sql
create or replace function public.publish_chapter_v2(
  p_story_id text,
  p_chapter_number int,
  p_title text,
  p_paragraphs text[],
  p_choice_prompt text,    -- NULL for chapter 50
  p_choices jsonb,         -- NULL or '[]' for chapter 50
  p_outcomes jsonb,        -- '[]' for chapter 50; includes effect_json + choice_kind per outcome otherwise
  p_lease_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- Same logic as publish_chapter but:
-- 1. p_choices and p_outcomes may be NULL/empty (chapter 50 final — no branching)
-- 2. When outcomes provided, insert choice_outcomes with effect_json and choice_kind columns
-- 3. Atomic: chapter + outcomes (if any) + event + lease release
-- 4. Idempotency via p_idempotency_key
-- 5. Returns {ok: true, chapter_number, seq} or {ok: false, reason: 'CHAPTER_EXISTS'}
$$;

-- Grant only to service_role, not anon
revoke execute on function public.publish_chapter_v2 from anon;
revoke execute on function public.publish_chapter_v2 from authenticated;
grant execute on function public.publish_chapter_v2 to service_role;
```

### 3.8 `clone_premium_story_instance` RPC

```sql
create or replace function public.clone_premium_story_instance(
  p_template_story_id text,
  p_user_id uuid,          -- MUST come from authenticated server context, never raw client input
  p_new_story_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- Validation:
-- 1. Verify p_template_story_id exists with story_mode = 'premium_template' AND visibility = 'public'
--    If not, return {ok: false, reason: 'INVALID_TEMPLATE'}
-- 2. Do NOT allow clone from private stories or non-template stories
--
-- Transactional clone (all-or-nothing):
-- 1. Copy stories row (new id, owner = p_user_id, private, premium_instance mode)
--    source_story_id = p_template_story_id
-- 2. Copy story_generation_contracts
-- 3. Copy characters, character_states, character_aliases, character_voice_sheets
-- 4. Copy facts_ledger, knowledge_scopes, secrets_reveals
-- 5. Copy story_threads, chapter_blueprints
-- 6. Copy act_rollups
-- 7. Optionally copy curated chapter 1
-- 8. Create reader_state
-- If ANY step fails, entire transaction rolls back → no CANON_MISSING partial state.
-- Returns {ok: true, story_id: p_new_story_id} or {ok: false, reason: ...}
$$;

revoke execute on function public.clone_premium_story_instance from anon;
revoke execute on function public.clone_premium_story_instance from authenticated;
grant execute on function public.clone_premium_story_instance to service_role;
```

---

## 4. Story Engine Modules

All under `lib/story-engine/`, pure functions, testable without DB.

### 4.1 `story-contract.ts`

```ts
export const StoryContractSchema = z.object({
  storyId: z.string(),
  totalChapters: z.literal(50),
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  styleProfile: z.literal('lakoku_mobile_drama_v1'),
  mainCharacter: z.object({
    name: z.string(),
    role: z.string(),
    wound: z.string(),
    desire: z.string(),
  }),
  mainConflict: z.string(),
  finalQuestion: z.string(),
  corePromise: z.string(),
  actPlan: z.array(z.object({
    actNumber: z.number(),
    fromChapter: z.number(),
    toChapter: z.number(),
    goal: z.string(),
  })),
  chapterTargets: z.array(z.object({
    chapterNumber: z.number(),
    phase: z.string(),
    goal: z.string(),
    mustInclude: z.array(z.string()),
    mustNotReveal: z.array(z.string()),
    emotionalTurn: z.string(),
    expectedThreadMovement: z.array(z.string()),
  })).length(50),
  // Fields stored in separate DB columns but validated as part of contract
  endingCandidates: z.array(z.object({
    key: z.string(),
    name: z.string(),
    condition: z.string(),
    requiredClosure: z.array(z.string()),
  })).min(2),
  plotDebts: z.array(z.object({
    id: z.string(),
    question: z.string(),
    introducedAt: z.number().int().min(1).max(50),
    mustProgressBy: z.array(z.number().int()),
    mustCloseBy: z.number().int().min(1).max(50),
    status: z.enum(['open', 'progressing', 'closed']),
  })).min(1),
  revealRunway: z.array(z.object({
    secretId: z.string(),
    revealGateChapter: z.number().int().min(1).max(50),
  })),
  closureRunway: z.object({
    noNewMajorConflictAfter: z.literal(35),
    noNewThreadAfter: z.literal(40),
    endingLockChapter: z.literal(45),
    mainMysteryResolveBy: z.literal(48),
    emotionalResolutionChapter: z.literal(49),
    finalEndingChapter: z.literal(50),
  }),
}).strict()
```

**Note:** `endingCandidates` and `plotDebts` are persisted in separate DB columns (`ending_candidates_json`, `plot_debts_json`) but validated together as part of the contract. `revealRunway` and `closureRunway` are stored inside `story_contract_json`. All fields are validated at contract creation time — no unvalidated important data.

**Contract generation (hybrid, via AI gateway):**

```
generateStoryContract(tasteJson, storyId) →
  1. Build prompt from taste_json
  2. Call AI gateway provider.generateStoryContract(input)
     - Uses existing gateway, same model routing/logging/cost tracking
     - Timeout: fast (30s max for LLM call)
  3. Parse with StoryContractSchema (full validation including endingCandidates, plotDebts)
  4. If invalid → 1 repair attempt ONLY (same repair pattern as chapter generation)
  5. If still fails OR timeout → mapTasteToTemplate(tasteJson, storyId)
  6. Track contract_source: "llm" | "llm_repaired" | "template_fallback"
  7. NEVER fail story creation because of contract generation failure
```

**Template fixtures (3):**
- `fixtures/contracts/misteri-drama.json` — 50 chapter targets, act plan, ending candidates
- `fixtures/contracts/romansa-drama.json`
- `fixtures/contracts/fantasi-petualangan.json`

Each fixture is a complete valid `StoryContractSchema` with all 50 chapterTargets, actPlan, endingCandidates, plotDebts, revealRunway, closureRunway.

Template customization from taste_json: character name, genre nuance, conflict type, tropes, setting — without breaking 50-chapter structure.

### 4.2 `route-state.ts`

```ts
export const RouteStateSchema = z.object({
  truth: z.number().int().min(0).max(20).default(0),
  trust: z.record(z.string(), z.number().int().min(-10).max(10)).default({}),
  risk: z.number().int().min(0).max(20).default(0),
  secrecy: z.number().int().min(0).max(20).default(0),
  empathy: z.number().int().min(0).max(20).default(0),
  evidence: z.array(z.string()).default([]),
  flags: z.record(z.string(), z.boolean()).default({}),
  endingBias: z.record(z.string(), z.number().int()).default({}),
}).strict()
```

Functions:
- `mergeChoiceEffect(routeState, effectJson)` — apply deltas, clamp scores, deduplicate evidence, validate flags as boolean
- `normalizeRouteState(routeState)` — clamp all values to bounds
- `summarizeRouteStateForPrompt(routeState)` — human-readable summary for AI context

Rules:
- All scores clamped to schema bounds
- Evidence array deduplicated
- Flags always boolean
- Never trust raw LLM output — always validate through schema

### 4.3 `plot-debt.ts`

Plot debt ledger format:
```json
[{
  "id": "main_mystery",
  "question": "Apa rahasia utama cerita?",
  "introducedAt": 1,
  "mustProgressBy": [6, 12, 20, 32, 40],
  "mustCloseBy": 48,
  "status": "open"
}]
```

Auditor rejection rules:
- Chapter 36+ opens major new mystery → REJECT
- Chapter 41+ opens any new thread → REJECT
- Chapter 45 ending not locked → REJECT
- Chapter 48 main mystery unresolved → REJECT
- Chapter 50 has open main conflicts → REJECT
- Chapter 50 opens new conflict → REJECT

### 4.4 `ending-resolver.ts`

```ts
resolveEnding({
  routeState,
  storyContract,
  chapterNumber,
}): {
  key: string
  name: string
  requiredClosure: string[]
}
```

Rules:
- Ending locked at chapter 45
- Chapter 45: last major choice
- Chapter 46–48: confrontation and conflict payoff
- Chapter 49: emotional resolution toward ending
- Chapter 50: final ending, NO choices
- Engine determines ending key; AI writes ending prose

Locked ending stored in:
- `reader_states.locked_ending_key`
- `story_generation_contracts.ending_lock_json`

### 4.5 `chapter-brief.ts`

```ts
buildChapterBrief({
  storyContract,
  snapshot,
  readerState,
  chapterNumber,
  previousChoice,
}): ChapterBrief
```

Output: `ChapterBriefSchema` with phase, goals, constraints, route summary, plot debts to progress/close, ending runway status.

Hard rules:
- Chapter 1–20: may open new conflicts
- Chapter 21–35: begin closing old conflicts
- Chapter 36–40: no major new conflicts
- Chapter 41+: no new threads
- Chapter 45: lock ending
- Chapter 46–48: pay main conflicts
- Chapter 49: emotional resolution
- Chapter 50: final ending, no new conflicts

Uses existing rules from `lib/narrative/template.ts` and `lib/narrative/threads.ts` — no contradictions.

### 4.6 `quality.ts`

Deterministic validators:
- Word count 800–1000
- No duplicate long paragraphs
- Max 1 consecutive abstract paragraph
- Min 3 dialog lines per chapter (drama/mystery genre)
- Chapter ending must have hook
- Choice labels specific to last 3 paragraphs
- No internal labels in choices
- No leaked words: prompt, token, model, LLM, provider, route

Mobile-readable validators:
- Short paragraphs
- Concrete conflict in first 150 words
- No excessive info dump
- No lengthy backstory exposition
- Choice labels are actions, not concepts

---

## 5. Dynamic Choice Generation

### 5.1 New Schemas (`lib/ai-gateway/schemas.ts`)

```ts
export const ChoiceEffectSchema = z.object({
  routeDeltas: z.record(z.string(), z.number().int()).default({}),
  trustDeltas: z.record(z.string(), z.number().int()).default({}),
  flagsSet: z.record(z.string(), z.boolean()).default({}),
  evidenceAdded: z.array(z.string()).default([]),
  endingBiasDeltas: z.record(z.string(), z.number().int()).default({}),
  threadTouches: z.array(z.string()).default([]),
}).strict()

export const ChoiceBranchSchema = z.object({
  choicePrompt: z.string().min(8).max(120),
  choices: z.array(z.object({
    id: z.string().min(1).max(50),
    label: z.string().min(8).max(90),
    hint: z.string().min(8).max(140).optional(),
  })).min(2).max(3),
  outcomes: z.array(z.object({
    choiceId: z.string().min(1).max(50),
    consequence: z.array(z.string().min(1).max(160)).min(1).max(2),
    nextChapterNumber: z.number().int().positive().nullable(),
    isEnding: z.boolean(),
    effect: ChoiceEffectSchema,
  })).min(2).max(3),
}).strict()
```

### 5.2 Provider Method

```ts
// Optional method on GenerationProvider
generateChoices?(input: ChoiceInput): Promise<unknown>
```

Uses existing AI gateway — same model routing, logging, cost tracking, retry pattern.

ChoiceInput contains:
- Canon snapshot
- Chapter brief
- Draft chapter text
- Last 3–5 paragraphs
- route_state
- choice_history
- ending lock (if any)

### 5.3 Validation Rules

- 2–3 choices
- All choice IDs unique
- All outcome choiceIds match a choice
- Labels must be concrete actions
- Labels must NOT contain: "rute", generic phrases
- Consequence must not spoil
- `effect_json` must pass `ChoiceEffectSchema`
- `nextChapterNumber = chapterNumber + 1` (except ending window)
- `isEnding = true` only allowed at chapter 49 (NOT 50 — chapter 50 has no choices)
- Chapter 49 choices: `isEnding = false` preferred (ending prose paid in chapter 50); `isEnding = true` allowed only for special bad endings
- **Chapter 50: skip choice generation entirely**

Banned generic labels:
- "Melangkah maju"
- "Menghadapi keadaan"
- "Menahan diri"
- "Mengikuti kata hati"
- "Mencari kebenaran"
- "Rute Kebenaran" / "Rute Kepatuhan" / "Rute Kabur"

Good labels example:
```
Buka lemari itu sebelum Marwah mendekat.
Sembunyikan kunci di balik sajadah ibu.
Pancing Marwah bicara seolah kau belum tahu apa-apa.
```

---

## 6. Generation Flows

### 6.1 Personalized Chapter Generation

```ts
generateNextPersonalizedChapter({
  storyId,
  userId,
  chapterNumber,
  triggerChoiceId,
})
```

Flow:
```
1.  acquireGenerationLease(storyId, chapterNumber)
2.  loadCanonSnapshot(storyId, chapterNumber)
3.  loadStoryGenerationContract(storyId)
4.  loadReaderState(userId, storyId)
5.  buildChapterBrief(contract, snapshot, readerState, chapterNumber, previousChoice)
6.  compileContext(snapshot, chapterNumber, {brief})
7.  generateChapter(context)  — existing: plan → write → Layer A → Layer B → repair
8.  assertConsumerSafe(draft)
9.  IF chapterNumber < 50:
      generateChoiceBranch(snapshot, brief, draft, routeState, choiceHistory)
      validateChoiceBranch(branch)
10. IF chapterNumber === 50:
      resolveEnding(routeState, contract, 50)
11. publishChapterV2(chapter, outcomes, effectJson)
12. IF chapterNumber === 50:
      markReaderStateSelesai(userId, storyId, endingName)
13. recordGenerationAttempt(telemetry)
```

`generateNextChapterReal()` remains for `standard`/demo stories. No forced migration.

### 6.2 Chapter 50 Ending Flow

```
Chapter 50 generated →
  skip generateChoiceBranch()
  publish chapter without choices/outcomes
  resolveEnding() → get ending key + name
  mark reader_state:
    status = SELESAI
    ending_name = resolved ending name
    locked_ending_key = ending key
  Reader UI shows final chapter without choice buttons
  UI displays non-choice CTA: "Kembali ke Library" / "Buat Cerita Baru"
```

### 6.3 Ending Timeline

```
Chapter 45: lock ending route (resolveEnding determines key)
Chapter 46–48: confrontation, conflict payoff
Chapter 49: emotional resolution; choices present but nextChapter=50, isEnding=false
Chapter 50: final ending prose; NO choices; mark SELESAI
```

---

## 7. Personalized Story Creation

### 7.1 Endpoint

```
POST /api/stories/personalized
```

Auth required. Idempotent via idempotency key.

### 7.2 Idempotency

**Preferred (if time permits):**
- Client sends `Idempotency-Key` header
- Server stores request key in `idempotency_keys` table (or inline check)
- If same key repeated, return existing story_id without re-creating
- Key format: `personalized:{userId}:{clientNonce}`

**MVP fallback (acceptable, noted as tech debt):**
- Before creating: check if user has a story with `generation_status = 'creating_contract'` created within last 5 minutes
- If found, return existing story_id
- Prevents double-click / timeout duplicates
- **TECH DEBT:** Replace with proper request key idempotency post-MVP

### 7.3 Flow

```
1.  Auth user
2.  Check idempotency (no recent creating story)
3.  Get taste_json from reader_taste_profiles
4.  Generate story_id: ai:<uuid>
5.  Insert stories:
      id, owner_user_id = user.id, visibility = private,
      story_mode = personalized_ai, generation_status = creating_contract,
      title/tagline/synopsis/tropes/cover, total_chapters = 50,
      current_chapter = 1, status = BARU
6.  Generate StoryContract (hybrid: LLM → repair → template fallback)
7.  Insert story_generation_contracts (with contract_source)
8.  Insert canon tables:
      characters, character_aliases, character_voice_sheets,
      facts_ledger, knowledge_scopes, secrets_reveals,
      story_threads, chapter_blueprints
9.  Insert reader_states:
      user_id, story_id, status = BERJALAN, current_chapter = 1,
      jejak = [], route_state = {}, choice_history = []
10. Update generation_status = generating_chapter
11. Generate Chapter 1 (via generateNextPersonalizedChapter)
12. Update generation_status = ready
13. Return { storyId, redirectUrl: /baca/<storyId>?bab=1 }
```

Canon MUST be populated before chapter generation. `generateNextChapterReal()` returns `CANON_MISSING` if blueprints/characters empty.

Only Chapter 1 generated at creation. Chapters 2+ generated on-demand after user choice.

---

## 8. Premium Template → Instance

### 8.1 Premium Template

```
story_id = premium:bilik-ketujuh-v2
story_mode = premium_template
visibility = public
owner_user_id = null
```

Contains: metadata, canon, character voice, facts, secrets, story_threads, chapter_blueprints 1–50, optional curated Chapter 1 as preview.

### 8.2 Premium Instance Creation

When user clicks "Mulai Cerita":

```
1.  Auth user
2.  Check idempotency
3.  Generate story_id: ai:premium:bilik-ketujuh-v2:<uuid>
4.  Call clone_premium_story_instance RPC (TRANSACTIONAL):
      - Copy stories row (new id, owner, private, premium_instance)
      - source_story_id = premium:bilik-ketujuh-v2
      - Copy story_generation_contracts
      - Copy all canon tables
      - Copy chapter_blueprints
      - Create reader_state
      - Copy curated Chapter 1 (if exists)
5.  If clone fails → rollback, return error
6.  If no curated Chapter 1 → generate Chapter 1
7.  Proceed with personalized engine for all subsequent chapters
```

### 8.3 `source_story_id` Rules

| Mode | `source_story_id` |
|------|-------------------|
| `standard` | `null` |
| `personalized_ai` | `null` (unless from seed) |
| `premium_template` | `null` |
| `premium_instance` | `<template_story_id>` (required) |

Enforced in service layer, not SQL constraint.

---

## 9. Choice Endpoint Update

### 9.1 `POST /api/stories/[id]/choices` — New Flow

```
1.  Parse request (chapterNumber, choiceId)
2.  Auth: if story is private/personalized → require authenticated user
3.  Load outcome (service role client):
      - Public fields: consequence, next_chapter_number, is_ending
      - Internal: effect_json
4.  Validate user can read this story
5.  Merge effect_json → reader_states.route_state (via mergeChoiceEffect)
6.  Append to choice_history (summary format, not raw effect_json):
      { chapterNumber, choiceId, label, consequence, effectSummary, createdAt }
7.  Append jejak (reader-safe, as before)
8.  Compute nextChapterNumber
9.  If nextChapterNumber null:
      - Resolve ending
      - Set status = SELESAI
      - Return outcome (reader-safe)
10. If personalized/premium_instance:
      - Trigger generateNextPersonalizedChapter (async)
      - Sync wait max 25 seconds
      - If ready in time: return { outcome, nextChapterReady: true }
      - If not: return { outcome, nextChapterReady: false }
11. Return public outcome WITHOUT: effect_json, route_state, choice_history
```

### 9.2 Chapter Status Polling

New lightweight endpoint:

```
GET /api/stories/[id]/chapters/[chapterNumber]/status
```

Response:
```json
{
  "status": "ready" | "generating" | "failed",
  "chapterNumber": 2
}
```

**Status resolution logic** (NOT just `stories.generation_status`):
1. Check if chapter row exists in `chapters` table → `"ready"`
2. Check if active generation lease exists for this story+chapter → `"generating"`
3. Check if failed generation attempt exists → `"failed"`
4. Otherwise → `"generating"` (triggered but lease not yet acquired)

`stories.generation_status` is a surface-level indicator for UI convenience. Per-chapter truth comes from chapter existence + lease/attempt state.

Client polls this when `nextChapterReady = false`. No long sync waits.

### 9.3 Internal Fields — NEVER Sent to Client

These fields are strictly server-internal:
- `effect_json`
- `route_state`
- `choice_history`
- `story_contract_json`
- `plot_debts_json`
- `ending_candidates_json`
- `ending_lock_json`

API queries use explicit column selection. No `select *` on any reader-facing endpoint.

### 9.4 `choice_history` vs `jejak`

Both maintained separately:

| Field | Purpose | Audience |
|-------|---------|----------|
| `jejak` | Reader-facing recap | User (UI) |
| `choice_history` | Structured AI context | Server/AI only |

`choice_history` entry format:
```json
{
  "chapterNumber": 1,
  "choiceId": "sembunyikan_kunci",
  "label": "Sembunyikan kunci di balik sajadah ibu",
  "consequence": ["..."],
  "effectSummary": {
    "truth": 1,
    "secrecy": 2,
    "flagsSet": ["took_black_key"]
  },
  "createdAt": "..."
}
```

---

## 10. Query Updates

### 10.1 `queryStoriesByIdsForUser(storyIds, userId)`

New function in `lib/api/queries.ts` or `lib/api/owned-queries.ts`.

Uses cookie Supabase client or admin client + filter. Returns stories where:
- `visibility = 'public'`, OR
- `owner_user_id = userId`

### 10.2 Server Query Updates

- `listExploreStories()` — only official demo / premium template public. No personalized private stories.
- `listMyLibraryStories()` — uses `queryStoriesByIdsForUser` for owned/private stories from `reader_states`.
- `getStory(id)` — allows: public template/demo; private story if `owner_user_id = current user`; rejects private story of other users.

No reliance on anon `queryStories()` for personal library.

---

## 11. Tests

### 11.1 Unit Tests (Vitest)

```
tests/story-engine/route-state.test.ts
tests/story-engine/choice-branch.test.ts
tests/story-engine/ending-resolver.test.ts
tests/runtime/personalized-generation.test.ts
```

Required test cases:
1. `mergeChoiceEffect()` clamps scores, no duplicate evidence
2. `ChoiceBranchSchema` rejects generic labels
3. Choice outcome without matching choice id rejected
4. Chapter 45 locks ending
5. Chapter 48 rejected if main mystery unresolved
6. Personalized story A and B have different chapters (different story_ids)
7. Private personalized story not in Explore
8. Premium template can be cloned to premium instance
9. `/api/stories/[id]/choices` does not send `effect_json` to client
10. Reader can render `hint`

### 11.2 RLS/Privacy Tests (NEW)

1. User A cannot read private story of User B
2. Anon cannot read personalized story
3. Public can read premium template public
4. API reader does not send `effect_json`
5. API reader does not send `route_state`
6. `choice_outcomes` internal readable by server for route effect merge
7. `listExploreStories()` excludes personalized private stories
8. `listMyLibraryStories()` includes private stories owned by user

### 11.3 Smoke Script

```
scripts/personalized-story-smoke.ts
```

Static checks:
- Migration file exists
- `buildChoices()` hardcoded not used for real personalized generation
- `generateChoiceBranch()` exists
- `effect_json` not in public contract
- `reader_states.route_state` used during personalized generation
- `story_mode = premium_template` not published as private user instance
- `premium_instance` has `source_story_id`
- Internal fields not in API response shapes
- **No `select('*')` in reader-facing query code** — grep for `select('*')` in `lib/api/queries.ts`, `lib/api/server.ts`, and API route files
- **No internal field names in response types** — grep reader contract and API route responses for: `effect_json`, `route_state`, `choice_history`, `story_contract_json`, `plot_debts_json`, `ending_candidates_json`, `ending_lock_json`

Package script:
```json
"smoke:personalized-story": "tsx scripts/personalized-story-smoke.ts"
```

---

## 12. Gate

```
pnpm typecheck
pnpm test:unit
pnpm smoke:personalized-story
```

Plus existing smoke if any.

Final output must include:
- Files changed
- Migration created
- Flow changes summary
- Gate results
- Example generated choices for one chapter
- Example route_state after user choice
- Proof `effect_json` not in client response
- Proof personalized story A and B don't overwrite each other's chapters

---

## 13. Implementation Phase Order

**Start from DB/RLS/query ownership. Do not start from AI prompts.**

| Phase | Scope | Depends On |
|-------|-------|------------|
| **Phase 1** | Migration additive + RLS + query ownership | — |
| **Phase 2** | Story-engine pure modules + unit tests | — |
| **Phase 3** | Dynamic choice generation + `publish_chapter_v2` | Phase 1, 2 |
| **Phase 4** | Personalized story creation endpoint | Phase 1, 2, 3 |
| **Phase 5** | Choice endpoint update + async generation/status polling | Phase 3, 4 |
| **Phase 6** | Premium template clone | Phase 1, 4 |
| **Phase 7** | Smoke tests + privacy tests + gate | Phase 1–6 |

Phase 1 and 2 can run in parallel. Phase 3+ sequential.

---

## 14. Explicit Prohibitions

- No full branching tree
- No `chapter_variants`
- No `route_state` sent to client
- No `effect_json` sent to client
- No AI-determined final ending without resolver
- No modifying `ChapterDraftSchema` for choices
- No removing Layer A/B validators
- No destructive migration
- No publishing personal chapters to premium template
- No showing private stories in Explore
- No `select *` on reader-facing queries
- No bypassing AI gateway for contract generation
- No RPC callable by anon for publish/clone operations
- No `ChoiceBranchSchema` validation for chapter 50 (no choices)
- No trusting raw client `user_id` in clone RPC — always from authenticated server context
