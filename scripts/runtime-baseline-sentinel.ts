import fs from 'node:fs'
import path from 'node:path'
import {
  execLocalPsql,
  verifyLocalRaceTarget,
  type RaceTarget,
} from './authoring-race-session'

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260707000000_core_runtime_baseline.sql',
)

function snapshot(target: RaceTarget): string {
  return execLocalPsql(target, String.raw`
with fingerprints as (
  select 'functions' as kind, md5(string_agg(
    p.oid::regprocedure::text || '|' || pg_get_userbyid(p.proowner) || '|' ||
    coalesce(array_to_string(p.proconfig, ','), '') || '|' || coalesce(array_to_string(p.proacl, ','), '') || '|' ||
    md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text
  )) as hash
  from pg_proc p
  where p.oid in (
    'public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure,
    'public.release_generation_lease(text,uuid)'::regprocedure,
    'public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure,
    'public.story_is_public(text)'::regprocedure,
    'public.story_is_owned_by_auth(text)'::regprocedure
  )
  union all
  select 'relations', md5(string_agg(
    c.oid::regclass::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity::text || '|' ||
    coalesce(array_to_string(c.relacl, ','), ''), E'\n' order by c.oid::regclass::text
  ))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'act_rollups','chapter_blueprints','chapters','character_aliases','character_states',
      'character_voice_sheets','characters','choice_outcomes','facts_ledger','generation_leases',
      'idempotency_keys','knowledge_scopes','outbox','reader_states','retrieval_logs','secrets_reveals',
      'stories','story_events','story_threads','timeline_events'
    )
  union all
  select 'policies', md5(string_agg(
    schemaname || '.' || tablename || '.' || policyname || '|' || permissive || '|' ||
    array_to_string(roles, ',') || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
    E'\n' order by schemaname, tablename, policyname
  ))
  from pg_policies
  where schemaname = 'public'
    and tablename in ('stories','chapters','choice_outcomes','reader_states')
)
select string_agg(kind || '=' || hash, E'\n' order by kind) from fingerprints;
`).trim()
}

function expectDrift(target: RaceTarget, migration: string, mutation: string, label: string): void {
  let rejected = false
  try {
    execLocalPsql(target, `begin;\n${mutation}\n${migration}\nrollback;`, {}, 30_000)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error(`runtime baseline sentinel: ${label} drift was accepted`)
}

function main(): void {
  const target = verifyLocalRaceTarget('runtime baseline sentinel')
  const migration = fs.readFileSync(migrationPath, 'utf8')
  const before = snapshot(target)
  execLocalPsql(target, migration, {}, 30_000)
  const after = snapshot(target)
  if (after !== before) throw new Error('runtime baseline sentinel: validation-only path mutated catalog')

  expectDrift(
    target,
    migration,
    "alter table public.generation_leases alter column status set default 'RELEASED';",
    'column default',
  )
  expectDrift(
    target,
    migration,
    'revoke execute on function public.acquire_generation_lease(text,integer,text,integer,text) from service_role;',
    'function ACL',
  )
  expectDrift(
    target,
    migration,
    'drop function public.story_is_public(text) cascade;',
    'pre-history policy helper',
  )
  expectDrift(
    target,
    migration,
    'alter table public.generation_leases add constraint generation_leases_unexpected_check check (chapter_number > 0);',
    'unexpected constraint',
  )

  console.log('Runtime baseline sentinel: PASS')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'runtime baseline sentinel failed')
  process.exitCode = 1
}
