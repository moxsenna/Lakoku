/**
 * Rantai model AUTHORING (T7.4) khusus untuk structured output.
 *
 * Authoring butuh JSON schema yang valid. Tidak semua model konsisten
 * mengembalikan objek yang lolos Zod, jadi kandidat dicoba satu per satu.
 * Default release mengutamakan reliabilitas, lalu jatuh ke model murah:
 *   openai/gpt-4.1-mini -> deepseek/deepseek-v3.2 -> google/gemini-2.5-flash-lite
 *
 * Override via env `AUTHORING_MODELS` (dipisah koma).
 */
import 'server-only'
import { generateObject, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { z } from 'zod'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const AUTHORING_PRIMARY_JSON = 'openai/gpt-4.1-mini'
const AUTHORING_FALLBACK_JSON = 'deepseek/deepseek-v3.2'
const AUTHORING_LAST_RESORT_JSON = 'google/gemini-2.5-flash-lite'
const NINEROUTER_AUTHORING_PRIMARY = 'ag/claude-sonnet-4-6'
const NINEROUTER_AUTHORING_FALLBACK = 'ag/claude-opus-4-6-thinking'
const GATEWAY_FALLBACK = AUTHORING_PRIMARY_JSON
const PUBLIC_AUTHORING_ERROR =
  'Usulan cerita belum berhasil dibentuk. Coba ulang sebentar lagi.'
const PUBLIC_UNEXPECTED_ERROR = 'Terjadi kesalahan tak terduga.'

export interface AuthoringModel {
  model: LanguageModel
  label: string
}

export interface AuthorObjectArgs<T> {
  schema: z.ZodType<T>
  system: string
  prompt: string
}

export interface AuthorObjectGenerateArgs<T> extends AuthorObjectArgs<T> {
  model: LanguageModel
  schemaName: string
  schemaDescription: string
}

export type AuthorObjectGenerate = <T>(
  args: AuthorObjectGenerateArgs<T>,
) => Promise<{ object: T }>

export class PublicAuthoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicAuthoringError'
  }
}

export class AuthoringGenerationError extends PublicAuthoringError {
  readonly cause: unknown
  readonly failures: readonly string[]

  constructor(cause: unknown, failures: readonly string[]) {
    super(PUBLIC_AUTHORING_ERROR)
    this.name = 'AuthoringGenerationError'
    this.cause = cause
    this.failures = failures
  }
}

function splitModelList(value: string | undefined): string[] {
  return value?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
}

/**
 * Custom fetch untuk authoring OpenAI-compatible.
 * 1. stream: false dipaksa agar provider (seperti 9router) tidak mengembalikan SSE.
 * 2. User-Agent diinjeksi agar lolos perlindungan Cloudflare pada endpoint reverse proxy.
 * 3. Jika respons terbungkus markdown code fence (```json ... ```), kupas fence
 *    sebelum AI SDK melakukan JSON parsing, dan bersihkan header kompresi/panjang.
 */
function createAuthoringFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    let reqInit = init
    if (reqInit && typeof reqInit.body === 'string') {
      try {
        const body = JSON.parse(reqInit.body) as Record<string, unknown>
        if (body && typeof body === 'object') {
          if (body.stream === undefined) {
            body.stream = false
            reqInit = { ...reqInit, body: JSON.stringify(body) }
          }
        }
      } catch {
        // Biarkan body apa adanya bila gagal parse.
      }
    }
    const headers = new Headers(reqInit?.headers)
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    }
    const finalInit = { ...reqInit, headers }
    const res = await globalThis.fetch(
      input as Parameters<typeof globalThis.fetch>[0],
      finalInit,
    )

    const contentType = res.headers.get('content-type') ?? ''
    if (res.ok && contentType.includes('application/json')) {
      try {
        const text = await res.text()
        const data = JSON.parse(text) as Record<string, unknown>
        if (Array.isArray(data.choices) && data.choices[0] && typeof data.choices[0] === 'object') {
          const choice = data.choices[0] as { message?: { content?: unknown } }
          if (choice.message && typeof choice.message.content === 'string') {
            const content = choice.message.content
            const match = content.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i)
            if (match) {
              choice.message.content = match[1].trim()
              const newHeaders = new Headers(res.headers)
              newHeaders.delete('content-length')
              newHeaders.delete('content-encoding')
              return new Response(JSON.stringify(data), {
                status: res.status,
                statusText: res.statusText,
                headers: newHeaders,
              })
            }
          }
        }
        const newHeaders = new Headers(res.headers)
        newHeaders.delete('content-length')
        newHeaders.delete('content-encoding')
        return new Response(text, {
          status: res.status,
          statusText: res.statusText,
          headers: newHeaders,
        })
      } catch {
        // Fallback ke response mentah bila gagal parse
      }
    }
    return res
  }
}

