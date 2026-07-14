import 'server-only'
import { streamText, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { CanonSnapshot, Finding } from '@lakoku/narrative-core'
import {
  createDeterministicProvider,
  type GenerationProvider,
  type PlanInput,
  type WriteInput,
  type ChoiceInput,
  type GenerationRuntimePolicy,
  DEFAULT_RUNTIME_POLICY,
} from './provider'
import { scanForLeaks } from './gateway'
import { buildWriterPrompt } from '@/lib/prose/prompt-engine'
import { getAiModelRoute, DEFAULT_AI_MODEL_ROUTE, type AiModelRoute } from '@/lib/ops/ai-model-routes'

/**
 * Provider LLM NYATA via Vercel AI Gateway.
 *
 * Strategi keamanan (KUNCI): semua metadata terstruktur yang divalidasi
 * Layer A/B — events, reveals, proposedStateDelta, knowledgeAssertions, sinyal
 * voice/emosi/soft-claim — tetap DITURUNKAN DETERMINISTIK dari canon + plan
 * (via provider deterministik). LLM HANYA menulis prosa yang dilihat pembaca
 * (judul + paragraf). Dengan begitu:
 *   - jaminan konsistensi canon (Layer A) & Layer B tidak bergantung pada model,
 *   - nilai AI nyata ada di kualitas prosa,
 *   - tidak ada metadata model/prompt/token yang bisa bocor ke pembaca
 *     (discan ulang di sini + di boundary gateway).
 *
 * `plan` mengikuti provider deterministik (canon-derived & tervalidasi gateway),
 * jadi seluruh logika reveal/state/thread yang kritis TIDAK diserahkan ke model.
 *
 * Gaya prosa: PRD §9 / `lib/prose/mobile-drama-style.ts` (serial drama mobile).
 */

const DEFAULT_MODEL = 'openai/gpt-4.1-mini'

/** Satu kandidat "otak" dalam rantai fallback. */
type ModelCandidate = { model: LanguageModel; label: string }

// Default model OpenRouter: primary GRATIS berkualitas naratif terbaik →
// fallback berbayar sangat murah. Fallback antar-model ditangani OpenRouter
// sendiri lewat param `models` (array), dalam satu request.
const OPENROUTER_FREE_DEFAULT = 'nousresearch/hermes-3-llama-3.1-405b:free'
const OPENROUTER_PAID_DEFAULT = 'deepseek/deepseek-v3.2'

/** Kandidat endpoint OpenAI-compatible kustom (tunnel/proxy pribadi). */
function customCandidate(optModel?: string): ModelCandidate | null {
  const baseURL = process.env.CUSTOM_LLM_BASE_URL?.trim()
  if (!baseURL) return null
  const modelId = optModel ?? process.env.NARRATIVE_MODEL ?? 'gpt-4o-mini'
  const custom = createOpenAICompatible({
    name: 'custom',
    baseURL,
    apiKey: process.env.CUSTOM_LLM_API_KEY,
  })
  return { model: custom(modelId), label: `custom:${modelId}` }
}

/**
 * Kandidat OpenRouter (juga OpenAI-compatible). Memakai fitur array `models`
 * OpenRouter: dikirim [gratis, berbayar] dan OpenRouter otomatis pindah ke
 * model berikut bila yang pertama error/kena rate-limit — semua dalam satu
 * request. Model bisa dioverride via `OPENROUTER_MODELS` (dipisah koma).
 */
function openRouterCandidate(): ModelCandidate | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null

  const models = (process.env.OPENROUTER_MODELS?.trim()
    ? process.env.OPENROUTER_MODELS.split(',').map((s) => s.trim()).filter(Boolean)
    : [OPENROUTER_FREE_DEFAULT, OPENROUTER_PAID_DEFAULT])

  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    // Suntik param non-standar `models` (fallback bawaan OpenRouter) ke body.
    transformRequestBody: (args) => ({ ...args, models }),
  })
  // `model` utama = model pertama; `models` array mengatur urutan fallback.
  return { model: openrouter(models[0]), label: `openrouter:${models.join('|')}` }
}

/**
 * Bangun RANTAI model berurutan (fallback bila satu gagal). Prioritas:
 *   1) DB route (ai_model_routes) — bila `resolvedRoute` ada.
 *   2) Env override (CUSTOM_LLM_BASE_URL / OPENROUTER_API_KEY) — backward compat.
 *   3) Vercel AI Gateway (model string) — fallback terakhir.
 */
