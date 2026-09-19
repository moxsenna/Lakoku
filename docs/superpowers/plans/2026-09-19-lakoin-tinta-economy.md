# Lakoin & Tinta — Ekonomi 3 Lapis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyatukan ekonomi Lakoku ke tiga lapis mata uang — **Lakoin** (hard currency, rename display dari "Kredit" yang ada sekarang), **Tinta** (soft currency baru dari misi harian + reward penulis, ditukar manual ke Lakoin), dan **Imbalan** (dompet komisi referral Rupiah yang SUDAH ada, tidak berubah) — ditambah toggle publikasi cerita (private/public) yang membuka etalase beranda dan reward penulis.

**Architecture:** Lakoin = rename display murni; kolom DB tetap `credits`, logika paycore/credit_ledger TIDAK berubah. Tinta = event-sourced ledger baru `tinta_ledger` (idempotency via `ref` unik, pola identik `credit_ledger`/`reward_ledger`) dengan kolom `pending_until` (jendela anomali 24 jam khusus reward penulis). Reward penulis menyala dari hook server-side di `app/api/stories/[id]/choices/route.ts` SETELAH pilihan pembaca sukses di-apply — dedupe lewat unique ref `author_read:{storyId}:{chapter}:{readerId}` (pembaca ulang tidak membayar lagi), batas harian penulis 300 Tinta (hari WIB) ditegakkan atomik di dalam RPC. Semua knob dikendalikan dari `/admin/settings` lewat tabel baris-tunggal `tinta_policy` (pola `reward_policy`/`mission_policy`) dengan audit log.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL, RLS, RPC security definer), TypeScript strict mode, Zod, Vitest, smoke runner `scripts/run-smoke.cjs`, Tailwind CSS, Lucide icons.

## Global Constraints

- **DILARANG mengubah logika paycore/credit_ledger** — Lakoin hanya rename display. Tidak ada kolom baru di `credit_products`/`credit_ledger` untuk fitur ini.
- **DILARANG approval manual / gerbang kualitas** untuk reward penulis — keputusan PM final. Pagar = idempotensi + dedupe + cap harian + pending 24 jam, semuanya otomatis.
- **Arus satu arah:** Tinta → Lakoin (manual, via "Tukar"). Lakoin TIDAK PERNAH jadi Tinta. Tinta TIDAK bisa dibeli dengan uang. Imbalan (Rp) TIDAK bisa dicairkan (Tarik Tunai tetap terkunci).
- **Fail-open non-fatal:** kegagalan grant Tinta reward penulis TIDAK BOLEH menggagalkan pilihan pembaca (pilihan sukses tetap tersimpan; reward di-skip + log).
- **Idempotensi pilihan adalah sumber kebenaran:** pembaca menyelesaikan bab DENGAN MEMBUAT PILIHAN (bukan sekadar buka halaman). Kunci dedupe reward = unique ref ledger; baca ulang / replay pilihan tidak pernah membayar dua kali.
- **Brand guard:** copy pembaca tanpa "AI", "model", "token", "ledger", "pending". "Lakoin" dan "Tinta" adalah istilah pembaca. Saldo tertunda ditampilkan sebagai "Sedang diproses".
- **Konfigurasi admin:** DILARANG hardcode kurs tukar, cap harian, nilai reward, pending hours, atau switch — semua dibaca dari `tinta_policy`.
- **Batas paket ESLint:** komponen membaca data lewat seam `lib/api/` / modul server-only domain (`lib/tinta/server.ts`, `lib/missions/server.ts`); tanpa deep imports internal; tanpa `as any`.
- **Mobile-first:** semua UI baru vertikal, sentuhan besar, sesi pendek; copy Bahasa Indonesia.

---

## 1. Ringkasan Eksekutif & Tabel Keputusan

Ekonomi Lakoku saat ini satu-mata-uang (Kredit) yang didanai inferensi berbayar per bab — hadiah gratis (misi) langsung menggerus margin. Keputusan yang diratifikasi PM:

1. **Lakoin** menggantikan nama tampilan "Kredit" di seluruh permukaan pembaca. Sumber Lakoin: top-up (PayCore web / Play Billing android), tukar dari Tinta, dan tukar dari Imbalan referral (sudah ada).
2. **Tinta** = soft currency baru. Sumber: (a) misi harian yang DIMIGRASI dari hadiah Kredit → Tinta lewat flag `missions_pay_tinta`; (b) reward penulis saat pembaca LAIN menyelesaikan bab dengan membuat pilihan di cerita publik milik penulis. Tinta ditukar MANUAL ke Lakoin via tombol "Tukar" di dompet.
3. **Imbalan** (komisi referral Rp, `reward_ledger`) tidak berubah sama sekali.
4. **Toggle publikasi cerita** (kolom `stories.visibility` SUDAH ADA: `private|unlisted|public`) dibuka di UI koleksi; cerita publik masuk etalase beranda dan eligible reward penulis. Share→clone yang ada tetap berjalan.

| Keputusan | Nilai | Catatan |
|---|---|---|
| Nama hard currency | **Lakoin** | Rename display; DB tetap `credits`, URL `/kredit` tetap |
| Nama soft currency | **Tinta** | Ledger baru `tinta_ledger` |
| Kurs tukar default | **100 Tinta = 1 Lakoin** | Knob `tinta_per_lakoin` (10..100000) |
| `tinta_per_read` | **10 Tinta / bab** (usulan) | Per penulis per bab selesai (dengan pilihan) |
| `author_daily_cap` | **300 Tinta / hari** | Hari kalender Asia/Jakarta (WIB) |
| Jendela pending | **24 jam** | Hanya reward penulis; misi langsung tersedia |
| `exchange_min_lakoin` | **1 Lakoin** | Pecahan Tinta tersisa tetap di saldo |
| `author_rewards_enabled` | `false` (default mati) | Prasyarat rilis: pengukuran biaya |
| `exchange_enabled` | `false` (default mati) | Prasyarat rilis: harga Lakoin final |
| `missions_pay_tinta` | `false` (default mati) | Flag migrasi misi; saat `true` misi grant Tinta |
| Reward misi (Tinta) | checkin 5 · choice 10 · ad_batch 10 (usulan) | Knob per jenis misi di `tinta_policy` |
| Eligibility reward penulis | `visibility = 'public'` + `owner ≠ reader` + bab 1..49 | Guest tidak menghasilkan reward |
| Dedupe reward | `ref = author_read:{storyId}:{chapter}:{readerId}` UNIQUE | Baca ulang tidak membayar |

## 2. Peta Ekonomi 3 Lapis (Diagram Alur Teks)

```
                        [UANG (Rupiah)]
                         /           \
        top-up (PayCore web /          komisi referral 10%
        Play Billing android)          (reward_policy, existing)
                       /                        \
                 [LAKOIN] <--- tukar --- [IMBALAN (Rp)]   <-- TIDAK BERUBAH
                    ^  ^                        |
                    |  |                        | redeem (kurs Rp/Lakoin, existing)
   unlock bab       |  +--- tukar manual ---[TINTA] <=== "Tukar" di dompet
   premium          |         (100 Tinta = 1 Lakoin, manual, konfirmasi)
                    |                          ^
                                    +---------+---------+
                                    |                   |
                             [MISI HARIAN]      [REWARD PENULIS]
                             flag missions_pay_tinta    pembaca LAIN menyelesaikan bab
                             checkin/choice/ad          (MEMBUAT PILIHAN) di cerita
                             langsung tersedia          PUBLIC milikmu; cap 300/hari;
                                                        PENDING 24 jam sebelum bisa ditukar
```

Aturan keras:

