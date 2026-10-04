# RLS Policy Audit & Explicit Guard Matrix (Neon Migration Phase A)

**Generated:** 2026-10-04  
**Worktree:** `D:\Coding\lakoku v2\.worktrees\feat-neon-phase-a`  
**Autoritas Sumber:** Skema live Supabase (`pg_policies`) direkonsiliasi terhadap `supabase/migrations/*.sql`.  
**Tujuan Dokumen:** Memetakan seluruh kebijakan Row Level Security (RLS) PostgreSQL yang dipensiunkan di Neon ke penjaga aplikasi eksplisit (`APP_GUARD`), klausa filter baru (`NEW_WHERE`), atau diklasifikasikan sebagai tidak diperlukan (`UNNECESSARY`). Dokumen ini menjadi rujukan wajib bagi Task 8–11 saat menulis ulang query database ke Kysely.

---

## 1. Ringkasan Eksekutif & Statistik Klasifikasi

Total kebijakan RLS live yang diaudit: **44 policies** pada **30 tabel**.

| Klasifikasi | Jumlah Policy | Deskripsi |
|---|---|---|
| **APP_GUARD** | **30** | Penjagaan sudah ditegakkan secara penuh oleh kode aplikasi yang ada (otorisasi sesi, route guard, verifikasi kepemilikan eksplisit, atau referensi data publik tanpa batasan baris). |
| **NEW_WHERE** | **7** | Query aplikasi yang ada saat ini bergantung pada RLS implisit dari Supabase. **Wajib ditambahkan klausul `WHERE` eksplisit** saat migrasi ke Kysely (Task 8–11). |
| **UNNECESSARY** | **7** | Kebijakan yang menargetkan `service_role` (bypass RLS bawaan di server), tabel internal tanpa reader di aplikasi, atau policy write usang tanpa mutasi pemanggil. |
| **TOTAL** | **44** | **100% dari seluruh kebijakan RLS aktif.** |

---

## 2. Daftar Wajib Tindakan (MANDATORY NEW_WHERE Work Items)

Query dan rute di bawah ini **TIDAK MEMILIKI** filter kepemilikan/visibilitas di kode TypeScript saat ini karena sebelumnya bergantung pada RLS Supabase. Pada engine Neon (single application role tanpa RLS), query-query ini akan membocorkan data privat lintas pengguna jika tidak ditambahkan klausul `WHERE` eksplisit pada Tasks 8–11.

### Work Item 1: `queryStories()` — Filter Katalog Publik
- **File Target:** `lib/api/queries.ts:98,100` (atau Kysely replacement di Task 8)
- **Fungsi:** `export const queryStories = cache(async function queryStories()...)` (saat ini tanpa argumen di `lib/api/queries.ts:98`)
- **Policy Terdampak:** `#36 stories_owner_read`, `#37 stories_public_read`
- **Kondisi Eksplisit Baru:**
  ```sql
  WHERE visibility = 'public'
  ```
  *(Catatan: `queryStories` saat ini tidak menerima argumen (`lib/api/queries.ts:98`), sehingga penerapan kondisi `visibility = 'public' OR owner_user_id = :userId` memerlukan penambahan parameter opsional `userId` pada signature fungsinya — task rewrite wajib menambahkan ini).*

### Work Item 2: `queryStory(id)` — Filter Detail Cerita Tunggal
- **File Target:** `lib/api/queries.ts:110` (atau Kysely replacement di Task 8)
- **Fungsi:** `export const queryStory = cache(async function queryStory(id: string)...)`
- **Policy Terdampak:** `#36 stories_owner_read`, `#37 stories_public_read`
- **Kondisi Eksplisit Baru:**
  ```sql
  WHERE id = :id AND (visibility = 'public' OR owner_user_id = :userId)
  ```
  *(Rekomendasi arsitektur: delegasikan langsung ke `queryStoryForUser(id, userId)` yang sudah memiliki logika guard ini).*

