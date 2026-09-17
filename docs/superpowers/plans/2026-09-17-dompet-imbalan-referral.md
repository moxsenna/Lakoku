# Dompet Imbalan & Komisi Referral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun sistem Dompet Imbalan (rupiah) dengan atribusi referral berbasis kode/link, komisi 10% dari top-up berbayar dalam 30 hari pertama, penukaran saldo ke kredit baca, dan panel konfigurasi admin.

**Architecture:** Arus dana satu arah (rupiah top-up → 10% ke reward_ledger → ditukar ke credit_ledger; kredit tak pernah bisa dicairkan). Atribusi ditangkap via route handler `/r/[code]` (cookie 30 hari) dan disimpan permanen saat pendaftaran. Hook non-fatal pada webhook PayCore mencatat komisi idempoten `commission:<order_id>`. Seluruh konfigurasi dikendalikan dari `/admin/settings` dengan audit log.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL, RLS, RPC), TypeScript strict mode, Zod, Vitest, Tailwind CSS, Lucide icons.

## Global Constraints

- **Invarian Dana:** Kredit yang dibeli DILARANG KERAS bisa berpindah ke dompet imbalan atau dicairkan (anti-regulasi uang elektronik).
- **Brand Guard:** DILARANG menampilkan kata "AI", "model", "token", "prompt", atau jargon teknis kepada pembaca.
- **Fail-Closed & Non-Fatal:** Kegagalan komisi TIDAK BOLEH membatalkan penerbitan kredit top-up; pendaftaran user TIDAK BOLEH gagal karena atribusi.
- **Konfigurasi Admin:** DILARANG hardcode persentase komisi, umur cookie, jendela hari, kurs tukar, atau ambang minimum — semua dibaca dari `reward_policy`.
- **Default Switch:** `commission_enabled` default `false` (prasyarat rilis: biaya inferensi per bab terukur).
- **Batas Paket ESLint:** Komponen membaca data lewat seam `lib/api/` atau helper server-only terisolasi, tidak ada deep imports internal.

---

### Task 1: Supabase Migration (Tables, RPC, RLS)

**Files:**
- Create: `supabase/migrations/20260917000000_dompet_imbalan_referral.sql`
- Test: `tests/rewards/migration.test.ts`

**Interfaces:**
- Consumes: `auth.users(id)`, `public.credit_ledger`, `public.credit_orders`
- Produces:
  - Table `public.referral_codes (user_id uuid PK, code text UNIQUE, created_at timestamptz)`
  - Table `public.referral_attributions (id uuid PK, referrer_user_id uuid, referred_user_id uuid UNIQUE, source text, shared_link_id uuid NULL, attributed_at timestamptz, window_ends_at timestamptz)`
  - Table `public.reward_ledger (id uuid PK, user_id uuid, delta_idr integer, reason text, ref text UNIQUE, created_at timestamptz)`
  - Table `public.reward_policy (id boolean PK check id=true, commission_percent int, window_days int, attribution_cookie_days int, redeem_rate_idr_per_credit int, redeem_min_idr int, commission_enabled boolean, redeem_enabled boolean, payout_enabled boolean, payout_min_idr int, updated_at timestamptz)`
  - Function `public.reward_balance_v1(p_user_id uuid) RETURNS integer`
  - Function `public.grant_reward_v1(p_user_id uuid, p_ref text, p_delta_idr integer, p_reason text) RETURNS boolean`

- [ ] **Step 1: Write migration test verifying SQL syntax and structure**

