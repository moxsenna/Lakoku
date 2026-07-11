Plan Implementasi: Ops Config Kredit, Bonus Topup, Admin Grant, AI Route, dan Target 800–1000 Kata
Tujuan akhir

Setelah implementasi selesai, admin/owner bisa mengubah hal-hal berikut tanpa bongkar banyak kode:

Harga paket topup.
Jumlah kredit utama per paket.
Bonus topup normal.
Bonus topup pertama kali.
Biaya unlock chapter.
Target panjang bab 800–1000 kata.
Provider/model AI per use case.
Grant kredit manual oleh admin ke user.
Audit ledger untuk semua kredit masuk/keluar.
Prinsip desain

Pakai aturan ini:

DB = source of truth untuk keputusan bisnis.
Env = hanya untuk secret dan credential.
Code = validasi, orchestration, fallback aman.

Jangan taruh angka bisnis di komponen UI. Jangan taruh model default penting tersebar di file AI. Saat ini masih ada default model dan fallback model di gateway-provider.ts, serta TARGET_WORDS = 650 di deterministic provider.

Phase 0 — Audit dan guard awal
0.1. Buat branch
git checkout -b ops-credit-config
0.2. Jalankan baseline
pnpm typecheck
pnpm run smoke
pnpm test:unit

Repo sudah punya script typecheck, test:unit, dan rangkaian smoke, termasuk smoke:credits-policy, smoke:paycore-webhook, dan smoke:paycore-client.

0.3. Audit hardcoded business value

Agen wajib cari:

grep -R "650\|800\|1000\|creditsPerChapter\|price_idr\|credits_starter\|TARGET_WORDS\|DEFAULT_MODEL\|OPENROUTER_FREE_DEFAULT\|OPENROUTER_PAID_DEFAULT" \
  app components lib packages scripts supabase -n

Target hasil audit:

semua angka harga/kredit masuk DB config,
semua angka naratif seperti target kata masuk generation policy,
semua model/provider masuk AI route config,
code hanya menyimpan fallback aman.
Phase 1 — Tambah kolom bonus di credit_products

Saat ini credit_products punya:

product_key
name
price_idr
credits
active
sort_order
updated_at

Migrasi existing memang sudah menjadikan credit_products sebagai katalog produk kredit utama.

Tambahkan kolom bonus langsung ke table ini. Ini lebih sederhana daripada membuat table promo terpisah untuk MVP.

1.1. Buat migration baru

File:

supabase/migrations/20260711010000_credit_products_bonus.sql

Isi:

alter table public.credit_products
  add column if not exists normal_bonus_credits integer not null default 0 check (normal_bonus_credits >= 0),
  add column if not exists first_topup_bonus_credits integer not null default 0 check (first_topup_bonus_credits >= 0),
  add column if not exists marketing_badge text,
  add column if not exists bonus_active boolean not null default true;

create index if not exists credit_products_active_sort_idx
  on public.credit_products (active, sort_order);
1.2. Update seed contoh

Jangan ubah seed lama dengan on conflict do nothing. Buat update eksplisit:

update public.credit_products
set
  normal_bonus_credits = case product_key
    when 'credits_starter' then 3
    when 'credits_basic' then 8
    when 'credits_plus' then 20
    when 'credits_pro' then 60
    when 'credits_max' then 175
    when 'credits_ultra' then 600
    else normal_bonus_credits
  end,
  first_topup_bonus_credits = case product_key
    when 'credits_starter' then 10
    when 'credits_basic' then 20
    when 'credits_plus' then 40
    when 'credits_pro' then 100
    when 'credits_max' then 250
    when 'credits_ultra' then 800
    else first_topup_bonus_credits
  end,
  marketing_badge = case product_key
    when 'credits_starter' then 'Bonus pemula'
    when 'credits_basic' then 'Populer'
    when 'credits_plus' then 'Bonus ekstra'
    when 'credits_pro' then 'Best value'
    when 'credits_max' then 'Hemat besar'
    when 'credits_ultra' then 'Power reader'
    else marketing_badge
  end