function resolveModelChain(optModel?: string): ModelCandidate[] {
  const chain: ModelCandidate[] = []
  const custom = customCandidate(optModel)
  if (custom) chain.push(custom)
  const or = openRouterCandidate()
  if (or) chain.push(or)
  if (chain.length === 0) {
    const modelId = optModel ?? process.env.NARRATIVE_MODEL ?? DEFAULT_MODEL
    chain.push({ model: modelId, label: `gateway:${modelId}` })
  }
  return chain
}

/** Skema prosa yang diminta dari model — hanya konten naratif untuk pembaca. */
/**
 * Parse teks bebas dari LLM menjadi {title, paragraphs}.
 *
 * Kontrak keluaran (lihat prompt): baris pertama diawali `JUDUL:` lalu judul,
 * diikuti baris kosong, lalu prosa dengan paragraf dipisah baris kosong. Parser
 * ini toleran: bila prefiks `JUDUL:` tak ada, baris non-kosong pertama dianggap
 * judul. Dibuat begini agar kompatibel dengan endpoint OpenAI-compatible apa pun
 * (banyak yang tak mendukung structured/JSON output).
 */
function parseProse(text: string): { title: string; paragraphs: string[] } {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  if (blocks.length === 0) {
    throw new Error('gateway-provider: LLM mengembalikan teks kosong.')
  }

  let title = ''
  const first = blocks[0]
  const titleMatch = first.match(/^\s*(?:JUDUL|Judul|TITLE|Title)\s*[:：]\s*(.+)$/)
  if (titleMatch) {
    title = titleMatch[1].trim()
    blocks.shift()
  } else {
    // Baris pertama sebagai judul jika singkat (satu baris), selain itu sintesis.
    const firstLine = first.split('\n')[0].trim()
    if (!first.includes('\n') && firstLine.length <= 80) {
      title = firstLine.replace(/^#+\s*/, '')
      blocks.shift()
    } else {
      title = 'Tanpa Judul'
    }
  }

  // Ratakan paragraf: pecah blok multi-baris menjadi paragraf per baris berisi.
  const paragraphs = blocks
    .flatMap((b) => b.split(/\n+/))
    .map((p) => p.trim())
    .filter(Boolean)

  if (!title) title = 'Tanpa Judul'
  return { title, paragraphs }
}

type ProseModel = {
  /** Model gateway, mis. "openai/gpt-4.1-mini". */
  model?: string
}

function countWords(paragraphs: string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

function activeCharacterNames(snapshot: CanonSnapshot, chapter: number): string[] {
  return snapshot.characters
    .filter((c) => c.status !== 'DEAD' && c.introducedChapter <= chapter)
    .map((c) => c.canonicalName)
}

/**
 * Panduan suara (T0/G5-VOICE): rakit voice sheet tokoh aktif menjadi instruksi
 * ringkas untuk penulis prosa, sehingga dialog tiap tokoh KHAS & konsisten sejak
 * Bab 1. Voice diturunkan deterministik dari canon (opening package), bukan model.
 * Aman-pembaca: hanya bahasa cerita (tak ada metadata internal).
 */
function voiceGuidance(snapshot: CanonSnapshot, chapter: number): string {
  const nameById = new Map(snapshot.characters.map((c) => [c.id, c.canonicalName]))
  const activeIds = new Set(
    snapshot.characters
      .filter((c) => c.status !== 'DEAD' && c.introducedChapter <= chapter)
      .map((c) => c.id),
  )
  const lines = snapshot.voiceSheets
    .filter((v) => activeIds.has(v.characterId))
    .sort((a, b) => a.characterId.localeCompare(b.characterId))
    .map((v) => {
      const name = nameById.get(v.characterId) ?? 'Tokoh'
      const parts = [`- ${name}: bicara ${v.register}`]
      if (v.speechHabits.length) parts.push(`kebiasaan: ${v.speechHabits.join('; ')}`)
      if (v.forbiddenWords.length) parts.push(`hindari kata: ${v.forbiddenWords.join(', ')}`)
      if (v.sampleLines.length) parts.push(`contoh nada: "${v.sampleLines[0]}"`)
      return parts.join(' — ')
    })
  if (!lines.length) return ''
  return ['Jaga suara tiap tokoh agar khas & konsisten:', ...lines].join('\n')
}

/**
 * Bangun prompt penulisan bab lewat prose prompt-engine (single source of rhythm).
 * Repair findings diteruskan ke buildWriterPrompt untuk instruksi perbaikan.
 */
function buildPrompt(args: {
  snapshot: CanonSnapshot
  plan: Record<string, unknown>
  repairFindings?: Finding[]
}): { system: string; prompt: string } {
  const { snapshot, plan } = args
  const chapter = Number(plan.chapterNumber)
  const names = activeCharacterNames(snapshot, chapter)
  const voices = voiceGuidance(snapshot, chapter)
  const beats = Array.isArray(plan.plannedBeats) ? (plan.plannedBeats as string[]) : []
  const goal = String(plan.chapterGoal ?? '')
  const phase = String(plan.phase ?? '')
  const scenes = Number(plan.targetSceneCount ?? 3)

  const parts = buildWriterPrompt({
    chapterNumber: chapter,
    phase: phase || undefined,
    goal: goal || undefined,
    characterNames: names,
    voiceGuidance: voices || undefined,
    plannedBeats: beats,
    sceneCount: scenes,
    repairFindings: args.repairFindings?.map((f) => ({
      severity: f.severity,
      message: f.message,
    })),
  })

  return { system: parts.system, prompt: parts.user }
}

/**
 * Hasilkan prosa via LLM dengan penjagaan: bila terdeteksi kebocoran istilah
 * internal, coba sekali lagi; bila masih bocor, lempar agar pipeline menangani
 * (fallback aman ditangani pemanggil bila perlu).
 */
async function generateProse(args: {
  chain: ModelCandidate[]
  snapshot: CanonSnapshot
  plan: Record<string, unknown>
  repairFindings?: Finding[]
}): Promise<{ title: string; paragraphs: string[]; usedModel: string }> {
  const { system, prompt } = buildPrompt(args)
  let lastError: unknown

  // Rantai fallback: coba tiap kandidat model berurutan. Kegagalan (error
  // jaringan/HTTP maupun kebocoran istilah internal setelah repair) memicu
  // pindah ke kandidat berikutnya.
  for (const { model, label } of args.chain) {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Pakai streamText (bukan generateText): banyak endpoint
        // OpenAI-compatible (termasuk proxy/tunnel & OpenRouter) SELALU membalas
        // SSE streaming meski diminta non-stream, sehingga parser non-stream
        // gagal. streamText mem-parse SSE; kita cukup menunggu `text` rampung.
        const result = streamText({
          model,
          system,
          prompt:
            attempt === 0
              ? prompt
              : `${prompt}\n\nCATATAN: revisi sebelumnya memuat istilah teknis terlarang. Tulis ulang murni sebagai narasi cerita.`,
        })
        const text = await result.text
        const { title, paragraphs } = parseProse(text)
        const blob = [title, ...paragraphs].join('\n')
        if (scanForLeaks(blob).length === 0) {
          return { title, paragraphs, usedModel: label }
        }
      }
      lastError = new Error(`gateway-provider: prosa dari ${label} bocor istilah internal setelah 2 percobaan.`)
    } catch (err) {
      lastError = err
      console.log(`[v0] gateway-provider: kandidat ${label} gagal, mencoba fallback berikutnya:`, (err as Error)?.message)
    }
  }
  throw lastError ?? new Error('gateway-provider: semua kandidat model gagal.')
}

function parseChoiceJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed
  try {
    return JSON.parse(fenced)
  } catch {
    // Gateway memetakan respons non-JSON ke CHOICE_INVALID lewat validator Task 9.
    return text
  }
}

function buildChoicePrompt(input: ChoiceInput): { system: string; prompt: string } {
  const context = {
    snapshot: input.snapshot,
    chapterBrief: input.chapterBrief,
    draft: input.draft,
    lastParagraphs: input.lastParagraphs,
    routeState: input.routeState,
    choiceHistory: input.choiceHistory,
    lockedEndingKey: input.lockedEndingKey,
    chapterNumber: input.chapterNumber,
  }

  return {
    system: [
      'Buat cabang pilihan cerita interaktif berdasarkan konteks server.',
      'Balas hanya dengan satu objek JSON ketat tanpa markdown atau komentar.',
      'Berikan 2 atau 3 tindakan konkret yang berbeda dan dapat langsung dilakukan tokoh.',
      'Teks pembaca harus alami; jangan tampilkan label internal, status rute, spoiler ending, prompt, model, atau metadata generasi.',
      'Setiap choice harus memiliki outcome dengan choiceId sama dan effect terstruktur.',
    ].join(' '),
    prompt: `Konteks pilihan:\n${JSON.stringify(context)}`,
  }
}