Buat test file `tests/rewards/migration.test.ts` untuk memvalidasi isi SQL migration file:
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('20260917000000_dompet_imbalan_referral migration', () => {
  const sqlPath = resolve(process.cwd(), 'supabase/migrations/20260917000000_dompet_imbalan_referral.sql')

  it('contains all 4 required tables and single-row reward_policy constraint', () => {
    const sql = readFileSync(sqlPath, 'utf8')
    expect(sql).toContain('create table if not exists public.referral_codes')
    expect(sql).toContain('create table if not exists public.referral_attributions')
    expect(sql).toContain('create table if not exists public.reward_ledger')
    expect(sql).toContain('create table if not exists public.reward_policy')
    expect(sql).toContain('check (id = true)')
    expect(sql).toContain('reward_balance_v1')
    expect(sql).toContain('grant_reward_v1')
    expect(sql).toContain('commission_enabled boolean not null default false')
  })

  it('contains self-referral check constraint', () => {
    const sql = readFileSync(sqlPath, 'utf8')
    expect(sql).toContain('referrer_user_id <> referred_user_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/rewards/migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory`

- [ ] **Step 3: Write the SQL migration file**

Buat file `supabase/migrations/20260917000000_dompet_imbalan_referral.sql`:
```sql
-- ============================================================================
-- Dompet Imbalan & Komisi Referral (M1 dengan rel M2)
-- Spec: docs/superpowers/specs/2026-09-17-dompet-imbalan-referral-design.md
-- ============================================================================

-- 1) referral_codes: kode permanen per user (dibuat saat registrasi atau on-demand)
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists referral_codes_code_idx on public.referral_codes(code);
alter table public.referral_codes enable row level security;

drop policy if exists referral_codes_own_read on public.referral_codes;
create policy referral_codes_own_read on public.referral_codes
  for select using (auth.uid() = user_id);

-- 2) referral_attributions: ikatan pengajak dan pembaca baru (unik seumur hidup)
create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  source text not null default 'referral_code',
  shared_link_id uuid references public.shared_story_links(id) on delete set null,
  attributed_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  constraint referral_attributions_no_self_referral check (referrer_user_id <> referred_user_id),
  constraint referral_attributions_source_check check (source in ('referral_code', 'share_link'))
);

create index if not exists referral_attributions_referrer_idx
  on public.referral_attributions(referrer_user_id, attributed_at desc);

alter table public.referral_attributions enable row level security;

drop policy if exists referral_attributions_own_read on public.referral_attributions;
create policy referral_attributions_own_read on public.referral_attributions
  for select using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

-- 3) reward_ledger: buku kas rupiah terpisah dari kredit (arus satu arah)
create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_idr integer not null,
  reason text not null,
  ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists reward_ledger_user_idx
  on public.reward_ledger(user_id, created_at desc);

alter table public.reward_ledger enable row level security;

drop policy if exists reward_ledger_own_read on public.reward_ledger;
create policy reward_ledger_own_read on public.reward_ledger
  for select using (auth.uid() = user_id);

-- RPC reward_balance_v1: hitung saldo rupiah user
create or replace function public.reward_balance_v1(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(delta_idr), 0)::int
  from public.reward_ledger
  where user_id = p_user_id;
$$;

grant execute on function public.reward_balance_v1(uuid) to authenticated, service_role;

-- RPC grant_reward_v1: tulis entri ledger idempoten
create or replace function public.grant_reward_v1(
  p_user_id uuid,
  p_ref text,
  p_delta_idr integer,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_delta_idr = 0 then
    raise exception 'grant_reward_v1: delta_idr cannot be zero';
  end if;

  insert into public.reward_ledger (user_id, delta_idr, reason, ref)
  values (p_user_id, p_delta_idr, p_reason, p_ref);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

grant execute on function public.grant_reward_v1(uuid, text, integer, text) to service_role;

-- 4) reward_policy: konfigurasi baris tunggal (id = true), editable lewat admin
create table if not exists public.reward_policy (
  id boolean primary key default true check (id = true),
  commission_percent integer not null default 10 check (commission_percent >= 0 and commission_percent <= 50),
  window_days integer not null default 30 check (window_days >= 1 and window_days <= 365),
  attribution_cookie_days integer not null default 30 check (attribution_cookie_days >= 1 and attribution_cookie_days <= 365),
  redeem_rate_idr_per_credit integer not null default 250 check (redeem_rate_idr_per_credit >= 50 and redeem_rate_idr_per_credit <= 10000),
  redeem_min_idr integer not null default 1000 check (redeem_min_idr >= 0),
  commission_enabled boolean not null default false,
  redeem_enabled boolean not null default true,
  payout_enabled boolean not null default false,
  payout_min_idr integer not null default 50000 check (payout_min_idr >= 0),
  updated_at timestamptz not null default now()
);

insert into public.reward_policy (
  id,
  commission_percent,
  window_days,
  attribution_cookie_days,
  redeem_rate_idr_per_credit,
  redeem_min_idr,
  commission_enabled,
  redeem_enabled,
  payout_enabled,
  payout_min_idr
) values (
  true,
  10,
  30,
  30,
  250,
  1000,
  false,
  true,
  false,
  50000
)
on conflict (id) do nothing;

alter table public.reward_policy enable row level security;

drop policy if exists reward_policy_read on public.reward_policy;
create policy reward_policy_read on public.reward_policy
  for select using (true);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/rewards/migration.test.ts`
Expected: PASS

- [ ] **Step 5: Run migration version check**

Run: `pnpm run check:migration-versions`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260917000000_dompet_imbalan_referral.sql tests/rewards/migration.test.ts
git commit -m "feat(rewards): migration for referral codes, attributions, ledger, and policy"
```

---

### Task 2: Pure Domain Logic & Calculation Engine (`lib/rewards/policy.ts`)

**Files:**
- Create: `lib/rewards/policy.ts`
- Test: `tests/rewards/policy.test.ts`

**Interfaces:**
- Consumes: None (pure domain logic)
- Produces:
  - `export interface RewardPolicy`
  - `export const DEFAULT_REWARD_POLICY: RewardPolicy`
  - `export function calculateCommission(priceIdr: number, policy?: RewardPolicy): number`
  - `export function isWithinWindow(attributedAt: Date | string, windowDays: number, now?: Date): boolean`
  - `export function calculateRedeemCredits(amountIdr: number, policy?: RewardPolicy): { creditsToGrant: number; costIdr: number; remainderIdr: number }`
  - `export function isValidReferralCode(code: string): boolean`
  - `export function generateReferralCode(): string`
  - `export const REFERRAL_COOKIE_NAME: string`

- [ ] **Step 1: Write the failing tests for reward policy calculation**

Buat file `tests/rewards/policy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REWARD_POLICY,
  calculateCommission,
  isWithinWindow,
  calculateRedeemCredits,
  isValidReferralCode,
  generateReferralCode,
  type RewardPolicy,
} from '../../lib/rewards/policy'

describe('lib/rewards/policy', () => {
  it('calculates 10% commission floor by default', () => {
    expect(calculateCommission(50000)).toBe(5000)
    expect(calculateCommission(15000)).toBe(1500)
    expect(calculateCommission(0)).toBe(0)
    expect(calculateCommission(99)).toBe(9) // floor(9.9) = 9
  })

  it('returns 0 commission if commission_enabled is false', () => {
    const disabledPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, commissionEnabled: false }
    expect(calculateCommission(50000, disabledPolicy)).toBe(0)
  })

  it('calculates commission with custom percent', () => {
    const customPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, commissionPercent: 15, commissionEnabled: true }
    expect(calculateCommission(100000, customPolicy)).toBe(15000)
  })

  it('checks if within referral window', () => {
    const now = new Date('2026-09-17T12:00:00Z')
    const within = new Date('2026-09-01T12:00:00Z') // 16 days ago
    const exactlyBoundary = new Date('2026-08-18T12:00:00Z') // 30 days ago
    const outside = new Date('2026-08-17T12:00:00Z') // 31 days ago

    expect(isWithinWindow(within, 30, now)).toBe(true)
    expect(isWithinWindow(exactlyBoundary, 30, now)).toBe(true)
    expect(isWithinWindow(outside, 30, now)).toBe(false)
  })

  it('calculates credit redemption at Rp250 per credit default', () => {
    const res = calculateRedeemCredits(5000)
    expect(res.creditsToGrant).toBe(20) // 5000 / 250
    expect(res.costIdr).toBe(5000)
    expect(res.remainderIdr).toBe(0)

    const withRemainder = calculateRedeemCredits(5100)
    expect(withRemainder.creditsToGrant).toBe(20)
    expect(withRemainder.costIdr).toBe(5000)
    expect(withRemainder.remainderIdr).toBe(100)
  })

  it('enforces redeemMinIdr and redeemEnabled', () => {
    expect(() => calculateRedeemCredits(500)).toThrow(/minimal/)
    const disabledPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, redeemEnabled: false }
    expect(() => calculateRedeemCredits(5000, disabledPolicy)).toThrow(/dinonaktifkan/)
  })

  it('validates and generates referral codes avoiding ambiguous characters', () => {
    const code = generateReferralCode()
    expect(code).toHaveLength(8)
    expect(isValidReferralCode(code)).toBe(true)
    expect(/^[A-HJ-NP-Z2-9]{8}$/.test(code)).toBe(true) // No 0, O, 1, I, l
    expect(isValidReferralCode('ABCD1234')).toBe(true)
    expect(isValidReferralCode('abc')).toBe(false)
    expect(isValidReferralCode('ABCD123O')).toBe(false) // Contains 'O'
    expect(isValidReferralCode('ABCD1230')).toBe(false) // Contains '0'
    expect(isValidReferralCode('ABCD123I')).toBe(false) // Contains 'I'
    expect(isValidReferralCode('ABCD1231')).toBe(false) // Contains '1'
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/rewards/policy.test.ts`
Expected: FAIL with `Cannot find module '../../lib/rewards/policy'`

- [ ] **Step 3: Implement `lib/rewards/policy.ts`**

Buat file `lib/rewards/policy.ts`:
```ts
/**
 * Logika murni domain Dompet Imbalan & Referral (bebas I/O dan server-only).
 * Spec: docs/superpowers/specs/2026-09-17-dompet-imbalan-referral-design.md
 */

export interface RewardPolicy {
  commissionPercent: number
  windowDays: number
  attributionCookieDays: number
  redeemRateIdrPerCredit: number
  redeemMinIdr: number
  commissionEnabled: boolean
  redeemEnabled: boolean
  payoutEnabled: boolean
  payoutMinIdr: number
}

export const DEFAULT_REWARD_POLICY: RewardPolicy = {
  commissionPercent: 10,
  windowDays: 30,
  attributionCookieDays: 30,
  redeemRateIdrPerCredit: 250,
  redeemMinIdr: 1000,
  commissionEnabled: false, // default mati per spec §7
  redeemEnabled: true,
  payoutEnabled: false,
  payoutMinIdr: 50000,
}

export const REFERRAL_COOKIE_NAME = 'lakoku_ref'

// Karakter tanpa ambigu: hilangkan 0, O, 1, I, L
const SAFE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Hitung komisi rupiah dari harga bayar (priceIdr). */
export function calculateCommission(
  priceIdr: number,
  policy: RewardPolicy = DEFAULT_REWARD_POLICY,
): number {
  if (!policy.commissionEnabled) return 0
  if (priceIdr <= 0) return 0
  return Math.floor((priceIdr * policy.commissionPercent) / 100)
}

/** Periksa apakah waktu transaksi masih dalam batas jendela referral. */
export function isWithinWindow(
  attributedAt: Date | string,
  windowDays: number,
  now: Date = new Date(),
): boolean {
  const start = new Date(attributedAt).getTime()
  const current = now.getTime()
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  return current >= start && current <= start + windowMs
}

export interface RedeemResult {
  creditsToGrant: number
  costIdr: number
  remainderIdr: number
}

/** Hitung kredit yang didapat dari penukaran saldo imbalan rupiah. */
export function calculateRedeemCredits(
  amountIdr: number,
  policy: RewardPolicy = DEFAULT_REWARD_POLICY,
): RedeemResult {
  if (!policy.redeemEnabled) {
    throw new Error('Penukaran kredit sedang dinonaktifkan')
  }
  if (amountIdr < policy.redeemMinIdr) {
    throw new Error(`Penukaran minimal Rp${policy.redeemMinIdr.toLocaleString('id-ID')}`)
  }
  if (policy.redeemRateIdrPerCredit <= 0) {
    throw new Error('Kurs penukaran tidak valid')
  }

  const creditsToGrant = Math.floor(amountIdr / policy.redeemRateIdrPerCredit)
  const costIdr = creditsToGrant * policy.redeemRateIdrPerCredit
  const remainderIdr = amountIdr - costIdr

  return { creditsToGrant, costIdr, remainderIdr }
}

/** Validasi format kode referral (8 karakter, hanya alfabet aman). */
export function isValidReferralCode(code: string): boolean {
  if (!code || typeof code !== 'string' || code.length !== 8) return false
  const regex = new RegExp(`^[${SAFE_ALPHABET}]{8}$`)
  return regex.test(code.toUpperCase())
}

/** Hasilkan kode referral acak 8 karakter. */
export function generateReferralCode(): string {
  let result = ''
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(Math.random() * SAFE_ALPHABET.length)
    result += SAFE_ALPHABET[idx]
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/rewards/policy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rewards/policy.ts tests/rewards/policy.test.ts
git commit -m "feat(rewards): pure domain logic for commission, window, and redemption"
```

---

### Task 3: Rewards Server Seam (`lib/rewards/server.ts`)

**Files:**
- Create: `lib/rewards/server.ts`
- Test: `tests/rewards/server.test.ts`

**Interfaces:**
- Consumes: `@lakoku/db`, `lib/rewards/policy.ts`, `grant_credits_v1`
- Produces:
  - `export async function getRewardPolicy(): Promise<RewardPolicy>`
  - `export async function getRewardBalance(userId: string): Promise<number>`
  - `export async function ensureReferralCode(userId: string): Promise<string>`
  - `export async function redeemRewardCredits(userId: string, amountIdr: number): Promise<{ creditsGranted: number; deductedIdr: number; newBalance: number }>`
  - `export async function getReferralStats(userId: string): Promise<{ code: string; totalReferred: number; activeReferred: number; balanceIdr: number; history: Array<{ id: string; deltaIdr: number; reason: string; createdAt: string }> }>`

- [ ] **Step 1: Write test for rewards server seam with mock DB**

Buat file `tests/rewards/server.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  getRewardPolicy,
  getRewardBalance,
  redeemRewardCredits,
} from '../../lib/rewards/server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@lakoku/db'

describe('lib/rewards/server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads reward policy from DB with fallback', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            commission_percent: 15,
            window_days: 45,
            attribution_cookie_days: 60,
            redeem_rate_idr_per_credit: 250,
            redeem_min_idr: 2000,
            commission_enabled: true,
            redeem_enabled: true,
            payout_enabled: false,
            payout_min_idr: 50000,
          },
          error: null,
        }),
      }),
    })
    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    })

    const policy = await getRewardPolicy()
    expect(policy.commissionPercent).toBe(15)
    expect(policy.windowDays).toBe(45)
    expect(policy.attributionCookieDays).toBe(60)
    expect(policy.commissionEnabled).toBe(true)
  })

  it('reads reward balance via RPC', async () => {
    ;(createAdminClient as any).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 12500, error: null }),
    })
    const balance = await getRewardBalance('user-123')
    expect(balance).toBe(12500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/rewards/server.test.ts`
Expected: FAIL with `Cannot find module '../../lib/rewards/server'`

- [ ] **Step 3: Implement `lib/rewards/server.ts`**

Buat file `lib/rewards/server.ts`:
```ts
import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'
import {
  DEFAULT_REWARD_POLICY,
  generateReferralCode,
  calculateRedeemCredits,
  type RewardPolicy,
} from './policy'

/** Ambil kebijakan reward aktif dari DB (fallback ke DEFAULT_REWARD_POLICY). */
export const getRewardPolicy = cache(async function getRewardPolicy(): Promise<RewardPolicy> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('reward_policy')
      .select('*')
      .eq('id', true)
      .maybeSingle()

    if (error || !data) return DEFAULT_REWARD_POLICY

    return {
      commissionPercent: Number(data.commission_percent ?? DEFAULT_REWARD_POLICY.commissionPercent),
      windowDays: Number(data.window_days ?? DEFAULT_REWARD_POLICY.windowDays),
      attributionCookieDays: Number(data.attribution_cookie_days ?? DEFAULT_REWARD_POLICY.attributionCookieDays),
      redeemRateIdrPerCredit: Number(data.redeem_rate_idr_per_credit ?? DEFAULT_REWARD_POLICY.redeemRateIdrPerCredit),
      redeemMinIdr: Number(data.redeem_min_idr ?? DEFAULT_REWARD_POLICY.redeemMinIdr),
      commissionEnabled: Boolean(data.commission_enabled),
      redeemEnabled: Boolean(data.redeem_enabled),
      payoutEnabled: Boolean(data.payout_enabled),
      payoutMinIdr: Number(data.payout_min_idr ?? DEFAULT_REWARD_POLICY.payoutMinIdr),
    }
  } catch {
    return DEFAULT_REWARD_POLICY
  }
})