where product_key in (
  'credits_starter',
  'credits_basic',
  'credits_plus',
  'credits_pro',
  'credits_max',
  'credits_ultra'
);

Catatan keputusan: bonus topup pertama kali harus lebih besar daripada bonus normal, tapi jangan terlalu ekstrem untuk paket kecil. Kalau terlalu besar, user akan beli paket termurah hanya untuk ambil bonus.

Phase 2 — Deteksi first topup

Webhook PayCore sekarang grant kredit berdasarkan fulfillment_data.credits, lalu ledger memakai ref paycore:{order_id}. Jalur webhook sudah benar karena hanya webhook bertanda tangan yang menerbitkan kredit, bukan return URL client.

Masalahnya: bonus pertama kali harus dihitung server-side, bukan dari client.

2.1. Tambah RPC untuk cek topup pertama

Di migration yang sama atau file baru:

create or replace function public.has_paid_topup_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.credit_ledger
    where user_id = p_user_id
      and delta > 0
      and ref like 'paycore:%'
  );
$$;

grant execute on function public.has_paid_topup_v1(uuid) to service_role;
2.2. Jangan mengandalkan jumlah topup dari client

Agen harus memastikan:

request checkout hanya kirim productKey,
server baca credit_products,
server menghitung baseCredits + bonus,
webhook tetap yang grant.

Route checkout saat ini memang sudah menolak harga/kredit dari client; server membuat order berdasarkan productKey.

Phase 3 — Update type dan loader produk

File:

lib/paycore/products.ts

Saat ini interface CreditProduct hanya punya productKey, name, priceIdr, credits, active.

3.1. Update interface
export interface CreditProduct {
  productKey: string
  name: string
  priceIdr: number
  credits: number
  normalBonusCredits: number
  firstTopupBonusCredits: number
  marketingBadge: string | null
  bonusActive: boolean
  active: boolean
}
3.2. Update select

Ambil kolom baru:

.select(`
  product_key,
  name,
  price_idr,
  credits,
  normal_bonus_credits,
  first_topup_bonus_credits,
  marketing_badge,
  bonus_active,
  active
`)
3.3. Tambah helper

Buat fungsi baru:

export function calculateTopupCredits(
  product: CreditProduct,
  isFirstTopup: boolean,
): {
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: 'first_topup' | 'normal' | 'none'
} {
  const bonusCredits = product.bonusActive
    ? isFirstTopup
      ? product.firstTopupBonusCredits
      : product.normalBonusCredits
    : 0

  return {
    baseCredits: product.credits,
    bonusCredits,
    totalCredits: product.credits + bonusCredits,
    bonusKind: bonusCredits <= 0 ? 'none' : isFirstTopup ? 'first_topup' : 'normal',
  }
}
Phase 4 — Simpan snapshot order

Ini penting. Kalau nanti harga/bonus berubah, order lama tetap bisa diaudit.

4.1. Tambah table credit_orders

Migration:

