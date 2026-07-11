import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { requireAdminUser } from '@/lib/admin/auth'
import type {
  UpdateCreditProductInput,
  UpdateFeatureCreditCostInput,
  UpdateGenerationPolicyInput,
  UpdateAiModelRouteInput,
} from './settings-schemas'

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

export interface AdminSettingsAuditLog {
  id: string
  adminEmail: string | null
  settingArea: string
  settingKey: string
  oldValue: unknown
  newValue: unknown
  reason: string
  createdAt: string
}

export async function listRecentSettingsAuditLogs(limit = 20): Promise<AdminSettingsAuditLog[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('admin_settings_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    adminEmail: (r.admin_email as string) ?? null,
    settingArea: r.setting_area as string,
    settingKey: r.setting_key as string,
    oldValue: r.old_value,
    newValue: r.new_value,
    reason: r.reason as string,
    createdAt: r.created_at as string,
  }))
}

export interface AdminSettingsData {
  creditProducts: AdminCreditProduct[]
  generationPolicy: AdminGenerationPolicy | null
  aiModelRoutes: AdminAiModelRoute[]
  featureCreditCosts: AdminFeatureCreditCost[]
  recentAuditLogs: AdminSettingsAuditLog[]
}

export async function loadAdminSettings(): Promise<AdminSettingsData> {
  const [creditProducts, generationPolicy, aiModelRoutes, featureCreditCosts, recentAuditLogs] =
    await Promise.all([
      listAdminCreditProducts(),
      getAdminGenerationPolicy(),
      listAdminAiModelRoutes(),
      listAdminFeatureCreditCosts(),
      listRecentSettingsAuditLogs(),
    ])
  return { creditProducts, generationPolicy, aiModelRoutes, featureCreditCosts, recentAuditLogs }
}

// --- Write helpers (owner-only) ---

async function auditSettings(args: {
  adminUserId: string
  adminEmail: string | undefined
  settingArea: string
  settingKey: string
  oldValue: unknown
  newValue: unknown
  reason: string
}): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.from('admin_settings_audit_logs').insert({
    admin_user_id: args.adminUserId,
    admin_email: args.adminEmail ?? null,
    setting_area: args.settingArea,
    setting_key: args.settingKey,
    old_value: args.oldValue != null ? JSON.parse(JSON.stringify(args.oldValue)) : null,
    new_value: JSON.parse(JSON.stringify(args.newValue)),
    reason: args.reason,
  })
  if (error) throw new Error(`auditSettings: ${error.message}`)
}

async function requireOwner() {
  const admin = await requireAdminUser()
  if (admin.role !== 'owner') {
    throw new Error('Forbidden: owner role required')
  }
  return admin
}

export async function updateCreditProductSettings(
  input: UpdateCreditProductInput,
): Promise<AdminCreditProduct> {
  const admin = await requireOwner()
  const db = createAdminClient()

  // Ambil old value
  const { data: oldRow } = await db
    .from('credit_products')
    .select('*')
    .eq('product_key', input.productKey)
    .single()
  if (!oldRow) throw new Error('Product not found')

  const oldVal = {
    name: oldRow.name,
    price_idr: oldRow.price_idr,
    credits: oldRow.credits,
    normal_bonus_credits: oldRow.normal_bonus_credits,
    first_topup_bonus_credits: oldRow.first_topup_bonus_credits,
    marketing_badge: oldRow.marketing_badge,
    active: oldRow.active,
  }

  const { data: updated } = await db
    .from('credit_products')
    .update({
      name: input.name,
      price_idr: input.priceIdr,
      credits: input.credits,
      normal_bonus_credits: input.normalBonusCredits,
      first_topup_bonus_credits: input.firstTopupBonusCredits,
      marketing_badge: input.marketingBadge,
      active: input.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('product_key', input.productKey)
    .select('*')
    .single()

  if (!updated) throw new Error('Update failed')

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'credit_products',
    settingKey: input.productKey,
    oldValue: oldVal,
    newValue: {
      name: input.name,
      price_idr: input.priceIdr,
      credits: input.credits,
      normal_bonus_credits: input.normalBonusCredits,
      first_topup_bonus_credits: input.firstTopupBonusCredits,
      marketing_badge: input.marketingBadge,
      active: input.isActive,
    },
    reason: input.reason,
  })

  return {
    productKey: input.productKey,
    name: input.name,
    priceIdr: input.priceIdr,
    credits: input.credits,
    normalBonusCredits: input.normalBonusCredits,
    firstTopupBonusCredits: input.firstTopupBonusCredits,
    marketingBadge: input.marketingBadge,
    active: input.isActive,
  }
}

