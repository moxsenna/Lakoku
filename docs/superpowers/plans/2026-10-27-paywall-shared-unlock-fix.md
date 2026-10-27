# Paywall Fix: Shared-Story Unlock + Ungated Content Routes

**Goal:** Tutup tiga celah paywall dan satu bug kunci-pemilik, prasyarat fitur cerita katalog admin (cerita bersama dibaca banyak pembaca).

**Branch:** `fix/paywall-shared-unlock` (worktree `.worktrees/fix-paywall-shared-unlock`), base `e189c1a`.

## Global Constraints

- `unlockRef(storyId, chapter)` di `lib/credits/policy.ts` TIDAK BOLEH berubah: tetap `unlock:${storyId}:${chapter}`. Ref ini kontrak kanonik cerita komersial (`personalized_ai`, `premium_instance`): RPC publish (`neon/migrations/20260805030000_publish_generation_job_chapter_v6.sql`), capture reservasi (`20260804020000_credit_reservations.sql`, `20260920000000_story_cover_generation.sql`) dan `tests/commercial/no-double-charge.test.ts` bergantung padanya.
- Ref per-pembaca baru HANYA untuk cerita non-komersial (`isCommercialStoryMode(story_mode) === false`): `unlock:${storyId}:${chapter}:${userId}`.
- Tidak ada migrasi SQL. `credit_ledger.ref` unik global dan `spend_credits_v1` tidak diubah.
- Ledger lama berformat kanonik milik pembaca yang sama tetap dihormati (tidak ada pembaca yang kehilangan bab yang sudah dibayar). Query ledger selalu difilter `user_id = userId`.
- Pesan error ke pembaca dalam Bahasa Indonesia, tanpa istilah teknis (brand guard: tanpa "AI", "token", dsb).
- Tanpa `as any`, `@ts-ignore`, `@ts-expect-error`, catch kosong.
- TDD: test merah dulu, lihat gagal, baru implementasi.
- Jangan menyentuh DB produksi. Test memakai mock (`vi.mock('@lakoku/db')`, `vi.mock('server-only', () => ({}))`); `DATABASE_URL` tidak di-set di shell.
- Jalur generate-dari-nol milik user (personalized/standard milik sendiri) tidak boleh berubah perilaku untuk pemiliknya.

## Task 1: Ref unlock per-pembaca + resolver menerima keduanya

**Bug:** `credit_ledger.ref` unik global dan `unlockRef` tidak memuat userId. Pada cerita bersama, pembaca A membuka Bab 4 → ref `unlock:S:4` terpakai. Pembaca B membuka Bab 4 → `spend_credits_v1` mengembalikan `duplicate` (0 debit) dan resolver mencari ref milik B → tidak ada → B terkunci selamanya.

**Files:**
- Modify `lib/credits/policy.ts`: tambah
  ```ts
  /** Ref ledger unlock per-pembaca untuk cerita bersama (non-komersial). */
  export function readerUnlockRef(storyId: string, chapter: number, userId: string): string {
    return `${unlockRef(storyId, chapter)}:${userId}`
  }
  ```
- Modify `lib/credits/access-resolver.server.ts` jalur non-komersial (blok `if (!isCommercial)`): cek ledger dengan `.where('user_id', '=', input.userId).where('ref', 'in', [readerUnlockRef(storyId, chapter, userId), unlockRef(storyId, chapter)])`. Jalur komersial tidak berubah.
- Modify `lib/credits/server.ts`: hapus `listUnlockedChapters` (tidak punya pemanggil di app/lib/scripts/tests dan parsing angkanya rusak untuk ref per-pembaca); perbarui doc comment di atas file.
- Test baru `tests/credits/shared-unlock.test.ts`.

