import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { requireAdminUser } from '@/lib/admin/auth'
import {
  normalizeFallbackModels,
  type AiProvider,
} from '@/lib/ops/ai-model-routes'
import type {
  UpdateCreditProductInput,
  UpdateFeatureCreditCostInput,
  UpdateGenerationPolicyInput,
  UpdateAiModelRouteInput,
  UpdateRewardPolicyInput,
  UpdateMissionPolicyInput,
} from './settings-schemas'

export interface AdminMissionPolicy {
  missionsEnabled: boolean
  adRewardEnabled: boolean
  adsenseEnabled: boolean
  checkinCredits: number
  choiceCredits: number
  adBatchCredits: number
  choiceRequired: number
  adsPerCredit: number
  adDailyCap: number
  ssvFreshnessSeconds: number
  adsenseClientId: string
  adsenseSlotShareLanding: string
  adsenseSlotEnding: string
  adsenseSlotBeranda: string
  adsenseSlotCredit: string
  updatedAt: string | null
}

export interface AdminRewardPolicy {
  commissionPercent: number
  windowDays: number
  attributionCookieDays: number
  redeemRateIdrPerCredit: number
  redeemMinIdr: number
  commissionEnabled: boolean
  redeemEnabled: boolean
  payoutEnabled: boolean
  payoutMinIdr: number
  updatedAt: string | null
}

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

export interface AdminFallbackModel {
  provider: string
  modelId: string
}

export interface AdminGenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
  leaseTtlSeconds: number
  maxConcurrentGenerations: number
  maxConcurrentGenerationsPerUser: number
  generationMaxQueue: number
  updatedAt: string | null
}

export interface AdminAiModelRoute {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: AdminFallbackModel[]
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
    .select(
      'target_words_min,target_words_max,target_scenes,lease_ttl_seconds,max_concurrent_generations,max_concurrent_generations_per_user,generation_max_queue,updated_at',
    )
    .eq('id', 1)
    .maybeSingle()
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    targetWordsMin: d.target_words_min as number,
    targetWordsMax: d.target_words_max as number,
    targetScenes: d.target_scenes as number,
    leaseTtlSeconds: d.lease_ttl_seconds != null ? Number(d.lease_ttl_seconds) : 300,
    maxConcurrentGenerations:
      d.max_concurrent_generations != null ? Number(d.max_concurrent_generations) : 10,
    maxConcurrentGenerationsPerUser:
      d.max_concurrent_generations_per_user != null
        ? Number(d.max_concurrent_generations_per_user)
        : 1,
    generationMaxQueue:
      d.generation_max_queue != null ? Number(d.generation_max_queue) : 40,
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
  return (data as Record<string, unknown>[]).map((r) => {
    const provider = r.provider as string
    return {
      useCase: r.use_case as string,
      provider,
      modelId: r.model_id as string,
      fallbackModels: normalizeFallbackModels(r.fallback_models, provider as AiProvider),
      temperature: (r.temperature as number) ?? null,
      maxOutputTokens: (r.max_output_tokens as number) ?? null,
      isActive: (r.is_active as boolean) ?? false,
      routeVersion: r.route_version as string,
      notes: (r.notes as string) ?? null,
    }
  })
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

export async function getAdminRewardPolicy(): Promise<AdminRewardPolicy | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('reward_policy')
    .select('*')
    .eq('id', true)
    .maybeSingle()
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    commissionPercent: Number(d.commission_percent ?? 10),
    windowDays: Number(d.window_days ?? 30),
    attributionCookieDays: Number(d.attribution_cookie_days ?? 30),
    redeemRateIdrPerCredit: Number(d.redeem_rate_idr_per_credit ?? 250),
    redeemMinIdr: Number(d.redeem_min_idr ?? 1000),
    commissionEnabled: Boolean(d.commission_enabled),
    redeemEnabled: Boolean(d.redeem_enabled),
    payoutEnabled: Boolean(d.payout_enabled),
    payoutMinIdr: Number(d.payout_min_idr ?? 50000),
    updatedAt: (d.updated_at as string) ?? null,
  }
}

export interface AdminSettingsData {
  creditProducts: AdminCreditProduct[]
  generationPolicy: AdminGenerationPolicy | null
  aiModelRoutes: AdminAiModelRoute[]
  featureCreditCosts: AdminFeatureCreditCost[]
  rewardPolicy: AdminRewardPolicy | null
  missionPolicy: AdminMissionPolicy | null
  recentAuditLogs: AdminSettingsAuditLog[]
}