- Lakoin unlock bab premium (mekanisme `spend_credits_v1`, `unlock:{storyId}:{chapter}` — TIDAK berubah).
- Tinta tidak pernah bisa membeli apa pun selain ditukar ke Lakoin; tidak bisa dibeli dengan uang.
- Imbalan → Lakoin hanya via `redeemRewardCredits` yang sudah ada (kurs `redeem_rate_idr_per_credit`).
- Reward penulis hanya dari `visibility = 'public'`; `unlisted` dan `private` tidak eligible dan tidak masuk etalase.

## 3. Terminologi & Copy Guide (Apa yang Boleh Dilihat Pembaca)

| Istilah internal (boleh di kode/admin) | Copy pembaca (Bahasa Indonesia) | Dilarang muncul ke pembaca |
|---|---|---|
| `credits`, `credit_ledger`, `spend_credits_v1` | **Lakoin** | "Kredit" (nama tampilan lama), "token" |
| `tinta_ledger`, `pending_until` | **Tinta**; saldo tertunda = **"Sedang diproses (±24 jam)"** | "pending", "ledger", "event" |
| `reward_ledger`, komisi referral | **Imbalan** | "komisi", "rupiah elektronik" |
| exchange rate | **"100 Tinta = 1 Lakoin"** (teks utuh) | "kurs", "konversi", "rate" |
| `author_read_reward` | **"Ada pembaca menyelesaikan bab ceritamu"** | "reward event", "trigger" |
| `visibility public/private` | **"Publik" / "Privat"** | "unlisted" (tidak diekspos ke UI) |

- Angka: format `id-ID` (mis. `1.250 Tinta`).
- Semua pesan error reader-safe: "Tukar belum bisa diproses. Coba lagi nanti." — tanpa kode teknis.
- Halaman admin (`/admin/*`) bebas pakai istilah teknis.

## 4. Skema DB — Migration Sketch SQL

Satu file migration: `supabase/migrations/20260919000000_lakoin_tinta_economy.sql` (gaya terbaru mengikuti `20260917120000_play_billing_channel_model.sql`: idempotent, RLS wajib, revoke/grant eksplisit, seed `on conflict do nothing`).

```sql
-- ============================================================================
-- Lakoin & Tinta — Ekonomi 3 Lapis
-- Spec: docs/superpowers/plans/2026-09-19-lakoin-tinta-economy.md
-- Lakoin = rename display dari Kredit (tidak ada perubahan kolom/paycore).
-- ============================================================================

-- ===== 1) tinta_ledger: event-sourced soft currency =====
create table if not exists public.tinta_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         integer not null,          -- (+) earn, (-) tukar ke Lakoin
  reason        text not null,             -- 'mission_checkin' | 'mission_choice' |
                                           -- 'mission_ad_batch' | 'author_read_reward' |
                                           -- 'tinta_exchange' | 'tinta_exchange_rollback'
  ref           text not null unique,      -- idempotency key (pola credit_ledger.ref)
  pending_until timestamptz,               -- non-null = masih jendela anomali 24 jam
  created_at    timestamptz not null default now()
);

create index if not exists tinta_ledger_user_idx
  on public.tinta_ledger (user_id, created_at desc);

-- Cap harian penulis: pemindaian per (penulis, hari WIB) pada reason tertentu.
create index if not exists tinta_ledger_author_day_idx
  on public.tinta_ledger (
    user_id, ((timezone('Asia/Jakarta', created_at))::date)
  ) where reason = 'author_read_reward';

alter table public.tinta_ledger enable row level security;

drop policy if exists tinta_ledger_own_read on public.tinta_ledger;
create policy tinta_ledger_own_read on public.tinta_ledger
  for select using (auth.uid() = user_id);
-- Tidak ada policy write: tulis hanya via service_role / RPC security definer.

-- ===== 2) tinta_policy: konfigurasi baris tunggal (pola reward_policy) =====
create table if not exists public.tinta_policy (
  id boolean primary key default true check (id = true),
  tinta_per_read          integer not null default 10   check (tinta_per_read >= 0 and tinta_per_read <= 1000),
  author_daily_cap        integer not null default 300  check (author_daily_cap >= 0 and author_daily_cap <= 100000),
  tinta_checkin           integer not null default 5    check (tinta_checkin >= 0 and tinta_checkin <= 1000),
  tinta_choice            integer not null default 10   check (tinta_choice >= 0 and tinta_choice <= 1000),
  tinta_ad_batch          integer not null default 10   check (tinta_ad_batch >= 0 and tinta_ad_batch <= 1000),
  tinta_per_lakoin        integer not null default 100  check (tinta_per_lakoin >= 10 and tinta_per_lakoin <= 100000),
  exchange_min_lakoin     integer not null default 1    check (exchange_min_lakoin >= 1 and exchange_min_lakoin <= 10000),
  pending_hours           integer not null default 24   check (pending_hours >= 0 and pending_hours <= 168),
  author_rewards_enabled  boolean not null default false,
  exchange_enabled        boolean not null default false,
  missions_pay_tinta      boolean not null default false,
  updated_at              timestamptz not null default now()
);

insert into public.tinta_policy (id) values (true) on conflict (id) do nothing;

alter table public.tinta_policy enable row level security;

drop policy if exists tinta_policy_read on public.tinta_policy;
create policy tinta_policy_read on public.tinta_policy
  for select using (true);

-- ===== 3) grant_tinta_v1: tulis entri ledger idempoten =====
create or replace function public.grant_tinta_v1(
  p_user_id uuid,
  p_ref text,
  p_delta integer,
  p_reason text,
  p_pending_hours integer default 0
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_delta = 0 then
    raise exception 'grant_tinta_v1: delta cannot be zero';
  end if;

  insert into public.tinta_ledger (user_id, delta, reason, ref, pending_until)
  values (
    p_user_id, p_delta, p_reason, p_ref,
    case when p_pending_hours > 0
         then now() + make_interval(hours => p_pending_hours)
         else null end
  );
  return true;
exception
  when unique_violation then
    return false;   -- sudah pernah diterbitkan: idempoten
end;
$$;

revoke all on function public.grant_tinta_v1(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.grant_tinta_v1(uuid, text, integer, text, integer) to service_role;

-- ===== 4) tinta_balance_v1: saldo total / tersedia / tertunda =====
create or replace function public.tinta_balance_v1(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_build_object(
    'total',
      coalesce(sum(delta), 0),
    'available',
      coalesce(sum(case when pending_until is null or pending_until <= now()
                        then delta else 0 end), 0),
    'pending',
      coalesce(sum(case when pending_until > now()
                        then delta else 0 end), 0)
  ), '{"total":0,"available":0,"pending":0}'::jsonb)
  from public.tinta_ledger
  where user_id = p_user_id;
$$;

revoke all on function public.tinta_balance_v1(uuid) from public, anon, authenticated;
grant execute on function public.tinta_balance_v1(uuid) to authenticated, service_role;

-- ===== 5) spend_tinta_v1: debit untuk penukaran (cek saldo TERSEDIA atomik) =====
create or replace function public.spend_tinta_v1(
  p_user_id uuid,
  p_ref text,
  p_amount integer,
  p_reason text
) returns text   -- 'ok' | 'insufficient' | 'duplicate'
language plpgsql security definer set search_path = public
as $$
declare
  v_available integer;
begin
  if p_amount <= 0 then
    raise exception 'spend_tinta_v1: amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.tinta_ledger where ref = p_ref) then
    return 'duplicate';
  end if;

  select coalesce(sum(case when pending_until is null or pending_until <= now()
                           then delta else 0 end), 0)::int
    into v_available
  from public.tinta_ledger
  where user_id = p_user_id;

  if v_available < p_amount then
    return 'insufficient';
  end if;

  insert into public.tinta_ledger (user_id, delta, reason, ref)
  values (p_user_id, -p_amount, p_reason, p_ref);

  return 'ok';
end;
$$;

revoke all on function public.spend_tinta_v1(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.spend_tinta_v1(uuid, text, integer, text) to service_role;

-- ===== 6) grant_author_tinta_v1: reward penulis, semua pagar ditegakkan di sini =====
-- Return: 'ok' | 'duplicate' | 'capped' | 'disabled' | 'ineligible'
create or replace function public.grant_author_tinta_v1(
  p_reader_id uuid,
  p_story_id text,
  p_chapter_number integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_policy    public.tinta_policy%rowtype;
  v_owner     uuid;
  v_visibility text;
  v_ref       text;
  v_today     date := (timezone('Asia/Jakarta', now()))::date;
  v_earned    integer;
begin
  select * into v_policy from public.tinta_policy where id = true;
  if not found or not v_policy.author_rewards_enabled then
    return 'disabled';
  end if;

  if p_chapter_number < 1 or p_chapter_number > 49 then
    return 'ineligible';   -- bab 50 = ending, tanpa pilihan
  end if;

  select owner_user_id, visibility into v_owner, v_visibility
  from public.stories where id = p_story_id;
  if not found then
    return 'ineligible';
  end if;
  if v_visibility <> 'public' then
    return 'ineligible';
  end if;
  if v_owner is null or v_owner = p_reader_id then
    return 'ineligible';   -- baca cerita sendiri tidak membayar
  end if;

  v_ref := 'author_read:' || p_story_id || ':' || p_chapter_number::text
           || ':' || p_reader_id::text;
  if exists (select 1 from public.tinta_ledger where ref = v_ref) then
    return 'duplicate';    -- baca ulang tidak membayar
  end if;

  -- Cap harian atomik per penulis (kunci baris penulis).
  perform pg_advisory_xact_lock(hashtext(v_owner::text));

  select coalesce(sum(delta), 0)::int into v_earned
  from public.tinta_ledger
  where user_id = v_owner
    and reason = 'author_read_reward'
    and (timezone('Asia/Jakarta', created_at))::date = v_today;

  if v_earned + v_policy.tinta_per_read > v_policy.author_daily_cap then
    return 'capped';
  end if;

  insert into public.tinta_ledger
    (user_id, delta, reason, ref, pending_until)
  values
    (v_owner, v_policy.tinta_per_read, 'author_read_reward', v_ref,
     now() + make_interval(hours => v_policy.pending_hours));

  return 'ok';
end;
$$;

revoke all on function public.grant_author_tinta_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_author_tinta_v1(uuid, text, integer) to service_role;

-- ===== 7) Misi: branch grant Tinta vs Kredit =====
-- claim_mission_v1 di-create-or-replace: saat tinta_policy.missions_pay_tinta = true,
-- imbalan misi di-grant sebagai Tinta (langsung tersedia, pending_hours = 0) dengan
-- ref yang sama 'mission:{key}:{user}:{day}' (tabel berbeda, idempotensi tetap dari
-- PK user_mission_daily). Logika verifikasi bukti TIDAK berubah.
-- get_daily_missions_v1: tambahkan field 'currency' ('tinta' | 'lakoin') dan
-- nilai imbalan per misi dibaca dari tinta_policy saat flag menyala.
create or replace function public.get_daily_missions_v1(p_user_id uuid)
returns jsonb
-- ... (isi identik dengan 20260918000000_gamified_missions_ads.sql, dengan tambahan:)
--   v_tinta  public.tinta_policy%rowtype;
--   select * into v_tinta from public.tinta_policy where id = true;
--   'currency', case when coalesce(v_tinta.missions_pay_tinta, false) then 'tinta' else 'lakoin' end,
--   nilai 'credits' per misi = v_tinta.tinta_checkin / v_tinta.tinta_choice / v_tinta.ad_batch
--     bila missions_pay_tinta, selain itu mission_policy.checkin_credits dst. (fallback 0)
$$;
-- (versi lengkap ditulis verbatim di Task P5; grant execute service_role seperti semula)

create or replace function public.claim_mission_v1(p_user_id uuid, p_mission_key text)
returns text
-- ... (isi verifikasi bukti identik; pada blok grant akhir:)
--   v_amount := case p_mission_key
--     when 'daily_checkin' then v_tinta.tinta_checkin
--     when 'make_choice'   then v_tinta.tinta_choice
--     when 'watch_ad'      then v_tinta.tinta_ad_batch else 0 end;
--   if coalesce(v_tinta.missions_pay_tinta, false) and v_amount > 0 then
--     perform public.grant_tinta_v1(p_user_id, v_ref, v_amount,
--       'mission_' || p_mission_key, 0);
--   elsif v_credits > 0 then
--     perform public.grant_credits_v1(p_user_id, v_ref, v_credits,
--       'Misi harian: ' || p_mission_key);
--   end if;
$$;

revoke all on function public.claim_mission_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_mission_v1(uuid, text) to service_role;
```