create table if not exists public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  price_idr integer not null check (price_idr >= 0),
  base_credits integer not null check (base_credits >= 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  total_credits integer not null check (total_credits >= 0),
  bonus_kind text not null default 'none' check (bonus_kind in ('none', 'normal', 'first_topup')),
  status text not null default 'created' check (status in ('created', 'paid', 'duplicate', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists credit_orders_user_idx
  on public.credit_orders (user_id, created_at desc);

alter table public.credit_orders enable row level security;

drop policy if exists credit_orders_own_read on public.credit_orders;
create policy credit_orders_own_read
  on public.credit_orders
  for select
  using (auth.uid() = user_id);
4.2. Di checkout create, insert snapshot

File kemungkinan:

lib/paycore/client.ts

dan route:

app/api/checkout/create/route.ts

Agen harus update alur:

Auth user.
Ambil product aktif.
Cek has_paid_topup_v1(userId).
Hitung baseCredits, bonusCredits, totalCredits.
Kirim ke PayCore fulfillment data:
fulfillment_data: {
  user_id: userId,
  product_key: product.productKey,
  base_credits: baseCredits,
  bonus_credits: bonusCredits,
  credits: totalCredits,
  bonus_kind: bonusKind,
}
Simpan credit_orders dengan snapshot.
Return ke client:
{
  order_id,
  checkout_url,
  base_credits,
  bonus_credits,
  total_credits,
  bonus_kind,
  amount_idr
}
Phase 5 — Update webhook agar memakai snapshot aman

Saat ini webhook membaca fulfillment_data.credits dan langsung grant sejumlah itu. Ini masih oke jika PayCore fulfillment data dibuat server-side. Tapi lebih aman: webhook cocokkan ke credit_orders.

5.1. Update parser PayCore event

File:

lib/entitlement/paycore.ts

Saat ini PayCoreEvent punya credits, productKey, orderId, dan userId.

Tambahkan:

baseCredits: number | null
bonusCredits: number | null
bonusKind: 'first_topup' | 'normal' | 'none' | null
5.2. Webhook grant total credit

Alur webhook final:

Verify HMAC.
Parse order_id, user_id, credits.
Cek credit_orders.order_id.
Jika ada snapshot:
gunakan total_credits dari DB.
update status paid.
Jika tidak ada snapshot:
fallback ke fulfillment credits,
log warning,
tetap idempotent.
Grant ke ledger:
ref: paycore:{order_id}
reason: topup:{product_key}:{bonus_kind}
delta: total_credits

Agen jangan grant base dan bonus sebagai dua ledger row dulu. Untuk MVP, satu row cukup. Detail bonus sudah ada di credit_orders.

Phase 6 — Admin grant credit manual

User minta admin bisa memberi kredit tanpa topup. Ini harus dibuat serius, karena rawan abuse.

6.1. Tambah table audit admin grants

Migration:

create table if not exists public.admin_credit_grants (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  credits integer not null check (credits > 0 and credits <= 100000),
  reason text not null check (length(reason) >= 3 and length(reason) <= 500),
  ledger_ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists admin_credit_grants_target_idx
  on public.admin_credit_grants (target_user_id, created_at desc);

create index if not exists admin_credit_grants_admin_idx
  on public.admin_credit_grants (admin_user_id, created_at desc);

alter table public.admin_credit_grants enable row level security;

Jangan beri public write policy. Semua write via service role route.

6.2. Tambah RPC atomic
create or replace function public.admin_grant_credits_v1(
  p_target_user_id uuid,
  p_admin_user_id uuid,
  p_credits integer,
  p_reason text,
  p_ref text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_credits <= 0 or p_credits > 100000 then
    raise exception 'admin_grant_credits_v1: invalid credits';
  end if;

  if length(coalesce(p_reason, '')) < 3 then
    raise exception 'admin_grant_credits_v1: reason too short';
  end if;

  insert into public.admin_credit_grants (
    target_user_id,
    admin_user_id,
    credits,
    reason,
    ledger_ref
  )
  values (
    p_target_user_id,
    p_admin_user_id,
    p_credits,
    p_reason,
    p_ref
  )
  on conflict (ledger_ref) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return false;
  end if;

  insert into public.credit_ledger (
    user_id,
    delta,
    reason,
    ref
  )
  values (
    p_target_user_id,
    p_credits,
    'admin_grant',
    p_ref
  );

  return true;
end;
$$;

grant execute on function public.admin_grant_credits_v1(uuid, uuid, integer, text, text) to service_role;
6.3. Buat server helper

File baru:

lib/admin/credits.ts

Isi fungsi:

import 'server-only'
import { createAdminClient } from '@lakoku/db'

export async function adminGrantCredits(args: {
  targetUserId: string
  adminUserId: string
  credits: number
  reason: string
  requestId?: string
}): Promise<{ granted: boolean; ref: string }> {
  const ref =
    args.requestId ??
    `admin_grant:${args.targetUserId}:${Date.now()}:${crypto.randomUUID()}`

  const db = createAdminClient()

  const { data, error } = await db.rpc('admin_grant_credits_v1', {
    p_target_user_id: args.targetUserId,
    p_admin_user_id: args.adminUserId,
    p_credits: args.credits,
    p_reason: args.reason,
    p_ref: ref,
  })

  if (error) throw new Error(`adminGrantCredits: ${error.message}`)

  return { granted: data === true, ref }
}
6.4. Buat admin API route

File baru:

app/api/admin/credits/grant/route.ts

Kontrak body:

{
  targetUserId: string
  credits: number
  reason: string
  requestId?: string
}

Validasi:

user login,
user admin,
credits integer 1..100000,
reason wajib,
target user valid,
route dynamic.

Catatan: repo sekarang punya app/api/admin hanya untuk alerts dan metrics, jadi endpoint grant ini memang baru.

6.5. Guard admin

Ikuti pola admin guard yang sudah ada di repo. AGENT_RULES.md menyebut ada smoke admin-guard, jadi jangan bikin guard baru asal-asalan.

Agen harus cari implementasi existing:

grep -R "admin" app lib scripts -n | head -100
grep -R "ADMIN" app lib scripts -n

Lalu reuse helper existing. Kalau belum ada helper reusable, buat:

lib/admin/auth.ts

dengan fungsi:

requireAdminUser()
Phase 7 — Admin UI sederhana

Karena user minta “admin bisa memberi kredit”, API saja belum cukup.

7.1. Tambah page

File baru:

app/admin/credits/page.tsx

Repo sekarang app/admin baru berisi consistency, jadi halaman credit admin memang belum ada.

UI minimal:

input targetUserId,
input credits,
textarea reason,
tombol “Grant Kredit”,
hasil sukses/gagal,
link/teks ref ledger.
7.2. Jangan cari user by email dulu kalau belum ada admin user search

Untuk MVP paling aman: pakai targetUserId.
Search user by email di Supabase Auth Admin bisa ditambah nanti, tapi jangan membuat query ke auth.users sembarangan dari client.

Phase 8 — Generation policy: 800–1000 kata

Ini perlu dipisah dari pricing. Jangan digabung dengan reading_policy.

8.1. Tambah table generation_policy

Migration:

create table if not exists public.generation_policy (
  id integer primary key default 1 check (id = 1),
  target_words_min integer not null default 800 check (target_words_min >= 100),
  target_words_max integer not null default 1000 check (target_words_max >= target_words_min),
  target_scenes integer not null default 3 check (target_scenes >= 1 and target_scenes <= 8),
  updated_at timestamptz not null default now()
);

insert into public.generation_policy (
  id,
  target_words_min,
  target_words_max,
  target_scenes
)
values (1, 800, 1000, 3)
on conflict (id) do update
set
  target_words_min = excluded.target_words_min,
  target_words_max = excluded.target_words_max,
  target_scenes = excluded.target_scenes,
  updated_at = now();

alter table public.generation_policy enable row level security;

drop policy if exists generation_policy_read on public.generation_policy;
create policy generation_policy_read
  on public.generation_policy
  for select
  using (true);
8.2. Buat service

File baru:

lib/ops/generation-policy.ts

Isi konsep:

import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'

export interface GenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
}

export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
}

export const getGenerationPolicy = cache(async (): Promise<GenerationPolicy> => {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('generation_policy')
      .select('target_words_min,target_words_max,target_scenes')
      .eq('id', 1)
      .maybeSingle()

    if (data) {
      return {
        targetWordsMin: Number(data.target_words_min),
        targetWordsMax: Number(data.target_words_max),
        targetScenes: Number(data.target_scenes),
      }
    }
  } catch {
    // fallback
  }

  return DEFAULT_GENERATION_POLICY
})
8.3. Update deterministic provider

File:

lib/ai-gateway/provider.ts

Masalah sekarang: TARGET_WORDS = 650.

Jangan impor DB langsung ke pure deterministic provider kalau ingin tetap pure/testable. Ubah input agar menerima policy.

Tambahkan di type:

export interface GenerationRuntimePolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
}

Update PlanInput atau provider factory:

Opsi terbaik untuk minim perubahan:

export function createDeterministicProvider(policy: GenerationRuntimePolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
}): GenerationProvider

