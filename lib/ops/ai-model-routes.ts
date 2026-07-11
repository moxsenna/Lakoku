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

export type AiProvider = 'custom' | 'openrouter' | 'gateway' | 'deterministic'

export interface AiModelRoute {
  useCase: string
  provider: AiProvider
  modelId: string
  fallbackModels: string[]
  temperature: number | null
  maxOutputTokens: number | null
  routeVersion: string
}

interface AiModelRouteRow {
  use_case: string
  provider: AiProvider
  model_id: string
  fallback_models: string[]
  temperature: number | null
  max_output_tokens: number | null
  route_version: string
}

function mapRow(r: AiModelRouteRow): AiModelRoute {
  return {
    useCase: r.use_case,
    provider: r.provider,
    modelId: r.model_id,
    fallbackModels: r.fallback_models,
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