async function generateChoiceJson(args: {
  chain: ModelCandidate[]
  input: ChoiceInput
  route?: AiModelRoute
}): Promise<unknown> {
  const { system, prompt } = buildChoicePrompt(args.input)
  let lastError: unknown

  for (const { model, label } of args.chain) {
    try {
      const result = streamText({
        model,
        system,
        prompt,
        temperature: args.route?.temperature ?? undefined,
        maxOutputTokens: args.route?.maxOutputTokens ?? undefined,
      })
      return parseChoiceJson(await result.text)
    } catch (error) {
      lastError = error
      console.log(
        `[v0] gateway-provider: kandidat choices ${label} gagal, mencoba fallback berikutnya:`,
        (error as Error)?.message,
      )
    }
  }

  throw lastError ?? new Error('gateway-provider: semua kandidat model choices gagal.')
}

/**
 * Provider LLM nyata. `generatePlan` & scaffold metadata memakai provider
 * deterministik (canon-safe); hanya prosa yang berasal dari model.
 *
 * @param opts.model — override model string (optional, via NARRATIVE_MODEL env).
 * @param genPolicy — generation policy dari DB (target kata/scene).
 * @param aiRoute — route model dari DB ai_model_routes (opsional). Bila ada,
 *   digunakan sebagai prioritas pertama sebelum env/code fallback.
 */
export function createGatewayProvider(
  opts: ProseModel = {},
  genPolicy: GenerationRuntimePolicy = DEFAULT_RUNTIME_POLICY,
  aiRoute?: AiModelRoute,
  choicesRoute?: AiModelRoute,
): GenerationProvider {
  const base = createDeterministicProvider(genPolicy)

  // Build chain: DB route first if available, then env, then code fallback.
  let chain = resolveModelChain(opts.model)
  const dbModel = toModelCandidate(aiRoute)
  if (dbModel) chain = [dbModel, ...chain]

  const resolvedChoicesRoute = choicesRoute ?? aiRoute
  let choiceChain = chain
  if (choicesRoute) {
    const choiceDbModel = toModelCandidate(choicesRoute)
    if (choiceDbModel) choiceChain = [choiceDbModel, ...chain]
  }

  return {
    name: chain.map((c) => c.label).join(' → '),

    // Plan tetap canon-derived (aman); model tidak menyentuh logika reveal/state.
    generatePlan(input: PlanInput): Promise<unknown> {
      return base.generatePlan(input)
    },

    async writeChapter(input: WriteInput): Promise<unknown> {
      // 1) Scaffold canon-safe (semua metadata terstruktur & sinyal Layer B).
      const scaffold = (await base.writeChapter(input)) as Record<string, unknown>

      // 2) Prosa nyata dari LLM (dengan rantai fallback).
      const { title, paragraphs } = await generateProse({
        chain,
        snapshot: input.snapshot,
        plan: input.plan as Record<string, unknown>,
        repairFindings: input.repairFindings,
      })

      // 3) Gabungkan: prosa model menggantikan judul/paragraf; sisanya canon-safe.
      return {
        ...scaffold,
        title,
        paragraphs,
        wordCount: countWords(paragraphs),
      }
    },

    generateChoices(input: ChoiceInput): Promise<unknown> {
      return generateChoiceJson({
        chain: choiceChain,
        input,
        route: resolvedChoicesRoute,
      })
    },
  }
}

/** Konversi DB route ke ModelCandidate untuk dimasukkan ke chain. */
function toModelCandidate(route: AiModelRoute | undefined): ModelCandidate | null {
  if (!route) return null

  if (route.provider === 'custom') {
    const baseURL = process.env.CUSTOM_LLM_BASE_URL?.trim()
    if (!baseURL) return null
    const custom = createOpenAICompatible({
      name: 'custom',
      baseURL,
      apiKey: process.env.CUSTOM_LLM_API_KEY,
    })
    return { model: custom(route.modelId), label: `db:custom:${route.modelId}` }
  }

  if (route.provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim()
    if (!apiKey) return null
    const models = route.fallbackModels.length
      ? [route.modelId, ...route.fallbackModels]
      : [route.modelId]
    const openrouter = createOpenAICompatible({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      transformRequestBody: (args) => ({ ...args, models }),
    })
    return { model: openrouter(models[0]), label: `db:openrouter:${models.join('|')}` }
  }

  if (route.provider === 'gateway') {
    return { model: route.modelId, label: `db:gateway:${route.modelId}` }
  }

  // deterministic — no real model.
  return null
}