/** Ambil saldo rupiah dompet imbalan user. */
export async function getRewardBalance(userId: string): Promise<number> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('reward_balance_v1', { p_user_id: userId })
    if (error) return 0
    return Number(data ?? 0)
  } catch {
    return 0
  }
}

/** Ambil atau terbitkan kode referral unik untuk user. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const db = createAdminClient()
  const { data: existing } = await db
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.code) return existing.code

  // Buat kode baru dengan retry bila bentrok
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const { error } = await db.from('referral_codes').insert({
      user_id: userId,
      code,
    })
    if (!error) return code
    if (error.code !== '23505') throw new Error(`ensureReferralCode: ${error.message}`)
  }

  throw new Error('Gagal membuat kode referral unik setelah 5 percobaan')
}

/**
 * Tukar saldo rupiah jadi kredit baca (transaksi atomik berpasangan).
 * Ledger reward didebit (delta negatif), ledger kredit dikredit (delta positif).
 */
export async function redeemRewardCredits(
  userId: string,
  amountIdr: number,
): Promise<{ creditsGranted: number; deductedIdr: number; newBalance: number }> {
  const policy = await getRewardPolicy()
  const balance = await getRewardBalance(userId)

  if (amountIdr > balance) {
    throw new Error('Saldo imbalan tidak mencukupi')
  }

  const { creditsToGrant, costIdr } = calculateRedeemCredits(amountIdr, policy)
  if (creditsToGrant <= 0) {
    throw new Error('Jumlah penukaran tidak cukup untuk menghasilkan 1 kredit')
  }

  const db = createAdminClient()
  const redeemUuid = crypto.randomUUID()
  const rewardRef = `redeem:${redeemUuid}`
  const creditRef = `reward-redeem:${redeemUuid}`

  // 1. Tulis debit ke reward_ledger
  const { data: rewardGranted, error: rewardErr } = await db.rpc('grant_reward_v1', {
    p_user_id: userId,
    p_ref: rewardRef,
    p_delta_idr: -costIdr,
    p_reason: 'redeem_credits',
  })

  if (rewardErr || rewardGranted !== true) {
    throw new Error(`Gagal memotong saldo imbalan: ${rewardErr?.message ?? 'duplikasi'}`)
  }

  // 2. Tulis grant ke credit_ledger
  const { data: creditGranted, error: creditErr } = await db.rpc('grant_credits_v1', {
    p_user_id: userId,
    p_ref: creditRef,
    p_credits: creditsToGrant,
    p_reason: 'reward_redeem',
  })

  if (creditErr || creditGranted !== true) {
    // Upaya kompensasi bila grant kredit gagal
    await db.rpc('grant_reward_v1', {
      p_user_id: userId,
      p_ref: `compensate:${redeemUuid}`,
      p_delta_idr: costIdr,
      p_reason: 'compensation_failed_credit_grant',
    })
    throw new Error(`Gagal menerbitkan kredit: ${creditErr?.message}`)
  }

  const newBalance = await getRewardBalance(userId)
  return {
    creditsGranted: creditsToGrant,
    deductedIdr: costIdr,
    newBalance,
  }
}