**Test cases (resolver, mock Kysely):**
1. Cerita `standard`, Bab 4, ledger milik user B berisi `unlock:S:4:B` → `{ readable: true, reason: 'LEDGER_UNLOCKED' }`.
2. Cerita `standard`, Bab 4, ledger milik user B berisi ref kanonik lama `unlock:S:4` → readable (kompatibilitas mundur).
3. Cerita `standard`, Bab 4, ledger B kosong (walau A punya `unlock:S:4:A`) → `PAYMENT_REQUIRED`, cost = `policy.creditsPerChapter`.
4. Query ledger non-komersial memakai filter `user_id = userId` dan kedua ref (assert argumen `where`).
5. `readerUnlockRef('S', 4, 'u1') === 'unlock:S:4:u1'` dan `unlockRef('S', 4) === 'unlock:S:4'` (tetap).

## Task 2: Belanja unlock memakai ref per-pembaca + `duplicate` tidak lagi dianggap sukses

**Files:**
- Modify `lib/credits/server.ts` `spendChapterUnlock`: tambah parameter kelima `refScope: 'reader' | 'canonical'`. `'reader'` → `p_ref: readerUnlockRef(storyId, chapter, userId)`; `'canonical'` → `unlockRef(storyId, chapter)`. Tanpa default (pemanggil wajib memilih).
- Modify `app/api/stories/[id]/unlock/route.ts`:
  - Fallback standar (cerita non-komersial) → `refScope: 'reader'`.
  - Cabang komersial `LEGACY_GRANDFATHERED` → `refScope: 'canonical'` (tidak berubah perilaku).
  - Pada kedua cabang, bila hasil `'duplicate'`: panggil ulang `resolveChapterAccess`; bila readable → 200 `{ status: 'ok', balance }`; bila tidak → 409 `{ error: 'Bab belum bisa dibuka. Coba lagi sebentar.' }` (jangan 200 untuk bab yang masih terkunci).
- Test baru `tests/api/unlock-route.test.ts` (mock `@/lib/api/user-state` getSessionUser, `@/lib/credits/server`, `@/lib/credits/access-resolver.server`, `@lakoku/db`).

**Test cases:**
1. Cerita `standard`, PAYMENT_REQUIRED → `spendChapterUnlock` dipanggil dengan `refScope 'reader'`.
2. Cerita `personalized_ai` origin `LEGACY_GRANDFATHERED`, pemilik, Bab ≥4, row bab ada → `refScope 'canonical'`.
3. Spend `'duplicate'` + resolve ulang tetap tidak readable → 409, bukan 200.
4. Spend `'duplicate'` + resolve ulang readable → 200 `status: 'ok'`.
5. Spend `'insufficient'` → 402 `WAITING_FOR_CREDITS` (regresi).

## Task 3: Gerbang akses `GET /api/stories/[id]/chapters/[number]`

**Bug:** route mengembalikan isi bab (`paragraphs`) tanpa `resolveChapterAccess`; tamu bisa membaca bab berbayar cerita publik.

**Files:**
- Modify `app/api/stories/[id]/chapters/[number]/route.ts`: setelah `getChapter` mengembalikan bab, panggil `resolveChapterAccess({ userId: user?.id ?? null, storyId: id, chapterNumber: chapter.number, policy: await getReadingPolicy() })` (gerbang pada `chapter.number` yang benar-benar dikembalikan, karena `getChapter` bisa fallback ke bab lain). `getSessionUser` dari `@/lib/api/user-state`, `getReadingPolicy` dari `@/lib/credits/server`, resolver via `await import('@/lib/credits/access-resolver.server')` (pola sama dengan `app/baca/[id]/page.tsx`).
  - Tidak readable dan reason `PAYMENT_REQUIRED` → 402 `{ error: 'Bab ini perlu dibuka dulu.' }`.
  - Tidak readable reason lain → 403 `{ error: 'Tidak diizinkan.' }`.
  - Readable → perilaku lama (`jsonWithETag`).
  - Respons terkunci tidak memuat field bab apa pun.
- Test baru `tests/api/chapter-route-gate.test.ts`.