Catatan skema:

- **Tidak ada kolom/konstanta baru di paycore.** `credit_ledger`, `credit_products`, `credit_orders*` tidak disentuh.
- `stories.visibility` SUDAH ADA (`20260707000000_core_runtime_baseline.sql`: default `private`, check `private|unlisted|public`) + partial index `stories_visibility_idx ... WHERE visibility = 'public'` — query etalase memakai index itu apa adanya.
- Rename Lakoin TIDAK menambah kolom apa pun. `user_mission_daily.credits_granted` tetap menyimpan angka imbalan (makna kolom berganti mengikuti flag).
- RPC `get_daily_missions_v1`/`claim_mission_v1` di-create-or-replace di migration yang sama; bagian verifikasi bukti (`personalized_choice_applications`, `admob_ssv_events`) TIDAK diubah.

## 5. Event Ledger & Aturan Penerbitan Event Tinta

`public.tinta_ledger` adalah buku besar event-sourced. Saldo TIDAK disimpan; saldo = agregasi (pola `credit_balance_v1`).

### 5.1 Jenis event & kapan diterbitkan

| reason | delta | penerbit | ref (idempotency) | pending |
|---|---|---|---|---|
| `mission_checkin` | +`tinta_checkin` | `claim_mission_v1` saat `missions_pay_tinta` | `mission:daily_checkin:{userId}:{dayWIB}` | 0 jam |
| `mission_choice` | +`tinta_choice` | idem, kunci misi `make_choice` | `mission:make_choice:{userId}:{dayWIB}` | 0 jam |
| `mission_ad_batch` | +`tinta_ad_batch` | idem, kunci misi `watch_ad` | `mission:watch_ad:{userId}:{dayWIB}` | 0 jam |
| `author_read_reward` | +`tinta_per_read` | hook pasca-pilihan di `app/api/stories/[id]/choices/route.ts` → `grant_author_tinta_v1` | `author_read:{storyId}:{chapter}:{readerId}` | `pending_hours` (24) |
| `tinta_exchange` | −(jumlah ditukar) | server action "Tukar" → `spend_tinta_v1` | `exchange:{uuid}` | — |
| `tinta_exchange_rollback` | +jumlah | kompensasi bila grant Lakoin gagal | `exchange-rollback:{uuid}` | — |

### 5.2 Aturan penerbitan

1. **Penerbitan reward penulis** terjadi hanya setelah pilihan pembaca sukses di-apply secara durabel:
   - Jalur personal (pemilik, `apply_personalized_choice_v2`): hook dipanggil hanya bila `result.replayed === false` dan status bukan `WAITING_FOR_CREDITS`.
   - Jalur standar (cerita publik/berbagi, `applyChoiceToUserState`): hook dipanggil setelah pemanggilan sukses (idempotensi final ada di unique ref ledger).
   - Hook = satu fungsi server-only `maybeGrantAuthorTinta({ readerUserId, storyId, chapterNumber })`, dibungkus try/catch — kegagalan dicatat ke log, TIDAK menggagalkan respons pilihan.
