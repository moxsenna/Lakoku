/**
 * Harness M6 — provider LLM NYATA via Vercel AI Gateway.
 *
 * Membuktikan: dengan createGatewayProvider, prosa bab ditulis oleh model
 * sungguhan (bukan template deterministik), tetapi TETAP:
 *   - lolos pipeline plan→write→Layer A→Layer B→repair (status PUBLISHED),
 *   - konsisten canon (metadata terstruktur canon-derived),
 *   - dalam rentang 500–800 kata & 2–4 scene,
 *   - bersih dari kebocoran istilah internal (consumer-safe),
 *   - berbeda dari output deterministik (bukti model betul-betul menulis).
 *
 * Butuh AI_GATEWAY_API_KEY. Jalankan:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/m6-llm-smoke.ts
 */

import { buildFixtureSnapshot } from '../fixtures/narrative/fixture-50'
import {
  createDeterministicProvider,
  generateChapter,
  toReaderSafe,
  assertConsumerSafe,
  scanForLeaks,
  type GatewayDeps,
} from '@lakoku/ai-gateway'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import type { ChapterBlueprint } from '@lakoku/narrative-core'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '')
  }
}

function blueprintFor(bps: ChapterBlueprint[], n: number): ChapterBlueprint {
  const bp = bps.find((b) => b.chapterNumber === n)
  if (!bp) throw new Error(`blueprint bab ${n} tak ada`)
  return bp
}

async function main() {
  // Butuh minimal satu sumber model: tunnel kustom, OpenRouter, atau AI Gateway.
  if (
    !process.env.CUSTOM_LLM_BASE_URL &&
    !process.env.OPENROUTER_API_KEY &&
    !process.env.AI_GATEWAY_API_KEY
  ) {
    console.error('Tak ada provider LLM (CUSTOM_LLM_BASE_URL / OPENROUTER_API_KEY / AI_GATEWAY_API_KEY) — lewati smoke test.')
    process.exit(2)
  }

  const snapshot = buildFixtureSnapshot()
  // Biarkan rantai provider (tunnel → OpenRouter → gateway) ditentukan env.
  const provider = createGatewayProvider()
  console.log(`Rantai model: ${provider.name}\n`)

  const llm: GatewayDeps = { provider }
  const det: GatewayDeps = { provider: createDeterministicProvider() }

  for (const n of [6, 12]) {
    console.log(`== Bab ${n} (LLM nyata) ==`)
    const bp = blueprintFor(snapshot.blueprints, n)

    const r = await generateChapter(llm, { snapshot, blueprint: bp, chapterNumber: n })
    check('status PUBLISHED', r.status === 'PUBLISHED', { status: r.status, reason: r.reason, findings: r.findings })
    if (r.status !== 'PUBLISHED' || !r.draft) {
      console.log('  (bab gagal terbit — lihat detail di atas)\n')
      continue
    }
    const d = r.draft
    check('wordCount 500–800', d.wordCount >= 500 && d.wordCount <= 800, d.wordCount)
    check('sceneCount 2–4', d.sceneCount >= 2 && d.sceneCount <= 4, d.sceneCount)
    check('≥3 paragraf', d.paragraphs.length >= 3, d.paragraphs.length)
    check('judul non-kosong', d.title.trim().length > 0, d.title)

    // Consumer-safe: reader payload tak boleh bocor istilah internal.
    const safe = toReaderSafe(d)
    let clean = true
    try {
      assertConsumerSafe(safe)
    } catch {
      clean = false
    }
    check('lolos consumer-safe', clean)
    check('0 kebocoran istilah internal', scanForLeaks([d.title, ...d.paragraphs].join('\n')).length === 0)

    // Bukti model betul menulis: prosa berbeda dari deterministik.
    const rd = await generateChapter(det, { snapshot, blueprint: bp, chapterNumber: n })
    const llmProse = d.paragraphs.join('\n')
    const detProse = rd.draft?.paragraphs.join('\n') ?? ''
    check('prosa LLM ≠ prosa deterministik', llmProse !== detProse)

    // Metadata terstruktur tetap canon-derived (identik dgn deterministik).
    check('events canon-derived (sama dgn deterministik)', JSON.stringify(d.events) === JSON.stringify(rd.draft?.events))
    check('reveals canon-derived (sama dgn deterministik)', JSON.stringify(d.reveals) === JSON.stringify(rd.draft?.reveals))

    console.log(`  → "${d.title}" (${d.wordCount} kata)`)
    console.log(`  → ${d.paragraphs[0].slice(0, 120)}...\n`)
  }

  console.log(`\nHASIL M6: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