export async function getAdminMissionPolicy(): Promise<AdminMissionPolicy | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('mission_policy')
    .select('*')
    .eq('id', true)
    .maybeSingle()
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    missionsEnabled: Boolean(d.missions_enabled),
    adRewardEnabled: Boolean(d.ad_reward_enabled),
    adsenseEnabled: Boolean(d.adsense_enabled),
    checkinCredits: Number(d.checkin_credits ?? 1),
    choiceCredits: Number(d.choice_credits ?? 1),
    adBatchCredits: Number(d.ad_batch_credits ?? 1),
    choiceRequired: Number(d.choice_required ?? 3),
    adsPerCredit: Number(d.ads_per_credit ?? 5),
    adDailyCap: Number(d.ad_daily_cap ?? 10),
    ssvFreshnessSeconds: Number(d.ssv_freshness_seconds ?? 600),
    adsenseClientId: String(d.adsense_client_id ?? ''),
    adsenseSlotShareLanding: String(d.adsense_slot_share_landing ?? ''),
    adsenseSlotEnding: String(d.adsense_slot_ending ?? ''),
    adsenseSlotBeranda: String(d.adsense_slot_beranda ?? ''),
    adsenseSlotCredit: String(d.adsense_slot_credit ?? ''),
    updatedAt: (d.updated_at as string) ?? null,
  }
}

export async function loadAdminSettings(): Promise<AdminSettingsData> {
  const [
    creditProducts,
    generationPolicy,
    aiModelRoutes,
    featureCreditCosts,
    rewardPolicy,
    missionPolicy,
    recentAuditLogs,
  ] = await Promise.all([
    listAdminCreditProducts(),
    getAdminGenerationPolicy(),
    listAdminAiModelRoutes(),
    listAdminFeatureCreditCosts(),
    getAdminRewardPolicy(),
    getAdminMissionPolicy(),
    listRecentSettingsAuditLogs(),
  ])
  return {
    creditProducts,
    generationPolicy,
    aiModelRoutes,
    featureCreditCosts,
    rewardPolicy,
    missionPolicy,
    recentAuditLogs,
  }
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
    lease_ttl_seconds: oldRow.lease_ttl_seconds,
    max_concurrent_generations: oldRow.max_concurrent_generations,
    max_concurrent_generations_per_user: oldRow.max_concurrent_generations_per_user,
    generation_max_queue: oldRow.generation_max_queue,
  }

  const { error } = await db
    .from('generation_policy')
    .update({
      target_words_min: input.targetWordsMin,
      target_words_max: input.targetWordsMax,
      target_scenes: input.targetScenes,
      lease_ttl_seconds: input.leaseTtlSeconds,
      max_concurrent_generations: input.maxConcurrentGenerations,
      max_concurrent_generations_per_user: input.maxConcurrentGenerationsPerUser,
      generation_max_queue: input.generationMaxQueue,
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
      lease_ttl_seconds: input.leaseTtlSeconds,
      max_concurrent_generations: input.maxConcurrentGenerations,
      max_concurrent_generations_per_user: input.maxConcurrentGenerationsPerUser,
      generation_max_queue: input.generationMaxQueue,
    },
    reason: input.reason,
  })

  return {
    targetWordsMin: input.targetWordsMin,
    targetWordsMax: input.targetWordsMax,
    targetScenes: input.targetScenes,
    leaseTtlSeconds: input.leaseTtlSeconds,
    maxConcurrentGenerations: input.maxConcurrentGenerations,
    maxConcurrentGenerationsPerUser: input.maxConcurrentGenerationsPerUser,
    generationMaxQueue: input.generationMaxQueue,
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

  const structuredFallbacks = input.fallbackModels.map((f) => ({
    provider: f.provider,
    modelId: f.modelId,
  }))

  const oldVal = {
    provider: oldRow.provider,
    model_id: oldRow.model_id,
    fallback_models: normalizeFallbackModels(
      oldRow.fallback_models,
      oldRow.provider as AiProvider,
    ),
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
      fallback_models: structuredFallbacks,
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
      fallback_models: structuredFallbacks,
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
    fallbackModels: structuredFallbacks,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    isActive: input.isActive,
    routeVersion: input.routeVersion,
    notes: input.notes,
  }
}

