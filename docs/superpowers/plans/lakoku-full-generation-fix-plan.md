# Lakoku — Full Fix Plan: Chapter & Choice Generation Reliability

**Status:** implementation-ready  
**Target:** branch `main` repository Lakoku  
**Tanggal audit:** 24 Juli 2026  
**Runtime produksi:** VPS, Next.js standalone, Docker `lakoku-web`, Supabase linked  
**Fokus:** memperbaiki seluruh temuan pada generasi bab, generasi pilihan, migration, retry, status, dan observability tanpa menurunkan konsistensi naratif.

---

## 1. Ringkasan masalah

Kondisi saat ini memungkinkan alur berikut:

```text
prosa bab selesai dan valid
→ choice provider timeout / invalid response
→ repair mengulang pola yang sama
→ seluruh workflow dianggap gagal
→ prosa dibuang
→ chapter tidak dipublikasikan
→ pengguna melihat “Bab belum berhasil disiapkan”
```

Masalah tidak hanya berasal dari provider. Repo memiliki beberapa kelemahan sistemik:

1. Prompt choices memakai pseudo-JSON kompleks yang bukan contoh JSON valid.
2. Model diminta membuat field kreatif sekaligus field mekanis dan state delta.
3. Choices memakai `streamText()` lalu parsing JSON manual.
4. Timeout choices 60 detik, SDK retry 0.
5. Repair default bukan repair struktural; finding code dimasukkan ke `mustNotInclude`.
6. Kegagalan choices menggagalkan bab yang prosanya sudah valid.
7. Belum ada gate concurrency khusus choices.
8. Route choices dapat mengikuti model prosa, padahal karakter tugas berbeda.
9. Fallback creative direction dapat menimpa generation contract dengan `{}`.
10. Ada dua migration dengan prefix versi `20260722090000`.
11. Retry chapter selalu menjalankan standard generator.
12. Beberapa operasi observability yang disebut best-effort masih dapat menggagalkan workflow.
13. Failure tertentu dapat dicatat dua kali dengan kode berbeda.
14. Status polling belum attempt-aware sehingga failure lama dapat terbaca sebagai hasil retry baru.
15. Belum ada durable checkpoint `PROSE_READY`; retry choices dapat memaksa generasi ulang prosa.

---

## 2. Sasaran akhir

Pipeline target:

```text
request generation
→ buat durable attempt
→ resolve generation mode
→ acquire capacity + lease
→ load contract/canon/direction
→ generate dan validate prose
→ simpan PROSE_READY checkpoint
→ enqueue / jalankan choice-only stage
→ validate / repair choices
→ server menyusun field mekanis
→ publish chapter + choices + outcomes secara atomik
→ terminal attempt PUBLISHED
→ status reader ready
```

Saat choices gagal:

```text
PROSE_READY
→ CHOICES_RETRY_WAIT
→ retry hanya choices
→ fallback provider lintas infrastruktur
→ publish setelah choices valid
```

**Prosa tidak boleh dihasilkan ulang hanya karena choices gagal.**

---

## 3. Non-negotiable constraints

Agen wajib membaca sebelum mengubah kode:

- `AGENT_RULES.md`
- `docs/VPS_DEPLOY.md`
- `docs/ARCHITECTURE_v1.1.md`
- `docs/NARRATIVE_CONSISTENCY_SPEC.md`
- `docs/NARRATIVE_TRACEABILITY_MATRIX.md`
- `docs/PROGRESS_CHECKLIST.md`
- `package.json`

Larangan:

- Jangan menghapus validator.
- Jangan menonaktifkan consumer-safety atau leak scan.
- Jangan mem-publish fallback generik hard-coded.
- Jangan melakukan direct insert chapter sebagai bypass RPC atomik.
- Jangan menurunkan aturan 50 bab atau reveal gate.
- Jangan menampilkan provider, prompt, model, token, validator, database, atau correlation ID kepada pembaca.
- Jangan log prompt, raw prose, raw provider output, secret, cookie, email, atau service-role key.
- Jangan menganggap deployment Cloudflare/Vercel.
- Jangan menjalankan production migration tanpa dry-run dan persetujuan eksplisit.
- Jangan mengubah migration historis yang mungkin sudah diterapkan tanpa rekonsiliasi.
- Jangan menyatakan fixed hanya karena satu smoke berhasil.

---

# BAGIAN A — BASELINE DAN PEMBUKTIAN

## 4. Fase 0 — Characterization dan failing regression tests

Sebelum mengubah implementasi, buat test yang membuktikan perilaku lama.

### 4.1 Snapshot branch

Catat:

```bash
git rev-parse HEAD
git log -1 --oneline
pnpm --version
node --version
```

### 4.2 Test reproduksi wajib

Buat failing tests untuk:

1. Prompt choices tidak menyediakan contoh JSON valid yang dapat diparse.
2. Choice provider mendapat kontrak nested penuh.
3. Timeout provider menghasilkan `CHOICE_GENERATION_FAILED`.
4. Prosa valid tidak dipertahankan ketika choices gagal.
5. Repair provider error memasukkan `PROVIDER_ERROR` ke `mustNotInclude`.
6. `persistStoryCreativeDirection()` dapat meng-upsert contract kosong.
7. Dua migration mempunyai version prefix identik.
8. `startOwnedChapterGeneration()` tidak melakukan mode dispatch.
9. `persistRetrievalLog()` failure menggagalkan generation.
10. Post-publish `recordGenerationAttempt()` failure membuat fungsi melempar.
11. Choice leak dicatat sebagai specific failure lalu outer catch mencatat unknown failure.
12. Retry baru dapat membaca exact failure lama sebelum lease baru terbentuk.

### 4.3 Test file yang disarankan

```text
tests/ai-gateway/choice-prompt-contract.test.ts
tests/ai-gateway/choice-structured-output.test.ts
tests/runtime/choice-generation-repair.test.ts
tests/runtime/choice-checkpoint.test.ts
tests/runtime/story-generation-observability.test.ts
tests/runtime/generation-mode-dispatch.test.ts
tests/authoring/persist-creative-direction.test.ts
tests/api/chapter-attempt-status.test.ts
tests/db/migration-version-uniqueness.test.ts
```

### 4.4 Exit criteria

- Test benar-benar gagal pada kode sebelum fix.
- Failure message menunjukkan bug yang dimaksud.
- Tidak ada test palsu yang hanya menguji mock tanpa melewati fungsi produksi.

---

# BAGIAN B — DATABASE DAN DATA SAFETY

## 5. Fase 1 — Hentikan fallback creative direction yang destruktif

### 5.1 Bug sekarang

`persistStoryCreativeDirection()` mencoba dedicated table. Bila gagal, ia melakukan upsert ke `story_generation_contracts` dengan:

