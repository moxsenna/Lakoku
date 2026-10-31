/**
 * Smoke: analytics infrastructure (static check).
 *
 * Cek migration, schema strictness, dan client/API pattern.
 */
import * as fs from 'fs'
import * as path from 'path'
import { AnalyticsEventSchema, ANALYTICS_EVENT_NAMES } from '../lib/analytics/events'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log('  PASS ', name) }
  else { fail++; console.error('  FAIL ', name, detail ?? '') }
}

console.log('analytics:')

// ── Migration ──────────────────────────────────────────────────────

const migrationPath = path.resolve(
  __dirname, '..', 'db', 'migrations', '20260711000001_analytics_events.sql',
)
check('Migration file exists', fs.existsSync(migrationPath))

if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf-8')
  check('CREATE TABLE analytics_events', sql.includes('create table if not exists public.analytics_events'))
  check('user_id uuid FK nullable', sql.includes('user_id') && sql.includes('references auth.users') && sql.includes('null'))
  check('anonymous_id text', sql.includes('anonymous_id'))
  check('event_name text not null', sql.includes('event_name'))
  check('payload jsonb column', sql.includes('payload') && sql.includes('jsonb'))
  check('created_at timestamptz', sql.includes('created_at'))
  check('pgcrypto extension', sql.includes('pgcrypto'))
  check('index event_name', sql.includes('analytics_events_event_name_idx'))
  check('index created_at', sql.includes('analytics_events_created_at_idx'))
  check('index user_id', sql.includes('analytics_events_user_id_idx'))
  check('index anonymous_id', sql.includes('analytics_events_anonymous_id_idx'))
  check('RLS enabled', sql.includes('enable row level security'))
  check('no public policy text', !sql.includes('create policy'))
}

// ── Schema strictness ──────────────────────────────────────────────

check('All event names non-empty', ANALYTICS_EVENT_NAMES.length >= 11)
check('Taste onboarding events present', ANALYTICS_EVENT_NAMES.includes('taste_onboarding_viewed'))
check('Taste save events present', ANALYTICS_EVENT_NAMES.includes('taste_profile_saved'))
check('Event name accept valid', AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_entry_viewed',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Event name reject invalid', !AnalyticsEventSchema.safeParse({
  event_name: 'invalid_event_name',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema strict: reject customIdea', !AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_entry_viewed',
  customIdea: 'rahasia keluarga terbongkar',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema strict: reject answers', !AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_mode_selected',
  answers: { trope: 'drama' },
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema strict: reject synopsis', !AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_premise_selected',
  synopsis: 'cerita tentang...',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema: reject invalid story_setup_mode', !AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_mode_selected',
  story_setup_mode: 'invalid_mode',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema: reject invalid stage', !AnalyticsEventSchema.safeParse({
  event_name: 'story_setup_failed',
  stage: 'random_stage',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema: accept share_slug', AnalyticsEventSchema.safeParse({
  event_name: 'share_link_opened',
  share_slug: 'kamar-304',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema: reject free-text share_slug', !AnalyticsEventSchema.safeParse({
  event_name: 'share_link_opened',
  share_slug: 'Slug Bebas!!',
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

check('Schema: reject overlong share_slug', !AnalyticsEventSchema.safeParse({
  event_name: 'share_link_opened',
  share_slug: 'a'.repeat(33),
  anonymous_id: null,
  created_at: new Date().toISOString(),
}).success)

// ── Migration user_acquisition (OQ1=A) ─────────────────────────────

const acquisitionMigrationPath = path.resolve(
  __dirname, '..', 'db', 'migrations', '20261101090000_user_acquisition.sql',
)
check('Migration user_acquisition exists', fs.existsSync(acquisitionMigrationPath))

if (fs.existsSync(acquisitionMigrationPath)) {
  const acqSql = fs.readFileSync(acquisitionMigrationPath, 'utf-8')
  check('user_acquisition: create table', acqSql.includes('create table if not exists public.user_acquisition'))
  check('user_acquisition: source check constraint', acqSql.includes('check (source in'))
  check('user_acquisition: unique user_id FK', acqSql.includes('unique references auth.users'))
  check('user_acquisition: pgcrypto', acqSql.includes('pgcrypto'))
  check('user_acquisition: RLS enabled', acqSql.includes('enable row level security'))
  check('user_acquisition: no public policy', !acqSql.includes('create policy'))
}

// ── Client exports ─────────────────────────────────────────────────

const clientPath = path.resolve(__dirname, '..', 'lib', 'analytics', 'client.ts')
check('Client file exists', fs.existsSync(clientPath))

if (fs.existsSync(clientPath)) {
  const src = fs.readFileSync(clientPath, 'utf-8')
  check('Client exports trackEvent', src.includes('export function trackEvent'))
  check('Client uses void fetch', src.includes('void fetch'))
  check('Client uses .catch', src.includes('.catch('))
  check('Client uses keepalive: true', src.includes('keepalive: true'))
  check('Client uses localStorage key', src.includes('lakoku:anonymous-id:v1'))
}

// ── API route ─────────────────────────────────────────────────────

const routePath = path.resolve(__dirname, '..', 'app', 'api', 'analytics', 'track', 'route.ts')
check('API route exists', fs.existsSync(routePath))

if (fs.existsSync(routePath)) {
  const src = fs.readFileSync(routePath, 'utf-8')
  check('API route uses getDb', src.includes('getDb'))
  check('API route overwrites is_logged_in', src.includes('is_logged_in: Boolean('))
  check('API route size guard', src.includes('content-length') && src.includes('413'))
  check('API route force-dynamic', src.includes("force-dynamic"))
}

console.log(`analytics-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
