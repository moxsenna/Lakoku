/**
 * Audit READ-ONLY: apakah smoke A/B sempat menulis telemetry sintetis ke DB?
 *
 * Latar: `executeObservedModelCall()` selalu menjalankan recorder, sukses
 * maupun gagal. Recorder default `recordGenerationProviderCall` membuat
 * `createAdminClient()` dan memanggil RPC `record_generation_provider_call_v2`
 * yang langsung `insert into public.generation_provider_calls`. Jadi real-model
 * smoke yang berjalan dengan env production ikut menulis baris telemetry,
 * meskipun tidak menyentuh story/chapter sama sekali.
 *
 * Skrip ini HANYA SELECT. Tidak ada DELETE/UPDATE dalam bentuk apa pun —
 * baris yang ditemukan adalah bukti audit dan sengaja dibiarkan.
 *
 * Jalankan:
 *   set -a && source .env.local && set +a
 *   pnpm exec node scripts/run-smoke.cjs scripts/continuity-smoke-telemetry-audit.ts
 */

import { createAdminClient } from '@lakoku/db'

const SMOKE_USER_ID = '00000000-0000-4000-8000-00000000ab01'
const SMOKE_STORY_IDS = ['story-ab-test-a', 'story-ab-test-b']
const SMOKE_WORKFLOW_PHASE = 'CONTINUITY_AB_SMOKE'

/** Identitas DB yang diaudit, ditegaskan sebelum query apa pun. */
function attestTarget(): { url: string; isProduction: boolean } {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    console.error('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL tidak diset. Audit butuh target eksplisit.')
    process.exit(1)
  }
  const nonProduction = /(^|[.\-/])(local|localhost|127\.0\.0\.1|staging|stg|dev)([.\-/:]|$)/i
  const isProduction = !nonProduction.test(url) && (url.includes('supabase.co') || url.includes('prod'))
  return { url, isProduction }
}

function redactUrl(url: string): string {
  return url.replace(/(https:\/\/[a-z0-9]{6})[a-z0-9]*/i, '$1***')
}

async function main(): Promise<void> {
  const target = attestTarget()

  console.log('=== AUDIT TELEMETRY SMOKE (READ-ONLY) ===')
  console.log(`target        : ${redactUrl(target.url)}`)
  console.log(`identitas     : ${target.isProduction ? 'PRODUCTION' : 'non-production (local/staging)'}`)
  console.log(`workflow_phase: ${SMOKE_WORKFLOW_PHASE}`)
  console.log(`user_id       : ${SMOKE_USER_ID}`)
  console.log(`story_id      : ${SMOKE_STORY_IDS.join(', ')}`)
  console.log('mutasi        : TIDAK ADA. Skrip ini hanya SELECT.')
  console.log('')

  const db = createAdminClient()

  const { data, error } = await db
    .from('generation_provider_calls')
    .select(
      'provider_call_id, user_id, story_id, chapter_number, workflow_phase, provider_id, model_id, outcome, started_at, created_at',
    )
    .eq('workflow_phase', SMOKE_WORKFLOW_PHASE)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`Query gagal: ${error.message}`)
    process.exit(1)
  }

  const rows = data ?? []

  if (rows.length === 0) {
    console.log('HASIL: 0 baris. Tidak ada telemetry sintetis smoke di target ini.')
    return
  }

  console.log(`HASIL: ${rows.length} baris ditemukan.`)
  console.log('')
  for (const row of rows) {
    const flagged =
      row.user_id === SMOKE_USER_ID && SMOKE_STORY_IDS.includes(String(row.story_id))
    console.log(
      `${flagged ? '[SMOKE]' : '[LAIN] '} ${row.created_at} story=${row.story_id} bab=${row.chapter_number} ` +
        `provider=${row.provider_id} model=${row.model_id} outcome=${row.outcome} id=${row.provider_call_id}`,
    )
  }
  console.log('')

  const smokeRows = rows.filter(
    (r) => r.user_id === SMOKE_USER_ID && SMOKE_STORY_IDS.includes(String(r.story_id)),
  )
  console.log(`Cocok penuh dengan identitas smoke: ${smokeRows.length}`)
  if (target.isProduction && smokeRows.length > 0) {
    console.log('')
    console.log('CATATAN: baris ini ada di PRODUCTION dan SENGAJA TIDAK DIHAPUS.')
    console.log('Ia observability murni, tidak menyentuh story/chapter/reader state.')
    console.log('Biarkan sebagai bukti audit.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
