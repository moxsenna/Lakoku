-- ============================================================
-- Selaraskan identitas Better Auth dengan skema domain (uuid)
-- + pulihkan FK domain ke public."user" + repoint RPC dari auth.users
-- (Audit 2026-11-04, temuan B1)
-- ============================================================
-- Latar:
-- - Better Auth menulis user ke public."user"(id text), sementara seluruh
--   skema domain memakai user_id uuid. generateId di lib/auth.ts sudah
--   memaksa UUID, dan 19/19 id existing terverifikasi uuid-format — aman
--   dikonversi.
-- - FK domain ke auth.users tidak pernah terpasang di produksi (tabel dibuat
--   sebelum migrasi FK-nya; `create table if not exists` menjadi no-op),
--   sedangkan rebuild fresh akan membuat FK ke auth.users yang sudah mati.
-- - Empat RPC masih membaca auth.users sehingga buta terhadap pendaftar
--   baru: clone premium (INVALID_OWNER), welcome credit (user not found),
--   admin user search (hasil kosong).
--
-- Strategi: kolom domain & RPC TIDAK disentuh tipenya. Yang diubah hanya
-- sisi identitas (public."user" + tabel auth Better Auth + user_acquisition
-- yang sempat diubah text oleh cae08ee).

-- 1) Konversi identitas Better Auth ke uuid.
--    FK antar tabel auth di-drop dulu — ALTER TYPE tidak bisa membangun
--    ulang FK saat kedua sisi berubah tipe secara berurutan. Semua nilai
--    terverifikasi uuid-format (read-only) sebelum migrasi.
alter table public."session"  drop constraint if exists "session_userId_fkey";
alter table public."account"  drop constraint if exists "account_userId_fkey";
alter table public.user_acquisition drop constraint if exists user_acquisition_user_id_fkey;

alter table public."user"    alter column id       set data type uuid using id::uuid;
alter table public."session" alter column "userId" set data type uuid using "userId"::uuid;
alter table public."account" alter column "userId" set data type uuid using "userId"::uuid;
alter table public.user_acquisition alter column user_id set data type uuid using user_id::uuid;

alter table public."session"  add constraint "session_userId_fkey"
  foreign key ("userId") references public."user"(id) on delete cascade;
alter table public."account"  add constraint "account_userId_fkey"
  foreign key ("userId") references public."user"(id) on delete cascade;
alter table public.user_acquisition add constraint user_acquisition_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

-- 2) Pasang FK domain yang hilang → public."user".
--    `drop constraint if exists` menjaga idempotensi pada rebuild fresh
--    (yang punya FK→auth.users dari DDL inline dengan nama konvensi sama).
--    Delete rule mengikuti definisi asli tiap tabel di migrasinya.
alter table public.credit_ledger   drop constraint if exists credit_ledger_user_id_fkey;
alter table public.credit_ledger   add constraint credit_ledger_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.credit_orders   drop constraint if exists credit_orders_user_id_fkey;
alter table public.credit_orders   add constraint credit_orders_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.credit_orders_v2 drop constraint if exists credit_orders_v2_user_id_fkey;
alter table public.credit_orders_v2 add constraint credit_orders_v2_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.reward_ledger   drop constraint if exists reward_ledger_user_id_fkey;
alter table public.reward_ledger   add constraint reward_ledger_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.tinta_ledger    drop constraint if exists tinta_ledger_user_id_fkey;
alter table public.tinta_ledger    add constraint tinta_ledger_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.user_mission_daily drop constraint if exists user_mission_daily_user_id_fkey;
alter table public.user_mission_daily add constraint user_mission_daily_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.referral_codes  drop constraint if exists referral_codes_user_id_fkey;
alter table public.referral_codes  add constraint referral_codes_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.referral_attributions drop constraint if exists referral_attributions_referrer_user_id_fkey;
alter table public.referral_attributions add constraint referral_attributions_referrer_user_id_fkey
  foreign key (referrer_user_id) references public."user"(id) on delete cascade;

alter table public.referral_attributions drop constraint if exists referral_attributions_referred_user_id_fkey;
alter table public.referral_attributions add constraint referral_attributions_referred_user_id_fkey
  foreign key (referred_user_id) references public."user"(id) on delete cascade;