Lalu:

const targetWords = policy.targetWordsMin
const targetScenes = policy.targetScenes

Untuk plan:

targetWordCount: policy.targetWordsMin,
targetWordCountMin: policy.targetWordsMin,
targetWordCountMax: policy.targetWordsMax,
targetSceneCount: policy.targetScenes,

Kalau schema ChapterPlan belum menerima targetWordCountMin/Max, jangan paksa sekarang. Pakai targetWordCount: 900 atau targetWordCount: policy.targetWordsMin.

Rekomendasi saya: pakai 900 sebagai target tengah, dengan validator menerima 800–1000.

const targetWordCount = Math.round(
  (policy.targetWordsMin + policy.targetWordsMax) / 2,
)
Phase 9 — AI model route config

Saat ini default model masih di code: DEFAULT_MODEL, OPENROUTER_FREE_DEFAULT, dan OPENROUTER_PAID_DEFAULT.

Untuk operasional, route model sebaiknya DB-backed.

9.1. Tambah table ai_model_routes

Migration:

create table if not exists public.ai_model_routes (
  id uuid primary key default gen_random_uuid(),
  use_case text not null,
  provider text not null check (provider in ('custom', 'openrouter', 'gateway', 'deterministic')),
  model_id text not null,
  fallback_models text[] not null default '{}',
  temperature numeric,
  max_output_tokens integer,
  is_active boolean not null default true,
  route_version text not null default 'default',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (use_case, is_active) deferrable initially immediate
);

