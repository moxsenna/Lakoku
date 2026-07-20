# Baseline Choice Route Generation (Phase 0)

Commit baseline: `4c9040e879dc2684e5f9abc33b549c0879f0c547`
Branch: `feature/choice-route-generation-v2`
Date: 2026-07-21

## Ringkasan

Dokumen ini mendokumentasikan **perilaku buggy** pada jalur generasi standard (`lib/runtime/story-generation.ts`) yang menjadi target perbaikan di Phase 1-5. Jalur personalized (`lib/runtime/personalized-generation.ts`) sudah memiliki perilaku yang benar dan menjadi referensi.

---

## Key Files

| File | Role |
|---|---|
| `lib/runtime/story-generation.ts` | Standard generation flow (buggy) |
| `lib/runtime/personalized-generation.ts` | Personalized flow (correct, reference) |
| `lib/runtime/lifecycle.ts` | Publish adapters (legacy `publishChapter`, v2 `publishChapterV2`) |
| `lib/story-engine/route-state.ts` | Route state types and normalization |
| `lib/narrative/template.ts` | `TOTAL_CHAPTERS = 50` |

---

## Current buggy behaviors (5 confirmed)

### B1: Provider choice failure yields generic hard-coded fallback and can be published

**Lokasi**: `story-generation.ts:265-268`

```typescript
} catch {
    console.log('GENERATION_CHOICES_FALLBACK_USED')
    return fallbackChoicesFromDraft(draft, chapterNumber)
}
```

`buildChoices` menyembunyikan kegagalan provider. Ketika `generateChoiceBranch` throw, caller (`generateNextChapterReal`) tetap menerima hasil `fallbackChoicesFromDraft` dengan label:
- 'Hadapi langsung apa yang baru terbuka'
- 'Selidiki dulu jejak yang tersisa'

Tidak ada `ok: false` atau `reason`. Caller tidak bisa membedakan fallback dari real LLM result. Chapter kemudian dipublikasi dengan generic choices.

**Personalized flow** (sebagai referensi): `generateNextPersonalizedChapter:615-617` melempar error `Choice branch missing for chapter ${chapterNumber}` jika branch null — tidak ada fallback.

### B2: `mapBranchToPublishOutcomes` drops `effect`

**Lokasi**: `story-generation.ts:169-178`

```typescript
function mapBranchToPublishOutcomes(branch: ChoiceBranch): PublishOutcome[] {
  return branch.outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
  }))
}
```

Hanya 4 field yang dimapping. `effect` dan `choiceKind` dibuang. Hasilnya digunakan oleh `publishChapter` (legacy) yang tidak menerima effect. Route state delta, trust delta, evidence, dsb. hilang.

**Personalized flow**: `mapBranchToV2Outcomes` (lines 234-248) mempertahankan semua field termasuk `effect` dan `choiceKind`.

### B3: Chapter 50 mendapat fallback choices

**Lokasi**: `story-generation.ts:233-234`

```typescript
if (chapterNumber >= TOTAL_CHAPTERS) {
    return fallbackChoicesFromDraft(draft, chapterNumber)
}
```

Chapter 50 (TOTAL_CHAPTERS) dicek dengan `>=` dan langsung mengembalikan fallback hard-coded — bukan null/empty. Akibatnya chapter 50 memiliki "choice" (hadapi/selidiki) yang tidak seharusnya.

**Personalized flow**: `generateNextPersonalizedChapter:597` mengecek `chapterNumber < TOTAL_PERSONALIZED_CHAPTERS` — chapter 50 tidak melibatkan `generateChoiceBranch` sama sekali.

### B4: `buildChoices` menggunakan `routeState` kosong, `choiceHistory` kosong, `lockedEndingKey` null

**Lokasi**: `story-generation.ts:246-248`

```typescript
routeState: normalizeRouteState({}),
choiceHistory: [],
lockedEndingKey: null,
```

Standard flow tidak pernah membaca reader state sebenarnya. Semua input route state di-hardcode ke default kosong. LLM choice generator tidak memiliki konteks rute atau history pilihan.

**Personalized flow**: membaca `reader.route_state`, `reader.choice_history`, `reader.locked_ending_key` dari database lalu meneruskannya ke `generateChoiceBranch`.

### B5: Choices tidak divalidasi terhadap final repaired paragraphs

**Lokasi**: `story-generation.ts:443-459`