export interface ReferralHistoryItem {
  id: string
  deltaIdr: number
  reason: string
  createdAt: string
}

export interface ReferralStats {
  code: string
  totalReferred: number
  activeReferred: number
  balanceIdr: number
  history: ReferralHistoryItem[]
}

/** Statistik lengkap referral dan imbalan untuk profil user. */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const [code, balanceIdr, db] = await Promise.all([
    ensureReferralCode(userId),
    getRewardBalance(userId),
    createAdminClient(),
  ])

  const nowIso = new Date().toISOString()

  const [attributionsRes, historyRes] = await Promise.all([
    db
      .from('referral_attributions')
      .select('id,window_ends_at')
      .eq('referrer_user_id', userId),
    db
      .from('reward_ledger')
      .select('id,delta_idr,reason,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const attributions = attributionsRes.data ?? []
  const totalReferred = attributions.length
  const activeReferred = attributions.filter((a) => a.window_ends_at > nowIso).length

  const history: ReferralHistoryItem[] = (historyRes.data ?? []).map((row) => ({
    id: row.id,
    deltaIdr: Number(row.delta_idr),
    reason: row.reason,
    createdAt: row.created_at,
  }))

  return {
    code,
    totalReferred,
    activeReferred,
    balanceIdr,
    history,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/rewards/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rewards/server.ts tests/rewards/server.test.ts
git commit -m "feat(rewards): server seam for policy, balance, code, and atomic credit redemption"
```

---

### Task 4: Attribution Server, Route Handler `/r/[code]`, and Auth Callback

**Files:**
- Create: `lib/rewards/attribution.server.ts`
- Create: `app/r/[code]/route.ts`
- Modify: `app/auth/callback/route.ts`
- Test: `tests/rewards/attribution.test.ts`

**Interfaces:**
- Consumes: `lib/rewards/server.ts`, `lib/rewards/policy.ts`
- Produces:
  - `recordReferralAttribution(referredUserId: string, codeOrSlug: string, source: 'referral_code' | 'share_link'): Promise<boolean>`
  - Route handler `GET /r/[code]`
  - Auth callback sets attribution and purges cookie

- [ ] **Step 1: Write unit tests for attribution logic**

Buat file `tests/rewards/attribution.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { recordReferralAttribution } from '../../lib/rewards/attribution.server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn().mockResolvedValue({
    windowDays: 30,
    attributionCookieDays: 30,
  }),
}))

import { createAdminClient } from '@lakoku/db'

