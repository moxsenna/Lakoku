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