```ts
story_contract_json: {},
route_schema_json: {},
plot_debts_json: [],
ending_candidates_json: [],
```

Karena `onConflict: 'story_id'`, row contract valid dapat tertimpa data kosong.

### 5.2 Perubahan wajib

Hapus seluruh fallback yang menulis generation contract kosong.

Kontrak baru:

```ts
type PersistCreativeDirectionResult =
  | {
      ok: true
      fingerprint: string
      storage: 'story_creative_directions'
    }
  | {
      ok: false
      error:
        | 'INVALID_DIRECTION'
        | 'TABLE_UNAVAILABLE'
        | 'WRITE_FAILED'
    }
```

Implementasi:

```ts
export async function persistStoryCreativeDirection(args: ...):
  Promise<PersistCreativeDirectionResult> {
  const parsed = StoryCreativeDirectionSchema.safeParse(args.direction)
  if (!parsed.success) {
    return { ok: false, error: 'INVALID_DIRECTION' }
  }

  const result = await db
    .from('story_creative_directions')
    .upsert(...)

  if (result.error) {
    logSafeCreativeDirectionFailure(...)
    return {
      ok: false,
      error: isMissingRelation(result.error)
        ? 'TABLE_UNAVAILABLE'
        : 'WRITE_FAILED',
    }
  }

  return {
    ok: true,
    fingerprint,
    storage: 'story_creative_directions',
  }
}
```

### 5.3 Lock semantics

Saat feature `story_creative_direction_v1` aktif:

- gagal menyimpan direction harus menggagalkan final lock;
- jangan membuat story terlihat siap bila direction snapshot belum tersimpan;
- idealnya story bible + creative direction disimpan melalui satu RPC transaksional.

Saat feature flag tidak aktif:

- direction boleh diabaikan secara eksplisit;
- jangan mencoba fallback tersembunyi.

### 5.4 RPC atomik yang disarankan

Audit RPC authoring lock yang sudah ada. Bila tidak dapat diperluas dengan aman, buat RPC baru:

```text
lock_authoring_story_v2(
  p_story_id,
  p_owner_user_id,
  p_bible_payload,
  p_creative_direction_json,
  p_creative_direction_fingerprint,
  p_prompt_contract_version
)
```

Dalam satu transaksi:

1. validasi owner;
2. validasi story shell;
3. replace/lock story bible;
4. upsert creative direction;
5. commit;
6. rollback semuanya bila salah satu gagal.

### 5.5 Data audit production

Sediakan script read-only:

```sql
select
  story_id,
  mode,
  contract_source,
  jsonb_object_length(coalesce(story_contract_json, '{}'::jsonb)) as contract_keys,
  jsonb_object_length(coalesce(route_schema_json, '{}'::jsonb)) as route_keys,
  jsonb_array_length(coalesce(plot_debts_json, '[]'::jsonb)) as plot_debts,
  updated_at
from story_generation_contracts
where
  coalesce(story_contract_json, '{}'::jsonb) = '{}'::jsonb
  or coalesce(route_schema_json, '{}'::jsonb) = '{}'::jsonb;
```

Klasifikasikan:

- row memang legacy/placeholder;
- row rusak karena fallback;
- row masih dapat dibangun ulang dari locked bible/canon;
- row tidak dapat dipulihkan otomatis.

### 5.6 Repair data

Jangan menebak isi contract.

Urutan recovery:

1. rebuild dari canonical authoring story bible;
2. rebuild dari persisted story contract source;
3. rebuild dari deterministic template hanya bila seluruh input sumber tersedia;
4. bila sumber tidak cukup, tandai `NEEDS_REAUTHORING`;
5. jangan mengisi `{}` agar parser “tidak error”.

---

## 6. Fase 2 — Rekonsiliasi duplicate migration version

### 6.1 Bug sekarang

Terdapat:

```text
20260722090000_align_choices_and_runtime_policy.sql
20260722090000_story_creative_directions.sql
```

Supabase memakai timestamp prefix sebagai migration version.

### 6.2 Jangan langsung rename

Jangan rename file historis sebelum mengetahui:

- mana yang sudah tercatat di local;
- mana yang sudah tercatat di linked production;
- isi checksum masing-masing;
- tabel dan route mana yang benar-benar ada.

### 6.3 Langkah rekonsiliasi

Jalankan:

```bash
pnpm exec supabase migration list --local
pnpm exec supabase migration list --linked
```

Periksa production:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
where version = '20260722090000';
```

Periksa objek:

```sql
select to_regclass('public.story_creative_directions');

select
  use_case,
  provider,
  model_id,
  fallback_models,
  timeout_ms,
  max_output_tokens,
  temperature,
  reasoning_effort
