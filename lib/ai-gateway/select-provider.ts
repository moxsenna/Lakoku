import 'server-only'
import { createDeterministicProvider } from './provider'
import { createGatewayProvider } from './gateway-provider'
import type { GenerationProvider } from './provider'
import {
  ProviderCallContextSchema,
  type ProviderCallContext,
} from '@/lib/observability/generation-provider-call.contract'
import { getGenerationPolicy } from '@/lib/ops/generation-policy'
import { getAiModelRoute } from '@/lib/ops/ai-model-routes'

/**
 * Seam pemilihan provider generasi (satu-satunya tempat runtime memutuskan
 * "otak" penulis). Konsumen lain hanya kenal kontrak GenerationProvider —
 * pipeline, compiler, & validator tak berubah apa pun provider yang dipakai.
 *
 * Prioritas:
 *   1) generation_policy DB → target kata (800–1000) & scene (3).
 *   2) ai_model_routes DB → model/provider per use_case.
 *   3) Env override (CUSTOM_LLM_BASE_URL, OPENROUTER_API_KEY, NARRATIVE_MODEL, dll).
 *   4) Fallback code.
 *
 * Mode (env `NARRATIVE_PROVIDER`):
 *   - `gateway` → LLM nyata. Hanya prosa yang dari model; metadata terstruktur
 *     tetap canon-derived.
 *   - selain itu (default) → deterministik tanpa LLM (gratis, dipakai harness).
 *
 * Fungsi async karena membaca generation_policy & ai_model_routes dari DB
 * (dengan cache per-request).
 */
export async function selectProvider(
  context: ProviderCallContext,
): Promise<GenerationProvider> {
  ProviderCallContextSchema.parse(context)
  const genPolicy = await getGenerationPolicy()
  if (process.env.NARRATIVE_PROVIDER === 'gateway') {
    const [aiRoute, choicesRoute] = await Promise.all([
      getAiModelRoute('chapter_prose'),
      getAiModelRoute('choices'),
    ])
    return createGatewayProvider(
      undefined,
      genPolicy,
      aiRoute ?? undefined,
      choicesRoute ?? undefined,
    )
  }
  return createDeterministicProvider(genPolicy)
}

/**
 * Versi sinkron untuk harness/test yang tak mau I/O. Pakai default policy,
 * tanpa route DB.
 */
export function selectProviderSync(): GenerationProvider {
  if (process.env.NARRATIVE_PROVIDER === 'gateway') {
    return createGatewayProvider()
  }
  return createDeterministicProvider()
}