2. **Idempotensi:** semua tulis lewat unique `ref`; konflik = `duplicate` (return false / status) — tidak pernah dobel.
3. **Pending 24 jam:** hanya `author_read_reward` (kolom `pending_until`). Selama pending, Tinta terlihat di UI sebagai "Sedang diproses" dan TIDAK ikut saldo `available` (dihitung `tinta_balance_v1`, tanpa job/cron).
4. **Konversi pending → available:** otomatis by-time; `pending_until <= now()` saat agregasi. Tidak ada migrasi/worker.
5. **Cap harian:** ditegakkan DI DALAM `grant_author_tinta_v1` dengan advisory lock per penulis; hari = kalender `Asia/Jakarta` (reuse semantik `jakartaDay()` di `lib/missions/policy.ts`). Melebihi cap → status `capped`, tidak ada baris ditulis.
6. **Penukaran:** debit pakai `spend_tinta_v1` (advisory lock per user + cek saldo available) — dua penukaran paralel tidak bisa overdraft.

## 6. User Flows

### 6.1 Pembaca selesaikan bab → penulis dapat Tinta

1. Pembaca B (login) membuka cerita publik milik penulis A dari etalase beranda dan membaca bab N.
2. B membuat pilihan → `POST /api/stories/[id]/choices` (Idempotency-Key seperti sekarang).
3. Pilihan di-apply durabel (jalur standar → `applyChoiceToUserState`; respons pilihan TIDAK berubah bentuk).
4. Hook `maybeGrantAuthorTinta` dipanggil (non-fatal): RPC memvalidasi `author_rewards_enabled`, `visibility = 'public'`, `owner ≠ reader`, bab 1..49, ref belum ada, cap harian.
5. Berhasil → baris `tinta_ledger` (+10, `pending_until = now()+24h`) milik A; analytics `tinta_earned` (sisi server) / `author_reward_pending` (sisi admin dashboard, opsional).
6. A melihat saldo Tinta di dompet: "+10 — Sedang diproses"; setelah 24 jam pindah ke "Tersedia".
7. Dedupe: B membaca ulang bab N (atau replay pilihan) → ref sudah ada → `duplicate`, tidak membayar. B menyelesaikan bab N+1 → event baru. Pembaca C di bab N yang sama → event baru (dedupe per pasangan penulis-bab-pembaca).

### 6.2 Misi harian → Tinta

1. Pembaca buka `/misi`; snapshot `get_daily_missions_v1` kini membawa `currency: 'tinta'` saat `missions_pay_tinta` (UI menampilkan "+10 Tinta").
2. Pembaca menyelesaikan langkah (mis. 3 pilihan hari ini) dan menekan Klaim.
3. `claim_mission_v1` memverifikasi bukti (tidak berubah), lalu karena flag menyala memanggil `grant_tinta_v1(... 'mission_make_choice', 10, pending 0)` — langsung tersedia.
4. Saat flag dimatikan, misi kembali memberi Lakoin persis seperti sekarang (migrasi reversibel).

### 6.3 Tukar Tinta → Lakoin (manual, konfirmasi)

1. Pembaca buka `/profil/tinta` (dompet Tinta). Saldo: Tersedia + Sedang diproses + riwayat.
2. Tekan "Tukar" → dialog: input jumlah Tinta, kalkulator hasil (`floor(jumlah / 100)` Lakoin), teks kurs "100 Tinta = 1 Lakoin", konfirmasi eksplisit (tombol dua-tahap).
3. Server action `actExchangeTinta(amount)`: validasi `exchange_enabled`, min 1 Lakoin hasil, `spend_tinta_v1` (debit `exchange:{uuid}`), lalu `grant_credits_v1` (`tinta_exchange:{uuid}`) — bila grant gagal, rollback Tinta via `exchange-rollback:{uuid}` (pola `redeemRewardCredits`).
4. UI menampilkan "+N Lakoin", saldo Lakoin & Tinta ter-refresh (`revalidatePath`), analytics `tinta_exchanged`.
5. Sisa pecahan Tinta (< kurs) tetap di saldo available.

### 6.4 Toggle publik/privat cerita di Koleksiku

1. Pembaca buka `/koleksiku`; setiap kartu cerita miliknya (yang punya `owner_user_id`) menampilkan toggle "Privat / Publik" (klien kecil di server component).
2. Toggle memanggil `PATCH /api/stories/[id]/visibility` (via seam `lib/api/client.ts`); route memverifikasi `isStoryOwnedBy`, zod `StoryVisibilitySchema` (`private|public` — UI tidak menawarkan `unlisted`), menulis `stories.visibility`, analytics `story_visibility_changed`.
3. Cerita jadi publik: tampil di etalase beranda (rail cerita publik) + eligible reward penulis mulai pilihan BERIKUTNYA (tidak retroaktif).
4. Cerita kembali privat: hilang dari etalase; pembaca lain yang sudah punya `reader_states` kehilangan akses lanjutan (perilaku akses existing `queryStoryForUser`); Tinta yang sudah diterbitkan TIDAK ditarik.

## 7. Perubahan API / Seam

Prinsip: komponen TIDAK pernah import DB langsung; semua lewat `lib/api/client.ts` (browser) / modul server-only (RSC).

| # | Ubahan | Tipe | Kontrak |
|---|---|---|---|
| 7.1 | `packages/contracts/src/reader.ts` | Tambah | `StoryVisibilitySchema = z.enum(['private','unlisted','public'])`; `SetStoryVisibilityRequestSchema = z.object({ storyId: z.string().min(1).max(100), visibility: z.enum(['private','public']) }).strict()`; `SetStoryVisibilityResponseSchema = z.object({ ok: z.boolean(), visibility: StoryVisibilitySchema.optional(), error: z.string().optional() }).strict()` |
| 7.2 | `app/api/stories/[id]/visibility/route.ts` | Baru | `PATCH`: auth `getSessionUser` → `isStoryOwnedBy(id, user.id)` → zod parse body → update `stories.visibility` via admin client → `NextResponse.json(SetStoryVisibilityResponseSchema)`; 401/403/404/400 reader-safe |
| 7.3 | `lib/api/client.ts` | Tambah | `setStoryVisibility(storyId, visibility): Promise<SetStoryVisibilityResponse>` — fetch PATCH ke `API_BASE` |
| 7.4 | `lib/tinta/policy.ts` | Baru | Murni: `TintaPolicy` interface, `DEFAULT_TINTA_POLICY`, `calculateTintaExchange(amount, policy) → { lakoinOut, tintaSpent, remainderTinta }` (throw reader-safe bila di bawah minimum / dinonaktifkan), `authorRewardRef(storyId, chapter, readerId)` |
| 7.5 | `lib/tinta/server.ts` | Baru (server-only) | `getTintaPolicy()` (baca `tinta_policy`, fallback default, pola `getRewardPolicy`), `getTintaBalance(userId) → { total, available, pending }` via `tinta_balance_v1`, `listTintaHistory(userId, limit)`, `exchangeTintaForLakoin(userId, amount)` (paired spend+grant+rollback) |
| 7.6 | `lib/tinta/author-reward.server.ts` | Baru (server-only) | `maybeGrantAuthorTinta({ readerUserId, storyId, chapterNumber }) → Promise<void>` — non-fatal, try/catch total, memanggil `grant_author_tinta_v1` |
| 7.7 | `app/api/stories/[id]/choices/route.ts` | Modif | Panggil `maybeGrantAuthorTinta` di 2 titik: (a) jalur personal setelah sukses & `!result.replayed` & status bukan `WAITING_FOR_CREDITS`; (b) jalur standar setelah `applyChoiceToUserState`. Kontrak respons route TIDAK berubah |
| 7.8 | `lib/missions/policy.ts` | Modif | `MissionView` tambah field opsional `currency?: 'lakoin' \| 'tinta'`; `MISSION_LABELS.watch_ad.description` netral ("menambah hadiahmu" bukan "kredit bacamu") |
| 7.9 | `lib/missions/server.ts` | Modif | `getDailyMissionsSnapshot` baca & teruskan `currency` dari payload RPC; nilai per misi tetap lewat field `credits` (makna mengikuti `currency`) |
| 7.10 | `app/(shell)/profil/tinta/actions.ts` | Baru | `'use server'` — `actExchangeTinta(amount: number): Promise<ExchangeActionResult>`; `revalidatePath('/profil/tinta')`, `('/profil')`, `('/kredit')`; auth via `getSessionUser`; error reader-safe |
| 7.11 | `lib/api/queries.ts` | Tambah | `queryPublicUserStories(limit = 12)`: admin client, `visibility = 'public'`, `owner_user_id IS NOT NULL`, `.not('id','like','demo:%')`, `.not('id','like','premium:%')`, order `created_at desc` (memanfaatkan `stories_visibility_idx`) |
| 7.12 | `lib/api/server.ts` | Modif | `listExploreStories()` merge hasil `queryPublicUserStories` (dedupe by id, tetap filter cerita yang sedang berjalan) — perilaku demo/premium existing tidak berubah |
| 7.13 | `lib/admin/settings-schemas.ts` / `lib/admin/settings.ts` | Modif | `updateTintaPolicySchema` + `AdminTintaPolicy` + `SettingsData.tintaPolicy` + `updateTintaPolicy(input)` dengan `auditSettings({ settingArea: 'tinta_policy', ... })` |
| 7.14 | `app/api/admin/settings/tinta-policy/route.ts` | Baru | `PATCH` pola `reward-policy` (zod → `updateTintaPolicy` → 400/403/500) |
| 7.15 | `lib/analytics/events.ts` | Modif | Nama + payload event baru (§9) |

