import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Anti-Abuse DB Migration Integrity', () => {
  it('account_commercial_entitlements migration has strict REVOKE / GRANT ACLs and no unsafe default', () => {
    const filePath = path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260804010000_account_commercial_entitlements.sql',
    )
    const sql = fs.readFileSync(filePath, 'utf-8')

    expect(sql).toContain('create table if not exists public.account_commercial_states')
    expect(sql).toContain('add column if not exists commercial_origin text')
    expect(sql).not.toContain("default 'LEGACY_GRANDFATHERED'")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.credit_balance_v1(uuid) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.grant_credits_v1(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.spend_credits_v1(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_starter_story_v1(uuid, text) TO service_role;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.grant_welcome_credit_v1(uuid) TO service_role;')
  })

  it('credit_reservations migration has DB-derived prices, DB ownership checks, server-owned TTL, and strict REVOKE / GRANT ACLs', () => {
    const filePath = path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260804020000_credit_reservations.sql',
    )
    const sql = fs.readFileSync(filePath, 'utf-8')

    expect(sql).toContain('create table if not exists public.credit_reservations')
    expect(sql).toContain('create or replace function public.reserve_chapter_unlock_v1')
    expect(sql).toContain('create or replace function public.reserve_story_start_v1')
    expect(sql).toContain('create or replace function public.capture_credit_reservation_v1')
    expect(sql).toContain('create or replace function public.release_credit_reservation_v1')
    expect(sql).toContain("set status = 'EXPIRED'")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.available_credit_balance_v1(uuid) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reserve_chapter_unlock_v1(uuid, text, integer) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reserve_story_start_v1(uuid, text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.capture_credit_reservation_v1(text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.release_credit_reservation_v1(text) FROM PUBLIC, anon, authenticated;')
  })
})