function candidateForTarget(
  provider: string,
  modelId: string,
  authoringFetch: typeof globalThis.fetch,
): AuthoringModel | null {
  const cleanId = modelId.trim()
  if (!cleanId) return null

  if (provider === '9router') {
    const baseURL = process.env.NINEROUTER_BASE_URL?.trim()
    const apiKey = process.env.NINEROUTER_API_KEY?.trim()
    if (baseURL && apiKey) {
      const nine = createOpenAICompatible({
        name: '9router-authoring',
        baseURL,
        apiKey,
        supportsStructuredOutputs: true,
        fetch: authoringFetch,
      })
      return { model: nine(cleanId), label: `9router:${cleanId}` }
    }
  }

  if (provider === 'custom') {
    const baseURL = process.env.CUSTOM_LLM_BASE_URL?.trim()
    const apiKey = process.env.CUSTOM_LLM_API_KEY?.trim()
    if (baseURL && apiKey) {
      const custom = createOpenAICompatible({
        name: 'custom-authoring',
        baseURL,
        apiKey,
        supportsStructuredOutputs: true,
        fetch: authoringFetch,
      })
      return { model: custom(cleanId), label: `custom:${cleanId}` }
    }
  }

  if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim()
    if (apiKey) {
      const openrouter = createOpenAICompatible({
        name: 'openrouter-authoring',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        supportsStructuredOutputs: true,
        fetch: authoringFetch,
      })
      return { model: openrouter(cleanId), label: `openrouter:${cleanId}` }
    }
  }

  if (provider === 'gateway') {
    return { model: cleanId as unknown as LanguageModel, label: `gateway:${cleanId}` }
  }

  return null
}

/**
 * Pilih kandidat authoring JSON-capable.
 * Prioritas:
 * 0. Rute aktif dari DB (jika route disediakan)
 * 1. 9Router (bila NINEROUTER_BASE_URL & NINEROUTER_API_KEY tersedia)
 * 2. Custom endpoint (bila CUSTOM_LLM_BASE_URL & CUSTOM_LLM_API_KEY tersedia)
 * 3. OpenRouter (bila OPENROUTER_API_KEY tersedia)
 * 4. Gateway fallback (bila tidak ada provider OpenAI-compatible)
 */