Tidak ada perubahan pada: `POST /api/stories/[id]/choices` (respons), `spend_credits_v1`, `authorize_commercial_generation_intent_v1`, webhook PayCore, alur share→clone, kontrak `SubmitChoiceResponseSchema`.

## 8. Admin Dashboard (Knob)

Lokasi: `/admin/settings`, pola persis `reward_policy` (schema zod + `lib/admin/settings.ts` + PATCH route + dialog + section card + audit log wajib `reason ≥ 5 karakter`).

Knob `tinta_policy` (semua tersimpan di DB, tanpa deploy):

| Knob | Tipe | Default | Rentang zod | Efek |
|---|---|---|---|---|
| `tintaPerRead` | int | 10 | 0..1000 | Tinta per penyelesaian bab pembaca lain |
| `authorDailyCap` | int | 300 | 0..100000 | Batas harian Tinta per penulis (WIB) |
| `tintaCheckin` | int | 5 | 0..1000 | Imbalan misi "Hadir Hari Ini" |
| `tintaChoice` | int | 10 | 0..1000 | Imbalan misi "Tentukan Langkahmu" |
| `tintaAdBatch` | int | 10 | 0..1000 | Imbalan misi "Tonton Sekilas" |
| `tintaPerLakoin` | int | 100 | 10..100000 | Kurs: Tinta per 1 Lakoin |
| `exchangeMinLakoin` | int | 1 | 1..10000 | Minimum hasil penukaran |
| `pendingHours` | int | 24 | 0..168 | Jendela anomali reward penulis |
| `authorRewardsEnabled` | bool | false | — | Master switch reward penulis |
| `exchangeEnabled` | bool | false | — | Master switch Tukar Tinta→Lakoin |
| `missionsPayTinta` | bool | false | — | Flag migrasi misi Kredit→Tinta |

- Dialog baru: `components/admin/settings/edit-tinta-policy-dialog.tsx` (pola `edit-reward-policy-dialog.tsx`: state lokal, validasi mirror zod, banner peringatan bila `authorRewardsEnabled`/`exchangeEnabled` dinyalakan, textarea alasan wajib).
- Route: `PATCH /api/admin/settings/tinta-policy` (owner-only, 403 bila bukan owner).
- Audit log: `auditSettings({ settingArea: 'tinta_policy', settingKey: 'default', oldValue, newValue, reason })` — lihat old/new row snapshot seperti `updateRewardPolicy`.
- Perubahan kurs TIDAK berlaku surut: penukaran yang sudah terjadi memakai kurs saat penukaran; pending Tinta menukar memakai kurs saat tombol Tukar ditekan.

## 9. Analytics Events + Properti Aman

Tambah ke `ANALYTICS_EVENT_NAMES` dan `AnalyticsEventSchema` (strict — hanya bucket/enum/id, tanpa teks mentah):

```ts
// ANALYTICS_EVENT_NAMES (tambahan)
'tinta_earned',
'author_reward_skipped',
'tinta_exchanged',
'story_visibility_changed',

// AnalyticsEventSchema (tambahan, semua optional)
tinta_source: z.enum(['mission_checkin', 'mission_choice', 'mission_ad_batch', 'author_read_reward']).optional(),
tinta_amount_bucket: z.enum(['1_9', '10_49', '50_99', '100_plus']).optional(),
tinta_skip_reason: z.enum(['disabled', 'not_public', 'self_read', 'duplicate', 'capped', 'guest']).optional(),
lakoin_out_bucket: z.enum(['1_4', '5_19', '20_99', '100_plus']).optional(),
exchange_rate: z.number().int().min(10).max(100000).optional(),
to_visibility: z.enum(['private', 'public']).optional(),
```

Titik instrumen:

- `tinta_earned` — sisi server setelah `grant_author_tinta_v1` status `ok` (hook) dan sisi client setelah klaim misi sukses saat `currency === 'tinta'` (payload: `tinta_source`, `tinta_amount_bucket`).
- `author_reward_skipped` — hook, saat status `capped|disabled|ineligible|duplicate` (payload: `tinta_skip_reason`, `story_id`); sampling log server untuk `duplicate` agar tidak bising.
- `tinta_exchanged` — server action penukaran sukses (payload: `lakoin_out_bucket`, `exchange_rate`).
- `story_visibility_changed` — route visibility sukses (payload: `to_visibility`, `story_id`).

## 10. Edge Cases & Anti-Abuse

| Kasus | Penanganan |
|---|---|
| **Akun ganda / farm diri sendiri** | `owner ≠ reader` ditegakkan RPC; 1 pembaca hanya membayar 1× per (penulis, bab) seumur hidup; cap 300/hari per penulis; pending 24 jam memberi jendela deteksi anomali. TANPA approval manual / quality gate (keputusan PM) — risiko residual akun skeletons diterima, dipantau via `tinta_earned`/`author_reward_skipped(reason=capped)` |
| **Baca ulang / replay pilihan** | `personalized_choice_applications` PK mencegah dobel-apply; `replayed === true` tidak memanggil hook; unique ref ledger menjadi dedupe final — baca ulang tidak membayar |
| **Guest (tanpa login)** | Tidak ada `user_id` → hook tidak terpanggil; misi & tukar butuh login. Guest→login: tidak ada reward retroaktif untuk bacaan masa guest |
| **Cerita dihapus saat Tinta pending** | `tinta_ledger` hanya FK ke `auth.users` — baris reward tetap hidup, pending→available tetap jalan; tidak ada clawback (bacaan sungguhan sudah terjadi) |
| **Cerita jadi privat saat ada pembaca aktif** | Reward berhenti seketika (RPC cek `visibility` per event); Tinta sudah diterbitkan tidak ditarik; akses pembaca lain mengikuti perilaku existing |
| **Kurs berubah saat Tinta pending** | Pending tidak bisa ditukar; setelah available, tukar memakai kurs `tinta_policy` saat aksi — tidak ada penguncian kurs historis |
| **Dua penukaran paralel** | `spend_tinta_v1`: advisory lock per user + cek available; kedua punya ref unik — tidak bisa overdraft, tidak bisa dobel |
| **Grant Lakoin gagal setelah debit Tinta** | Kompensasi `tinta_exchange_rollback` (+jumlah, ref unik) seperti pola `redeemRewardCredits` |
| **Refund top-up** | Tidak ada clawback otomatis (paycore tak berubah). Komisi Rp & Lakoin dari order direfund = risiko kebocoran kecil; ditangani manual admin, dipantau `pnpm cost:daily` + daftar order. Tercatat sebagai keterbatasan |
| **`unlisted`** | Tidak eligible reward, tidak masuk etalase (hanya `public`); UI tidak menawarkan nilai ini (dipakai mekanisme internal share) |
| **Bab 50 / ending** | Bab 50 tanpa pilihan → `chapter_number > 49` → `ineligible`; ending bab ≤49 dengan pilihan tetap eligible |
| **Flag `missions_pay_tinta` toggling** | Reversibel per klaim; klaim hari yang sama tidak dobel (`user_mission_daily` PK); saldo lama tidak dikonversi otomatis |
| **Cap melewati tengah malam WIB** | Cap dihitung per hari penerbitan (created_at WIB), bukan per hari pending; penghitungan di dalam RPC dengan advisory lock |
| **`tinta_per_read = 0` / cap `0`** | Reward efektif nonaktif tanpa perlu mematikan master switch; RPC tetap return `capped`/delta 0 tidak ditulis |

