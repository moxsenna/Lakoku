/**
 * Continuity A/B smoke — dua cabang pilihan, satu ending Bab 1 yang sama.
 *
 * MODE (LAKOKU_CONTINUITY_SMOKE_MODE):
 *
 *   provider-only (default)
 *     NOL DB IO. Snapshot/continuation/brief dibangun in-memory dari fixture
 *     Nadia/Raka. Tidak butuh Supabase sama sekali, jadi TIDAK ada guard
 *     produksi di sini — tidak ada yang bisa ditulis ke DB mana pun.
 *     Inilah gate wajib sebelum merge.
 *
 *   db-e2e (BELUM DIIMPLEMENTASI)
 *     Rencana: seed template → clone ke dua story instance → publish Bab 1 →
 *     catat pilihan → generate Bab 2 lewat jalur runtime penuh. Butuh DB
 *     local/staging terisolasi. Sengaja exit 1 daripada memalsukan seeding.
 *
 * PROVIDER (NARRATIVE_PROVIDER):
 *   gateway → LLM nyata (butuh kredensial provider di env)
 *   selain itu → deterministic (harness-only, gratis, tanpa network)
 *
 * Gate programatik di sini PERLU tapi TIDAK CUKUP. Keputusan rilis butuh
 * pembacaan manusia atas prosa penuh terhadap rubrik semantik 5 poin yang
 * dicetak di akhir run.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runContinuityChecks } from '@lakoku/narrative-core'
import { generateChapter, createDeterministicProvider } from '@lakoku/ai-gateway'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import { createSynchronousProviderContext } from '@lakoku/runtime'
import type { ContinuationContext, Finding } from '@lakoku/narrative-core'
import type { PreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'
import {
  NADIA_RAKA_BLUEPRINT,
  NADIA_RAKA_BRIEF_A,
  NADIA_RAKA_BRIEF_B,
  NADIA_RAKA_CHAPTER_1_ENDING,
  NADIA_RAKA_CONTINUATION_A,
  NADIA_RAKA_CONTINUATION_B,
  nadiaRakaSnapshot,
} from '../fixtures/narrative/nadia-raka-continuity'

const SMOKE_USER_ID = '00000000-0000-4000-8000-00000000ab01'
const EXCERPT_PARAGRAPHS = 10

type SmokeMode = 'provider-only' | 'db-e2e'

function resolveMode(): SmokeMode {
  const raw = process.env.LAKOKU_CONTINUITY_SMOKE_MODE?.trim() || 'provider-only'
  if (raw === 'provider-only' || raw === 'db-e2e') return raw
  console.error(`LAKOKU_CONTINUITY_SMOKE_MODE tidak dikenal: ${raw} (provider-only|db-e2e)`)
  process.exit(1)
}

function isProductionSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false
  const staging = /(^|[.\-/])(local|localhost|127\.0\.0\.1|staging|stg|dev)([.\-/:]|$)/i
  if (staging.test(url)) return false
  return url.includes('supabase.co') || url.includes('prod')
}

function printBranch(
  label: string,
  route: string,
  status: string,
  paragraphs: string[],
  findings: Finding[],
): void {
  console.log(`\n${'='.repeat(72)}`)
  console.log(`CABANG ${label} — ${route}`)
  console.log('='.repeat(72))
  console.log(`status         : ${status}`)
  console.log(`paragraf       : ${paragraphs.length}`)
  console.log(`kata           : ${paragraphs.join(' ').split(/\s+/).filter(Boolean).length}`)
  console.log(`findings       : ${findings.length === 0 ? '(kosong)' : ''}`)
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.code} — ${f.message}`)
  }
  console.log(`\n--- ${EXCERPT_PARAGRAPHS} PARAGRAF AWAL (verbatim, untuk dibaca manusia) ---`)
  paragraphs.slice(0, EXCERPT_PARAGRAPHS).forEach((p, i) => {
    console.log(`\n[${i + 1}] ${p}`)
  })
  if (paragraphs.length > EXCERPT_PARAGRAPHS) {
    console.log(`\n… (${paragraphs.length - EXCERPT_PARAGRAPHS} paragraf berikutnya tidak dicetak)`)
  }
}

async function runProviderOnly(): Promise<void> {
  const snapshot = nadiaRakaSnapshot()
  const useGateway = process.env.NARRATIVE_PROVIDER === 'gateway'
  const provider = useGateway ? createGatewayProvider() : createDeterministicProvider()

  console.log('=== CONTINUITY A/B SMOKE (mode: provider-only, tanpa DB IO) ===')
  console.log(`provider kind  : ${useGateway ? 'gateway (LLM NYATA)' : 'deterministic (harness-only)'}`)
  console.log(`provider chain : ${provider.name}`)
  console.log(`NARRATIVE_MODEL: ${process.env.NARRATIVE_MODEL ?? '(unset)'}`)
  console.log(`fixture        : Nadia/Raka — ending Bab 1 ${NADIA_RAKA_CHAPTER_1_ENDING.length} paragraf`)

  if (!useGateway) {
    console.log(
      '\nCATATAN: ini dry-run deterministik. Bukti real-model butuh NARRATIVE_PROVIDER=gateway.',
    )
  }

  const branches: Array<{
    label: string
    storyId: string
    continuation: ContinuationContext
    brief: PreProseChapterBrief
  }> = [
    { label: 'A', storyId: 'story-ab-test-a', continuation: NADIA_RAKA_CONTINUATION_A, brief: NADIA_RAKA_BRIEF_A },
    { label: 'B', storyId: 'story-ab-test-b', continuation: NADIA_RAKA_CONTINUATION_B, brief: NADIA_RAKA_BRIEF_B },
  ]

  const results: Array<{ label: string; pass: boolean }> = []
  // Prosa PENUH ditulis ke artefak: rubrik #3 (konflik diteruskan, bukan
  // disebut sekali) tidak bisa dinilai dari excerpt saja.
  const runDir = path.join(process.cwd(), '.zcode/artifacts/continuity-ab', `run-${Date.now()}`)
  mkdirSync(runDir, { recursive: true })

  for (const branch of branches) {
    // Telemetry context wajib: gateway-provider menolak panggilan tanpa ini.
    const telemetryContext = createSynchronousProviderContext({
      userId: SMOKE_USER_ID,
      storyId: branch.storyId,
      chapterNumber: 2,
      generationKind: 'personalized',
      correlationId: randomUUID(),
    })

    const result = await generateChapter(
      { provider },
      {
        snapshot,
        blueprint: NADIA_RAKA_BLUEPRINT,
        chapterNumber: 2,
        continuation: branch.continuation,
        brief: branch.brief,
        executionOptions: {
          telemetryContext,
          workflowPhase: 'CONTINUITY_AB_SMOKE',
        },
      },
    )

    if (!result.draft) {
      console.error(`\nCABANG ${branch.label}: generasi gagal (status ${result.status}).`)
      console.error(JSON.stringify(result.findings, null, 2))
      process.exit(1)
    }

    const paragraphs = result.draft.paragraphs
    const findings = runContinuityChecks(
      snapshot,
      { chapterNumber: 2, paragraphs },
      branch.continuation,
    )
    printBranch(
      branch.label,
      branch.continuation.previousChoice?.label ?? '(tanpa pilihan)',
      result.status,
      paragraphs,
      findings,
    )

    const artifact = path.join(runDir, `cabang-${branch.label}.md`)
    writeFileSync(
      artifact,
      [
        `# Cabang ${branch.label}`,
        ``,
        `- provider chain: ${provider.name}`,
        `- pilihan Bab 1: ${branch.continuation.previousChoice?.label ?? '-'}`,
        `- konsekuensi: ${(branch.continuation.previousChoice?.consequence ?? []).join(' | ')}`,
        `- status: ${result.status}`,
        `- judul: ${result.draft.title}`,
        ``,
        `## Ending Bab 1 (jangkar)`,
        ``,
        ...(branch.continuation.previousChapter?.endingParagraphs ?? []).map((p) => `> ${p}`),
        ``,
        `## Prosa Bab 2 (PENUH)`,
        ``,
        ...paragraphs,
        ``,
        `## Findings`,
        ``,
        ...(findings.length === 0
          ? ['(kosong)']
          : findings.map((f) => `- [${f.severity}] ${f.code} — ${f.message}`)),
        ``,
      ].join('\n'),
      'utf8',
    )
    console.log(`\nprosa penuh   : ${artifact}`)

    const blocking = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
    results.push({ label: branch.label, pass: blocking.length === 0 })
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log('GATE PROGRAMATIK (perlu, TIDAK cukup)')
  console.log('='.repeat(72))
  for (const r of results) {
    console.log(`  cabang ${r.label}: ${r.pass ? 'PASS' : 'FAIL'} (bebas CRITICAL/MAJOR)`)
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log('GATE SEMANTIK — WAJIB dinilai manusia dari prosa di atas')
  console.log('='.repeat(72))
  console.log('Skrip ini TIDAK memutuskan PASS semantik. Nilai kelima poin per cabang:')
  console.log('  1. Pembukaan lahir dari ending Bab 1 (bukan adegan baru tanpa jembatan)?')
  console.log('  2. Tindakan pilihan menjadi PENYEBAB peristiwa Bab 2 (bukan sekadar disinggung)?')
  console.log('  3. Konflik lama DITERUSKAN, bukan hanya disebut sekali lalu ditinggal?')
  console.log('  4. Perpindahan waktu/lokasi dijembatani secara eksplisit?')
  console.log('  5. Cabang A vs B berbeda SECARA KAUSAL, bukan hanya beda kata?')
  console.log('Tanpa kelimanya PASS di kedua cabang: tidak merge, tidak deploy, tidak canary.')

  if (!results.every((r) => r.pass)) process.exit(1)
}

function runDbE2E(): never {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isProductionSupabaseUrl(supabaseUrl)) {
    console.error('REFUSING_PRODUCTION_SEED: db-e2e hanya boleh di DB local/staging terisolasi!')
    process.exit(1)
  }
  const envTarget = process.env.LAKOKU_CONTINUITY_SMOKE_DB
  if (envTarget !== 'local' && envTarget !== 'staging') {
    console.error('db-e2e butuh LAKOKU_CONTINUITY_SMOKE_DB=local|staging')
    process.exit(1)
  }
  console.error(
    'db-e2e BELUM DIIMPLEMENTASI. Jalur seed/clone/publish nyata belum ada;\n' +
      'skrip menolak berpura-pura melakukan seeding. Gunakan mode provider-only\n' +
      'untuk bukti real-model, dan lacak db-e2e sebagai follow-up terpisah.',
  )
  process.exit(1)
}

async function main(): Promise<void> {
  const mode = resolveMode()
  if (mode === 'db-e2e') runDbE2E()
  await runProviderOnly()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