export async function updateFeatureCreditCost(
  input: UpdateFeatureCreditCostInput,
): Promise<AdminFeatureCreditCost> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('feature_credit_costs')
    .select('credits_required,is_active,pricing_version')
    .eq('feature_key', input.featureKey)
    .single()
  if (!oldRow) throw new Error('Feature cost not found')

  const oldVal = {
    credits_required: oldRow.credits_required,
    is_active: oldRow.is_active,
    pricing_version: oldRow.pricing_version,
  }

  const { error } = await db
    .from('feature_credit_costs')
    .update({
      credits_required: input.creditsRequired,
      is_active: input.isActive,
      pricing_version: input.pricingVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('feature_key', input.featureKey)

  if (error) throw new Error(`updateFeatureCreditCost: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'feature_credit_costs',
    settingKey: input.featureKey,
    oldValue: oldVal,
    newValue: {
      credits_required: input.creditsRequired,
      is_active: input.isActive,
      pricing_version: input.pricingVersion,
    },
    reason: input.reason,
  })

  return {
    featureKey: input.featureKey,
    creditsRequired: input.creditsRequired,
    isActive: input.isActive,
    pricingVersion: input.pricingVersion,
    metadata: {},
    updatedAt: new Date().toISOString(),
  }
}

export async function updateGenerationPolicy(
  input: UpdateGenerationPolicyInput,
): Promise<AdminGenerationPolicy> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('generation_policy')
    .select('*')
    .eq('id', 1)
    .single()
  if (!oldRow) throw new Error('Generation policy not found')

  const oldVal = {
    target_words_min: oldRow.target_words_min,
    target_words_max: oldRow.target_words_max,
    target_scenes: oldRow.target_scenes,
  }

  const { error } = await db
    .from('generation_policy')
    .update({
      target_words_min: input.targetWordsMin,
      target_words_max: input.targetWordsMax,
      target_scenes: input.targetScenes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)

  if (error) throw new Error(`updateGenerationPolicy: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'generation_policy',
    settingKey: 'default',
    oldValue: oldVal,
    newValue: {
      target_words_min: input.targetWordsMin,
      target_words_max: input.targetWordsMax,
      target_scenes: input.targetScenes,
    },
    reason: input.reason,
  })

  return {
    targetWordsMin: input.targetWordsMin,
    targetWordsMax: input.targetWordsMax,
    targetScenes: input.targetScenes,
    updatedAt: new Date().toISOString(),
  }
}

export async function updateAiModelRoute(
  input: UpdateAiModelRouteInput,
): Promise<AdminAiModelRoute> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('ai_model_routes')
    .select('*')
    .eq('use_case', input.useCase)
    .single()
  if (!oldRow) throw new Error('AI model route not found')

  const oldVal = {
    provider: oldRow.provider,
    model_id: oldRow.model_id,
    fallback_models: oldRow.fallback_models,
    temperature: oldRow.temperature,
    max_output_tokens: oldRow.max_output_tokens,
    is_active: oldRow.is_active,
    route_version: oldRow.route_version,
    notes: oldRow.notes,
  }

  const { error } = await db
    .from('ai_model_routes')
    .update({
      provider: input.provider,
      model_id: input.modelId,
      fallback_models: input.fallbackModels,
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens,
      is_active: input.isActive,
      route_version: input.routeVersion,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('use_case', input.useCase)

  if (error) throw new Error(`updateAiModelRoute: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'ai_model_routes',
    settingKey: input.useCase,
    oldValue: oldVal,
    newValue: {
      provider: input.provider,
      model_id: input.modelId,
      fallback_models: input.fallbackModels,
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens,
      is_active: input.isActive,
      route_version: input.routeVersion,
      notes: input.notes,
    },
    reason: input.reason,
  })

  return {
    useCase: input.useCase,
    provider: input.provider,
    modelId: input.modelId,
    fallbackModels: input.fallbackModels,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    isActive: input.isActive,
    routeVersion: input.routeVersion,
    notes: input.notes,
  }
}