### Work Item 3: `authorizeParentWithCookieRls` — Otorisasi Pilihan Personal
- **File Target:** `lib/api/personalized-choice.server.ts:178`
- **Fungsi:** `authorizeParentWithCookieRls(userId: string, storyId: string)`
- **Policy Terdampak:** `#36 stories_owner_read`, `#37 stories_public_read`
- **Kondisi Eksplisit Baru:**
  ```sql
  WHERE id = :storyId AND (visibility = 'public' OR owner_user_id = :userId)
  ```

### Work Item 4: `getReaderStates()` — Daftar Progres Membaca Koleksiku
- **File Target:** `lib/api/user-state.ts:118` (atau Kysely replacement di Task 8)
- **Fungsi:** `export const getReaderStates = cache(async function getReaderStates()...)`
- **Policy Terdampak:** `#22 reader_states_owner`
- **Kondisi Eksplisit Baru:**
  ```sql
  WHERE user_id = :userId
  ```

### Work Item 5: `getReaderState(storyId)` — Progres Membaca Cerita Spesifik
- **File Target:** `lib/api/user-state.ts:134` (atau Kysely replacement di Task 8)
- **Fungsi:** `export const getReaderState = cache(async function getReaderState(storyId: string)...)`
- **Policy Terdampak:** `#22 reader_states_owner`
- **Kondisi Eksplisit Baru:**
  ```sql
  WHERE story_id = :storyId AND user_id = :userId
  ```

### Work Item 6: Fallback Pilihan Standar — Otorisasi Bab & Outcome
- **File Target:** `app/api/stories/[id]/choices/route.ts:132`
- **Fungsi:** `POST(req, { params })` (jalur fallback setelah catch `NOT_PERSONALIZED_STORY`)
- **Policy Terdampak:** `#10 chapters_owner_read`, `#11 chapters_public_read`, `#12 choice_outcomes_owner_read`, `#13 choice_outcomes_public_read`
- **Kondisi Eksplisit Baru:**
  Otorisasi cerita induk sebelum membaca outcome dan bab:
  ```typescript
  const story = await queryStoryForUser(id, user?.id ?? null);
  if (!story) {
    return NextResponse.json({ error: 'Pilihan tidak dikenali.' }, { status: 404 });
  }
  ```

---

## 3. Matriks Audit Lengkap Kebijakan RLS (44 Policies)

Format Kolom:
`# | Policy Name (Migrasi:Baris) | Tabel | Role | Perilaku RLS Asal | Klasifikasi | Bukti Penjagaan (file:line) | Catatan / Tindakan`

