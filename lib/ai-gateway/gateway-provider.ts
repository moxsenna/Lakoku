import 'server-only'
import { streamText, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { CanonSnapshot, Finding } from '@lakoku/narrative-core'
import {
  createDeterministicProvider,
  type GenerationProvider,
  type PlanInput,
  type WriteInput,
  type ChoiceProviderInput,
  type GenerationRuntimePolicy,
  DEFAULT_RUNTIME_POLICY,
} from './provider'
import { GatewayError, scanForLeaks } from './gateway'
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

/** Perluas rantai env dengan kandidat dari DB route (termasuk fallbackModels). */
function expandChainWithRoute(chain: ModelCandidate[], route: AiModelRoute): ModelCandidate[] {
  const routeCandidates: ModelCandidate[] = []
  for (const modelId of [route.modelId, ...route.fallbackModels]) {
    const candidate = toModelCandidate({ ...route, modelId, fallbackModels: [] })
    if (candidate) routeCandidates.push(candidate)
  }
  return routeCandidates.length > 0 ? [...routeCandidates, ...chain] : chain
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
          await logUsage('chapter_prose', label, result.usage)
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

// ---------- Choice prompt contract ----------

const MAX_PROMPT_CHARS = 16_000

function buildChoiceSystemPrompt(): string {
  return [
    'Kamu adalah engine pilihan cerita interaktif Lakoku.',
    'Balas HANYA dengan satu objek JSON, tanpa markdown, tanpa komentar, tanpa teks lain.',
    'Teks pembaca harus alami — jangan tampilkan label internal, status rute, spoiler ending, nama prompt, model, token, provider, atau metadata generasi apa pun.',
    '',
    'Skema JSON (TEPAT):',
    '{',
    '  "choicePrompt": "<string 8–120 karakter, pertanyaan naratif yang memicu pilihan>",',
    '  "choices": [',
    '    { "id": "<lowercase-hyphen 1–50 karakter>", "label": "<string 8–90 karakter, kata kerja konkret diawali huruf besar>", "hint": "<string 8–140 karakter, opsional>" }',
    '  ],',
    '  "outcomes": [',
    '    { "choiceId": "<harus cocok dengan salah satu choices[].id>", "consequence": ["<string 1–160 karakter>", "<string 1–160 karakter, opsional>"], "nextChapterNumber": <integer|null>, "isEnding": <boolean>, "effect": { "routeDeltas": { "truth": <int -20..20 optional>, "risk": <int -20..20 optional>, "secrecy": <int -20..20 optional>, "empathy": <int -20..20 optional> }, "trustDeltas": { "<characterId>": <int -10..10> }, "flagsSet": { "<flagKey>": true }, "evidenceAdded": ["<string 1–240 karakter>"], "endingBiasDeltas": { "<endingKey>": <int -100..100> }, "threadTouches": ["<string 1–120 karakter>"] } }',
    '  ]',
    '}',
    '',
    'ATURAN:',
    '- choices.length === outcomes.length (2 atau 3).',
    '- Setiap outcome.choiceId harus cocok dengan tepat satu choices[].id.',
    '- Untuk bab 1..48: nextChapterNumber = currentChapter + 1, isEnding = false.',
    '- Untuk bab 49 normal: nextChapterNumber = 50, isEnding = false (semua outcome).',
    '- Untuk bab 49 spesial: nextChapterNumber = null, isEnding = true (semua outcome).',
    '- Semua outcome dalam satu respons bab 49 harus memakai mode sama; jangan campur normal dan spesial.',
    '- Gunakan aturan di atas berdasarkan currentChapter dari konteks.',
    '- Untuk nilai yang diwajibkan null, tulis JSON null; jangan tulis string "null" dan jangan hilangkan key.',
    '- Label pilihan harus berupa tindakan konkret (kata kerja) yang bisa dibayangkan pembaca.',
    '- Jangan pernah gunakan kata "rute", "prompt", "model", "token", "provider", "narraza", "llm", "gateway" di teks pembaca.',
  ].join('\n')
}

function buildChoicePrompt(input: ChoiceProviderInput): { system: string; prompt: string } {
  const prompt = `Konteks pilihan (currentChapter=${input.currentChapter}):\n${JSON.stringify(input)}`

  // Reject oversized serialized prompt.
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new GatewayError(
      'Pilihan cabang tidak dapat dihasilkan.',
      'CHOICE_INPUT_INVALID',
      [`Prompt length ${prompt.length} exceeds limit ${MAX_PROMPT_CHARS}.`],
    )
  }

  return { system: buildChoiceSystemPrompt(), prompt }
}

// ---------- Shared usage / cost accounting log ----------

type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  raw?: Record<string, unknown>
}

async function logUsage(
  useCase: string,
  model: string,
  usage: PromiseLike<ModelUsage> | undefined,
): Promise<void> {
  const resolved = usage ? await usage : undefined
  console.log('[v0] ai-gateway usage', {
    useCase,
    model,
    provider: 'gateway-provider',
    inputTokens: resolved?.inputTokens,
    outputTokens: resolved?.outputTokens,
    totalTokens: resolved?.totalTokens,
    cost: resolved?.raw?.cost ?? null,
  })
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

// ---------- Choice generation with fallback ----------

async function generateChoiceJson(args: {
  chain: ModelCandidate[]
  input: ChoiceProviderInput
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
      const text = await result.text
      await logUsage(args.route?.useCase ?? 'choices', label, result.usage)
      return parseChoiceJson(text)
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
 * @param choicesRoute — route khusus choices (opsional). Fallback ke aiRoute bila kosong.
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
  if (aiRoute) {
    chain = expandChainWithRoute(chain, aiRoute)
  }

  // Route choices berdiri sendiri. Hanya bila tidak ada, pakai route chapter.
  const resolvedChoicesRoute = choicesRoute ?? aiRoute
  let choiceChain = resolveModelChain(opts.model)
  if (resolvedChoicesRoute) {
    choiceChain = expandChainWithRoute(choiceChain, resolvedChoicesRoute)
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

    generateChoices(input: ChoiceProviderInput): Promise<unknown> {
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
    const openrouter = createOpenAICompatible({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    })
    return { model: openrouter(route.modelId), label: `db:openrouter:${route.modelId}` }
  }

  if (route.provider === 'gateway') {
    return { model: route.modelId, label: `db:gateway:${route.modelId}` }
  }

  // deterministic — no real model.
  return null
}