export async function updateRewardPolicy(
  input: UpdateRewardPolicyInput,
): Promise<AdminRewardPolicy> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('reward_policy')
    .select('*')
    .eq('id', true)
    .single()

  const oldVal = oldRow
    ? {
        commission_percent: oldRow.commission_percent,
        window_days: oldRow.window_days,
        attribution_cookie_days: oldRow.attribution_cookie_days,
        redeem_rate_idr_per_credit: oldRow.redeem_rate_idr_per_credit,
        redeem_min_idr: oldRow.redeem_min_idr,
        commission_enabled: oldRow.commission_enabled,
        redeem_enabled: oldRow.redeem_enabled,
        payout_enabled: oldRow.payout_enabled,
        payout_min_idr: oldRow.payout_min_idr,
      }
    : null

  const newVal = {
    commission_percent: input.commissionPercent,
    window_days: input.windowDays,
    attribution_cookie_days: input.attributionCookieDays,
    redeem_rate_idr_per_credit: input.redeemRateIdrPerCredit,
    redeem_min_idr: input.redeemMinIdr,
    commission_enabled: input.commissionEnabled,
    redeem_enabled: input.redeemEnabled,
    payout_enabled: input.payoutEnabled,
    payout_min_idr: input.payoutMinIdr,
    updated_at: new Date().toISOString(),
  }

  const { error } = await db
    .from('reward_policy')
    .update(newVal)
    .eq('id', true)

  if (error) throw new Error(`updateRewardPolicy: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'reward_policy',
    settingKey: 'default',
    oldValue: oldVal,
    newValue: newVal,
    reason: input.reason,
  })

  return {
    commissionPercent: input.commissionPercent,
    windowDays: input.windowDays,
    attributionCookieDays: input.attributionCookieDays,
    redeemRateIdrPerCredit: input.redeemRateIdrPerCredit,
    redeemMinIdr: input.redeemMinIdr,
    commissionEnabled: input.commissionEnabled,
    redeemEnabled: input.redeemEnabled,
    payoutEnabled: input.payoutEnabled,
    payoutMinIdr: input.payoutMinIdr,
    updatedAt: newVal.updated_at,
  }
}

export async function updateMissionPolicy(
  input: UpdateMissionPolicyInput,
): Promise<AdminMissionPolicy> {
  const admin = await requireOwner()
  const db = createAdminClient()

  const { data: oldRow } = await db
    .from('mission_policy')
    .select('*')
    .eq('id', true)
    .single()

  const oldVal = oldRow
    ? {
        missions_enabled: oldRow.missions_enabled,
        ad_reward_enabled: oldRow.ad_reward_enabled,
        adsense_enabled: oldRow.adsense_enabled,
        checkin_credits: oldRow.checkin_credits,
        choice_credits: oldRow.choice_credits,
        ad_batch_credits: oldRow.ad_batch_credits,
        choice_required: oldRow.choice_required,
        ads_per_credit: oldRow.ads_per_credit,
        ad_daily_cap: oldRow.ad_daily_cap,
        ssv_freshness_seconds: oldRow.ssv_freshness_seconds,
        adsense_client_id: oldRow.adsense_client_id,
        adsense_slot_share_landing: oldRow.adsense_slot_share_landing,
        adsense_slot_ending: oldRow.adsense_slot_ending,
        adsense_slot_beranda: oldRow.adsense_slot_beranda,
        adsense_slot_credit: oldRow.adsense_slot_credit,
      }
    : null

  const newVal = {
    missions_enabled: input.missionsEnabled,
    ad_reward_enabled: input.adRewardEnabled,
    adsense_enabled: input.adsenseEnabled,
    checkin_credits: input.checkinCredits,
    choice_credits: input.choiceCredits,
    ad_batch_credits: input.adBatchCredits,
    choice_required: input.choiceRequired,
    ads_per_credit: input.adsPerCredit,
    ad_daily_cap: input.adDailyCap,
    ssv_freshness_seconds: input.ssvFreshnessSeconds,
    adsense_client_id: input.adsenseClientId,
    adsense_slot_share_landing: input.adsenseSlotShareLanding,
    adsense_slot_ending: input.adsenseSlotEnding,
    adsense_slot_beranda: input.adsenseSlotBeranda,
    adsense_slot_credit: input.adsenseSlotCredit,
    updated_at: new Date().toISOString(),
  }

  const { error } = await db
    .from('mission_policy')
    .update(newVal)
    .eq('id', true)

  if (error) throw new Error(`updateMissionPolicy: ${error.message}`)

  await auditSettings({
    adminUserId: admin.id,
    adminEmail: admin.email,
    settingArea: 'mission_policy',
    settingKey: 'default',
    oldValue: oldVal,
    newValue: newVal,
    reason: input.reason,
  })

  return {
    missionsEnabled: input.missionsEnabled,
    adRewardEnabled: input.adRewardEnabled,
    adsenseEnabled: input.adsenseEnabled,
    checkinCredits: input.checkinCredits,
    choiceCredits: input.choiceCredits,
    adBatchCredits: input.adBatchCredits,
    choiceRequired: input.choiceRequired,
    adsPerCredit: input.adsPerCredit,
    adDailyCap: input.adDailyCap,
    ssvFreshnessSeconds: input.ssvFreshnessSeconds,
    adsenseClientId: input.adsenseClientId,
    adsenseSlotShareLanding: input.adsenseSlotShareLanding,
    adsenseSlotEnding: input.adsenseSlotEnding,
    adsenseSlotBeranda: input.adsenseSlotBeranda,
    adsenseSlotCredit: input.adsenseSlotCredit,
    updatedAt: newVal.updated_at,
  }
}

