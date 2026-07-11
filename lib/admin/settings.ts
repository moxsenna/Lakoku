import 'server-only'
import { createAdminClient } from '@lakoku/db'

export interface AdminCreditProduct {
  productKey: string
  name: string
  priceIdr: number
  credits: number
  normalBonusCredits: number
  firstTopupBonusCredits: number
  marketingBadge: string | null
  active: boolean
}

export interface AdminGenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
  updatedAt: string | null
}

export interface AdminAiModelRoute {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: string[]
  temperature: number | null
  maxOutputTokens: number | null
  isActive: boolean
  routeVersion: string
  notes: string | null
}

export interface AdminFeatureCreditCost {
  featureKey: string
  creditsRequired: number
  isActive: boolean
  pricingVersion: string
  metadata: Record<string, unknown>
  updatedAt: string | null
}

export async function listAdminCreditProducts(): Promise<AdminCreditProduct[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('credit_products')
    .select('*')
    .order('sort_order', { ascending: true })
  if (!data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    productKey: r.product_key as string,
    name: r.name as string,
    priceIdr: r.price_idr as number,
    credits: r.credits as number,
    normalBonusCredits: r.normal_bonus_credits as number,
    firstTopupBonusCredits: r.first_topup_bonus_credits as number,
    marketingBadge: (r.marketing_badge as string) ?? null,
    active: (r.active as boolean) ?? false,
  }))
}

export async function getAdminGenerationPolicy(): Promise<AdminGenerationPolicy | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('generation_policy')
    .select('target_words_min,target_words_max,target_scenes,updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    targetWordsMin: d.target_words_min as number,
    targetWordsMax: d.target_words_max as number,
    targetScenes: d.target_scenes as number,
    updatedAt: (d.updated_at as string) ?? null,
  }
}

export async function listAdminAiModelRoutes(): Promise<AdminAiModelRoute[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('ai_model_routes')
    .select('*')
    .order('use_case', { ascending: true })
  if (!data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    useCase: r.use_case as string,
    provider: r.provider as string,
    modelId: r.model_id as string,
    fallbackModels: (r.fallback_models as string[]) ?? [],
    temperature: (r.temperature as number) ?? null,
    maxOutputTokens: (r.max_output_tokens as number) ?? null,
    isActive: (r.is_active as boolean) ?? false,
    routeVersion: r.route_version as string,
    notes: (r.notes as string) ?? null,
  }))
}

export async function listAdminFeatureCreditCosts(): Promise<AdminFeatureCreditCost[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('feature_credit_costs')
    .select('*')
    .order('feature_key', { ascending: true })
  if (!data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    featureKey: r.feature_key as string,
    creditsRequired: r.credits_required as number,
    isActive: (r.is_active as boolean) ?? false,
    pricingVersion: r.pricing_version as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    updatedAt: (r.updated_at as string) ?? null,
  }))
}
