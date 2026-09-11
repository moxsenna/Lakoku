// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createAdminClient } from '../../lib/supabase/admin'
import {
  cleanupAndVerifyFaultHarnessStories,
  FAULT_STORY_IDS,
} from '../../lib/narrative-qa/fault/scenarios'
import { HARNESS_USER_EMAIL, HARNESS_USER_ID } from '../../lib/narrative-qa/harness/seed'
import {
  assertM10E2DisposableCleanDatabase,
} from '../../lib/narrative-qa/fault/e2/local-db'
import { bootstrapM10E2DisposableEnv } from '../../scripts/m10-e-reliability'

const CONTAINER = 'supabase_db_lakoku-m10-e2-task3'
const HARNESS_PROVIDER_CALL_ID = 'm10-e1-cleanup-auth-regression'
const SENTINEL_PROVIDER_CALL_ID = 'm10-e1-cleanup-unrelated-sentinel'
const SENTINEL_STORY_ID = 'm10-e1-unrelated-sentinel'
const SENTINEL_USER_ID = '99999999-9999-4999-9999-99999999c001'
const HARNESS_GRANT_REF = `m10c:harness-grant:${HARNESS_USER_ID}`
const SAME_USER_SENTINEL_REF = `m10-e1:unrelated-credit:${HARNESS_USER_ID}`
const UNRELATED_USER_SENTINEL_REF = `m10-e1:unrelated-credit:${SENTINEL_USER_ID}`