describe('lib/rewards/attribution.server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records attribution mapping code to referrer', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    const mockSelectReferrer = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'user-referrer-1' },
          error: null,
        }),
      }),
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_codes') {
          return { select: mockSelectReferrer }
        }
        if (table === 'referral_attributions') {
          return { insert: mockInsert }
        }
        return {}
      }),
    })

    const success = await recordReferralAttribution('user-new-2', 'ABCD2345', 'referral_code')
    expect(success).toBe(true)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const payload = mockInsert.mock.calls[0][0]
    expect(payload.referrer_user_id).toBe('user-referrer-1')
    expect(payload.referred_user_id).toBe('user-new-2')
  })

  it('rejects self-referral cleanly without error', async () => {
    const mockSelectReferrer = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'user-same' },
          error: null,
        }),
      }),
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockSelectReferrer }),
    })

    const success = await recordReferralAttribution('user-same', 'ABCD2345', 'referral_code')
    expect(success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/rewards/attribution.test.ts`
Expected: FAIL with `Cannot find module '../../lib/rewards/attribution.server'`

- [ ] **Step 3: Implement `lib/rewards/attribution.server.ts`**

Buat file `lib/rewards/attribution.server.ts`:
```ts
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { getRewardPolicy } from './server'

/**
 * Catat ikatan atribusi pembaca baru ke pengajak.
 * Fail-closed, non-fatal, idempoten seumur hidup.
 */
export async function recordReferralAttribution(
  referredUserId: string,
  code: string,
  source: 'referral_code' | 'share_link' = 'referral_code',
  sharedLinkId: string | null = null,
): Promise<boolean> {
  if (!referredUserId || !code) return false

  try {
    const db = createAdminClient()

    // 1. Cari pemilik kode referral
    const { data: codeRow, error: codeErr } = await db
      .from('referral_codes')
      .select('user_id')
      .eq('code', code.toUpperCase())
      .maybeSingle()

    if (codeErr || !codeRow?.user_id) return false
    const referrerUserId = codeRow.user_id

    // 2. Tolak self-referral
    if (referrerUserId === referredUserId) return false

    // 3. Hitung window_ends_at dari kebijakan aktif
    const policy = await getRewardPolicy()
    const now = new Date()
    const windowEndsAt = new Date(now.getTime() + policy.windowDays * 24 * 60 * 60 * 1000)

    // 4. Tulis atribusi
    const { error: insertErr } = await db.from('referral_attributions').insert({
      referrer_user_id: referrerUserId,
      referred_user_id: referredUserId,
      source,
      shared_link_id: sharedLinkId,
      attributed_at: now.toISOString(),
      window_ends_at: windowEndsAt.toISOString(),
    })

    if (insertErr) {
      // 23505 = unique_violation (user sudah pernah diatribusikan)
      if (insertErr.code === '23505') return false
      console.log('[rewards] recordReferralAttribution non-fatal insert error:', insertErr.message)
      return false
    }

    return true
  } catch (err) {
    console.log('[rewards] recordReferralAttribution caught error:', (err as Error)?.message)
    return false
  }
}
```

- [ ] **Step 4: Implement Route Handler `app/r/[code]/route.ts`**

Buat file `app/r/[code]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getRewardPolicy } from '@/lib/rewards/server'
import { isValidReferralCode, REFERRAL_COOKIE_NAME } from '@/lib/rewards/policy'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params
  const searchParams = request.nextUrl.searchParams
  const nextTarget = sanitizeNextPath(searchParams.get('next') ?? '/')

  const redirectUrl = new URL(nextTarget, request.nextUrl.origin)
  const response = NextResponse.redirect(redirectUrl)

  // Hanya tulis cookie bila kode memenuhi format alfabet aman
  if (isValidReferralCode(code)) {
    // Jangan timpa cookie bila pengunjung sudah memiliki atribusi referral sebelumnya (first-touch wins)
    const existingCookie = request.cookies.get(REFERRAL_COOKIE_NAME)
    if (!existingCookie) {
      const policy = await getRewardPolicy().catch(() => ({ attributionCookieDays: 30 }))
      const maxAge = (policy.attributionCookieDays ?? 30) * 24 * 60 * 60

      response.cookies.set({
        name: REFERRAL_COOKIE_NAME,
        value: code.toUpperCase(),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge,
      })
    }
  }

  return response
}
```

- [ ] **Step 5: Modify `app/auth/callback/route.ts` to hook attribution**

Edit `app/auth/callback/route.ts` setelah pertukaran session kode berhasil:
```ts
// Setelah:
// const { error } = await supabase.auth.exchangeCodeForSession(code)
// if (error) { ... }

// Tambahkan:
const refCookie = request.cookies.get('lakoku_ref')?.value
if (refCookie) {
  try {
    const { data: sessionData } = await supabase.auth.getUser()
    if (sessionData?.user?.id) {
      const { recordReferralAttribution } = await import('@/lib/rewards/attribution.server')
      await recordReferralAttribution(sessionData.user.id, refCookie, 'referral_code')
    }
  } catch (attributionErr) {
    console.log('[auth/callback] attribution hook non-fatal error:', attributionErr)
  }
  successResponse.cookies.delete('lakoku_ref')
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/rewards/attribution.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/rewards/attribution.server.ts app/r/[code]/route.ts app/auth/callback/route.ts tests/rewards/attribution.test.ts
git commit -m "feat(rewards): attribution capture via /r/[code] and auth callback hook"
```

---

### Task 5: PayCore Webhook Integration for Referral Commission (`lib/entitlement/paycore.ts`)

**Files:**
- Modify: `lib/entitlement/paycore.ts`
- Test: `tests/rewards/paycore-commission.test.ts`

**Interfaces:**
- Consumes: `lib/rewards/server.ts`, `lib/rewards/policy.ts`, `lib/entitlement/paycore.ts`
- Produces:
  - Integration: `applyReferralCommission(orderId: string, buyerUserId: string, db: SupabaseClient): Promise<void>` inside webhook completion.

- [ ] **Step 1: Write test for webhook referral commission hook**

Buat file `tests/rewards/paycore-commission.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyReferralCommission } from '../../lib/rewards/commission.server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn(),
}))

import { createAdminClient } from '@lakoku/db'
import { getRewardPolicy } from '../../lib/rewards/server'

describe('applyReferralCommission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies 10% commission if attribution exists, within window, and commission_enabled', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: true,
      windowDays: 30,
    })

    const mockGrantReward = vi.fn().mockResolvedValue({ data: true, error: null })
    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_attributions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    referrer_user_id: 'user-referrer',
                    window_ends_at: new Date(Date.now() + 86400000).toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'credit_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { price_idr: 50000 },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
      rpc: mockGrantReward,
    }
    ;(createAdminClient as any).mockReturnValue(mockDb)

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(true)
    expect(result.commissionIdr).toBe(5000)
    expect(mockGrantReward).toHaveBeenCalledWith('grant_reward_v1', {
      p_user_id: 'user-referrer',
      p_ref: 'commission:order-123',
      p_delta_idr: 5000,
      p_reason: 'referral_commission',
    })
  })

  it('skips commission if commission_enabled is false', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: false,
    })

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('commission_disabled')
  })

  it('skips commission if window has expired', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: true,
    })

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_attributions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    referrer_user_id: 'user-referrer',
                    window_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    ;(createAdminClient as any).mockReturnValue(mockDb)

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('window_expired')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/rewards/paycore-commission.test.ts`
Expected: FAIL with `Cannot find module '../../lib/rewards/commission.server'`

- [ ] **Step 3: Implement `lib/rewards/commission.server.ts`**

Buat file `lib/rewards/commission.server.ts`:
```ts
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { getRewardPolicy } from './server'
import { calculateCommission } from './policy'

