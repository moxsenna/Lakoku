import fs from 'node:fs'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
import {
  buildProductionChapterWriterPrompt,
  parseChapterWriterProse,
} from '@/lib/ai-gateway/chapter-writer-contract'
import { evaluateWriterCompleteness } from '@/lib/ai-gateway/writer-completeness'
import { countParagraphWords } from '@/lib/prose/clamp-chapter-prose'
import {
  NADIA_RAKA_BLUEPRINT,
  NADIA_RAKA_BRIEF_A,
  NADIA_RAKA_CONTINUATION_A,
  nadiaRakaSnapshot,
} from '../fixtures/narrative/nadia-raka-continuity'

interface ModelComparisonResult {
  modelId: string
  actualModelUsed?: string
  status: 'SUCCESS' | 'ERROR'
  latencySec: number
  wordCount: number
  paragraphCount: number
  title: string
  firstParagraph: string
  lastParagraph: string
  dialogueCount: number
  findings: string[]
  error?: string
  rawText?: string
}

async function runModel(
  nine: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ModelComparisonResult> {
  const start = Date.now()
  let text = ''
  let finishReason: string | undefined

  try {
    const result = streamText({
      model: nine(modelId),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 4096,
    })

    for await (const chunk of result.textStream) {
      text += chunk
    }
    const finish = await result.finishReason
    finishReason = finish

    const latencySec = Number(((Date.now() - start) / 1000).toFixed(2))

    if (!text.trim()) {
      return {
        modelId,
        status: 'ERROR',
        latencySec,
        wordCount: 0,
        paragraphCount: 0,
        title: '-',
        firstParagraph: '',
        lastParagraph: '',
        dialogueCount: 0,
        findings: ['EMPTY_RESPONSE'],
        error: 'Model returned empty text',
      }
    }

    const parsed = parseChapterWriterProse(text)
    const completeness = evaluateWriterCompleteness({
      title: parsed.title,
      paragraphs: parsed.paragraphs,
      hasExplicitTitle: parsed.hasExplicitTitle,
      finishReason,
    })

    const wordCount = countParagraphWords(parsed.paragraphs)
    const dialogueCount = parsed.paragraphs.filter((p) => p.includes('"') || p.includes('“')).length

    return {
      modelId,
      status: 'SUCCESS',
      latencySec,
      wordCount,
      paragraphCount: parsed.paragraphs.length,
      title: parsed.title,
      firstParagraph: parsed.paragraphs[0] || '',
      lastParagraph: parsed.paragraphs[parsed.paragraphs.length - 1] || '',
      dialogueCount,
      findings: completeness.map((f) => f.code),
      rawText: text,
    }
  } catch (err: unknown) {
    const latencySec = Number(((Date.now() - start) / 1000).toFixed(2))
    const msg = err instanceof Error ? err.message : String(err)
    return {
      modelId,
      status: 'ERROR',
      latencySec,
      wordCount: 0,
      paragraphCount: 0,
      title: '-',
      firstParagraph: '',
      lastParagraph: '',
      dialogueCount: 0,
      findings: ['EXECUTION_ERROR'],
      error: msg,
    }
  }
}

async function main() {
  console.log('=== BENCHMARK PERBANDINGAN PROSA MODEL 9ROUTER LAKOKU ===\n')

  // 1. Load env
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
      if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  }

  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (!baseUrl || !apiKey) {
    console.error('FATAL: NINEROUTER credentials missing in .env.local')
    process.exit(1)
  }

  const nine = createOpenAICompatible({
    name: '9router',
    baseURL: baseUrl,
    apiKey: apiKey,
  })

  // 2. Build production prompt (Nadia-Raka Bab 2)
  const promptData = buildProductionChapterWriterPrompt({
    snapshot: nadiaRakaSnapshot(),
    plan: {},
    continuation: NADIA_RAKA_CONTINUATION_A,
    brief: NADIA_RAKA_BRIEF_A,
    authorityMode: 'CHAPTER_BRIEF_V2',
  })

  console.log('Prompt Bab 2 siap:')
  console.log(`- Target bab: Nadia & Raka (Bab 2)`)
  console.log(`- System prompt: ${promptData.system.length} karakter`)
  console.log(`- User prompt: ${promptData.prompt.length} karakter`)
  console.log(`- Standard target: 800 - 1000 kata, 3 adegan, dialog hidup, cliffhanger emosional\n`)

  const targets = [
    { label: 'cx/gpt-5.6-luna (permintaan user)', id: 'cx/gpt-5.6-luna', fallbackId: 'openai/gpt-5.6-luna' },
    { label: 'ag/gemini-3.8-flash-high (permintaan user)', id: 'ag/gemini-3.8-flash-high', fallbackId: 'gweb/gemini-3.8-flash-high' },
    { label: 'oc/muse-spark-1.3-contributor-free (permintaan user)', id: 'oc/muse-spark-1.3-contributor-free' },
  ]

  const results: ModelComparisonResult[] = []

  for (const t of targets) {
    console.log(`------------------------------------------------------------`)
    console.log(`Menjalankan uji model: ${t.label}...`)
    let res = await runModel(nine, t.id, promptData.system, promptData.prompt)

    if (res.status === 'ERROR' && t.fallbackId) {
      console.log(`[!] Panggilan awal ${t.id} gagal: ${res.error?.slice(0, 120)}`)
      console.log(`[+] Menguji alias aktif identik di 9router: ${t.fallbackId}...`)
      const fallbackRes = await runModel(nine, t.fallbackId, promptData.system, promptData.prompt)
      fallbackRes.actualModelUsed = `${t.id} -> ${t.fallbackId}`
      results.push(res)
      results.push(fallbackRes)
    } else {
      results.push(res)
    }
  }

  console.log('\n============================================================')
  console.log('RINGKASAN HASIL BENCHMARK PROSA')
  console.log('============================================================\n')

  for (const r of results) {
    console.log(`Model: ${r.actualModelUsed || r.modelId}`)
    console.log(`Status: ${r.status}`)
    console.log(`Latensi: ${r.latencySec} detik`)
    if (r.status === 'SUCCESS') {
      console.log(`Judul: "${r.title}"`)
      console.log(`Jumlah Kata: ${r.wordCount} kata (Target Lakoku: 800-1000)`)
      console.log(`Jumlah Paragraf: ${r.paragraphCount}`)
      console.log(`Paragraf dengan Dialog: ${r.dialogueCount}`)
      console.log(`Temuan Completeness: ${r.findings.length === 0 ? 'BERSIH (PASS)' : r.findings.join(', ')}`)
      console.log('\n--- Paragraf Pembuka ---')
      console.log(r.firstParagraph)
      console.log('\n--- Paragraf Penutup ---')
      console.log(r.lastParagraph)
    } else {
      console.log(`Error: ${r.error}`)
    }
    console.log('\n------------------------------------------------------------\n')
  }

  // Simpan output lengkap untuk audit mendalam
  const outDir = path.resolve(process.cwd(), 'fixtures/benchmarks')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `model-prose-comparison-${Date.now()}.json`)
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`Laporan mentah disimpan di: ${outPath}`)
}

main().catch((err) => {
  console.error('Fatal error running benchmark:', err)
  process.exit(1)
})