| # | Policy Name (Migrasi:Baris) | Tabel | Role | Perilaku RLS Asal | Klasifikasi | Bukti Penjagaan (file:line) | Catatan / Tindakan |
|---|---|---|---|---|---|---|---|
| 1 | `blueprint_audit_log_owner_admin_select`<br>`(20260823100300_e5_blueprint_rls.sql:35)` | `blueprint_audit_log` | authenticated | SELECT: `(SELECT e5_is_owner_admin())` | **APP_GUARD** | `lib/runtime/blueprint-workflow.server.ts:34` | Endpoint review dan view log audit dilindungi oleh pemanggilan `requireAdminUser()`. |
| 2 | `blueprint_audit_log_service_role_select`<br>`(20260823100300_e5_blueprint_rls.sql:52)` | `blueprint_audit_log` | service_role | SELECT: `true` | **UNNECESSARY** | `lib/runtime/blueprint-workflow.server.ts:34` | Menargetkan `service_role`. Eksekusi server bypass RLS secara bawaan di PostgreSQL. |
| 3 | `blueprint_queue_owner_admin_select`<br>`(20260823100300_e5_blueprint_rls.sql:7)` | `blueprint_queue` | authenticated | SELECT: `(SELECT e5_is_owner_admin())` | **APP_GUARD** | `lib/runtime/blueprint-workflow.server.ts:34` | Fungsi `getPendingReviews()` memeriksa `requireAdminUser()` sebelum mengeksekusi query. |
| 4 | `blueprint_queue_owner_admin_update`<br>`(20260823100300_e5_blueprint_rls.sql:14)` | `blueprint_queue` | authenticated | UPDATE: `status = 'PENDING' AND e5_is_owner_admin()` | **APP_GUARD** | `lib/runtime/blueprint-workflow.server.ts:64-74` | Operasi CAS atomik memeriksa `.eq('status', 'PENDING')` dalam fungsi `claimQueueItem()` di bawah pengawasan admin. |
| 5 | `blueprint_queue_service_role_all`<br>`(20260823100300_e5_blueprint_rls.sql:42)` | `blueprint_queue` | service_role | ALL: `true` | **UNNECESSARY** | `lib/runtime/blueprint-workflow.server.ts:65` | Target `service_role`; background worker bypass RLS. |
| 6 | `blueprint_resolutions_owner_admin_select`<br>`(20260823100300_e5_blueprint_rls.sql:28)` | `blueprint_resolutions` | authenticated | SELECT: `(SELECT e5_is_owner_admin())` | **APP_GUARD** | `app/api/blueprint-review/[id]/route.ts:51` | Route review blueprint mengunci eksekusi dengan `requireAdminUser()`. |
| 7 | `blueprint_resolutions_service_role_select`<br>`(20260823100300_e5_blueprint_rls.sql:48)` | `blueprint_resolutions` | service_role | SELECT: `true` | **UNNECESSARY** | `app/api/blueprint-review/[id]/route.ts:51` | Target `service_role`; server backend bypass RLS. |
| 8 | `blueprint_validator_proofs_owner_admin_select`<br>`(20260823100250_e5_blueprint_validator_proofs.sql:190)` | `blueprint_validator_proofs` | authenticated | SELECT: `(SELECT e5_is_owner_admin())` | **APP_GUARD** | `app/api/blueprint-review/[id]/route.ts:51` | Bukti tinjauan validator hanya dibaca melalui RPC SECURITY DEFINER `e5_record_resolution_v1` setelah melewati `requireAdminUser()`. |
| 9 | `blueprint_validator_proofs_service_role_select`<br>`(20260823100250_e5_blueprint_validator_proofs.sql:195)` | `blueprint_validator_proofs` | service_role | SELECT: `true` | **UNNECESSARY** | `app/api/blueprint-review/[id]/route.ts:51` | Target `service_role`; server bypass RLS. |
| 10 | `chapters_owner_read`<br>`(20260713000000_personalized_story_engine.sql:145)` | `chapters` | authenticated | SELECT: `story_is_owned_by_auth(story_id)` | **NEW_WHERE** | `app/api/stories/[id]/choices/route.ts:132`<br>*(Lihat juga `lib/api/server.ts:175,216,241`)* | Jalur Server Component aman via `getStory()`. Namun, pada `POST /api/stories/[id]/choices` fallback standar wajib ditambahkan validasi otorisasi cerita induk. |
| 11 | `chapters_public_read`<br>`(20260713000000_personalized_story_engine.sql:142)` | `chapters` | anon, authenticated | SELECT: `story_is_public(story_id)` | **NEW_WHERE** | `app/api/stories/[id]/choices/route.ts:132`<br>*(Lihat juga `lib/api/server.ts:175,216,241`)* | Sama dengan policy #10. Otorisasi cerita induk wajib ditegakkan sebelum membaca bab pada rute choices. |
| 12 | `choice_outcomes_owner_read`<br>`(20260713000000_personalized_story_engine.sql:154)` | `choice_outcomes` | authenticated | SELECT: `story_is_owned_by_auth(story_id)` | **NEW_WHERE** | `app/api/stories/[id]/choices/route.ts:132`<br>*(Lihat juga `lib/api/server.ts:175`)* | Query outcome untuk cerita privat wajib dipagari otorisasi cerita pemilik. |
| 13 | `choice_outcomes_public_read`<br>`(20260713000000_personalized_story_engine.sql:151)` | `choice_outcomes` | anon, authenticated | SELECT: `story_is_public(story_id)` | **NEW_WHERE** | `app/api/stories/[id]/choices/route.ts:132`<br>*(Lihat juga `lib/api/server.ts:175`)* | Rute pilihan wajib memastikan cerita berstatus publik atau dimiliki pembaca sebelum mengekstrak outcome pilihan. |
| 14 | `credit_ledger_own_read`<br>`(20260708000000_paycore_credit_model.sql:113)` | `credit_ledger` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/credits/server.ts:57,72`; `lib/credits/access-resolver.server.ts:57,132` | Seluruh query membaca ledger memfilter eksplisit `.eq('user_id', userId)` dan saldo dihitung via RPC `credit_balance_v1(p_user_id)`. |
| 15 | `credit_orders_own_read`<br>`(20260711010000_ops_credit_config.sql:82)` | `credit_orders` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/entitlement/store.server.ts:78`; `lib/paycore/client.ts:159`; `lib/admin/orders.ts:27` | Snapshot order diakses spesifik via `order_id` (webhook token) atau rute admin terlindungi `requireAdminUser()`. |
| 16 | `credit_orders_v2_own_read`<br>`(20260917120000_play_billing_channel_model.sql:68)` | `credit_orders_v2` | public | SELECT: `auth.uid() = user_id` | **UNNECESSARY** | `neon/migrations/20260917120000_play_billing_channel_model.sql:99` | Tabel internal kanal Google Play Billing tanpa reader query di aplikasi web; mutasi ditangani oleh RPC `record_play_billing_order_v1`. |
| 17 | `credit_products_read`<br>`(20260708000000_paycore_credit_model.sql:118)` | `credit_products` | public | SELECT: `true` | **APP_GUARD** | `lib/paycore/products.ts:64,78,94` | Data katalog publik tanpa batasan baris (`qual: true`). Query aplikasi memfilter produk aktif `.eq('active', true)` atau berdasarkan ID. |
| 18 | `feature_credit_costs_read`<br>`(20260711010000_ops_credit_config.sql:293)` | `feature_credit_costs` | public | SELECT: `true` | **APP_GUARD** | `lib/credits/server.ts:38`; `lib/credits/access-resolver.server.ts:78` | Data tarif publik tanpa batasan baris (`qual: true`). Query aplikasi memfilter spesifik berdasarkan kolom `feature_key`. |
| 19 | `generation_policy_read`<br>`(20260711010000_ops_credit_config.sql:225)` | `generation_policy` | public | SELECT: `true` | **APP_GUARD** | `lib/ops/generation-policy.ts:56` | Konfigurasi global singleton tanpa batasan baris (`qual: true`). Diakses melalui `.eq('id', true)`. |
| 20 | `mission_policy_read`<br>`(20260918000000_gamified_missions_ads.sql:53)` | `mission_policy` | public | SELECT: `true` | **APP_GUARD** | `lib/missions/server.ts:25` | Konfigurasi global singleton tanpa batasan baris (`qual: true`). Diakses melalui `.eq('id', true)`. |
| 21 | `push_devices_own_read`<br>`(20260921000000_push_devices.sql:27)` | `push_devices` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `app/api/push/unsubscribe/route.ts:26,35`; `app/api/push/subscribe/route.ts:24` | Route subscribe/unsubscribe selalu menyematkan ID pengguna sesi terverifikasi (`auth.user.id`). |
| 22 | `reader_states_owner`<br>`(20260713000000_personalized_story_engine.sql:164)` | `reader_states` | authenticated | ALL: `user_id = auth.uid()` | **NEW_WHERE** | `lib/api/user-state.ts:118,134` | `getReaderStates()` dan `getReaderState()` tidak memfilter `user_id` di kode query. WAJIB ditambahkan `.eq('user_id', user.id)` saat rewrite. |
| 23 | `reader_taste_profiles_insert_self`<br>`(20260711000000_reader_taste_profiles.sql:29)` | `reader_taste_profiles` | authenticated | INSERT: `auth.uid() = user_id` | **APP_GUARD** | `lib/api/taste-profile.ts:71` | Fungsi `saveTasteProfileForUser` memasukkan nilai `user_id: userId` dari sesi terautentikasi. |
| 24 | `reader_taste_profiles_select_self`<br>`(20260711000000_reader_taste_profiles.sql:21)` | `reader_taste_profiles` | authenticated | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/api/taste-profile.ts:44` | Query membaca secara eksplisit memfilter `.eq('user_id', userId)`. |
| 25 | `reader_taste_profiles_update_self`<br>`(20260711000000_reader_taste_profiles.sql:37)` | `reader_taste_profiles` | authenticated | UPDATE: `auth.uid() = user_id` | **APP_GUARD** | `lib/api/taste-profile.ts:68-76` | Operasi upsert mengunci baris target pada `onConflict: 'user_id'`. |
| 26 | `reading_policy_read`<br>`(20260708100000_reading_policy.sql:18)` | `reading_policy` | public | SELECT: `true` | **APP_GUARD** | `lib/credits/server.ts:28` | Konfigurasi global singleton tanpa batasan baris (`qual: true`). Diakses melalui `.eq('id', true)`. |
| 27 | `referral_attributions_own_read`<br>`(20260917000000_dompet_imbalan_referral.sql:39)` | `referral_attributions` | public | SELECT: `(auth.uid() = referrer_user_id) OR (auth.uid() = referred_user_id)` | **APP_GUARD** | `lib/rewards/server.ts:176`; `lib/rewards/commission.server.ts:28` | Query aplikasi secara eksplisit memfilter `.eq('referrer_user_id', userId)` atau `.eq('referred_user_id', userId)`. |
| 28 | `referral_codes_own_read`<br>`(20260917000000_dompet_imbalan_referral.sql:17)` | `referral_codes` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/rewards/server.ts:67,89` | Query aplikasi secara eksplisit membatasi pencarian dengan `.eq('user_id', userId)`. |
| 29 | `reward_ledger_own_read`<br>`(20260917000000_dompet_imbalan_referral.sql:58)` | `reward_ledger` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/rewards/server.ts:180` | Query membaca secara eksplisit memfilter `.eq('user_id', userId)` dan kalkulasi saldo diproses melalui RPC `reward_balance_v1(p_user_id)`. |
| 30 | `reward_policy_read`<br>`(20260917000000_dompet_imbalan_referral.sql:141)` | `reward_policy` | public | SELECT: `true` | **APP_GUARD** | `lib/rewards/server.ts:27` | Konfigurasi global singleton tanpa batasan baris (`qual: true`). Diakses melalui `.eq('id', true)`. |
| 31 | `shared_story_links_insert_owner`<br>`(20260710010000_shared_story_links.sql:64)` | `shared_story_links` | authenticated | INSERT: `auth.uid() = owner_user_id` | **APP_GUARD** | `lib/api/share.ts:233` | Insert tautan share mengikat eksplisit `owner_user_id: user.id` dari session. |
| 32 | `shared_story_links_select_active`<br>`(20260710010000_shared_story_links.sql:54)` | `shared_story_links` | public | SELECT: `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())` | **APP_GUARD** | `lib/api/share.ts:270-271,282,392-395` | Kode aplikasi memeriksa status `revoked_at` dan tanggal `expires_at` pada saat resolve share link. |
| 33 | `shared_story_links_update_owner`<br>`(20260710010000_shared_story_links.sql:71)` | `shared_story_links` | authenticated | UPDATE: `auth.uid() = owner_user_id` | **UNNECESSARY** | `lib/api/share.ts` | Tidak ada pemanggil update untuk tabel ini di seluruh basis kode (dead writer policy). |
| 34 | `shared_story_starts_insert_self`<br>`(20260710010000_shared_story_links.sql:80)` | `shared_story_starts` | authenticated | INSERT: `auth.uid() = new_user_id` | **APP_GUARD** | `lib/api/share.ts:317,403` | Pencatatan share start mengikat eksplisit `new_user_id: user.id` dari sesi terotentikasi. |
| 35 | `shared_story_starts_select_self`<br>`(20260710010000_shared_story_links.sql:87)` | `shared_story_starts` | authenticated | SELECT: `auth.uid() = new_user_id` | **APP_GUARD** | `lib/api/share.ts:414,436,822` | Query aplikasi secara eksplisit menambahkan kriteria `.eq('new_user_id', user.id)`. |
| 36 | `stories_owner_read`<br>`(20260713000000_personalized_story_engine.sql:136)` | `stories` | authenticated | SELECT: `owner_user_id = auth.uid()` | **NEW_WHERE** | `lib/api/queries.ts:100,110`; `lib/api/personalized-choice.server.ts:185` | `queryStories()` dan `queryStory()` tidak membatasi kepemilikan/visibilitas di query. WAJIB ditambahkan klausul `WHERE visibility = 'public' OR owner_user_id = :userId`. |
| 37 | `stories_public_read`<br>`(20260713000000_personalized_story_engine.sql:133)` | `stories` | anon, authenticated | SELECT: `visibility = 'public'` | **NEW_WHERE** | `lib/api/queries.ts:100,110` | Sama dengan #36. Pembaca publik hanya boleh menerima cerita dengan `visibility = 'public'`. |
| 38 | `story_cover_candidates_owner_delete`<br>`(20260922000000_story_cover_candidates.sql:26)` | `story_cover_candidates` | public | DELETE: `auth.uid() = user_id` | **APP_GUARD** | `lib/cover/server.ts` | Tidak ada penghapusan langsung dari client; siklus hidup dikelola lewat cascade dan RPC internal `record_story_cover_candidate_v1`. |
| 39 | `story_cover_candidates_owner_select`<br>`(20260922000000_story_cover_candidates.sql:22)` | `story_cover_candidates` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/cover/server.ts:153` | Query eksplisit memfilter `.eq('story_id', storyId).eq('user_id', userId)`. |
| 40 | `scd_owner_read`<br>`(20260724100000_reconcile_choice_routes_and_creative_direction.sql:23)` | `story_creative_directions` | authenticated | SELECT: `owner_user_id = auth.uid()` | **APP_GUARD** | `lib/authoring/persist-creative-direction.ts:68,104` | Penulisan mengikat `owner_user_id: args.ownerUserId`; pembacaan saat generasi dijalankan via server runtime admin client. |
| 41 | `sgc_owner_read`<br>`(20260713000000_personalized_story_engine.sql:170)` | `story_generation_contracts` | authenticated | SELECT: `story_is_owned_by_auth(story_id)` | **UNNECESSARY** | `lib/api/personalized-stories.server.ts:439`; `lib/authoring/persist-creative-direction.ts:115` | Tabel kontrak internal engine; tidak pernah di-query langsung oleh pembaca; hanya diakses backend runtime via `createAdminClient()`. |
| 42 | `tinta_ledger_own_read`<br>`(20260919000000_lakoin_tinta_economy.sql:32)` | `tinta_ledger` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/tinta/server.ts:174` | Query riwayat mutasi memfilter eksplisit `.eq('user_id', userId)` dan saldo dihitung via RPC `tinta_balance_v1(p_user_id)`. |
| 43 | `tinta_policy_read`<br>`(20260919000000_lakoin_tinta_economy.sql:58)` | `tinta_policy` | public | SELECT: `true` | **APP_GUARD** | `lib/tinta/server.ts:40` | Konfigurasi global singleton tanpa batasan baris (`qual: true`). Diakses melalui `.eq('id', true)`. |
| 44 | `user_mission_daily_own_read`<br>`(20260918000000_gamified_missions_ads.sql:75)` | `user_mission_daily` | public | SELECT: `auth.uid() = user_id` | **APP_GUARD** | `lib/missions/server.ts:79` | Tidak ada SELECT langsung dari kode aplikasi. Akses dienkapsulasi oleh RPC SECURITY DEFINER `get_daily_missions_v1(p_user_id)` yang menerima `userId` dari sesi terotentikasi. |

---

## 4. Panduan Verifikasi untuk Implementasi Kysely (Task 8–11)

Setiap pengembang atau agent yang mengonversi query pada modul terkait wajib mematuhi aturan berikut:
1. **Dilarang keras mengeksekusi `selectFrom('stories')` tanpa menyertakan `.where('visibility', '=', 'public')` atau `.where(eb => eb.or([eb('visibility', '=', 'public'), eb('owner_user_id', '=', userId)]))`.**
2. **Dilarang keras mengeksekusi `selectFrom('reader_states')` tanpa klausa `.where('user_id', '=', userId)`.**
3. Seluruh unit test pada Task 8–11 harus menambahkan test case "Isolation Guard":
   - Memastikan bahwa pengguna anonim tidak dapat melihat cerita non-publik pengguna lain.
   - Memastikan bahwa `getReaderStates()` untuk User A tidak pernah mengembalikan data milik User B.