export interface ApplyCommissionResult {
  applied: boolean
  commissionIdr?: number
  reason?: string
}

/**
 * Berikan komisi referral atas pembayaran top-up (idempoten ref `commission:<order_id>`).
 * Dipanggil dari handler webhook PayCore setelah order lunas.
 */
export async function applyReferralCommission(
  orderId: string,
  buyerUserId: string,
): Promise<ApplyCommissionResult> {
  const policy = await getRewardPolicy()
  if (!policy.commissionEnabled) {
    return { applied: false, reason: 'commission_disabled' }
  }

  const db = createAdminClient()

  // 1. Cari ikatan atribusi pembeli
  const { data: attribution, error: attrErr } = await db
    .from('referral_attributions')
    .select('referrer_user_id,window_ends_at')
    .eq('referred_user_id', buyerUserId)
    .maybeSingle()

  if (attrErr || !attribution) {
    return { applied: false, reason: 'no_attribution' }
  }

  // 2. Cek apakah masih dalam jendela waktu
  const nowIso = new Date().toISOString()
  if (attribution.window_ends_at < nowIso) {
    return { applied: false, reason: 'window_expired' }
  }

  // 3. Ambil snapshot price_idr dari credit_orders
  const { data: order, error: orderErr } = await db
    .from('credit_orders')
    .select('price_idr')
    .eq('order_id', orderId)
    .maybeSingle()

  if (orderErr || !order) {
    console.log(`[rewards] applyReferralCommission: snapshot credit_orders untuk ${orderId} tidak ditemukan`)
    return { applied: false, reason: 'no_order_snapshot' }
  }

  const commissionIdr = calculateCommission(Number(order.price_idr), policy)
  if (commissionIdr <= 0) {
    return { applied: false, reason: 'zero_commission' }
  }

  // 4. Tulis ke reward_ledger idempoten
  const ref = `commission:${orderId}`
  const { data: granted, error: grantErr } = await db.rpc('grant_reward_v1', {
    p_user_id: attribution.referrer_user_id,
    p_ref: ref,
    p_delta_idr: commissionIdr,
    p_reason: 'referral_commission',
  })

  if (grantErr) {
    console.log(`[rewards] applyReferralCommission RPC error: ${grantErr.message}`)
    return { applied: false, reason: grantErr.message }
  }

  return { applied: granted === true, commissionIdr }
}
```

- [ ] **Step 4: Integrate `applyReferralCommission` into `lib/entitlement/paycore.ts`**

Edit `lib/entitlement/paycore.ts` pada baris setelah `await deps.store.markOrderPaid(event.orderId)` (sekitar baris 215):
```ts
  // Berikan komisi referral secara non-fatal bila pembeli terikat referral
  try {
    const { applyReferralCommission } = await import('@/lib/rewards/commission.server')
    await applyReferralCommission(event.orderId, event.userId)
  } catch (err) {
    console.log('[v0] paycore webhook: applyReferralCommission non-fatal failure:', (err as Error)?.message)
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/rewards/paycore-commission.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/rewards/commission.server.ts lib/entitlement/paycore.ts tests/rewards/paycore-commission.test.ts
git commit -m "feat(rewards): hook referral commission into PayCore webhook completion"
```

---

### Task 6: Admin Settings Schema & Backend API Route

**Files:**
- Modify: `lib/admin/settings-schemas.ts`
- Modify: `lib/admin/settings.ts`
- Create: `app/api/admin/settings/reward-policy/route.ts`
- Modify: `app/api/admin/settings/read/route.ts`
- Test: `tests/admin/reward-policy-settings.test.ts`

**Interfaces:**
- Consumes: `lib/admin/settings-schemas.ts`, `lib/admin/settings.ts`
- Produces:
  - `updateRewardPolicySchema`
  - `updateRewardPolicy(input: UpdateRewardPolicyInput): Promise<AdminRewardPolicy>`
  - `PATCH /api/admin/settings/reward-policy`

- [ ] **Step 1: Write test for updateRewardPolicySchema**

Buat file `tests/admin/reward-policy-settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { updateRewardPolicySchema } from '../../lib/admin/settings-schemas'

describe('updateRewardPolicySchema', () => {
  const valid = {
    commissionPercent: 10,
    windowDays: 30,
    attributionCookieDays: 30,
    redeemRateIdrPerCredit: 250,
    redeemMinIdr: 1000,
    commissionEnabled: false,
    redeemEnabled: true,
    payoutEnabled: false,
    payoutMinIdr: 50000,
    reason: 'Pengaturan awal dompet imbalan',
  }

  it('accepts valid reward policy update payload', () => {
    const res = updateRewardPolicySchema.safeParse(valid)
    expect(res.success).toBe(true)
  })

  it('rejects commissionPercent > 50', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, commissionPercent: 55 })
    expect(res.success).toBe(false)
  })

  it('rejects windowDays < 1', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, windowDays: 0 })
    expect(res.success).toBe(false)
  })

  it('rejects reason shorter than 5 characters', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, reason: 'ubah' })
    expect(res.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/admin/reward-policy-settings.test.ts`
Expected: FAIL with `updateRewardPolicySchema is not defined`

- [ ] **Step 3: Add `updateRewardPolicySchema` to `lib/admin/settings-schemas.ts`**

Tambahkan ke `lib/admin/settings-schemas.ts`:
```ts
export const updateRewardPolicySchema = z.object({
  commissionPercent: z.number().int().min(0).max(50),
  windowDays: z.number().int().min(1).max(365),
  attributionCookieDays: z.number().int().min(1).max(365),
  redeemRateIdrPerCredit: z.number().int().min(50).max(10000),
  redeemMinIdr: z.number().int().min(0).max(1000000),
  commissionEnabled: z.boolean(),
  redeemEnabled: z.boolean(),
  payoutEnabled: z.boolean(),
  payoutMinIdr: z.number().int().min(0).max(10000000),
  reason: z.string().min(5).max(500),
})

export type UpdateRewardPolicyInput = z.infer<typeof updateRewardPolicySchema>
```

- [ ] **Step 4: Add reward policy management to `lib/admin/settings.ts`**

Di `lib/admin/settings.ts`:
1. Ekspor interface `AdminRewardPolicy`:
```ts
export interface AdminRewardPolicy {
  commissionPercent: number
  windowDays: number
  attributionCookieDays: number
  redeemRateIdrPerCredit: number
  redeemMinIdr: number
  commissionEnabled: boolean
  redeemEnabled: boolean
  payoutEnabled: boolean
  payoutMinIdr: number
  updatedAt: string | null
}
```
2. Tambahkan `rewardPolicy: AdminRewardPolicy | null` ke interface `SettingsData`.
3. Di fungsi `loadSettingsData()`, baca baris `reward_policy` dan sertakan dalam hasil return.
4. Implementasikan `updateRewardPolicy`:
```ts
export async function updateRewardPolicy(
  input: UpdateRewardPolicyInput,
): Promise<AdminRewardPolicy> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('reward_policy')
    .select('*')
    .eq('id', true)
    .single()

  const oldVal = oldRow
    ? {
        commission_percent: oldRow.commission_percent,
        window_days: oldRow.window_days,
        attribution_cookie_days: oldRow.attribution_cookie_days,
        redeem_rate_idr_per_credit: oldRow.redeem_rate_idr_per_credit,
        redeem_min_idr: oldRow.redeem_min_idr,
        commission_enabled: oldRow.commission_enabled,
        redeem_enabled: oldRow.redeem_enabled,
        payout_enabled: oldRow.payout_enabled,
        payout_min_idr: oldRow.payout_min_idr,
      }
    : null

  const newVal = {
    commission_percent: input.commissionPercent,
    window_days: input.windowDays,
    attribution_cookie_days: input.attributionCookieDays,
    redeem_rate_idr_per_credit: input.redeemRateIdrPerCredit,
    redeem_min_idr: input.redeemMinIdr,
    commission_enabled: input.commissionEnabled,
    redeem_enabled: input.redeemEnabled,
    payout_enabled: input.payoutEnabled,
    payout_min_idr: input.payoutMinIdr,
    updated_at: new Date().toISOString(),
  }

  const { error } = await db
    .from('reward_policy')
    .update(newVal)
    .eq('id', true)

  if (error) throw new Error(`updateRewardPolicy: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'reward_policy',
    settingKey: 'default',
    oldValue: oldVal,
    newValue: newVal,
    reason: input.reason,
  })

  return {
    commissionPercent: input.commissionPercent,
    windowDays: input.windowDays,
    attributionCookieDays: input.attributionCookieDays,
    redeemRateIdrPerCredit: input.redeemRateIdrPerCredit,
    redeemMinIdr: input.redeemMinIdr,
    commissionEnabled: input.commissionEnabled,
    redeemEnabled: input.redeemEnabled,
    payoutEnabled: input.payoutEnabled,
    payoutMinIdr: input.payoutMinIdr,
    updatedAt: newVal.updated_at,
  }
}
```

- [ ] **Step 5: Create Route `app/api/admin/settings/reward-policy/route.ts`**

Buat file `app/api/admin/settings/reward-policy/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { updateRewardPolicy } from '@/lib/admin/settings'
import { updateRewardPolicySchema } from '@/lib/admin/settings-schemas'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json()
    const parsed = updateRewardPolicySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result = await updateRewardPolicy(parsed.data)
    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    const msg = (err as Error)?.message
    if (msg?.startsWith('Forbidden')) {
      return NextResponse.json({ error: 'Owner role required' }, { status: 403 })
    }
    console.log('[admin] PATCH /api/admin/settings/reward-policy gagal:', msg)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/admin/reward-policy-settings.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/admin/settings-schemas.ts lib/admin/settings.ts app/api/admin/settings/reward-policy/route.ts tests/admin/reward-policy-settings.test.ts
git commit -m "feat(admin): reward policy schema, backend mutation with audit log, and PATCH route"
```

---

### Task 7: Admin Settings UI Dialog & Section Card

**Files:**
- Create: `components/admin/settings/edit-reward-policy-dialog.tsx`
- Modify: `app/admin/settings/page.tsx`
- Test: `pnpm run typecheck`

**Interfaces:**
- Consumes: `components/admin/settings/edit-reward-policy-dialog.tsx`, `lib/admin/settings.ts`
- Produces:
  - Interactive Dialog for owner to edit `commissionPercent`, `windowDays`, `attributionCookieDays`, `redeemRateIdrPerCredit`, `redeemMinIdr`, `commissionEnabled`, `redeemEnabled`.
  - AdminSectionCard in `/admin/settings`.

- [ ] **Step 1: Implement `components/admin/settings/edit-reward-policy-dialog.tsx`**

Buat file `components/admin/settings/edit-reward-policy-dialog.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

interface Props {
  policy: {
    commissionPercent: number
    windowDays: number
    attributionCookieDays: number
    redeemRateIdrPerCredit: number
    redeemMinIdr: number
    commissionEnabled: boolean
    redeemEnabled: boolean
    payoutEnabled: boolean
    payoutMinIdr: number
  }
  onClose: () => void
  onSaved: () => void
}

export function EditRewardPolicyDialog({ policy, onClose, onSaved }: Props) {
  const [commissionPercent, setCommissionPercent] = useState(String(policy.commissionPercent))
  const [windowDays, setWindowDays] = useState(String(policy.windowDays))
  const [cookieDays, setCookieDays] = useState(String(policy.attributionCookieDays))
  const [redeemRate, setRedeemRate] = useState(String(policy.redeemRateIdrPerCredit))
  const [redeemMin, setRedeemMin] = useState(String(policy.redeemMinIdr))
  const [commissionEnabled, setCommissionEnabled] = useState(policy.commissionEnabled)
  const [redeemEnabled, setRedeemEnabled] = useState(policy.redeemEnabled)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const cp = Number(commissionPercent)
    const wd = Number(windowDays)
    const cd = Number(cookieDays)
    const rr = Number(redeemRate)
    const rm = Number(redeemMin)

    if (!Number.isInteger(cp) || cp < 0 || cp > 50) {
      setErr('Komisi harus bilangan bulat 0..50%')
      return
    }
    if (!Number.isInteger(wd) || wd < 1 || wd > 365) {
      setErr('Jendela komisi 1..365 hari')
      return
    }
    if (!Number.isInteger(cd) || cd < 1 || cd > 365) {
      setErr('Umur cookie 1..365 hari')
      return
    }
    if (!Number.isInteger(rr) || rr < 50 || rr > 10000) {
      setErr('Kurs penukaran Rp50..Rp10.000 per kredit')
      return
    }
    if (!Number.isInteger(rm) || rm < 0) {
      setErr('Ambang minimal penukaran minimal Rp0')
      return
    }
    if (reason.length < 5) {
      setErr('Alasan perubahan minimal 5 karakter')
      return
    }

    setLoading(true)
    setErr('')

    try {
      const res = await fetch('/api/admin/settings/reward-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commissionPercent: cp,
          windowDays: wd,
          attributionCookieDays: cd,
          redeemRateIdrPerCredit: rr,
          redeemMinIdr: rm,
          commissionEnabled,
          redeemEnabled,
          payoutEnabled: false, // Terkunci di rilis ini
          payoutMinIdr: 50000,
          reason,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan')
      onSaved()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl border border-border">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Kebijakan Dompet Imbalan</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        {commissionEnabled && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              <strong>Perhatian:</strong> Biaya inferensi nyata per bab saat ini berstatus UNMEASURED di rute produksi 9Router. Menyalakan komisi membawa risiko defisit per bab bila biaya riil melampaui margin.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Komisi (%)</label>
              <input
                type="number"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Jendela Komisi (hari)</label>
              <input
                type="number"
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Umur Cookie /r/ (hari)</label>
              <input
                type="number"
                value={cookieDays}
                onChange={(e) => setCookieDays(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Kurs Tukar (Rp / kredit)</label>
              <input
                type="number"
                value={redeemRate}
                onChange={(e) => setRedeemRate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">Min. Tukar ke Kredit (Rp)</label>
            <input
              type="number"
              value={redeemMin}
              onChange={(e) => setRedeemMin(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={commissionEnabled}
                onChange={(e) => setCommissionEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Komisi Referral</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={redeemEnabled}
                onChange={(e) => setRedeemEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Penukaran ke Kredit</span>
            </label>
          </div>

          <p className="text-[11px] text-muted-foreground italic">
            * Perubahan jendela hari dan persentase komisi tidak berlaku surut pada atribusi lama.
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">Alasan Perubahan (wajib dicatat di audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Pengujian aktivasi referral batch pilot..."
              rows={2}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Reward Policy Section Card to `app/admin/settings/page.tsx`**

Tambahkan card kebijakan reward ke dalam `app/admin/settings/page.tsx` dengan hook tombol Edit yang membuka `EditRewardPolicyDialog`.

- [ ] **Step 3: Run TypeScript check to verify clean compilation**

Run: `pnpm run typecheck`
Expected: PASS with 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/admin/settings/edit-reward-policy-dialog.tsx app/admin/settings/page.tsx
git commit -m "feat(admin): dialog and section card for live reward policy editing"
```

---

### Task 8: Reader-Facing UI: `/profil/imbalan` & Entry Links

**Files:**
- Create: `app/(shell)/profil/imbalan/page.tsx`
- Create: `app/(shell)/profil/imbalan/actions.ts` (Server actions for redeeming credits)
- Create: `components/rewards/copy-referral-link.tsx`
- Create: `components/rewards/redeem-credits-dialog.tsx`
- Modify: `app/(shell)/profil/page.tsx`
- Test: `pnpm run typecheck`

**Interfaces:**
- Consumes: `lib/rewards/server.ts`, `lib/rewards/policy.ts`
- Produces:
  - Page `/profil/imbalan` displaying:
    - Saldo Imbalan (Rp)
    - Tautan & Kode Referral dengan tombol salin
    - Kartu Statistik: Total Teman Diajak & Masih Aktif (30 hari)
    - Tombol Tukar ke Kredit (membuka dialog)
    - Tombol Tarik Tunai terkunci ("Pencairan segera hadir")
    - Riwayat Komisi & Penukaran
  - Entry card di `/profil` mengarah ke `/profil/imbalan`

- [ ] **Step 1: Implement server action `app/(shell)/profil/imbalan/actions.ts`**

Buat file `app/(shell)/profil/imbalan/actions.ts`:
```ts
'use server'

import { getSessionUser } from '@/lib/api/user-state'
import { redeemRewardCredits } from '@/lib/rewards/server'
import { revalidatePath } from 'next/cache'

export type RedeemActionResult =
  | { ok: true; creditsGranted: number; deductedIdr: number; newBalance: number }
  | { ok: false; error: string }

export async function actRedeemCredits(amountIdr: number): Promise<RedeemActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Silakan masuk terlebih dahulu' }

  try {
    const result = await redeemRewardCredits(user.id, amountIdr)
    revalidatePath('/profil/imbalan')
    revalidatePath('/profil')
    revalidatePath('/kredit')
    return { ok: true, ...result }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? 'Gagal menukarkan kredit' }
  }
}
```

- [ ] **Step 2: Implement UI components for Referral link and Redeem dialog**

1. `components/rewards/copy-referral-link.tsx`:
Tombol salin kode dan tautan lengkap `https://lakoku.app/r/<code>` dengan feedback "Tersalin!".
2. `components/rewards/redeem-credits-dialog.tsx`:
Modal input jumlah rupiah yang ingin ditukar, kalkulator estimasi kredit yang diperoleh (berdasarkan kurs aktif), dan tombol konfirmasi penukaran.

- [ ] **Step 3: Implement Page `app/(shell)/profil/imbalan/page.tsx`**

Buat halaman server component `app/(shell)/profil/imbalan/page.tsx` yang memanggil `getReferralStats(user.id)` dan `getRewardPolicy()` lalu merender kartu saldo, link referral, tombol aksi, dan tabel riwayat transaksi.

- [ ] **Step 4: Mount Dompet Imbalan link on `app/(shell)/profil/page.tsx`**

Edit `app/(shell)/profil/page.tsx` untuk menyisipkan Link Dompet Imbalan di sebelah card Kredit.

- [ ] **Step 5: Run typecheck and full unit tests**

Run: `pnpm run typecheck && pnpm exec vitest run --project unit tests/rewards/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/\(shell\)/profil/imbalan/ components/rewards/ app/\(shell\)/profil/page.tsx
git commit -m "feat(reader): profile reward wallet page, copy referral link, and credit redemption"
```

---

### Task 9: End-to-End Verification & Documentation Closeout

**Files:**
- Create: `scripts/smoke-rewards.ts`
- Test: `pnpm exec tsx scripts/smoke-rewards.ts`

**Interfaces:**
- Consumes: All rewards domain and server modules
- Produces:
  - Verification script running a complete simulated referral cycle:
    1. Register/ensure referral code for User A
    2. Route handler `/r/[code]` parses and validates correctly
    3. User B attributed to User A
    4. Mock top-up checkout triggers `applyReferralCommission`
    5. User A reward balance increases by 10%
    6. User A redeems reward into credit ledger
    7. Credit ledger balance increases, reward ledger decreases
    8. Audit log records setting modification

- [ ] **Step 1: Write smoke test script `scripts/smoke-rewards.ts`**

Buat file `scripts/smoke-rewards.ts` menguji alur di atas secara terisolasi.

- [ ] **Step 2: Run smoke script**

Run: `pnpm exec tsx scripts/smoke-rewards.ts`
Expected: All verification checks output PASS exit code 0.

- [ ] **Step 3: Commit and update plan checklist**

```bash
git add scripts/smoke-rewards.ts
git commit -m "test(rewards): smoke test covering complete referral-commission-redemption lifecycle"
```