create index if not exists ai_model_routes_use_case_idx
  on public.ai_model_routes (use_case, is_active);

alter table public.ai_model_routes enable row level security;

Catatan: constraint unique(use_case, is_active) agak kaku karena hanya boleh satu inactive juga. Lebih baik pakai partial unique index:

drop index if exists ai_model_routes_one_active_idx;

create unique index if not exists ai_model_routes_one_active_idx
  on public.ai_model_routes (use_case)
  where is_active = true;

Seed:

insert into public.ai_model_routes (
  use_case,
  provider,
  model_id,
  fallback_models,
  route_version,
  notes
)
values (
  'chapter_prose',
  'openrouter',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  array['deepseek/deepseek-v3.2'],
  '2026-07-default',
  'Default prose route'
)
on conflict do nothing;
9.2. Buat service

File:

lib/ops/ai-model-routes.ts

Fungsi:

getAiModelRoute(useCase: 'chapter_prose')

Fallback tetap boleh di code, tapi satu tempat saja:

export const DEFAULT_AI_MODEL_ROUTE = {
  useCase: 'chapter_prose',
  provider: 'gateway',
  modelId: 'openai/gpt-4.1-mini',
  fallbackModels: [],
  routeVersion: 'fallback-code',
}
9.3. Update gateway-provider.ts

Jangan langsung hapus semua env. Urutan final:

DB route aktif.
Env override untuk emergency.
Fallback code.

Agen harus menjaga backward compatibility dengan:

CUSTOM_LLM_BASE_URL
CUSTOM_LLM_API_KEY
OPENROUTER_API_KEY
OPENROUTER_MODELS
NARRATIVE_MODEL

Tapi default utama harus dari ai_model_routes.

Phase 10 — Feature credit cost

Untuk sekarang biaya unlock chapter sudah di reading_policy. Tapi nanti kalau ada fitur AI berbayar, jangan hardcode.