Setelah `buildChoices`, hanya `scanForLeaks` yang dijalankan — memeriksa kebocoran istilah internal (prompt/model/RAG). Tidak ada validasi bahwa choicePrompt dan consequence secara semantik konsisten dengan final `draft.paragraphs` (setelah repair). Jika writer repair ulang bab ke versi berbeda, choice mungkin tidak cocok dengan prosa final.

---

## Code trace: correlationId/storyId/chapterNumber flow

Flow `generateNextChapterReal` (standard):

```
Input (correlationId, storyId, userId, chapterNumber)
  |
  v
createSynchronousProviderContext(correlationId) → providerContext
  |
  v
ACQUIRE_LEASE → lease
  |
  v
LOAD_CANON → snapshot
  |
  v
COMPILE_CONTEXT → packet
  |
  v
GENERATE_PROSE → result (generateChapter)
  |               telemetryContext: providerContext
  |               workflowPhase: 'CHAPTER_PROSE_INITIAL'
  v
VALIDATE_PROSE → draft (if PUBLISHED)
  |
  v
CONSUMER_SAFE → readerSafe (toReaderSafe + assertConsumerSafe)
  |
  v
BUILD_CHOICES → buildChoices(snapshot, draft, chapterNumber, providerContext)
  |              telemetryContext: providerContext
  |              workflowPhase: 'CHOICES_INITIAL'
  |              routeState: {} (empty), choiceHistory: [], lockedEndingKey: null
  v
VALIDATE_CHOICES → scanForLeaks only (no prose-consistency check)
  |
  v
PUBLISH_CHAPTER → publishChapter (legacy: no effect field)
  |
  v
RECORD_TERMINAL_ATTEMPT → recordGenerationAttempt
```

### Key observations:

1. `correlationId` mengalir ke `providerContext` → `selectProvider(providerContext)` → `generateChoiceBranch()` options → telemetry.
2. `correlationId` tidak memengaruhi content generasi — hanya telemetry.
3. `storyId` dan `chapterNumber` mengalir ke `loadCanonSnapshot`, `compileContext`, `generateChapter`, `buildChoices`, `publishChapter`.
4. `workflowPhase` di-hardcode: `'CHAPTER_PROSE_INITIAL'` dan `'CHOICES_INITIAL'`.
5. Log `GENERATION_CHOICES_FALLBACK_USED` muncul via `console.log` (bukan structured log) di catch block `buildChoices`.
6. Chapter/outcomes mapping: `mapBranchToPublishOutcomes` → `publishChapter` (legacy, no effect).

---

## Evidence: screenshots would show generic fallback

Pada kondisi di mana provider gagal:

1. `buildChoices` mengembalikan fallback dengan label:
   - "Hadapi langsung apa yang baru terbuka"
   - "Selidiki dulu jejak yang tersisa"
2. `generateNextChapterReal` **tidak tahu** ini fallback — melanjutkan ke publish.
3. UI reader akan menampilkan dua tombol dengan teks hard-coded tersebut **tanpa ada indikasi error**.
4. Tidak ada effect/route delta yang terjadi karena field ini tidak masuk ke publish.

---

## Test coverage

File: `tests/runtime/choice-generation-baseline.test.ts`

### Characterization tests (11, all PASS)
- `fallbackChoicesFromDraft` — hard-coded labels, ending scenario, no effect/choiceKind
- `mapBranchToPublishOutcomes` — drops effect, only maps 4 fields
- `buildChoices` — empty routeState, chapter 50 fallback, GENERATION_CHOICES_FALLBACK_USED log, null branch fallback
- `syntheticChapterBrief` — empty summaries, null lockedEndingKey

### Desired-behavior TDD tests (6, all `it.fails` — RED)
- Effect preservation in outcomes
- choiceKind field
- No silent fallback on provider failure
- Chapter 50 no choices
- Route state pass-through
- Cross-flow parity with personalized

### Cross-flow comparison (1 PASS + 1 `it.fails`)
- Personalized correctly preserves effect (PASS)
- Standard should match personalized (it.fails — RED)

---

## Phase 0 exit criteria checklist

- [x] Document baseline evidence why screenshots would show generic fallback
- [x] At least one RED test reproducing main problem (6 it.fails tests)
- [x] NO production behavior changes (only tests + docs + test-only exports)
- [x] Characterization tests PASS, documenting current buggy behavior
- [x] TDD desired-behavior tests RED (it.fails)