function runGovernedSql(input: string): string {
  return execFileSync('docker', [
    'exec', '-i', '-e', 'PGPASSWORD=postgres', CONTAINER,
    'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
  ], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function providerCallRow(providerCallId: string, storyId: string) {
  return {
    provider_call_id: providerCallId,
    user_id: HARNESS_USER_ID,
    story_id: storyId,
    chapter_number: 1,
    generation_kind: 'personalized',
    correlation_id: providerCallId === HARNESS_PROVIDER_CALL_ID
      ? 'e1010000-0000-4000-8000-000000000001'
      : 'e1010000-0000-4000-8000-000000000002',
    use_case: 'm10-e1-cleanup-regression',
    workflow_phase: 'generation',
    provider_id: 'deterministic',
    model_id: 'm10-e1-fixture',
    fallback_index: 0,
    actual_model_resolved: true,
    started_at: '2026-08-13T00:00:00.000Z',
    ended_at: '2026-08-13T00:00:00.001Z',
    elapsed_ms: 1,
    outcome: 'SUCCEEDED',
    cost_source: 'unavailable',
  }
}

function exactProviderCallGrants(): string[] {
  return runGovernedSql(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name='generation_provider_calls'
      and grantee='service_role'
    order by privilege_type;
  `).trim().split(/\r?\n/).filter(Boolean)
}

function elevatedFixtureCleanup(): void {
  runGovernedSql(`
    begin;
    select pg_catalog.set_config('lakoku.generation_provider_retention_delete', 'v1', true);
    delete from public.generation_provider_calls
    where provider_call_id in ('${HARNESS_PROVIDER_CALL_ID}', '${SENTINEL_PROVIDER_CALL_ID}');
    delete from public.credit_ledger
    where ref in ('${HARNESS_GRANT_REF}', '${SAME_USER_SENTINEL_REF}', '${UNRELATED_USER_SENTINEL_REF}');
    delete from auth.users where id in ('${HARNESS_USER_ID}'::uuid, '${SENTINEL_USER_ID}'::uuid);
    commit;
  `)
}

describe.skipIf(process.env.LAKOKU_LOCAL_DB_TEST !== '1')(
  'M10-E1 governed disposable cleanup auth regression',
  () => {
    beforeAll(() => {
      bootstrapM10E2DisposableEnv()
      assertM10E2DisposableCleanDatabase()
      elevatedFixtureCleanup()
    }, 120_000)

    test('keeps append-only grants while removing exact harness rows, user, and credit residue only', async () => {
      const admin = createAdminClient()
      const grantsBefore = exactProviderCallGrants()
      expect(grantsBefore).toEqual(['INSERT', 'SELECT'])

      try {
        const created = await admin.auth.admin.createUser({
          id: HARNESS_USER_ID,
          email: HARNESS_USER_EMAIL,
          password: `m10c-${HARNESS_USER_ID}`,
          email_confirm: true,
        })
        expect(created.error).toBeNull()

        const sentinelUser = await admin.auth.admin.createUser({
          id: SENTINEL_USER_ID,
          email: 'm10-e1-unrelated-sentinel@example.test',
          password: `m10c-${SENTINEL_USER_ID}`,
          email_confirm: true,
        })
        expect(sentinelUser.error).toBeNull()

        const { error: creditError } = await admin.from('credit_ledger').insert([
          {
            user_id: HARNESS_USER_ID,
            delta: 5000,
            reason: 'm10c-harness-grant',
            ref: HARNESS_GRANT_REF,
          },
          {
            user_id: HARNESS_USER_ID,
            delta: 7,
            reason: 'unrelated-same-user-sentinel',
            ref: SAME_USER_SENTINEL_REF,
          },
          {
            user_id: SENTINEL_USER_ID,
            delta: 11,
            reason: 'unrelated-user-sentinel',
            ref: UNRELATED_USER_SENTINEL_REF,
          },
        ])
        expect(creditError).toBeNull()

        const { error: insertError } = await admin.from('generation_provider_calls').insert([
          providerCallRow(HARNESS_PROVIDER_CALL_ID, FAULT_STORY_IDS[0]),
          providerCallRow(SENTINEL_PROVIDER_CALL_ID, SENTINEL_STORY_ID),
        ])
        expect(insertError).toBeNull()

        const directDelete = await admin
          .from('generation_provider_calls')
          .delete()
          .eq('provider_call_id', HARNESS_PROVIDER_CALL_ID)
        expect(directDelete.error).not.toBeNull()

        await expect(cleanupAndVerifyFaultHarnessStories(admin)).rejects.toThrow(
          /M10_E1_UNEXPECTED_SAME_USER_CREDIT_REFS/,
        )
        expect(runGovernedSql(`
          select json_build_object(
            'auth_users',(select count(*) from auth.users where id='${HARNESS_USER_ID}'::uuid),
            'harness_provider_calls',(select count(*) from public.generation_provider_calls where provider_call_id='${HARNESS_PROVIDER_CALL_ID}'),
            'harness_grants',(select count(*) from public.credit_ledger where ref='${HARNESS_GRANT_REF}'),
            'same_user_sentinels',(select count(*) from public.credit_ledger where ref='${SAME_USER_SENTINEL_REF}'),
            'unrelated_user_sentinels',(select count(*) from public.credit_ledger where ref='${UNRELATED_USER_SENTINEL_REF}')
          );
        `).trim()).toBe('{"auth_users" : 1, "harness_provider_calls" : 1, "harness_grants" : 1, "same_user_sentinels" : 1, "unrelated_user_sentinels" : 1}')

        runGovernedSql(`delete from public.credit_ledger where ref='${SAME_USER_SENTINEL_REF}';`)
        const proof = await cleanupAndVerifyFaultHarnessStories(admin)
        expect(proof.completed).toBe(true)

        expect(exactProviderCallGrants()).toEqual(grantsBefore)
        expect(runGovernedSql(`
          select json_build_object(
            'harness_provider_calls', count(*) filter(where story_id=any(array[${FAULT_STORY_IDS.map((id) => `'${id}'`).join(',')}])) ,
            'sentinel_provider_calls', count(*) filter(where provider_call_id='${SENTINEL_PROVIDER_CALL_ID}')
          ) from public.generation_provider_calls;
        `).trim()).toBe('{"harness_provider_calls" : 0, "sentinel_provider_calls" : 1}')
        expect(runGovernedSql(`
          select json_build_object(
            'auth_users',(select count(*) from auth.users where id='${HARNESS_USER_ID}'::uuid),
            'harness_grants',(select count(*) from public.credit_ledger where ref='${HARNESS_GRANT_REF}'),
            'unrelated_user_auth',(select count(*) from auth.users where id='${SENTINEL_USER_ID}'::uuid),
            'unrelated_user_sentinels',(select count(*) from public.credit_ledger where ref='${UNRELATED_USER_SENTINEL_REF}')
          );
        `).trim()).toBe('{"auth_users" : 0, "harness_grants" : 0, "unrelated_user_auth" : 1, "unrelated_user_sentinels" : 1}')
      } finally {
        elevatedFixtureCleanup()
        assertM10E2DisposableCleanDatabase()
      }
    }, 120_000)
  },
)