## 11. Acceptance Criteria per Task (P1..P12)

Format tiap task: **Files**, **Acceptance criteria (checklist)**, **DoD + test yang harus hijau**. Urutan = urutan dependency.

---

### Task P1: Migration SQL (ledger, policy, RPC, RLS)

**Files:**
- Create: `supabase/migrations/20260919000000_lakoin_tinta_economy.sql`
- Create: `tests/tinta/migration.test.ts`

- [x] **AC1.1** Migration memuat `create table if not exists public.tinta_ledger` dengan kolom `delta`, `reason`, `ref text not null unique`, `pending_until timestamptz`, dan index `tinta_ledger_author_day_idx` (partial, `where reason = 'author_read_reward'`).
- [x] **AC1.2** Migration memuat `tinta_policy` baris-tunggal (`check (id = true)` semantik via PK boolean) dengan SEMUA 11 knob dari §8, nilai default sesuai tabel, plus seed `insert ... on conflict (id) do nothing`.
- [x] **AC1.3** RLS: `tinta_ledger` enable + policy `select using (auth.uid() = user_id)`, tanpa policy write; `tinta_policy` enable + policy `select using (true)`.
- [x] **AC1.4** RPC lengkap: `grant_tinta_v1` (idempoten via unique ref, parameter `p_pending_hours`), `tinta_balance_v1` (jsonb `total|available|pending`, pending = `pending_until > now()`), `spend_tinta_v1` (advisory lock + cek available, return `ok|insufficient|duplicate`), `grant_author_tinta_v1` (return `ok|duplicate|capped|disabled|ineligible`; cek policy → visibility public → owner≠reader → bab 1..49 → ref dedupe → cap WIB atomik → insert pending).
- [x] **AC1.5** Semua fungsi: `revoke all ... from public, anon, authenticated` + `grant execute ... to service_role` (`tinta_balance_v1` juga ke `authenticated`).
- [x] **AC1.6** `claim_mission_v1` & `get_daily_missions_v1` di-create-or-replace: verifikasi bukti identik; branch `missions_pay_tinta` grant Tinta (ref `mission:{key}:{user}:{day}`, pending 0); snapshot tambah field `currency`.
- [x] **AC1.7** Tidak ada perubahan apa pun pada `credit_ledger`, `credit_products`, `credit_orders*`, `reading_policy`, `feature_credit_costs`.

**DoD:** `pnpm exec vitest run --project unit tests/tinta/migration.test.ts` PASS (uji konten SQL: tabel, kolom, RLS, nama RPC, default `false` untuk 3 switch, unique ref); `pnpm run check:migration-versions` PASS; `pnpm exec supabase db push --linked` sukses di staging bila tersedia.

---

### Task P2: Domain Murni (`lib/tinta/policy.ts`)

**Files:**
- Create: `lib/tinta/policy.ts`
- Create: `tests/tinta/policy.test.ts`

- [x] **AC2.1** Ekspor `interface TintaPolicy` (camelCase 11 knob), `DEFAULT_TINTA_POLICY` (nilai §8), `type TintaSource`, `type AuthorRewardStatus = 'ok'|'duplicate'|'capped'|'disabled'|'ineligible'`.
- [x] **AC2.2** `calculateTintaExchange(amountTinta, policy)`: `exchangeEnabled=false` → throw "Penukaran sedang dinonaktifkan"; hasil `lakoinOut = floor(amount / tintaPerLakoin)`; `lakoinOut < exchangeMinLakoin` → throw reader-safe berisi minimum; return `{ lakoinOut, tintaSpent, remainderTinta }` dengan `tintaSpent = lakoinOut * tintaPerLakoin`.
- [x] **AC2.3** `authorRewardRef(storyId, chapter, readerId)` = `author_read:{storyId}:{chapter}:{readerId}`; `tintaAmountBucket(n)` & `lakoinOutBucket(n)` mengembalikan enum §9.
- [x] **AC2.4** Tanpa I/O, tanpa `server-only`, tanpa import domain lain (boleh `jakartaDay` di-import dari `lib/missions/policy` bila perlu).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/policy.test.ts` PASS (kasus: kurs 100 → 250 Tinta = 2 Lakoin + 50 sisa; 99 Tinta → throw; flag mati → throw; bucket boundaries); `pnpm run typecheck` PASS.

---

### Task P3: Server Seam (`lib/tinta/server.ts`)

**Files:**
- Create: `lib/tinta/server.ts`
- Create: `tests/tinta/server.test.ts`

- [x] **AC3.1** `'server-only'` di baris pertama; hanya import `@lakoku/db` + `./policy` (tanpa deep import internal lain).
- [x] **AC3.2** `getTintaPolicy()`: baca `tinta_policy` id=true, fallback `DEFAULT_TINTA_POLICY` bila error/kosong (pola `getRewardPolicy`).
- [x] **AC3.3** `getTintaBalance(userId)`: RPC `tinta_balance_v1` → `{ total, available, pending }` number; gagal → `{ total: 0, available: 0, pending: 0 }` (fail-open read).
- [x] **AC3.4** `exchangeTintaForLakoin(userId, amount)`: validasi policy & kalkulasi (P2) → `spend_tinta_v1` (`exchange:{uuid}`) → `grant_credits_v1` (`tinta_exchange:{uuid}`, reason `'tinta_exchange'`) → bila grant gagal: kompensasi `grant_tinta_v1` (`exchange-rollback:{uuid}`) + throw; return `{ lakoinOut, tintaSpent }`.
- [x] **AC3.5** `listTintaHistory(userId, limit=30)`: baris `tinta_ledger` (delta, reason, pending_until, created_at) desc.
- [x] **AC3.6** Tidak ada fungsi reward penulis di sini (hidup di P4 — pemisahan jalur pilihan vs dompet).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/server.test.ts` PASS (mock `@lakoku/db`: policy fallback, balance mapping, exchange happy-path + rollback path + insufficient); `pnpm run typecheck` PASS; `pnpm lint` PASS.

---

### Task P4: Hook Reward Penulis + Integrasi Route Pilihan

**Files:**
- Create: `lib/tinta/author-reward.server.ts`
- Modify: `app/api/stories/[id]/choices/route.ts`
- Create: `tests/tinta/author-reward.test.ts`