from ai_model_routes
where use_case in ('chapter_prose', 'choices');
```

### 6.4 Migration repair baru

Buat migration **baru dan unik**, contoh:

```text
20260724100000_reconcile_choice_routes_and_creative_direction.sql
```

Sifat:

- idempotent;
- `create table if not exists`;
- `alter table ... add column if not exists`;
- memastikan index/RLS/policy;
- tidak drop data;
- tidak menimpa generation contract;
- mengatur route choices secara eksplisit;
- mencatat version baru.

### 6.5 Guard otomatis

Tambahkan script:

```text
scripts/check-migration-version-uniqueness.ts
```

Algoritme:

1. baca `supabase/migrations/*.sql`;
2. ambil prefix 14 digit;
3. group berdasarkan prefix;
4. fail bila ada duplikat.

Tambahkan ke:

```json
{
  "scripts": {
    "check:migration-versions": "node scripts/run-smoke.cjs scripts/check-migration-version-uniqueness.ts"
  }
}
```

Jalankan di CI dan `pnpm test`.

---

# BAGIAN C — CHOICE PROTOCOL V2

## 7. Fase 3 — Sederhanakan kontrak output AI

### 7.1 Prinsip

AI hanya membuat keputusan kreatif. Server membuat field mekanis.

### 7.2 Schema AI baru

```ts
export const AiChoiceDraftSchema = z.object({
  question: z.string().trim().min(8).max(120),

  actions: z.array(
    z.object({
      label: z.string().trim().min(8).max(90),
      hint: z.string().trim().min(8).max(140).optional(),
      consequence: z.string().trim().min(1).max(180),

      intent: z.enum([
        'investigate',
        'confront',
        'protect',
        'escape',
        'trust',
        'deceive',
        'negotiate',
        'sacrifice',
      ]),

      targetCharacterId: z.string().min(1).max(80).nullable(),
      targetThreadId: z.string().min(1).max(120).nullable(),

      emotionalBias: z.enum([
        'truth',
        'risk',
        'secrecy',
        'empathy',
        'neutral',
      ]),
    }),
  ).length(2),
})
```

Mulai dengan tepat **dua** pilihan untuk reliabilitas. Dukungan tiga pilihan dapat dibuka kembali setelah soak.

### 7.3 Field yang tidak lagi dibuat model

Server wajib membuat:

```text
choices[].id
outcomes[].choiceId
outcomes[].nextChapterNumber
outcomes[].isEnding
effect.routeDeltas
effect.trustDeltas
effect.flagsSet
effect.evidenceAdded
effect.endingBiasDeltas
effect.threadTouches
```

### 7.4 Finalizer deterministik

Buat:

```ts
finalizeAiChoiceDraft({
  aiDraft,
  chapterNumber,
  totalChapters,
  activeCharacters,
  activeThreads,
  routeState,
  lockedEndingKey,
}): ChoiceBranch
```

Contoh:

```ts
function choiceId(chapter: number, index: number): string {
  return `chapter-${chapter}-choice-${index + 1}`
}
```

Aturan:

- bab 1–48 → `nextChapterNumber = chapter + 1`;
- bab 49 normal → `nextChapterNumber = 50`;
- bab 49 special ending hanya melalui deterministic policy, bukan keputusan model bebas;
- bab 50 → tanpa choices;
- `choiceId` selalu cocok;
- target character/thread harus ada dalam allowlist;
- unknown target diubah `null` atau ditolak sesuai finding;
- effect diturunkan dari intent + target + route policy;
- clamp seluruh delta.

### 7.5 Mapping intent → bounded effects

Contoh awal:

```ts
const INTENT_EFFECTS = {
  investigate: {
    routeDeltas: { truth: 4, risk: 1, secrecy: -1 },
  },
  confront: {
    routeDeltas: { truth: 2, risk: 4, empathy: -1 },
  },
  protect: {
    routeDeltas: { empathy: 4, risk: 2 },
  },
  escape: {
    routeDeltas: { risk: -2, secrecy: 2 },
  },
  trust: {
    routeDeltas: { empathy: 3, secrecy: -2 },
  },
  deceive: {
    routeDeltas: { secrecy: 4, empathy: -2 },
  },
  negotiate: {
    routeDeltas: { empathy: 2, truth: 1 },
  },
  sacrifice: {
    routeDeltas: { empathy: 4, risk: 4 },
  },
} satisfies ...
```

Mapping harus:

- deterministic;
- bounded;
- diuji;
- tidak mengubah canon;
- tidak memasukkan evidence faktual yang belum ada;
- thread touch hanya dari target thread valid.

### 7.6 Backward compatibility

Pertahankan parser legacy sementara:

```ts
type ChoiceProtocolVersion = 'v1_full_branch' | 'v2_creative_draft'
```

Route/config menentukan protocol.

Rollout:

1. generate V2;
2. finalizer menghasilkan existing `ChoiceBranch`;
3. publish RPC tetap menerima contract lama;
4. tidak perlu mengubah reader contract.

---

## 8. Fase 4 — Perbaiki prompt choices

### 8.1 Hapus pseudo-schema

Hapus blok seperti:

```text
"nextChapterNumber": <integer|null>
```

Itu bukan JSON valid dan memberi terlalu banyak kebebasan.

### 8.2 Prompt baru

System prompt:

```text
Kamu menyusun dua tindakan pembaca berdasarkan akhir bab yang diberikan.

Balas hanya satu objek JSON valid.
Jangan gunakan markdown atau komentar.
Jangan membuat ID, nomor bab, state delta, atau metadata sistem.
Gunakan hanya karakter dan konflik yang tersedia.
Dua pilihan harus sama-sama masuk akal, tetapi memiliki risiko dan arah berbeda.
```

Contoh JSON **valid**:

```json
{
  "question": "Suara langkah berhenti tepat di balik pintu. Apa yang dilakukan Nara?",
  "actions": [
    {
      "label": "Buka pintu dan hadapi orang di luar",
      "hint": "Berisiko, tetapi bisa mengungkap siapa yang mengikutinya.",
      "consequence": "Nara menghadapi ancaman sebelum lawannya sempat bersiap.",
      "intent": "confront",
      "targetCharacterId": null,
      "targetThreadId": "thread-penguntit",
      "emotionalBias": "risk"
    },
    {
      "label": "Sembunyikan surat lalu dengarkan dari balik dinding",
      "hint": "Lebih aman, tetapi memberi lawan waktu untuk bergerak.",
      "consequence": "Nara memperoleh petunjuk tanpa membuka posisinya.",
      "intent": "investigate",
      "targetCharacterId": null,
      "targetThreadId": "thread-surat",
      "emotionalBias": "truth"
    }
  ]
}
```

### 8.3 Prompt input minimal

Input choices hanya membawa:

- chapter number;
- title;
- 3–5 ending paragraphs;
- previous choice;
- route summary;
- maksimal 6 relevant characters;
- maksimal 6 active threads;
- relevant forbidden reveals;
- hard boundaries;
- locked ending key jika ada;
- agency style sebagai soft bias;
- relationship focus sebagai soft bias.

Jangan membawa seluruh 49 choice history atau 24+ entities bila tidak relevan.

### 8.4 Ranking context

Buat fungsi murni:

```ts
rankChoiceRelevantCharacters(...)
rankChoiceRelevantThreads(...)
rankChoiceRelevantReveals(...)
```

Prioritas:

1. disebut dalam ending paragraphs;
2. terkait previous choice;
3. active/urgent thread;
4. chapter brief must-include;
5. relationship focus;
6. fallback canonical priority.

---

## 9. Fase 5 — Structured output dengan capability fallback

### 9.1 Mode provider

Tambahkan field route:

```ts
structuredOutputMode:
  | 'native_schema'
  | 'json_prompt'
```

Opsional:

```ts
choiceProtocolVersion: 'v2'
```

### 9.2 Native schema

Untuk provider/model yang terbukti mendukung:

```ts
const result = await generateText({
  model,
  system,
  prompt,
  output: Output.object({
    name: 'LakokuChoiceDraftV2',
    schema: AiChoiceDraftSchema,
  }),
  temperature,
  maxOutputTokens,
  abortSignal,
  maxRetries: 0,
})
```

Gunakan API yang sesuai dengan versi `ai` di repo. Agen wajib memeriksa signature aktual, bukan menyalin buta.

### 9.3 JSON prompt fallback

Bila provider tidak mendukung native schema:

1. gunakan `generateText()` non-stream;
2. parse bounded text;
3. strip hanya markdown fence yang jelas;
4. jangan melakukan regex “repair” arbitrer;
5. validasi dengan `AiChoiceDraftSchema`;
6. klasifikasikan parse/schema error.

### 9.4 Kenapa non-stream untuk choices

Choices adalah output kecil. Streaming menambah titik gagal tanpa memberi manfaat UX karena hasil baru dipakai setelah selesai.

Prosa boleh tetap streaming secara internal bila sesuai implementasi existing.

---

# BAGIAN D — PROVIDER RELIABILITY

## 10. Fase 6 — Route choices khusus

### 10.1 Jangan otomatis menyamakan dengan prose

`choicesRoute` harus selalu resolvable sendiri.

Jika tidak ada DB route choices:

- fallback ke konfigurasi choices env;
- jangan diam-diam memakai route prose kecuali feature compatibility eksplisit;
- log bounded warning internal.

### 10.2 Konfigurasi awal

```text
choices concurrency per provider : 2
choices timeout per attempt       : 90 detik
transient retries                 : 1
retry backoff                     : 2–5 detik + jitter
temperature                       : 0.1
max output                        : 800–1200 tokens
cross-provider fallback           : wajib
```

Catatan:

- reasoning model boleh memerlukan token floor, tetapi choices sebaiknya diarahkan ke model structured-output yang cepat;
- jangan memakai output budget 4096 secara default bila model non-reasoning;
- `reasoning_effort = none` atau nilai terendah bila provider mendukung.

### 10.3 Fallback harus lintas provider

Contoh:

```text
Primary  : 9router / structured model
Fallback : OpenRouter / paid structured model
```

Tidak cukup mengganti model bila semua melewati endpoint yang sama.

### 10.4 Route migration

Migration repair mengatur `ai_model_routes` untuk use case `choices` secara eksplisit.

Jangan hard-code secret/model credential di migration.

---

## 11. Fase 7 — Gate concurrency khusus choices

### 11.1 Masalah burst

Overall gate 6 tidak mencegah 4–6 job selesai prosa hampir bersamaan lalu memanggil choices bersamaan.

### 11.2 Implementasi

Buat modul:

```text
lib/runtime/choice-concurrency.ts
```

API:

```ts
withChoiceGenerationSlot(
  {
    providerId,
    storyId,
    chapterNumber,
    correlationId,
  },
  callback,
)
```

Gate key:

```text
providerId + useCase
```

Default:

```text
9router choices     : 2
openrouter choices  : 3
custom choices      : configurable
```

### 11.3 Queue

Field config:

```ts
type ChoiceConcurrencyPolicy = {
  maxActive: number
  maxQueue: number
  queueTimeoutMs: number
  jitterMinMs: number
  jitterMaxMs: number
}
```

Rekomendasi awal:

```text
maxActive       2
maxQueue        50
queueTimeout    150 detik
jitter          500–2500 ms
```

### 11.4 Observability

Log/metric:

```text
CHOICE_CAPACITY_QUEUED
CHOICE_CAPACITY_WAIT_DONE
CHOICE_CAPACITY_REJECTED
CHOICE_CAPACITY_RELEASED
```

Payload aman:

- provider ID;
- story ID;
- chapter;
- correlation ID;
- queue position;
- wait ms;
- active count.

---

## 12. Fase 8 — Retry berdasarkan error taxonomy

### 12.1 Error class

Buat:

```ts
type ChoiceProviderErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'HTTP_5XX'
  | 'NETWORK_ERROR'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'CONTENT_REJECTED'
  | 'QUALITY_UNGROUNDED'
  | 'QUALITY_NOT_DISTINCT'
  | 'QUALITY_NOT_ACTIONABLE'
  | 'UNKNOWN'
```

### 12.2 Policy

| Error | Tindakan |
|---|---|
| `TIMEOUT`, `RATE_LIMITED`, `HTTP_5XX`, `NETWORK_ERROR` | satu retry dengan backoff; lalu provider berikut |
| `INVALID_JSON`, `SCHEMA_INVALID` | jangan retry prompt identik; jalankan structural repair atau provider structured lain |
| `CONTENT_REJECTED` | satu safe rewrite; lalu provider berikut |
| `QUALITY_UNGROUNDED`, `NOT_DISTINCT`, `NOT_ACTIONABLE` | findings-aware creative repair |
| `UNKNOWN` | provider berikut; terminal bila chain habis |

### 12.3 Retry budget

```ts
type ChoiceRetryBudget = {
  transientPerCandidate: 1
  structuralRepair: 1
  qualityRepair: 1
  maxProviderCandidates: 3
  maxTotalCalls: 5
}
```

Budget harus mencegah job berjalan tanpa batas.

---

# BAGIAN E — REPAIR CHOICES YANG BENAR

## 13. Fase 9 — Hapus repair via `mustNotInclude`

### 13.1 Bug sekarang

Finding code dan label lama dimasukkan ke:

```ts
chapterBrief.mustNotInclude
```

Ini mencampur:

- constraint naratif;
- diagnostic code;
- output lama.

### 13.2 Contract repair baru

```ts
type ChoiceRepairInput = {
  finalChapter: {
    title: string
    endingParagraphs: string[]
  }
  previousDraft: AiChoiceDraft | null
  parseFailure?: {
    code: 'INVALID_JSON' | 'SCHEMA_INVALID'
    schemaPaths: string[]
  }
  qualityFindings: Array<{
    code: string
    message: string
  }>
  context: MinimalChoiceContext
}
```

### 13.3 Repair prompt

```text
Perbaiki dua tindakan berikut tanpa mengubah situasi akhir bab.

Masalah yang harus diperbaiki:
- pilihan kedua tidak menyebut objek atau konflik yang muncul pada akhir bab;
- dua pilihan menghasilkan arah yang terlalu serupa;
- targetThreadId tidak valid.

Balas hanya objek JSON sesuai contoh.
Gunakan tepat dua tindakan.
Jangan menambah karakter atau fakta baru.
```

### 13.4 Previous raw response

- Simpan hanya in-memory selama request;
- maksimal karakter bounded, misalnya 6000;
- jangan log;
- jangan simpan ke story event;
- jangan expose ke admin kecuali redacted diagnostic metadata.

### 13.5 Provider repair

Repair boleh memakai:

- provider/model khusus repair;
- native structured output;
- fallback provider berbeda.

Jangan otomatis memakai object provider yang sama tanpa routing ulang.

---

# BAGIAN F — DURABLE PROSE CHECKPOINT DAN CHOICE-ONLY JOB

## 14. Fase 10 — Pisahkan prose stage dan choice stage

### 14.1 Target state machine

```text
QUEUED
RUNNING_PROSE
PROSE_READY
QUEUED_CHOICES
RUNNING_CHOICES
CHOICES_RETRY_WAIT
READY_TO_PUBLISH
PUBLISHING
SUCCEEDED
FAILED_REVIEW
FAILED_RUNTIME
```

### 14.2 Gunakan fondasi jobs yang sudah ada

Repo sudah mempunyai:

- generation jobs foundation;
- enqueue;
- worker RPC;
- recovery;
- fencing;
- choice enqueue.

Agen wajib audit contract yang ada sebelum membuat sistem baru.

Prioritas:

1. perluas existing generation jobs;
2. gunakan existing fencing/idempotency;
3. gunakan choice job kind yang sudah ada;
4. jangan membuat queue ad hoc kedua.

### 14.3 Checkpoint artifact

Bila generation jobs tidak menyediakan storage draft yang aman, buat:

```text
chapter_generation_checkpoints
```

Schema rekomendasi:

```sql
story_id uuid not null
chapter_number int not null
attempt_id uuid not null
correlation_id uuid not null

status text not null
title text not null
paragraphs_json jsonb not null

prose_fingerprint text not null
canon_version bigint null
blueprint_version bigint null
direction_fingerprint text null

prose_attempt_count int not null default 0
choice_attempt_count int not null default 0

created_at timestamptz not null
updated_at timestamptz not null
expires_at timestamptz not null

primary key (story_id, chapter_number, attempt_id)
```

### 14.4 Security

- tidak ada public select;
- service role/worker only;
- jangan expose prose draft melalui Reader API;
- retention cleanup setelah publish atau batas waktu;
- prose tetap data sensitif aplikasi.

### 14.5 Flow

```text
generate prose
→ validate/repair
→ consumer safe
→ boundary safe
→ persist checkpoint PROSE_READY
→ release prose provider resources
→ enqueue CHOICES job dengan attemptId
```

Choice worker:

```text
claim CHOICES job
→ load checkpoint
→ verify prose fingerprint / fencing token
→ generate choices
→ validate/repair
→ finalize mechanical fields
→ publish chapter atomically
→ delete/expire checkpoint
→ mark job SUCCEEDED
```

### 14.6 Retry user

Tombol retry:

- bila checkpoint `PROSE_READY` tersedia → enqueue choices only;
- bila checkpoint invalid/expired → regenerate prose;
- bila chapter sudah ada → `ALREADY_READY`;
- bila active job → `ALREADY_RUNNING`.

### 14.7 Idempotency

Keys:

```text
prose checkpoint : storyId + chapter + canonVersion
choice job       : storyId + chapter + proseFingerprint
publish          : storyId + chapter + proseFingerprint + choiceFingerprint
```

### 14.8 Restart recovery

Setelah container restart:

- queued/running job dapat di-reclaim;
- checkpoint tetap ada;
- choices tidak memaksa prose ulang;
- stale worker ditolak oleh fencing token.

---

# BAGIAN G — GENERATION MODE DISPATCH

## 15. Fase 11 — Dispatch standard vs personalized dengan benar

### 15.1 Bug sekarang

`startOwnedChapterGeneration()` hanya memilih `stories.id` lalu selalu memanggil:

```ts
generateNextChapterReal(...)
```

### 15.2 Jangan menebak kolom `stories.story_mode`

Gunakan sumber kebenaran existing:

- `story_generation_contracts.mode`;
- contract source;
- personalized reader state;
- helper runtime existing bila tersedia.

Buat:

```ts
type StoryGenerationMode =
  | 'standard'
  | 'personalized_ai'
```

Resolver:

```ts
resolveStoryGenerationMode(storyId): Promise<StoryGenerationMode>
```

Aturan awal:

1. contract mode `personalized_ai` → personalized;
2. contract tidak ada → standard;
3. contract ada tetapi invalid → fail `GENERATION_CONTRACT_INVALID`;
4. jangan fallback diam-diam ke standard untuk contract personalized rusak.

### 15.3 Central dispatcher

```ts
runChapterGenerationAttempt({
  mode,
  storyId,
  userId,
  chapterNumber,
  correlationId,
  attemptId,
})
```

Dispatch:

```ts
switch (mode) {
  case 'personalized_ai':
    return generateNextPersonalizedChapter(...)
  case 'standard':
    return generateNextChapterReal(...)
}
```

### 15.4 Semua entry point harus memakai dispatcher

Audit:

- first chapter kickoff;
- retry button;
- post-choice next chapter;
- worker job;
- admin retry;
- recovery worker;
- e2e scripts.

Tidak boleh ada entry point yang langsung memilih generator tanpa resolver, kecuali test eksplisit.

---

# BAGIAN H — OBSERVABILITY DAN ERROR HANDLING

## 16. Fase 12 — Best-effort benar-benar nonfatal

### 16.1 Helper

Buat:

```ts
async function bestEffort<T>(
  event: string,
  context: SafeContext,
  operation: () => Promise<T>,
): Promise<T | null>
```

Contoh:

```ts
await bestEffort(
  'RETRIEVAL_LOG_PERSIST_FAILED',
  { storyId, chapterNumber, correlationId },
  () => persistRetrievalLog(...),
)
```

### 16.2 Operasi yang harus nonfatal

- retrieval log;
- metrics;
- post-publish generation attempt event;
- analytics;
- admin telemetry projection;
- retention bookkeeping.

### 16.3 Operasi yang tetap critical

- load canon;
- load required personalized contract;
- acquire lease;
- prose validation;
- content boundary validation;
- choice validation;
- publish RPC;
- checkpoint write sebelum choice job;
- job status transition;
- fencing.

### 16.4 Post-publish telemetry

Setelah `publishChapterV2()` sukses:

```ts
leaseReleased = true
const result = successEnvelope

await bestEffort(...record PUBLISHED...)

return result
```

Tidak boleh masuk outer catch karena telemetry.

### 16.5 Failure sebelum publish

`recordGenerationAttempt(REVIEW_REQUIRED)` juga sebaiknya best-effort. Primary failure tetap dikembalikan walau event storage gagal.

---

## 17. Fase 13 — Hindari double failure event

### 17.1 Bug

Pada choice leak:

1. log specific `CHOICE_LEAK_REJECTED`;
2. throw;
3. outer catch log `UNKNOWN_RUNTIME_EXCEPTION`.

### 17.2 Typed error

```ts
class GenerationStageError extends Error {
  readonly alreadyRecorded: boolean
  readonly errorCode: string
  readonly stage: GenerationStage
}
```

Atau gunakan symbol internal:

```ts
markFailureRecorded(error)
isFailureRecorded(error)
```

Outer catch:

```ts
if (!isFailureRecorded(err)) {
  await logRuntimeFailure('UNKNOWN_RUNTIME_EXCEPTION', err)
}
```

### 17.3 One terminal failure rule

Untuk satu attempt:

- maksimal satu terminal runtime failure event;
- provider calls tetap boleh lebih dari satu;
- repair findings boleh banyak;
- terminal error code harus paling spesifik.

---

# BAGIAN I — ATTEMPT-AWARE STATUS DAN RETRY

## 18. Fase 14 — Buat durable attempt sebelum merespons STARTED

### 18.1 Masalah

`after()` dijadwalkan lalu response `STARTED` dapat sampai sebelum lease/gate terlihat. Status resolver dapat membaca failure event attempt lama.

### 18.2 Contract attempt

Gunakan `generation_jobs` atau tabel attempt existing. Jangan membuat sumber kebenaran duplikat bila job ID sudah cukup.

Start response:

```ts
type StartChapterSuccess = {
  ok: true
  chapterNumber: number
  status:
    | 'STARTED'
    | 'ALREADY_RUNNING'
    | 'ALREADY_READY'
  attemptId: string | null
}
```

### 18.3 Urutan

```text
ownership check
→ chapter ready check
→ active current job/lease check
→ create durable QUEUED attempt
→ commit
→ schedule worker/after
→ return STARTED + attemptId
```

### 18.4 Status API

Response reader-safe:

```ts
type ChapterStatusResponse = {
  status:
    | 'queued'
    | 'writing'
    | 'preparing_choices'
    | 'ready'
    | 'failed'
  chapterNumber: number
  attemptId?: string
  queue?: ...
}
```

Pembaca tidak melihat detail teknis.

### 18.5 Status resolution

Bila `attemptId` diberikan:

1. chapter exists → ready;
2. current attempt queued/running/retry → appropriate progress;
3. current attempt succeeded → ready;
4. current attempt terminal failed → failed;
5. failure attempt lama diabaikan.

Tanpa `attemptId`:

- gunakan latest durable attempt;
- jangan hanya latest story event.

### 18.6 UI copy

| State | Copy |
|---|---|
| `queued` | “Babmu masuk antrean penulisan.” |
| `writing` | “Bab ini sedang ditulis.” |
| `preparing_choices` | “Babnya sudah terbentuk. Kami sedang menyiapkan pilihanmu.” |
| `ready` | refresh halaman |
| `failed` | “Bab ini belum berhasil disiapkan.” |

Jangan menampilkan progress persen palsu.

---

# BAGIAN J — PROSE QUALITY FAILURE

## 19. Fase 15 — Tangani hard band 424 kata tanpa melonggarkan kualitas

Hasil soak menunjukkan satu prose gagal karena 424 kata dan hard band.

### 19.1 Audit sumber target

Periksa:

- runtime generation policy;
- prose prompt engine;
- clamp;
- validator band;
- model output token;
- repair instructions.

### 19.2 Satu sumber kebenaran

Buat typed resolved policy:

```ts
type ResolvedProseLengthPolicy = {
  targetWords: number
  minWords: number
  maxWords: number
  repairTargetWords: number
}
```

Semua komponen memakai objek sama.

### 19.3 Repair length

Jika hanya finding length:

- jangan generate ulang tanpa arahan;
- prompt repair menyebut jumlah aktual dan target;
- pertahankan fakta/beat;
- minta perluasan terarah:
  - sensory beat;
  - reaction;
  - dialog consequence;
  - transition;
- tetap validasi canon.

### 19.4 Deterministic post-processing

Jangan padding otomatis dengan kalimat generik.

Clamp hanya boleh:

- normalisasi paragraf;
- menghapus repetisi;
- tidak mengarang konten baru.

### 19.5 Metrics

Catat:

```text
actualWords
minWords
targetWords
maxWords
repairDelta
```

Tanpa menyimpan prosa.

---

# BAGIAN K — TEST PLAN

## 20. Unit tests wajib

### 20.1 Choice prompt/protocol

1. V2 example JSON dapat `JSON.parse`.
2. Schema tepat dua actions.
3. Tidak ada mechanical fields dalam AI schema.
4. Context bounded.
5. Prompt tidak mengandung raw internal metadata.
6. Finalizer menghasilkan ID stabil.
7. `choiceId` selalu cocok.
8. chapter 50 tidak menghasilkan choices.
9. chapter 49 ending policy deterministic.
10. unknown target ditolak/normalized.

### 20.2 Error taxonomy

1. timeout → transient retry.
2. 429 → backoff.
3. 5xx → retry lalu fallback.
4. invalid JSON → structural repair, bukan retry identik.
5. schema invalid → exact schema paths.
6. quality ungrounded → quality repair.
7. chain exhausted → terminal failure spesifik.

### 20.3 Repair

1. finding code tidak masuk `mustNotInclude`.
2. previous draft masuk bounded repair input.
3. repair prompt memuat finding reader-safe internal.
4. repair tidak log raw output.
5. repaired branch divalidasi ulang.
6. provider repair dapat berbeda dari initial provider.

### 20.4 Concurrency

1. global generation 6, choices gate 2.
2. max 2 active per provider.
3. queue order deterministic/fair.
4. timeout queue menghasilkan capacity error.
5. release slot pada success/error/abort.
6. provider A tidak memblok provider B.

### 20.5 Checkpoint

1. valid prose → `PROSE_READY`.
2. choices failure tidak menghapus checkpoint.
3. retry memakai prose fingerprint sama.
4. publish success meng-expire checkpoint.
5. stale worker tidak publish.
6. restart recovery dapat melanjutkan choices.
7. expired checkpoint memicu prose regeneration secara eksplisit.
8. duplicate choice job idempotent.

### 20.6 Mode dispatch

1. no contract → standard.
2. personalized contract → personalized.
3. invalid personalized contract → terminal invalid, bukan standard fallback.
4. retry memakai dispatcher.
5. worker memakai dispatcher.
6. post-choice next chapter memakai dispatcher.

### 20.7 Creative direction safety

1. dedicated table success.
2. dedicated table missing → typed failure.
3. generation contract tidak pernah di-upsert.
4. existing contract tidak berubah saat direction write gagal.
5. atomic lock rollback saat direction gagal.
6. loader membaca dedicated table.
7. story lama tanpa direction tetap neutral.

### 20.8 Observability

1. retrieval log gagal → generation lanjut.
2. PUBLISHED telemetry gagal → result tetap success.
3. REVIEW_REQUIRED telemetry gagal → primary failure tetap sama.
4. choice leak menghasilkan satu terminal failure.
5. log tidak memuat raw prose/prompt/secrets.

### 20.9 Attempt status

1. retry membuat attempt durable sebelum response.
2. stale failure attempt lama diabaikan.
3. latest queued attempt → queued.
4. prose ready → preparing_choices.
5. choice retry wait → preparing_choices.
6. current terminal failure → failed.
7. chapter row selalu menang → ready.
8. non-owner/anonymous tetap aman.

---

## 21. DB tests wajib

Tambahkan:

```text
supabase/tests/story_creative_direction_integrity_test.sql
supabase/tests/migration_version_reconciliation_test.sql
supabase/tests/chapter_generation_checkpoint_test.sql
supabase/tests/generation_choice_retry_test.sql
supabase/tests/generation_attempt_status_test.sql
```

Skenario:

1. creative direction write tidak memodifikasi contract.
2. checkpoint RLS menolak anon/auth client.
3. service role dapat claim/update.
4. fencing mencegah stale publish.
5. choice retry tidak membuat duplicate chapter.
6. cleanup hanya menghapus checkpoint terminal/expired.
7. attempt transition invalid ditolak.
8. one active attempt per story+chapter bila policy demikian.

---

## 22. Integration tests

### 22.1 Fake provider matrix

Gunakan provider test yang dapat diprogram:

```ts
fakeProvider.sequence([
  proseSuccess(...),
  choiceTimeout(),
  choiceInvalidJson(),
  choiceSuccess(...),
])
```

Prove:

- prose hanya dipanggil satu kali;
- choices dipanggil tiga kali;
- fallback/repair sesuai policy;
- chapter publish sekali.

### 22.2 Publish race

Dua choice worker untuk checkpoint sama:

- hanya satu publish sukses;
- worker kedua mendapat existing/idempotent;
- tidak ada duplicate outcome/event.

### 22.3 Restart

Simulasikan:

```text
PROSE_READY
→ process restart
→ recovery claims choice job
→ publish
```

---

# BAGIAN L — SMOKE, SOAK, DAN ACCEPTANCE METRICS

## 23. Command validasi

Targeted:

```bash
pnpm exec vitest run \
  tests/ai-gateway/choice-prompt-contract.test.ts \
  tests/ai-gateway/choice-structured-output.test.ts \
  tests/runtime/choice-generation-repair.test.ts \
  tests/runtime/choice-checkpoint.test.ts \
  tests/runtime/generation-mode-dispatch.test.ts \
  tests/runtime/story-generation-observability.test.ts \
  tests/authoring/persist-creative-direction.test.ts \
  tests/api/chapter-attempt-status.test.ts \
  tests/db/migration-version-uniqueness.test.ts
```

Existing gates:

```bash
pnpm typecheck
pnpm lint
pnpm run test:generation-observability
pnpm run test:db:generation-observability
pnpm run test:db:generation-jobs
pnpm run test:db:personalized
pnpm run smoke:ai-model-routes
pnpm run smoke:admin-generation-observability
pnpm run smoke:personalized-story
pnpm run smoke:web-release
pnpm build
```

Lalu:

```bash
pnpm run test:unit
pnpm test
```

DB:

```bash
pnpm exec supabase db reset
pnpm exec supabase test db --local
pnpm exec supabase db push --linked --dry-run
```

Jangan push linked production tanpa approval.

---

## 24. Soak plan

### 24.1 Baseline sequential

- 10 jobs;
- overall concurrency 1;
- choice concurrency 1;
- memastikan provider dapat sukses tanpa load.

### 24.2 Choice gate test

- 30 jobs;
- overall concurrency 6;
- choice concurrency 2;
- timeout 90 sec;
- cross-provider fallback aktif.

### 24.3 Stress

- 50 jobs;
- overall concurrency 10;
- choice concurrency 2;
- bukan release target, hanya karakterisasi.

### 24.4 Recovery soak

- terminate container ketika beberapa job `PROSE_READY`;
- restart;
- semua checkpoint direcover;
- tidak ada prose regeneration.

### 24.5 Metrics

Wajib dicatat:

```text
prose_initial_success_rate
prose_eventual_success_rate
choice_initial_success_rate
choice_eventual_success_rate
choice_invalid_json_rate
choice_schema_invalid_rate
choice_timeout_rate
choice_provider_fallback_rate
choice_repair_success_rate
prose_regenerated_due_to_choice_failure
checkpoint_recovery_success_rate
publish_success_rate
duplicate_publish_count
lease_expiry_count
p50/p95 prose latency
p50/p95 choice latency
p50/p95 end-to-end latency
```

### 24.6 Acceptance target

```text
initial prose success                  >= 90%
eventual prose success                 >= 98%
initial choice success                 >= 90%
eventual choice success                >= 99%
invalid JSON after structured rollout  < 1%
prose regeneration due choice failure  = 0
duplicate chapter publish              = 0
invalid/expired lease                  = 0
checkpoint recovery                    >= 99%
p95 choice provider stage              < 120 sec
p95 total eventual completion          < 8 min
```

Release gate minimal:

- 30/30 eventual publish;
- boleh ada initial retry;
- tidak boleh ada manual intervention;
- tidak boleh ada prosa yang dihasilkan ulang akibat failure choices.

---

# BAGIAN M — ADMIN DAN OPERASIONAL

## 25. Admin observability

Per provider call tampilkan:

```text
Use case
Provider
Model
Attempt
Fallback index
Workflow phase
Result
Latency
Error class
```

Per chapter workflow tampilkan:

```text
Attempt ID
Generation mode
Prose status
Checkpoint status
Choice status
Publish status
Current stage
Terminal result
```

Label:

- `Provider OK` bukan `Sukses`;
- `Prosa siap`;
- `Menyiapkan pilihan`;
- `Bab terbit`;
- `Proses gagal`.

Jangan expose raw response.

---

## 26. Runbook diagnosis

Sediakan doc/script yang mengumpulkan:

```bash
docker compose logs --since 3h web 2>&1 \
  | grep -E \
  'GENERATION_|CHOICE_|PROVIDER_|CHECKPOINT_|PUBLISH_|CONTRACT_|LEASE_|ATTEMPT_'
```

SQL timeline:

```sql
select
  seq,
  type,
  payload,
  created_at
from story_events
where story_id = '<STORY_ID>'
order by seq desc
limit 100;
```

Job/checkpoint:

```sql
select *
from generation_jobs
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>
order by created_at desc;

select
  story_id,
  chapter_number,
  attempt_id,
  status,
  prose_fingerprint,
  prose_attempt_count,
  choice_attempt_count,
  created_at,
  updated_at,
  expires_at
from chapter_generation_checkpoints
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>;
```

Provider:

```sql
select
  use_case,
  workflow_phase,
  provider_id,
  configured_model_id,
  outcome,
  error_code,
  latency_ms,
  created_at
from generation_provider_calls
where story_id = '<STORY_ID>'
  and chapter_number = <CHAPTER>
order by created_at;
```

---

# BAGIAN N — IMPLEMENTATION ORDER

## 27. Urutan PR

### PR 1 — Safety stop

- hapus destructive creative-direction fallback;
- duplicate migration checker;
- repair migration idempotent;
- data audit script;
- observability post-publish nonfatal;
- double-failure guard.

**Tujuan:** mencegah kerusakan data baru.

### PR 2 — Choice protocol V2

- `AiChoiceDraftSchema`;
- valid JSON prompt;
- deterministic finalizer;
- backward-compatible branch output;
- unit tests.

**Tujuan:** mengurangi invalid response.

### PR 3 — Provider reliability

- native structured output capability;
- JSON fallback;
- error taxonomy;
- choice-specific route;
- cross-provider fallback;
- timeout/retry/backoff;
- choice concurrency gate.

**Tujuan:** menstabilkan initial choices.

### PR 4 — Real repair

- structural repair;
- quality repair;
- bounded previous draft;
- different provider support;
- repair metrics.

**Tujuan:** meningkatkan eventual success.

### PR 5 — Durable split

- `PROSE_READY` checkpoint;
- choice-only jobs;
- recovery/fencing;
- no prose regeneration;
- atomic publish integration.

**Tujuan:** durability dan efisiensi.

### PR 6 — Mode dispatcher dan attempts

- resolve mode;
- central dispatcher;
- durable attempt;
- attempt-aware status;
- reader state copy.

**Tujuan:** retry benar dan status tidak stale.

### PR 7 — Full soak/release

- DB tests;
- stress/restart soak;
- admin projection;
- production runbook;
- rollout flag.

---

# BAGIAN O — ROLLOUT DAN ROLLBACK

## 28. Feature flags

```text
choice_protocol_v2
choice_structured_output
choice_provider_gate
choice_durable_checkpoint
attempt_aware_generation_status
creative_direction_strict_persist
```

Rollout:

1. tests/local;
2. internal account;
3. staging;
4. production 10%;
5. 50%;
6. 100%.

### Dual compatibility

- V2 AI draft finalizes ke existing publish branch contract.
- Reader tidak perlu memahami protocol V2.
- Story lama tanpa creative direction tetap berjalan neutral.
- Checkpoint feature off → old synchronous workflow masih dapat dipakai selama migration rollout, tetapi tidak direkomendasikan setelah full enable.

---

## 29. Rollback

### Code rollback

- matikan feature flags;
- kembalikan choice generation ke V1 sementara;
- jangan rollback migration dengan drop table;
- checkpoint rows tetap aman dan dapat dibersihkan setelah stabil.

### Provider rollback

- route choices dapat dipindah ke provider stabil dari Admin/DB;
- gate dapat diturunkan ke 1 tanpa rebuild bila config DB mendukung.

### Data rollback

- jangan restore generation contract dari creative-direction data;
- backup row terkait sebelum repair;
- simpan audit table mapping old/new contract fingerprint.

### Deploy VPS

Ikuti runbook repo:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 web
curl http://127.0.0.1:5200/
```

Jangan menimpa `.env`.
Jangan menjalankan `docker compose down -v`.

---

# BAGIAN P — DEFINITION OF DONE

## 30. Checklist final

### Safety

- [ ] Creative direction tidak pernah menimpa generation contract.
- [ ] Duplicate migration version terdeteksi otomatis.
- [ ] Repair migration unik dan idempotent.
- [ ] Production contract kosong sudah diaudit.
- [ ] Tidak ada data repair berbasis tebakan.

### Choices

- [ ] AI hanya menghasilkan creative draft.
- [ ] Mechanical fields dibuat server.
- [ ] Prompt memberi contoh JSON valid.
- [ ] Choices memakai non-stream structured output bila didukung.
- [ ] JSON fallback tervalidasi.
- [ ] Repair tidak memakai `mustNotInclude` untuk finding codes.
- [ ] Error taxonomy menentukan retry.
- [ ] Cross-provider fallback aktif.
- [ ] Choice concurrency gate terpisah.
- [ ] Choices selalu grounded pada final prose.
- [ ] Bab 50 tanpa choices.

### Durability

- [ ] Prosa valid disimpan sebagai `PROSE_READY`.
- [ ] Failure choices tidak membuang prosa.
- [ ] Retry hanya choices.
- [ ] Restart dapat recover checkpoint.
- [ ] Fencing mencegah stale publish.
- [ ] Publish tetap atomik.
- [ ] Prose regeneration akibat choice failure = 0.

### Dispatch/status

- [ ] Standard vs personalized dipilih dari sumber kebenaran contract.
- [ ] Semua entry point memakai central dispatcher.
- [ ] Attempt durable dibuat sebelum STARTED response.
- [ ] Status endpoint attempt-aware.
- [ ] Failure lama tidak menimpa retry baru.
- [ ] Reader copy tetap nonteknis.

### Observability

- [ ] Best-effort telemetry benar-benar nonfatal.
- [ ] Publish success tidak berubah menjadi failure karena telemetry.
- [ ] Satu attempt menghasilkan maksimal satu terminal failure event.
- [ ] Provider status dan workflow status terpisah.
- [ ] Tidak ada prompt/prose/secrets di log.

### Quality/release

- [ ] Targeted tests hijau.
- [ ] DB tests hijau.
- [ ] Typecheck hijau.
- [ ] Lint hijau.
- [ ] Build hijau.
- [ ] Full test hijau.
- [ ] 30/30 eventual publish pada soak release.
- [ ] Restart recovery soak hijau.
- [ ] Linked migration dry-run diperiksa.
- [ ] Production migration mendapat approval.
- [ ] Rollback path terdokumentasi.

---

# BAGIAN Q — FORMAT LAPORAN AKHIR AGEN

## 31. Laporan wajib

### Root causes

Tabel:

| ID | Root cause | Bukti | Dampak | Fixed by |
|---|---|---|---|---|

### Perubahan file

| File | Perubahan | Alasan |
|---|---|---|

### Database

- migration baru;
- duplicate version reconciliation;
- local reset result;
- DB tests;
- linked dry-run;
- production approval status;
- data audit count;
- repair count.

### Choice protocol

Tampilkan:

```text
old AI output
→ new AI creative draft
→ deterministic finalizer
→ existing publish contract
```

### Retry matrix

| Error | Retry | Repair | Fallback | Terminal |
|---|---|---|---|---|

### Checkpoint proof

Buktikan satu job:

```text
prose call count = 1
choice call count > 1
same prose fingerprint
publish count = 1
```

### Mode dispatch proof

- standard story;
- personalized story;
- invalid contract;
- retry path;
- worker path.

### Test output

Sertakan command dan output aktual. Jangan menulis “semua lolos” tanpa jumlah dan exit code.

### Soak result

| N | Overall concurrency | Choice concurrency | Initial success | Eventual success | Invalid JSON | Timeout | Prose regen | Publish |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

### Deployment

- commit SHA;
- container image;
- migration version;
- deploy timestamp;
- health checks;
- smoke story/attempt ID;
- rollback artifact/path.

### Remaining risks

Tuliskan risiko yang benar-benar masih tersisa, terutama ketergantungan provider eksternal.

---

## 32. Pernyataan selesai

Jangan menyatakan task selesai sebelum alur berikut terbukti pada environment terintegrasi:

```text
durable attempt
→ correct mode dispatch
→ valid prose
→ PROSE_READY
→ choices initial fail
→ retry/fallback
→ choices valid
→ deterministic effects
→ atomic publish
→ status ready
→ reader membuka bab
```

Keberhasilan provider HTTP atau keberhasilan prosa saja bukan Definition of Done.
