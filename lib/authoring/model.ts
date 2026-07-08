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
import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { z } from 'zod'

const AUTHORING_PRIMARY_JSON = 'openai/gpt-4.1-mini'
const AUTHORING_FALLBACK_JSON = 'deepseek/deepseek-v3.2'
const AUTHORING_LAST_RESORT_JSON = 'google/gemini-2.5-flash-lite'
const GATEWAY_FALLBACK = AUTHORING_PRIMARY_JSON
const PUBLIC_AUTHORING_ERROR =
  'Usulan cerita belum berhasil dibentuk. Coba ulang sebentar lagi.'

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

export class AuthoringGenerationError extends Error {
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
 * Pilih kandidat authoring JSON-capable. OpenRouter diutamakan, lalu AI
 * Gateway bila tidak ada key OpenRouter.
 */
export function resolveAuthoringModels(): AuthoringModel[] {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (apiKey) {
    const override = splitModelList(process.env.AUTHORING_MODELS)
    const modelIds = override.length > 0
      ? override
      : [AUTHORING_PRIMARY_JSON, AUTHORING_FALLBACK_JSON, AUTHORING_LAST_RESORT_JSON]
    const openrouter = createOpenAICompatible({
      name: 'openrouter-authoring',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      supportsStructuredOutputs: true,
    })
    return modelIds.map((id) => ({ model: openrouter(id), label: `openrouter:${id}` }))
  }

  const override = splitModelList(process.env.AUTHORING_MODELS)
  const modelIds = override.length > 0 ? override : [GATEWAY_FALLBACK]
  return modelIds.map((id) => ({ model: id, label: `gateway:${id}` }))
}

/** Kompatibilitas untuk pemanggil lama yang hanya butuh kandidat pertama. */
export function resolveAuthoringModel(): AuthoringModel {
  return resolveAuthoringModels()[0]
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isAuthoringSchemaError(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error)) return true
  const message = describeError(error)
  return /No object generated|did not match schema|response did not match schema/i.test(message)
}

export function publicAuthoringErrorMessage(error: unknown): string {
  if (error instanceof AuthoringGenerationError || isAuthoringSchemaError(error)) {
    return PUBLIC_AUTHORING_ERROR
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Terjadi kesalahan tak terduga.'
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
  return authorObjectFromCandidates(args, resolveAuthoringModels())
}