export function resolveAuthoringModels(route?: AiModelRoute | null): AuthoringModel[] {
  const authoringFetch = createAuthoringFetch()

  // 0. Bila route DB disediakan, gunakan primary & fallbacks dari route
  if (route) {
    const dbCandidates: AuthoringModel[] = []
    const primary = candidateForTarget(route.provider, route.modelId, authoringFetch)
    if (primary) dbCandidates.push(primary)
    for (const fb of route.fallbackModels ?? []) {
      const candidate = candidateForTarget(fb.provider, fb.modelId, authoringFetch)
      if (candidate) dbCandidates.push(candidate)
    }
    if (dbCandidates.length > 0) {
      return dbCandidates
    }
  }

  const candidates: AuthoringModel[] = []
  const customModels = splitModelList(process.env.AUTHORING_MODELS)

  // 1. 9Router (jika dikonfigurasi) — model Claude teruji sangat patuh schema
  const nineBaseURL = process.env.NINEROUTER_BASE_URL?.trim()
  const nineApiKey = process.env.NINEROUTER_API_KEY?.trim()
  if (nineBaseURL && nineApiKey) {
    const nine = createOpenAICompatible({
      name: '9router-authoring',
      baseURL: nineBaseURL,
      apiKey: nineApiKey,
      supportsStructuredOutputs: true,
      fetch: authoringFetch,
    })
    const modelIds = customModels.length > 0
      ? customModels
      : [NINEROUTER_AUTHORING_PRIMARY, NINEROUTER_AUTHORING_FALLBACK]
    candidates.push(...modelIds.map((id) => ({ model: nine(id), label: `9router:${id}` })))
  }

  // 2. Custom OpenAI-compatible endpoint (jika dikonfigurasi)
  const customBaseURL = process.env.CUSTOM_LLM_BASE_URL?.trim()
  const customApiKey = process.env.CUSTOM_LLM_API_KEY?.trim()
  if (customBaseURL && customApiKey) {
    const custom = createOpenAICompatible({
      name: 'custom-authoring',
      baseURL: customBaseURL,
      apiKey: customApiKey,
      supportsStructuredOutputs: true,
      fetch: authoringFetch,
    })
    const modelId = process.env.AUTHORING_CUSTOM_MODEL?.trim() || 'gpt-4o-mini'
    candidates.push({ model: custom(modelId), label: `custom:${modelId}` })
  }

  // 3. OpenRouter (jika dikonfigurasi)
  const openrouterApiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (openrouterApiKey) {
    const openrouter = createOpenAICompatible({
      name: 'openrouter-authoring',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: openrouterApiKey,
      supportsStructuredOutputs: true,
      fetch: authoringFetch,
    })
    const modelIds = (candidates.length === 0 && customModels.length > 0)
      ? customModels
      : [AUTHORING_PRIMARY_JSON, AUTHORING_FALLBACK_JSON, AUTHORING_LAST_RESORT_JSON]
    candidates.push(...modelIds.map((id) => ({ model: openrouter(id), label: `openrouter:${id}` })))
  }

  // 4. Gateway fallback bila tidak ada provider OpenAI-compatible sama sekali
  if (candidates.length === 0) {
    const modelIds = customModels.length > 0 ? customModels : [GATEWAY_FALLBACK]
    return modelIds.map((id) => ({ model: id, label: `gateway:${id}` }))
  }

  return candidates
}

/** Kompatibilitas untuk pemanggil lama yang hanya butuh kandidat pertama. */
export function resolveAuthoringModel(route?: AiModelRoute | null): AuthoringModel {
  return resolveAuthoringModels(route)[0]
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function publicAuthoringErrorMessage(error: unknown): string {
  if (error instanceof PublicAuthoringError) return error.message
  return PUBLIC_UNEXPECTED_ERROR
}

/**
 * Hasilkan objek terstruktur tervalidasi Zod dari model authoring.
 * Provider-level fallback tidak cukup untuk schema-invalid response, karena
 * request HTTP tetap sukses. Karena itu retry dilakukan di sini.
 */
export async function authorObjectFromCandidates<T>(
  args: AuthorObjectArgs<T>,
  candidates: AuthoringModel[],
  generate: AuthorObjectGenerate = generateObject as AuthorObjectGenerate,
): Promise<{ object: T; usedModel: string }> {
  let lastError: unknown = null
  const failures: string[] = []

  for (const candidate of candidates) {
    try {
      const { object } = await generate({
        model: candidate.model,
        schema: args.schema,
        schemaName: 'story_bible_authoring_payload',
        schemaDescription:
          'Objek JSON valid untuk tahap authoring story bible Lakoku. Patuhi semua field, batas panjang, dan jumlah item pada schema.',
        system: args.system,
        prompt: args.prompt,
      })
      if (failures.length > 0) {
        console.log('[v0] authoring model recovered:', {
          usedModel: candidate.label,
          failedModels: failures,
        })
      }
      return { object, usedModel: candidate.label }
    } catch (error) {
      lastError = error
      const failure = `${candidate.label}: ${describeError(error)}`
      failures.push(failure)
      console.log('[v0] authoring model failed:', failure)
    }
  }

  throw new AuthoringGenerationError(lastError, failures)
}

export async function authorObject<T>(
  args: AuthorObjectArgs<T>,
): Promise<{ object: T; usedModel: string }> {
  let dbRoute: AiModelRoute | null = null
  try {
    const { getAiModelRoute } = await import('@/lib/ops/ai-model-routes')
    dbRoute = await getAiModelRoute('story_authoring')
  } catch {
    // DB tidak tersedia (misal di runner offline/harness), fallback ke env
  }
  return authorObjectFromCandidates(args, resolveAuthoringModels(dbRoute))
}
