/**
 * Rantai model AUTHORING (T7.4) — khusus untuk structured output (generateObject).
 *
 * Berbeda dari rantai PROSA (gateway-provider): authoring butuh JSON schema,
 * yang TIDAK didukung semua model (mis. hermes-3-405b:free). Karena itu default
 * authoring memakai model JSON-capable murah di OpenRouter:
 *   deepseek/deepseek-v3.2 → google/gemini-2.5-flash-lite
 * Override via env `AUTHORING_MODELS` (dipisah koma).
 *
 * Bila `OPENROUTER_API_KEY` tak ada, fallback ke Vercel AI Gateway (model string).
 */
import 'server-only'
import { generateObject, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { z } from 'zod'

const AUTHORING_FREE_JSON = 'deepseek/deepseek-v3.2'
const AUTHORING_PAID_JSON = 'google/gemini-2.5-flash-lite'
const GATEWAY_FALLBACK = 'openai/gpt-4.1-mini'

export interface AuthoringModel {
  model: LanguageModel
  label: string
}

/**
 * Pilih model authoring JSON-capable. OpenRouter diutamakan (array `models`
 * memberi fallback intra-request), lalu AI Gateway sebagai jaring terakhir.
 */
export function resolveAuthoringModel(): AuthoringModel {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (apiKey) {
    const models = process.env.AUTHORING_MODELS?.trim()
      ? process.env.AUTHORING_MODELS.split(',').map((s) => s.trim()).filter(Boolean)
      : [AUTHORING_FREE_JSON, AUTHORING_PAID_JSON]
    const openrouter = createOpenAICompatible({
      name: 'openrouter-authoring',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      // WAJIB: tanpa ini provider hanya kirim `json_object` tanpa schema,
      // sehingga generateObject sering gagal ("did not match schema").
      // Dengan flag ini, JSON Schema penuh dikirim & OpenRouter menegakkannya
      // (hanya untuk model JSON-capable seperti deepseek/gemini).
      supportsStructuredOutputs: true,
      transformRequestBody: (args) => ({ ...args, models }),
    })
    return { model: openrouter(models[0]), label: `openrouter:${models.join('|')}` }
  }
  const modelId = process.env.AUTHORING_MODELS?.trim() || GATEWAY_FALLBACK
  return { model: modelId, label: `gateway:${modelId}` }
}

/**
 * Hasilkan objek terstruktur tervalidasi Zod dari model authoring.
 * Membungkus generateObject dengan pemilihan model + label untuk observability.
 */
export async function authorObject<T>(args: {
  schema: z.ZodType<T>
  system: string
  prompt: string
}): Promise<{ object: T; usedModel: string }> {
  const { model, label } = resolveAuthoringModel()
  const { object } = await generateObject({
    model,
    schema: args.schema,
    system: args.system,
    prompt: args.prompt,
  })
  return { object, usedModel: label }
}
