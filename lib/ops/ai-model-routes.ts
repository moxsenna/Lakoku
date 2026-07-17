import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'

/**
 * AI model route config — DB-backed agar admin/owner bisa mengganti model
 * per use-case tanpa deploy kode.
 *
 * Source of truth: tabel `ai_model_routes` (DB).
 * Env override: untuk emergency.
 * Fallback code: bila DB & env sama-sama tak tersedia.
 */

export type AiProvider = 'custom' | 'openrouter' | '9router' | 'gateway' | 'deterministic'

/** Satu kandidat fallback: provider sendiri + modelId (tidak warisi primary). */
export interface AiFallbackModel {
  provider: AiProvider
  modelId: string
}

export interface AiModelRoute {
  useCase: string
  provider: AiProvider
  modelId: string
  fallbackModels: AiFallbackModel[]
  temperature: number | null
  maxOutputTokens: number | null
  routeVersion: string
}

interface AiModelRouteRow {
  use_case: string
  provider: AiProvider
  model_id: string
  fallback_models: unknown
  temperature: number | null
  max_output_tokens: number | null
  route_version: string
}

const KNOWN_PROVIDERS = new Set<AiProvider>([
  'custom',
  'openrouter',
  '9router',
  'gateway',
  'deterministic',
])

/**
 * Infer provider for legacy string model ids when DB only stores text[].
 * OpenRouter-style ids contain `/` (e.g. deepseek/deepseek-v3.2).
 * Do NOT inherit primary provider blindly — 9router primary + openrouter
 * fallback strings used to become 9router:openai/... and hang.
 */
function inferProviderForModelId(
  modelId: string,
  fallbackProvider: AiProvider,
): AiProvider {
  if (modelId.includes('/')) return 'openrouter'
  if (fallbackProvider === '9router' || fallbackProvider === 'custom') {
    return 'openrouter'
  }
  return fallbackProvider
}

/** Normalisasi fallback_models dari DB (jsonb baru, atau legacy text[]). */
export function normalizeFallbackModels(
  raw: unknown,
  fallbackProvider: AiProvider = 'gateway',
): AiFallbackModel[] {
  if (!Array.isArray(raw)) return []
  const out: AiFallbackModel[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const modelId = entry.trim()
      if (modelId.length >= 3) {
        out.push({
          provider: inferProviderForModelId(modelId, fallbackProvider),
          modelId,
        })
      }
      continue
    }
    if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>
      const modelId = String(rec.modelId ?? rec.model_id ?? '').trim()
      const providerRaw = String(rec.provider ?? '').trim()
      if (modelId.length < 3) continue
      const provider = (KNOWN_PROVIDERS.has(providerRaw as AiProvider)
        ? (providerRaw as AiProvider)
        : inferProviderForModelId(modelId, fallbackProvider))
      out.push({ provider, modelId })
    }
  }
  return out
}

function mapRow(r: AiModelRouteRow): AiModelRoute {
  return {
    useCase: r.use_case,
    provider: r.provider,
    modelId: r.model_id,
    fallbackModels: normalizeFallbackModels(r.fallback_models, r.provider),
    temperature: r.temperature,
    maxOutputTokens: r.max_output_tokens,
    routeVersion: r.route_version,
  }
}

/** Fallback aman bila DB & env tak tersedia. */
export const DEFAULT_AI_MODEL_ROUTE: AiModelRoute = {
  useCase: 'chapter_prose',
  provider: 'gateway',
  modelId: 'openai/gpt-4.1-mini',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: null,
  routeVersion: 'fallback-code',
}

/**
 * Ambil route model aktif untuk suatu use_case dari DB.
 * Cache per-request via `cache()`. Return `null` bila tak ada route aktif.
 */
export const getAiModelRoute = cache(
  async (useCase: string): Promise<AiModelRoute | null> => {
    try {
      const db = createAdminClient()
      const { data } = await db
        .from('ai_model_routes')
        .select(
          'use_case,provider,model_id,fallback_models,temperature,max_output_tokens,route_version',
        )
        .eq('use_case', useCase)
        .eq('is_active', true)
        .maybeSingle()

      if (data) return mapRow(data as AiModelRouteRow)
    } catch {
      // fallback
    }
    return null
  },
)