- [x] **AC4.1** `maybeGrantAuthorTinta({ readerUserId, storyId, chapterNumber })`: panggil `grant_author_tinta_v1`; status `ok` → log + analytics server-side `tinta_earned` (source `author_read_reward`); status lain → log ringkas; SEMUA exception ditelan (try/catch) — fungsi TIDAK PERNAH throw.
- [x] **AC4.2** Route choices, jalur personal: hook dipanggil hanya bila `applyPersonalizedChoice` sukses, `result.status !== 'WAITING_FOR_CREDITS'`, dan `result.replayed === false`. Respons HTTP route TIDAK berubah bentuk (field/response schema tetap).
- [x] **AC4.3** Route choices, jalur standar: hook dipanggil tepat setelah `applyChoiceToUserState(...)` sukses (untuk user login; tamu sudah no-op di atasnya).
- [x] **AC4.4** Hook diletakkan sehingga kegagalan/hambatan tidak menambah latensi kritis: dipanggil setelah respons inti tersusun, tanpa `await` ganda di jalur error.
- [x] **AC4.5** Tidak ada logika eligibility di TS — semua di RPC (sumber kebenaran tunggal).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/author-reward.test.ts` PASS (mock RPC: ok→analytics terpanggil 1×; capped/duplicate→tanpa throw; RPC throw→fungsi resolve tanpa error); `pnpm smoke:production-reader` (atau smoke reader-path yang relevan) tetap PASS; `pnpm run typecheck` PASS.

---

### Task P5: Migrasi Misi → Tinta (RPC + snapshot + copy)

**Files:**
- Modify: `lib/missions/policy.ts`, `lib/missions/server.ts`
- Modify: `components/missions/missions-view.tsx`, `app/(shell)/misi/page.tsx`
- Create: `tests/tinta/missions.test.ts`

- [x] **AC5.1** `MissionView` tambah `currency?: 'lakoin' | 'tinta'`; snapshot interface tambah `currency`; mapping dari payload RPC.
- [x] **AC5.2** `missions-view.tsx`: label imbalan per misi menampilkan `+N Tinta` bila `currency === 'tinta'`, selain itu `+N Lakoin`; toast klaim "Berhasil klaim! +N Tinta ditambahkan ke akunmu." menyesuaikan; heading saldo tetap Lakoin.
- [x] **AC5.3** `MISSION_LABELS.watch_ad.description` tidak lagi menyebut "kredit bacamu" (netral: "menambah hadiahmu").
- [x] **AC5.4** Klaim sukses saat flag menyala menghasilkan analytics `tinta_earned` dengan `tinta_source` sesuai kunci misi.
- [x] **AC5.5** Verifikasi bukti & idempotensi klaim TIDAK berubah (duplicate tetap `duplicate`).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/missions.test.ts` PASS (mapping currency, fallback `lakoin` bila field absen); `pnpm run typecheck` PASS.

---

### Task P6: Dompet Tinta + Tukar ke Lakoin (UI & Server Action)

**Files:**
- Create: `app/(shell)/profil/tinta/page.tsx`, `app/(shell)/profil/tinta/actions.ts`
- Create: `components/tinta/tinta-wallet-view.tsx`, `components/tinta/exchange-tinta-dialog.tsx`
- Modify: `app/(shell)/profil/page.tsx`

- [x] **AC6.1** Halaman `/profil/tinta` (auth-gated, pola `/profil/imbalan`): kartu saldo **Tinta Tersedia** + **Sedang diproses (±24 jam)**, tombol "Tukar ke Lakoin", riwayat (tanggal, +/-, keterangan reader-safe, status pending).
- [x] **AC6.2** Dialog tukar: input jumlah Tinta, kalkulator hasil berdasarkan kurs live (`getTintaPolicy`), teks kurs "100 Tinta = 1 Lakoin", validasi minimum, konfirmasi dua-tahap (tombol "Tukar" → "Ya, tukar sekarang"); disabled penuh bila `exchangeEnabled=false` dengan pesan "Tukar belum tersedia".
- [x] **AC6.3** `actExchangeTinta(amount)`: auth via `getSessionUser`; sukses → `revalidatePath('/profil/tinta' | '/profil' | '/kredit')` + return `{ ok: true, lakoinOut, tintaSpent }`; gagal → `{ ok: false, error }` reader-safe.
- [x] **AC6.4** Empty state (saldo 0), loading state (server component + skeleton/existing pattern), error state (inline), permission state (guest → redirect login).
- [x] **AC6.5** Entry card "Tinta" di `/profil` di sebelah kartu Kredit/Lakoin.
- [x] **AC6.6** Tanpa import DB langsung — hanya props dari server component + server action.

**DoD:** `pnpm run typecheck` PASS; `pnpm lint` PASS; navigasi manual `/profil → /profil/tinta → tukar` bekerja di dev dengan flag dinyalakan; analytics `tinta_exchanged` terkirim (cek network/analytics smoke).

---

### Task P7: Rename Display Kredit → Lakoin

**Files:**
- Modify: `components/chapter-locked.tsx`, `components/kredit/buy-credit-button.tsx`, `app/(shell)/kredit/page.tsx`, `app/(shell)/profil/page.tsx`, `components/rewards/reward-wallet-view.tsx`, `components/rewards/redeem-credits-dialog.tsx`, `components/missions/missions-view.tsx`, `lib/missions/policy.ts`

- [x] **AC7.1** Seluruh copy pembaca di file di atas memakai "Lakoin" untuk hard currency (terverifikasi lokasi: `chapter-locked.tsx` "Kreditmu belum cukup" / "Buka bab ini dengan N Lakoin" / "Saldo Lakoinmu" / "Beli Lakoin" / "Buka bab (N Lakoin)"; `kredit/page.tsx` heading & copy; `reward-wallet-view.tsx` "Tukar ke Lakoin"; toast redeem).
- [x] **AC7.2** URL `/kredit`, nama komponen, kolom DB, nama fungsi (`spendChapterUnlock`, dst.) TIDAK berubah — rename display saja.
- [x] **AC7.3** Grep akhir: `grep -rin "kredit" app/\(shell\) components lib/missions lib/reader-fallback.ts` → sisa kemunculan hanya identifier kode/komentar dev, nol string literal yang tampil ke pembaca.
- [x] **AC7.4** Halaman admin & dokumen internal boleh tetap menyebut kredit (bukan permukaan pembaca).

**DoD:** `pnpm run typecheck` PASS; `pnpm smoke:web-release` PASS; audit grep ditempel di deskripsi PR.

---

### Task P8: Toggle Publik/Privat Cerita

**Files:**
- Modify: `packages/contracts/src/reader.ts`, `lib/api/client.ts`
- Create: `app/api/stories/[id]/visibility/route.ts`, `components/story/story-visibility-toggle.tsx`
- Modify: `app/(shell)/koleksiku/page.tsx`