alter table public.admin_credit_grants drop constraint if exists admin_credit_grants_target_user_id_fkey;
alter table public.admin_credit_grants add constraint admin_credit_grants_target_user_id_fkey
  foreign key (target_user_id) references public."user"(id) on delete cascade;

alter table public.admin_credit_grants drop constraint if exists admin_credit_grants_admin_user_id_fkey;
alter table public.admin_credit_grants add constraint admin_credit_grants_admin_user_id_fkey
  foreign key (admin_user_id) references public."user"(id) on delete restrict;

alter table public.admin_users     drop constraint if exists admin_users_user_id_fkey;
alter table public.admin_users     add constraint admin_users_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.account_commercial_states drop constraint if exists account_commercial_states_user_id_fkey;
alter table public.account_commercial_states add constraint account_commercial_states_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.credit_reservations drop constraint if exists credit_reservations_user_id_fkey;
alter table public.credit_reservations add constraint credit_reservations_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.password_recovery_capabilities drop constraint if exists password_recovery_capabilities_user_id_fkey;
alter table public.password_recovery_capabilities add constraint password_recovery_capabilities_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.push_devices    drop constraint if exists push_devices_user_id_fkey;
alter table public.push_devices    add constraint push_devices_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.reader_taste_profiles drop constraint if exists reader_taste_profiles_user_id_fkey;
alter table public.reader_taste_profiles add constraint reader_taste_profiles_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.generation_jobs drop constraint if exists generation_jobs_user_id_fkey;
alter table public.generation_jobs add constraint generation_jobs_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.shared_story_links drop constraint if exists shared_story_links_owner_user_id_fkey;
alter table public.shared_story_links add constraint shared_story_links_owner_user_id_fkey
  foreign key (owner_user_id) references public."user"(id) on delete cascade;

alter table public.story_creation_requests drop constraint if exists story_creation_requests_owner_user_id_fkey;
alter table public.story_creation_requests add constraint story_creation_requests_owner_user_id_fkey
  foreign key (owner_user_id) references public."user"(id) on delete cascade;

alter table public.personalized_choice_applications drop constraint if exists personalized_choice_applications_user_id_fkey;
alter table public.personalized_choice_applications add constraint personalized_choice_applications_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.personalized_choice_idempotency_keys drop constraint if exists personalized_choice_idempotency_keys_user_id_fkey;
alter table public.personalized_choice_idempotency_keys add constraint personalized_choice_idempotency_keys_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.story_creative_directions drop constraint if exists story_creative_directions_owner_user_id_fkey;
alter table public.story_creative_directions add constraint story_creative_directions_owner_user_id_fkey
  foreign key (owner_user_id) references public."user"(id) on delete cascade;

alter table public.stories drop constraint if exists stories_owner_user_id_fkey;
alter table public.stories add constraint stories_owner_user_id_fkey
  foreign key (owner_user_id) references public."user"(id) on delete set null;

alter table public.analytics_events drop constraint if exists analytics_events_user_id_fkey;
alter table public.analytics_events add constraint analytics_events_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete set null;

-- 3) Repoint RPC yang masih membaca auth.users.
--    UPDATE pg_proc tidak bisa dipakai di Neon (katalog sistem dilindungi,
--    role migrasi bukan superuser). Repoint body dilakukan di migrasi
--    20261104180000 via CREATE OR REPLACE FUNCTION per body — body
--    diekstrak verbatim dari file migrasi sumber dengan satu penggantian
--    string sasaran, diverifikasi di DB uji sebelum dipakai.

-- 3a) admin_search_users_v1: repoint ke public."user" + escape wildcard
--     LIKE (audit M7 — `?email=%%` sebelumnya mencocokkan semua baris).
create or replace function public.admin_search_users_v1(p_email text)
returns table (
  user_id uuid,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email
  from public."user" u
  where lower(u.email) like lower('%' || replace(replace(replace(p_email, '\', '\\'), '%', '\%'), '_', '\_') || '%') escape '\'
    and u.email is not null
  order by u.email
  limit 10;
$$;

grant execute on function public.admin_search_users_v1(text) to service_role;

-- Jaminan "tidak ada lagi RPC yang membaca auth.users" ada di migrasi
-- 20261104180000 (setelah semua body RPC di-repoint).
