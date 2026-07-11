import { z } from 'zod'

export const updateCreditProductSchema = z.object({
  productKey: z.string().min(1),
  name: z.string().min(2).max(80),
  priceIdr: z.number().int().min(1000).max(10_000_000),
  credits: z.number().int().min(1).max(1_000_000),
  normalBonusCredits: z.number().int().min(0).max(1_000_000),
  firstTopupBonusCredits: z.number().int().min(0).max(1_000_000),
  marketingBadge: z.string().max(80).nullable(),
  isActive: z.boolean(),
  reason: z.string().min(5).max(500),
})
export type UpdateCreditProductInput = z.infer<typeof updateCreditProductSchema>

export const updateFeatureCreditCostSchema = z.object({
  featureKey: z.string().min(1),
  creditsRequired: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
  pricingVersion: z.string().min(3).max(80),
  reason: z.string().min(5).max(500),
})
export type UpdateFeatureCreditCostInput = z.infer<typeof updateFeatureCreditCostSchema>

export const updateGenerationPolicySchema = z
  .object({
    targetWordsMin: z.number().int().min(300).max(3000),
    targetWordsMax: z.number().int().min(300).max(5000),
    targetScenes: z.number().int().min(1).max(10),
    reason: z.string().min(5).max(500),
  })
  .refine((d) => d.targetWordsMax >= d.targetWordsMin, {
    message: 'Max words harus >= min words',
    path: ['targetWordsMax'],
  })
export type UpdateGenerationPolicyInput = z.infer<typeof updateGenerationPolicySchema>

export const updateAiModelRouteSchema = z.object({
  useCase: z.string().min(1),
  provider: z.string().min(1).max(80),
  modelId: z.string().min(3).max(200),
  fallbackModels: z.array(z.string().min(3).max(200)).max(8),
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(256).max(64000).nullable(),
  isActive: z.boolean(),
  routeVersion: z.string().min(3).max(80),
  notes: z.string().max(500).nullable(),
  reason: z.string().min(5).max(500),
})
export type UpdateAiModelRouteInput = z.infer<typeof updateAiModelRouteSchema>