- [x] **AC8.1** Kontrak zod §7.1 terekspor dari `packages/contracts/src` (barrel, named export).
- [x] **AC8.2** Route PATCH: `getSessionUser` → wajib login (401) → `isStoryOwnedBy` (403/404) → zod body (400) → update `stories.visibility` hanya ke `private|public` → respons `SetStoryVisibilityResponseSchema`; error reader-safe.
- [x] **AC8.3** `setStoryVisibility` di `lib/api/client.ts` (fetch PATCH via `API_BASE`).
- [x] **AC8.4** Toggle di kartu cerita Koleksiku hanya untuk cerita milik user (punya owner); optimistic + revert bila gagal; label "Privat"/"Publik"; analytics `story_visibility_changed`.
- [x] **AC8.5** Cerita publik muncul di etalase beranda (tergantung P9; sebelum P9 merge, perubahan visibility tetap tersimpan).
- [x] **AC8.6** Share→clone existing tidak terpengaruh (tidak menyentuh `shared_story_links`).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/visibility.test.ts` PASS (schema parse, tolak `unlisted` dari UI contract, tolak non-owner); `pnpm smoke:contracts` PASS; `pnpm run typecheck` PASS.

---

### Task P9: Etalase Beranda — Cerita Publik User

**Files:**
- Modify: `lib/api/queries.ts`, `lib/api/server.ts`, `app/(shell)/beranda/page.tsx`

- [x] **AC9.1** `queryPublicUserStories(limit=12)` sesuai §7.11 (visibility public, owner tidak null, bukan `demo:%`/`premium:%`, order terbaru, memanfaatkan `stories_visibility_idx`).
- [x] **AC9.2** `listExploreStories()` menggabungkan demo/premium existing + cerita publik user (dedupe by id, buang cerita yang sedang berjalan seperti existing `jelajahi` filter).
- [x] **AC9.3** Beranda menampilkan cerita publik user dengan badge kecil "DARI PENULIS" (gaya badge "DIBAGIKAN" existing); rail "Sedang Dibagikan" (`listPublicShareTeasers`) tetap utuh di atasnya.
- [x] **AC9.4** Empty state existing ("Belum ada cerita yang dibagikan…") tetap benar saat tidak ada sumber apa pun.
- [x] **AC9.5** Cerita privat/unlisted TIDAK PERNAH bocor ke hasil (dites lewat filter query).

**DoD:** `pnpm exec vitest run --project unit tests/tinta/explore.test.ts` PASS (dedupe, filter prefix, limit); `pnpm run typecheck` PASS; smoke beranda existing tetap hijau.

---

### Task P10: Admin — `tinta_policy` (Schema, Route, Dialog, Audit)

**Files:**
- Modify: `lib/admin/settings-schemas.ts`, `lib/admin/settings.ts`, `app/admin/settings/page.tsx`
- Create: `app/api/admin/settings/tinta-policy/route.ts`, `components/admin/settings/edit-tinta-policy-dialog.tsx`
- Create: `tests/tinta/admin-policy.test.ts`

- [x] **AC10.1** `updateTintaPolicySchema`: 11 knob + `reason` (min 5, max 500), rentang sesuai §8.
- [x] **AC10.2** `AdminTintaPolicy` interface + `SettingsData.tintaPolicy` + `loadSettingsData` membaca baris; `updateTintaPolicy(input)`: snapshot old/new → update → `auditSettings(settingArea: 'tinta_policy')` → return nilai baru + `updatedAt`.
- [x] **AC10.3** PATCH route pola reward-policy (400 validasi / 403 bukan owner / 500 `processing_error`).
- [x] **AC10.4** Dialog pola `edit-reward-policy-dialog.tsx`: semua knob, banner peringatan saat menyalakan `authorRewardsEnabled`/`exchangeEnabled` (risiko biaya/ekonomi), alasan wajib, validasi mirror zod, loading state.
- [x] **AC10.5** Section card "Ekonomi Tinta & Lakoin" di `/admin/settings` menampilkan nilai aktif + waktu update terakhir.

**DoD:** `pnpm exec vitest run --project unit tests/tinta/admin-policy.test.ts` PASS (schema terima valid / tolak `tintaPerLakoin: 5` / tolak reason pendek); `pnpm run typecheck` PASS; audit log muncul setelah PATCH di staging.

---

### Task P11: Analytics Events

**Files:**
- Modify: `lib/analytics/events.ts`, `lib/tinta/author-reward.server.ts`, `components/missions/missions-view.tsx`, `app/(shell)/profil/tinta/actions.ts`, `app/api/stories/[id]/visibility/route.ts`
- Test: `pnpm smoke:analytics` (existing) + `tests/tinta/analytics.test.ts`

- [x] **AC11.1** 4 nama event + 6 field payload opsional (§9) masuk `ANALYTICS_EVENT_NAMES` & `AnalyticsEventSchema` (strict, tanpa teks mentah).
- [x] **AC11.2** Instrumentasi terpasang di titik §9; payload lolos schema (unit test parse).
- [x] **AC11.3** `tinta_skip_reason: 'guest'` tidak dikirim dari server (guest tidak sampai hook); `'duplicate'` di-log server saja tanpa event client.

**DoD:** `pnpm smoke:analytics` PASS; `pnpm exec vitest run --project unit tests/tinta/analytics.test.ts` PASS.

---

### Task P12: Smoke End-to-End & Closeout

**Files:**
- Create: `scripts/tinta-economy-smoke.ts`
- Modify: `package.json` (script `smoke:tinta`), `docs/superpowers/plans/2026-09-19-lakoin-tinta-economy.md` (centang checklist)

Skenario smoke (jiti runner, pola smoke existing):

- [x] **AC12.1** Klaim misi dengan `missions_pay_tinta=true` → baris `tinta_ledger` (+amount, ref `mission:…`, pending null); klaim ulang → duplicate. (verifikasi RPC live: staging, lihat G12-M)
- [x] **AC12.2** Pilihan pembaca B di bab cerita publik milik A (flag author on) → event `author_read_reward` pending 24 jam; replay/B baca ulang → duplicate; cap dites dengan cap kecil → `capped`; cerita privat → `ineligible`. (verifikasi RPC live: staging, lihat G12-M)
- [x] **AC12.3** Tukar: kurs 100, tukar 250 → debit 200, credit_ledger +2, sisa 50 available; `spend_tinta_v1` pada saldo pending saja → insufficient. (verifikasi RPC live: staging, lihat G12-M)
- [x] **AC12.4** `tinta_balance_v1` konsisten: total = available + pending. (verifikasi RPC live: staging, lihat G12-M)
- [x] **AC12.5** Grep rename (AC7.3) dijalankan sebagai bagian smoke gate copy.

**DoD:** `pnpm exec tsx scripts/tinta-economy-smoke.ts` exit 0 semua cek; `pnpm test` (typecheck + migration check + unit + smoke) hijau penuh; checklist dokumen ini dicentang.

---

## 12. Non-Goals

- **TANPA approval manual** dan **TANPA gerbang kualitas** untuk reward penulis — ditolak PM; pagar murni otomatis (dedupe, cap, pending).
- **Tidak mengubah mekanisme komisi referral Rp** (`reward_policy`, atribusi, webhook PayCore, redeem Imbalan→kredit) — hanya copy "Tukar ke Lakoin".
- **Tidak ada payout/pencairan** (Tarik Tunai tetap terkunci "Segera Hadir").
- **Tidak mengubah logika paycore/credit_ledger**, harga produk, atau struktur 50 bab; URL `/kredit` dan nama kolom `credits` tetap.
- **Tidak ada pembelian Tinta dengan uang**, tidak ada arah Lakoin→Tinta, tidak ada konversi Imbalan→Tinta.
- **Tidak ada job/cron** untuk pending→available (dihitung on-read).
- **Tidak ada reward retroaktif** untuk bacaan/klaim sebelum rilis.
- **Tidak mengekspos `unlisted`** di UI pembaca (tetap nilai internal).
- **Tidak ada sub-genre / diferensiasi reward per genre.**
- **Tidak ada clawback otomatis** atas refund top-up (keterbatasan didokumentasikan, ditangani manual admin).

## 13. Pertanyaan Terbuka untuk PM (maks. 3)

1. **Angka reward:** apakah `tinta_per_read = 10` dan paket misi (checkin 5 / choice 10 / ad_batch 10) disetujui sebagai default rilis? Semua sudah jadi knob admin, tapi default menentukan daya beli awal (kurs 100:1 → pembaca aktif maks ±3 Lakoin/hari per penulis).
2. **Etalase:** batas jumlah cerita publik user di beranda diusula 12 (urut terbaru, campur dengan demo/premium). OK, atau perlu rail terpisah dengan slot lebih banyak / kurasi sederhana lain?
3. **Refund top-up:** dikonfirmasi tidak ada clawback otomatis komisi Rp maupun Lakoin dari order yang direfund di fase ini (manual admin, dipantau cost monitor)?