10.1. Tambah table
create table if not exists public.feature_credit_costs (
  feature_key text primary key,
  credits_required integer not null check (credits_required >= 0),
  is_active boolean not null default true,
  pricing_version text not null default 'default',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.feature_credit_costs enable row level security;

drop policy if exists feature_credit_costs_read on public.feature_credit_costs;
create policy feature_credit_costs_read
  on public.feature_credit_costs
  for select
  using (true);

insert into public.feature_credit_costs (
  feature_key,
  credits_required,
  pricing_version
)
values
  ('chapter_unlock', 5, '2026-07-default'),
  ('chapter_generate', 0, '2026-07-default')
on conflict (feature_key) do nothing;
10.2. Jangan langsung pindahkan unlock kalau belum perlu

Untuk minim risiko, biarkan unlock tetap pakai reading_policy dulu. feature_credit_costs disiapkan untuk fitur AI/action baru.

Phase 11 — Update UI topup

Cari komponen topup/purchase:

grep -R "listCreditProducts\|credit_products\|checkout/create\|Paket Pemula\|credits_starter" app components lib -n

Update UI agar menampilkan:

Paket Plus
130 kredit + bonus 20
Bonus topup pertama: +40 kredit
Rp50.000
Badge: Bonus ekstra / Best value

Aturan tampilan:

Kalau user belum pernah topup: highlight first_topup_bonus_credits.
Kalau sudah pernah topup: highlight normal_bonus_credits.
Jangan tampilkan “AI”, “model”, “token”, atau provider di UI pembaca. AGENT_RULES.md jelas melarang bocoran AI/model/prompt ke pembaca.

Butuh endpoint baru:

GET /api/credits/products

Return:

{
  products: Array<{
    productKey: string
    name: string
    priceIdr: number
    baseCredits: number
    normalBonusCredits: number
    firstTopupBonusCredits: number
    displayBonusCredits: number
    displayTotalCredits: number
    bonusKind: 'first_topup' | 'normal' | 'none'
    marketingBadge: string | null
  }>
}
Phase 12 — Tests dan smoke
12.1. Unit test bonus calculator

File baru:

tests atau lib/paycore/products.test.ts

Cases:

First topup:
base 70
first bonus 20
total 90
Normal topup:
base 70
normal bonus 8
total 78
Bonus inactive:
total = base
Zero bonus:
bonusKind = none
12.2. Smoke admin grant

File baru:

scripts/admin-credit-grant-smoke.ts

Static checks:

migration contains admin_credit_grants,
migration contains admin_grant_credits_v1,
API route exists,
route checks admin auth,
route calls adminGrantCredits,
no client-side direct service-role access.

Tambah script:

"smoke:admin-credit-grant": "node scripts/run-smoke.cjs scripts/admin-credit-grant-smoke.ts"

Lalu masukkan ke chain smoke.

12.3. Smoke bonus topup

File baru:

scripts/topup-bonus-smoke.ts

Checks:

credit_products has normal_bonus_credits,
first_topup_bonus_credits,
calculateTopupCredits,
checkout create returns total credits,
webhook grants total credits,
no client-supplied credits accepted.
12.4. Smoke generation policy

File baru:

scripts/generation-policy-smoke.ts

Checks:

no TARGET_WORDS = 650,
default min 800,
default max 1000,
provider receives policy,
prompt/plan includes target 800–1000 or midpoint 900.
Phase 13 — Acceptance criteria

Agen boleh menyatakan selesai hanya jika semua ini benar:

DB
credit_products punya bonus normal dan first topup.
credit_orders menyimpan snapshot order.
admin_credit_grants menyimpan audit grant manual.
generation_policy menyimpan target 800–1000.
ai_model_routes menyimpan route model aktif.
Semua table sensitif tidak punya public write policy.
Backend
Checkout tidak menerima jumlah kredit dari client.
Bonus dihitung server-side.
First topup dicek dari ledger/order existing.
Webhook tetap satu-satunya jalur grant topup.
Admin grant memakai service-role route + admin guard.
Ledger tetap append-only.
Unlock chapter tetap idempotent.
Target 650 hilang dari provider.
Provider/model bisa diganti dari DB atau env override.
UI
Topup card menampilkan bonus.
First topup bonus tampil untuk user yang belum pernah topup.
Normal bonus tampil untuk user yang sudah pernah topup.
Admin punya halaman grant credit minimal.
Tidak ada istilah AI/model/token/provider di UI pembaca.
Test

Wajib hijau:

pnpm typecheck
pnpm run smoke
pnpm test:unit
Urutan pengerjaan yang saya rekomendasikan

Jangan kerjakan AI route dulu. Kerjakan yang berdampak monetisasi dulu.

Bonus topup di credit_products.
Snapshot credit_orders.
Webhook grant total credits.
Admin manual grant.
Generation policy 800–1000.
AI model routes.
Admin UI ops config lanjutan.

Alasannya: bonus topup dan admin grant langsung memengaruhi operasional dan marketing. AI route penting, tapi bisa menyusul setelah ledger dan pricing aman.

Instruksi ringkas untuk agen coding

Berikan ini ke agen:

Implement ops-ready credit and generation configuration for Lakoku.

Current constraints:
- Do not expose AI/model/provider/token terms to reader-facing UI.
- Do not accept credit amount, price, or bonus from client.
- PayCore webhook remains the only authoritative paid topup grant path.
- Credit ledger must stay append-only and idempotent.
- Admin manual grant must be audited.
- Replace any remaining 650 target words with generation policy 800–1000.

Tasks:
1. Add Supabase migrations:
   - credit_products bonus columns:
     normal_bonus_credits, first_topup_bonus_credits, marketing_badge, bonus_active.
   - credit_orders snapshot table.
   - has_paid_topup_v1 RPC.
   - admin_credit_grants table.
   - admin_grant_credits_v1 RPC.
   - generation_policy table seeded with target_words_min=800, target_words_max=1000, target_scenes=3.
   - ai_model_routes table with one active route per use_case.

2. Update lib/paycore/products.ts:
   - include bonus fields.
   - add calculateTopupCredits(product, isFirstTopup).

3. Update checkout create flow:
   - read product from DB.
   - check first topup server-side.
   - calculate base, bonus, total.
   - create PayCore order with total credits in fulfillment_data.
   - insert credit_orders snapshot.
   - return base_credits, bonus_credits, total_credits, bonus_kind.

4. Update PayCore webhook flow:
   - verify signature as currently.
   - resolve order snapshot by order_id.
   - grant total_credits using ref paycore:{order_id}.
   - mark credit_orders as paid.
   - keep idempotency.

5. Add admin grant credit:
   - lib/admin/credits.ts.
   - app/api/admin/credits/grant/route.ts.
   - app/admin/credits/page.tsx.
   - use existing admin guard pattern.
   - require reason and audit all grants.

6. Add generation policy:
   - lib/ops/generation-policy.ts.
   - update deterministic/gateway provider path so plan/prose uses 800–1000 target.
   - remove TARGET_WORDS=650.

7. Add AI model route config:
   - lib/ops/ai-model-routes.ts.
   - update gateway-provider to resolve model route from DB first, env override second, code fallback last.

8. Add smoke tests:
   - topup-bonus-smoke.ts.
   - admin-credit-grant-smoke.ts.
   - generation-policy-smoke.ts.
   - ai-model-routes-smoke.ts.
   - add scripts to package.json smoke chain.

Definition of done:
- pnpm typecheck passes.
- pnpm run smoke passes.
- pnpm test:unit passes.
- grep confirms no TARGET_WORDS=650 remains.
- No reader-facing UI string leaks AI/model/token/provider.

Keputusan paling penting: jangan hanya mengganti 650 jadi 900 di file. Itu cuma tambal sulam. Buat generation_policy, karena target kata juga bisa berubah untuk eksperimen kualitas, biaya AI, atau positioning produk.
