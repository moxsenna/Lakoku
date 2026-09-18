import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('20260919000000_lakoin_tinta_economy migration', () => {
  const sqlPath = resolve(
    process.cwd(),
    'supabase/migrations/20260919000000_lakoin_tinta_economy.sql',
  )

  it('migration file exists', () => {
    expect(existsSync(sqlPath)).toBe(true)
  })

  const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : ''

  describe('AC1.1: tinta_ledger table and indexes', () => {
    it('creates table tinta_ledger with required columns and constraints', () => {
      expect(sql).toContain('create table if not exists public.tinta_ledger')
      expect(sql).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/)
      expect(sql).toMatch(
        /user_id\s+uuid\s+not null\s+references\s+auth\.users\(id\)\s+on delete cascade/,
      )
      expect(sql).toMatch(/delta\s+integer\s+not null/)
      expect(sql).toMatch(/reason\s+text\s+not null/)
      expect(sql).toMatch(/ref\s+text\s+not null\s+unique/)
      expect(sql).toMatch(/pending_until\s+timestamptz/)
      expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/)
    })

    it('creates standard user index on tinta_ledger', () => {
      expect(sql).toContain('create index if not exists tinta_ledger_user_idx')
      expect(sql).toMatch(
        /on\s+public\.tinta_ledger\s*\(user_id,\s*created_at\s+desc\)/,
      )
    })

    it('creates partial author day index with WIB timezone and author_read_reward filter', () => {
      expect(sql).toContain('create index if not exists tinta_ledger_author_day_idx')
      expect(sql).toContain("timezone('Asia/Jakarta', created_at)")
      expect(sql).toMatch(/where\s+reason\s*=\s*'author_read_reward'/)
    })
  })

  describe('AC1.2: tinta_policy table, knobs, and seed', () => {
    it('creates single-row tinta_policy table with check (id = true)', () => {
      expect(sql).toContain('create table if not exists public.tinta_policy')
      expect(sql).toMatch(/id\s+boolean\s+primary key\s+default\s+true\s+check\s*\(id\s*=\s*true\)/)
    })

    it('includes all 11 knobs with exact default values and check constraint ranges', () => {
      // 1. tinta_per_read (default 10, check 0..1000)
      expect(sql).toMatch(
        /tinta_per_read\s+integer\s+not null\s+default\s+10\s+check\s*\(tinta_per_read\s*>=\s*0\s+and\s+tinta_per_read\s*<=\s*1000\)/,
      )
      // 2. author_daily_cap (default 300, check 0..100000)
      expect(sql).toMatch(
        /author_daily_cap\s+integer\s+not null\s+default\s+300\s+check\s*\(author_daily_cap\s*>=\s*0\s+and\s+author_daily_cap\s*<=\s*100000\)/,
      )
      // 3. tinta_checkin (default 5, check 0..1000)
      expect(sql).toMatch(
        /tinta_checkin\s+integer\s+not null\s+default\s+5\s+check\s*\(tinta_checkin\s*>=\s*0\s+and\s+tinta_checkin\s*<=\s*1000\)/,
      )
      // 4. tinta_choice (default 10, check 0..1000)
      expect(sql).toMatch(
        /tinta_choice\s+integer\s+not null\s+default\s+10\s+check\s*\(tinta_choice\s*>=\s*0\s+and\s+tinta_choice\s*<=\s*1000\)/,
      )
      // 5. tinta_ad_batch (default 10, check 0..1000)
      expect(sql).toMatch(
        /tinta_ad_batch\s+integer\s+not null\s+default\s+10\s+check\s*\(tinta_ad_batch\s*>=\s*0\s+and\s+tinta_ad_batch\s*<=\s*1000\)/,
      )
      // 6. tinta_per_lakoin (default 100, check 10..100000)
      expect(sql).toMatch(
        /tinta_per_lakoin\s+integer\s+not null\s+default\s+100\s+check\s*\(tinta_per_lakoin\s*>=\s*10\s+and\s+tinta_per_lakoin\s*<=\s*100000\)/,
      )
      // 7. exchange_min_lakoin (default 1, check 1..10000)
      expect(sql).toMatch(
        /exchange_min_lakoin\s+integer\s+not null\s+default\s+1\s+check\s*\(exchange_min_lakoin\s*>=\s*1\s+and\s+exchange_min_lakoin\s*<=\s*10000\)/,
      )
      // 8. pending_hours (default 24, check 0..168)
      expect(sql).toMatch(
        /pending_hours\s+integer\s+not null\s+default\s+24\s+check\s*\(pending_hours\s*>=\s*0\s+and\s+pending_hours\s*<=\s*168\)/,
      )
      // 9. author_rewards_enabled (default false)
      expect(sql).toMatch(/author_rewards_enabled\s+boolean\s+not null\s+default\s+false/)
      // 10. exchange_enabled (default false)
      expect(sql).toMatch(/exchange_enabled\s+boolean\s+not null\s+default\s+false/)
      // 11. missions_pay_tinta (default false)
      expect(sql).toMatch(/missions_pay_tinta\s+boolean\s+not null\s+default\s+false/)
      // updated_at
      expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/)
    })

    it('seeds the single-row policy idempotently', () => {
      expect(sql).toMatch(
        /insert\s+into\s+public\.tinta_policy\s*\(id\)\s+values\s*\(true\)\s+on conflict\s*\(id\)\s+do nothing/,
      )
    })
  })

  describe('AC1.3: Row Level Security (RLS)', () => {
    it('enables RLS on tinta_ledger and grants select only for own user_id', () => {
      expect(sql).toContain('alter table public.tinta_ledger enable row level security;')
      expect(sql).toContain('drop policy if exists tinta_ledger_own_read on public.tinta_ledger;')
      expect(sql).toMatch(
        /create policy tinta_ledger_own_read on public\.tinta_ledger\s+for select using\s*\(auth\.uid\(\)\s*=\s*user_id\);/,
      )
      // Verify no write policy is defined on tinta_ledger
      expect(sql).not.toMatch(/create policy.*on public\.tinta_ledger\s+for (insert|update|delete|all)/i)
    })

    it('enables RLS on tinta_policy with public read access', () => {
      expect(sql).toContain('alter table public.tinta_policy enable row level security;')
      expect(sql).toContain('drop policy if exists tinta_policy_read on public.tinta_policy;')
      expect(sql).toMatch(
        /create policy tinta_policy_read on public\.tinta_policy\s+for select using\s*\(true\);/,
      )
      // Verify no write policy is defined on tinta_policy
      expect(sql).not.toMatch(/create policy.*on public\.tinta_policy\s+for (insert|update|delete|all)/i)
    })
  })

  describe('AC1.4: Complete RPC implementations', () => {
    describe('grant_tinta_v1', () => {
      it('has correct signature, security definer, and idempotent insert', () => {
        expect(sql).toContain('create or replace function public.grant_tinta_v1(')
        expect(sql).toMatch(/p_user_id\s+uuid/)
        expect(sql).toMatch(/p_ref\s+text/)
        expect(sql).toMatch(/p_delta\s+integer/)
        expect(sql).toMatch(/p_reason\s+text/)
        expect(sql).toMatch(/p_pending_hours\s+integer\s+default\s+0/)
        expect(sql).toMatch(/returns\s+boolean/)
        expect(sql).toContain('security definer set search_path = public')
        expect(sql).toContain('when unique_violation then')
        expect(sql).toContain('return false;')
        expect(sql).toContain('now() + make_interval(hours => p_pending_hours)')
      })
    })

    describe('tinta_balance_v1', () => {
      it('has correct signature and calculates total, available, and pending balances', () => {
        expect(sql).toContain('create or replace function public.tinta_balance_v1(p_user_id uuid)')
        expect(sql).toMatch(/returns\s+jsonb/)
        expect(sql).toContain('stable security definer set search_path = public')
        expect(sql).toContain("'total'")
        expect(sql).toContain("'available'")
        expect(sql).toContain("'pending'")
        expect(sql).toContain('pending_until is null or pending_until <= now()')
        expect(sql).toContain('pending_until > now()')
        expect(sql).toContain('where user_id = p_user_id')
      })
    })

    describe('spend_tinta_v1', () => {
      it('has advisory lock, available balance check, duplicate check, and negative delta insert', () => {
        expect(sql).toContain('create or replace function public.spend_tinta_v1(')
        expect(sql).toMatch(/p_user_id\s+uuid/)
        expect(sql).toMatch(/p_ref\s+text/)
        expect(sql).toMatch(/p_amount\s+integer/)
        expect(sql).toMatch(/p_reason\s+text/)
        expect(sql).toMatch(/returns\s+text/)
        expect(sql).toContain('security definer set search_path = public')
        expect(sql).toContain('pg_advisory_xact_lock(hashtext(p_user_id::text))')
        expect(sql).toContain("return 'duplicate'")
        expect(sql).toContain("return 'insufficient'")
        expect(sql).toContain("return 'ok'")
        expect(sql).toContain('-p_amount')
      })
    })

    describe('grant_author_tinta_v1', () => {
      it('enforces all gates: policy switch, chapter 1..49, public visibility, owner!=reader, ref dedupe, WIB cap, pending', () => {
        expect(sql).toContain('create or replace function public.grant_author_tinta_v1(')
        expect(sql).toMatch(/p_reader_id\s+uuid/)
        expect(sql).toMatch(/p_story_id\s+text/)
        expect(sql).toMatch(/p_chapter_number\s+integer/)
        expect(sql).toMatch(/returns\s+text/)
        expect(sql).toContain('security definer set search_path = public')

        // 1. Policy check
        expect(sql).toContain('author_rewards_enabled')
        expect(sql).toContain("return 'disabled'")

        // 2. Chapter range 1..49
        expect(sql).toMatch(/p_chapter_number\s*<\s*1\s+or\s+p_chapter_number\s*>\s*49/)
        expect(sql).toContain("return 'ineligible'")

        // 3. Visibility check
        expect(sql).toMatch(/v_visibility\s*<>\s*'public'/)

        // 4. Owner != reader
        expect(sql).toMatch(/v_owner\s+is\s+null\s+or\s+v_owner\s*=\s*p_reader_id/)

        // 5. Unique ref dedupe
        expect(sql).toContain("'author_read:' || p_story_id || ':' || p_chapter_number::text")
        expect(sql).toContain("|| ':' || p_reader_id::text")
        expect(sql).toContain("return 'duplicate'")

        // 6. Advisory lock on author (v_owner)
        expect(sql).toContain('pg_advisory_xact_lock(hashtext(v_owner::text))')

        // 7. Atomic daily cap check on Jakarta calendar day
        expect(sql).toContain("(timezone('Asia/Jakarta', created_at))::date = v_today")
        expect(sql).toMatch(/v_earned\s*\+\s*v_policy\.tinta_per_read\s*>\s*v_policy\.author_daily_cap/)
        expect(sql).toContain("return 'capped'")

        // 8. Pending duration calculation & return ok
        expect(sql).toContain('now() + make_interval(hours => v_policy.pending_hours)')
        expect(sql).toContain("return 'ok'")
      })
    })
  })

  describe('AC1.5: Function revokes and grants', () => {
    it('revokes permissions from public, anon, authenticated and grants to service_role', () => {
      // grant_tinta_v1
      expect(sql).toContain(
        'revoke all on function public.grant_tinta_v1(uuid, text, integer, text, integer) from public, anon, authenticated;',
      )
      expect(sql).toContain(
        'grant execute on function public.grant_tinta_v1(uuid, text, integer, text, integer) to service_role;',
      )

      // tinta_balance_v1 (also to authenticated)
      expect(sql).toContain(
        'revoke all on function public.tinta_balance_v1(uuid) from public, anon, authenticated;',
      )
      expect(sql).toContain(
        'grant execute on function public.tinta_balance_v1(uuid) to authenticated, service_role;',
      )

      // spend_tinta_v1
      expect(sql).toContain(
        'revoke all on function public.spend_tinta_v1(uuid, text, integer, text) from public, anon, authenticated;',
      )
      expect(sql).toContain(
        'grant execute on function public.spend_tinta_v1(uuid, text, integer, text) to service_role;',
      )

      // grant_author_tinta_v1
      expect(sql).toContain(
        'revoke all on function public.grant_author_tinta_v1(uuid, text, integer) from public, anon, authenticated;',
      )
      expect(sql).toContain(
        'grant execute on function public.grant_author_tinta_v1(uuid, text, integer) to service_role;',
      )
    })
  })

  describe('AC1.6 & AC1.7: Scope boundaries and invariants', () => {
    it('does not touch paycore or credit tables', () => {
      // Ensure no DDL or DML modifications targeting existing paycore tables
      expect(sql).not.toMatch(
        /(create|alter|drop)\s+table\s+.*(credit_ledger|credit_products|credit_orders|reading_policy|feature_credit_costs)/i,
      )
      expect(sql).not.toMatch(
        /(insert\s+into|update|delete\s+from)\s+.*(credit_ledger|credit_products|credit_orders|reading_policy|feature_credit_costs)/i,
      )
    })

    it('does not touch mission functions in Task P1 (reserved for Task P5)', () => {
      expect(sql).not.toContain('get_daily_missions_v1')
      expect(sql).not.toContain('claim_mission_v1')
    })
  })
})
