import { z } from 'zod'
import {
  SAFE_ALIAS_SCHEMA,
  SHA256_SCHEMA,
  canonicalAuthorityHash,
} from './contracts'
import {
  canonicalizeDecimal,
  convertDecimal,
  multiplyDecimals,
  addDecimals,
  type CanonicalDecimal,
} from './decimal'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
const CURRENCY_SCHEMA = z.string().regex(/^[A-Z]{3}$/)
const ISO_TIMESTAMP_SCHEMA = z.string().datetime()

export const PRICING_UNIT_SIZE_SCHEMA = z.union([z.literal(1000), z.literal(1000000)])
export type PricingUnitSize = z.infer<typeof PRICING_UNIT_SIZE_SCHEMA>

export const PRICING_SNAPSHOT_SCHEMA = z.strictObject({
  provenance: z.literal('ASSUMPTION'),
  authorityVersion: z.literal('M10_E_PRICING_SNAPSHOT_V1'),
  pricingPolicyVersion: z.string().min(1),
  providerId: SAFE_ALIAS_SCHEMA,
  exactModelId: z.string().min(1),
  currency: CURRENCY_SCHEMA,
  inputPricePerUnit: z.string(),
  outputPricePerUnit: z.string(),
  unitSize: PRICING_UNIT_SIZE_SCHEMA,
  effectiveFrom: ISO_TIMESTAMP_SCHEMA,
  effectiveTo: ISO_TIMESTAMP_SCHEMA.nullable(),
  decisionRef: z.string().min(1),
  canonicalHash: SHA256_SCHEMA,
}).superRefine((input, context) => {
  if (canonicalAuthorityHash(input) !== input.canonicalHash) {
    context.addIssue({ code: 'custom', message: 'Canonical authority hash mismatch', path: ['canonicalHash'] })
  }
  if (input.effectiveTo !== null && input.effectiveFrom > input.effectiveTo) {
    context.addIssue({ code: 'custom', message: 'effectiveFrom must be <= effectiveTo', path: ['effectiveFrom'] })
  }
})

export type PricingSnapshot = z.infer<typeof PRICING_SNAPSHOT_SCHEMA> & {
  readonly inputPricePerUnit: CanonicalDecimal<'MONEY'>
  readonly outputPricePerUnit: CanonicalDecimal<'MONEY'>
}

export function createPricingSnapshot(params: {
  pricingPolicyVersion: string
  providerId: string
  exactModelId: string
  currency: string
  inputPricePerUnit: string
  outputPricePerUnit: string
  unitSize: PricingUnitSize
  effectiveFrom: string
  effectiveTo?: string | null
  decisionRef?: string
}): PricingSnapshot {
  const payload = {
    provenance: 'ASSUMPTION' as const,
    authorityVersion: 'M10_E_PRICING_SNAPSHOT_V1' as const,
    pricingPolicyVersion: params.pricingPolicyVersion,
    providerId: SAFE_ALIAS_SCHEMA.parse(params.providerId),
    exactModelId: params.exactModelId,
    currency: CURRENCY_SCHEMA.parse(params.currency),
    inputPricePerUnit: canonicalizeDecimal(params.inputPricePerUnit, 'MONEY'),
    outputPricePerUnit: canonicalizeDecimal(params.outputPricePerUnit, 'MONEY'),
    unitSize: PRICING_UNIT_SIZE_SCHEMA.parse(params.unitSize),
    effectiveFrom: ISO_TIMESTAMP_SCHEMA.parse(params.effectiveFrom),
    effectiveTo: params.effectiveTo ? ISO_TIMESTAMP_SCHEMA.parse(params.effectiveTo) : null,
    decisionRef: params.decisionRef ?? AUTHORITY_DECISION_REF,
  }
  return PRICING_SNAPSHOT_SCHEMA.parse({
    ...payload,
    canonicalHash: canonicalAuthorityHash(payload),
  }) as PricingSnapshot
}

export function validatePricingSnapshot(value: unknown): PricingSnapshot {
  const parsed = PRICING_SNAPSHOT_SCHEMA.parse(value)
  const canonicalInput = canonicalizeDecimal(parsed.inputPricePerUnit, 'MONEY')
  const canonicalOutput = canonicalizeDecimal(parsed.outputPricePerUnit, 'MONEY')
  if (canonicalInput !== parsed.inputPricePerUnit || canonicalOutput !== parsed.outputPricePerUnit) {
    throw new Error('Pricing prices must be canonical scale 8')
  }
  return Object.freeze(parsed) as unknown as PricingSnapshot
}

export function estimateCostFromTokens(
  inputTokens: number,
  outputTokens: number,
  pricingSnapshot: PricingSnapshot,
): CanonicalDecimal<'MONEY'> {
  if (inputTokens < 0 || outputTokens < 0 || !Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) {
    throw new Error('Token counts must be non-negative integers')
  }
  const inputRatio = convertDecimal((inputTokens / pricingSnapshot.unitSize).toString(), 'MONEY')
  const outputRatio = convertDecimal((outputTokens / pricingSnapshot.unitSize).toString(), 'MONEY')
  const inputCost = multiplyDecimals(inputRatio, pricingSnapshot.inputPricePerUnit, 'MONEY')
  const outputCost = multiplyDecimals(outputRatio, pricingSnapshot.outputPricePerUnit, 'MONEY')
  return addDecimals(inputCost, outputCost, 'MONEY')
}