**Test cases:**
1. Bab 2 cerita publik, resolver `FREE_STANDARD` → 200 berisi `chapter`.
2. Bab 5, tamu, resolver `PAYMENT_REQUIRED` → 402, body tidak memuat `paragraphs`/`chapter`.
3. Resolver `NOT_AUTHORIZED` → 403 tanpa isi.
4. `getChapter` fallback mengembalikan bab 4 untuk permintaan bab 6 → resolver dipanggil dengan `chapterNumber: 4`.
5. Readable `LEDGER_UNLOCKED` → 200.

Pastikan `tests/privacy/recursive-internal-field-scan.test.ts` tetap hijau (tambahkan mock resolver/policy/session bila perlu, tanpa melemahkan assertion).

## Task 4: Gerbang akses jalur standar `POST /api/stories/[id]/choices`

**Bug:** jalur standar (bukan personalized milik user) tidak memeriksa akses bab. Non-pembayar bisa mengirim pilihan di bab berbayar → `consequence` bab terkunci terbuka dan `reader_states.current_chapter` maju melewati paywall.

**Files:**
- Modify `app/api/stories/[id]/choices/route.ts`: di jalur standar, setelah `queryStoryForUser` sukses dan SEBELUM `queryChoiceOutcome`, panggil `resolveChapterAccess` untuk `chapterNumber` (bab tempat pilihan dibuat). Tidak readable → 402 `{ error: 'Bab ini perlu dibuka dulu.' }` bila `PAYMENT_REQUIRED`, selain itu 403 `{ error: 'Tidak diizinkan.' }`. Jalur personalized (`applyPersonalizedChoice`) tidak diubah.
- Update mock di test yang mengimpor route ini agar resolver ter-mock (readable default) tanpa melemahkan assertion: `tests/api/standard-choice-guard.test.ts`, `tests/api/generation-continuation.test.ts`, `tests/api/personalized-choice.test.ts`, `tests/tinta/author-reward.test.ts`, `tests/privacy/recursive-internal-field-scan.test.ts` (cek mana yang benar-benar memerlukannya).
- Tambah test di `tests/api/standard-choice-guard.test.ts` (atau file baru `tests/api/choice-route-gate.test.ts`).

**Test cases:**
1. Bab 5 cerita publik, resolver `PAYMENT_REQUIRED` → 402; `queryChoiceOutcome`, `applyChoiceToUserState`, `maybeGrantAuthorTinta`, `continueStandardGeneration` TIDAK dipanggil.
2. Resolver `NOT_AUTHORIZED` (mis. non-pemilik cerita komersial yang jatuh ke jalur standar) → 403, tanpa efek samping.
3. Bab 2 `FREE_STANDARD` → perilaku lama (outcome dikembalikan, state diterapkan).
4. Pemilik cerita standar dengan bab readable → `continueStandardGeneration` tetap terpanggil (generate-dari-nol tidak rusak).

## Task 5: Pemilik cerita komersial tidak terkunci saat cerita di-set publik

**Bug:** `resolveChapterAccess` jalur komersial mengembalikan `NOT_AUTHORIZED` bila `visibility` bukan `private`/`unlisted`, SETELAH cek pemilik. Route `PATCH /api/stories/[id]/visibility` mengizinkan pemilik men-set `public`, jadi pemilik cerita personalized yang membagikan ceritanya terkunci dari bab miliknya sendiri. Non-pemilik sudah ditolak oleh cek pemilik sebelumnya, jadi cek visibilitas tidak menambah keamanan.

**Files:**
- Modify `lib/credits/access-resolver.server.ts`: hapus blok `if (story.visibility && story.visibility !== 'private' && story.visibility !== 'unlisted')`. Cek pemilik tetap.
- Test di `tests/credits/shared-unlock.test.ts` (atau file baru): 
  1. `personalized_ai` origin `PAID_START`, visibility `public`, pemilik, Bab 2 → readable `PAID_START_INCLUDED`.
  2. Cerita yang sama, user lain → `NOT_AUTHORIZED`.
  3. Cerita yang sama, tamu → `NOT_AUTHORIZED`.
