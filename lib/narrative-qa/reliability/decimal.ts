import type { MeasurementState } from './contracts'
import { missingMeasurement, presentMeasurement } from './contracts'

export const DECIMAL_DOMAINS = ['MONEY', 'PROBABILITY', 'PERCENTAGE', 'LATENCY_MILLISECONDS'] as const
export type DecimalDomain = (typeof DECIMAL_DOMAINS)[number]

const DOMAIN_SCALES = {
  MONEY: 8,
  PROBABILITY: 12,
  PERCENTAGE: 6,
  LATENCY_MILLISECONDS: 3,
} as const satisfies Record<DecimalDomain, number>
const INTERMEDIATE_SCALE = 20
const MAX_COEFFICIENT = BigInt('99999999999999999999999999999999999999')
const DECIMAL_INPUT = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/
const POWERS_OF_TEN = Array.from({ length: INTERMEDIATE_SCALE + 39 }, (_, power) => BigInt('1' + '0'.repeat(power)))

declare const canonicalDecimalBrand: unique symbol
export type CanonicalDecimal<D extends DecimalDomain = DecimalDomain> = string & {
  readonly [canonicalDecimalBrand]: D
}

interface ExactDecimal {
  readonly coefficient: bigint
  readonly scale: number
}

export function parseDecimal<D extends DecimalDomain>(value: string, domain: D): ExactDecimal {
  const parsed = parseRawDecimal(value, domain)
  if (parsed.scale > DOMAIN_SCALES[domain]) throw new Error('Excess decimal scale requires named conversion boundary')
  return parsed
}

export function canonicalizeDecimal<D extends DecimalDomain>(value: string, domain: D): CanonicalDecimal<D> {
  return formatCanonical(roundToScale(parseDecimal(value, domain), DOMAIN_SCALES[domain]), domain)
}

export function convertDecimal<D extends DecimalDomain>(value: string, domain: D): CanonicalDecimal<D> {
  return formatCanonical(roundToScale(parseRawDecimal(value, domain), DOMAIN_SCALES[domain]), domain)
}

function parseRawDecimal<D extends DecimalDomain>(value: string, domain: D): ExactDecimal {
  if (typeof value !== 'string') throw new TypeError('Decimal authority must be a string')
  const match = DECIMAL_INPUT.exec(value)
  if (!match) throw new Error('Invalid nonnegative base-10 decimal')
  const fraction = match[2] ?? ''
  const coefficient = BigInt(match[1] + fraction)
  assertCoefficient(coefficient)
  if (domain === 'PROBABILITY' && compareExact({ coefficient, scale: fraction.length }, { coefficient: BigInt(1), scale: 0 }) > 0) {
    throw new RangeError('Probability must be within [0,1]')
  }
  return Object.freeze({ coefficient, scale: fraction.length })
}

export function compareDecimals<D extends DecimalDomain>(
  left: CanonicalDecimal<D>,
  right: CanonicalDecimal<D>,
  domain: D,
): -1 | 0 | 1 {
  return compareExact(parseCanonical(left, domain), parseCanonical(right, domain))
}

export function addDecimals<D extends DecimalDomain>(
  left: CanonicalDecimal<D>,
  right: CanonicalDecimal<D>,
  domain: D,
): CanonicalDecimal<D> {
  const leftExact = parseCanonical(left, domain)
  const rightExact = parseCanonical(right, domain)
  const coefficient = leftExact.coefficient + rightExact.coefficient
  assertCoefficient(coefficient)
  return formatCanonical({ coefficient, scale: DOMAIN_SCALES[domain] }, domain)
}

export function subtractDecimals<D extends DecimalDomain>(
  left: CanonicalDecimal<D>,
  right: CanonicalDecimal<D>,
  domain: D,
): CanonicalDecimal<D> {
  const leftExact = parseCanonical(left, domain)
  const rightExact = parseCanonical(right, domain)
  if (leftExact.coefficient < rightExact.coefficient) throw new RangeError('Subtraction result must be nonnegative')
  return formatCanonical({ coefficient: leftExact.coefficient - rightExact.coefficient, scale: DOMAIN_SCALES[domain] }, domain)
}

export function multiplyDecimals<D extends DecimalDomain>(
  left: CanonicalDecimal<D>,
  right: CanonicalDecimal<D>,
  domain: D,
): CanonicalDecimal<D> {
  const leftExact = parseCanonical(left, domain)
  const rightExact = parseCanonical(right, domain)
  const coefficient = leftExact.coefficient * rightExact.coefficient
  assertCoefficient(coefficient)
  const intermediate = roundToScale({ coefficient, scale: leftExact.scale + rightExact.scale }, INTERMEDIATE_SCALE)
  assertCoefficient(intermediate.coefficient)
  return formatCanonical(roundToScale(intermediate, DOMAIN_SCALES[domain]), domain)
}

export function divideDecimals<D extends DecimalDomain>(
  numerator: CanonicalDecimal<D>,
  denominator: CanonicalDecimal<D>,
  domain: D,
): CanonicalDecimal<D> {
  const numeratorExact = parseCanonical(numerator, domain)
  const denominatorExact = parseCanonical(denominator, domain)
  const intermediate = divideExact(numeratorExact, denominatorExact, INTERMEDIATE_SCALE)
  return formatCanonical(roundToScale(intermediate, DOMAIN_SCALES[domain]), domain)
}

export function sumDecimals<D extends DecimalDomain>(values: readonly CanonicalDecimal<D>[], domain: D): CanonicalDecimal<D> {
  let coefficient = BigInt(0)
  for (const value of values) {
    coefficient += parseCanonical(value, domain).coefficient
    assertCoefficient(coefficient)
  }
  return formatCanonical({ coefficient, scale: DOMAIN_SCALES[domain] }, domain)
}

export function ratioOf(numerator: string | bigint, denominator: string | bigint): CanonicalDecimal<'PROBABILITY'> {
  const ratio = divideWholeCounts(numerator, denominator, INTERMEDIATE_SCALE)
  if (compareExact(ratio, { coefficient: BigInt(1), scale: 0 }) > 0) throw new RangeError('Ratio must be within [0,1]')
  return formatCanonical(roundToScale(ratio, DOMAIN_SCALES.PROBABILITY), 'PROBABILITY')
}

export function percentageOf(numerator: string | bigint, denominator: string | bigint): CanonicalDecimal<'PERCENTAGE'> {
  const ratio = divideWholeCounts(numerator, denominator, INTERMEDIATE_SCALE)
  const coefficient = ratio.coefficient * BigInt(100)
  assertCoefficient(coefficient)
  return formatCanonical(roundToScale({ coefficient, scale: ratio.scale }, DOMAIN_SCALES.PERCENTAGE), 'PERCENTAGE')
}

export function decimalMean<D extends DecimalDomain>(values: readonly CanonicalDecimal<D>[], domain: D): CanonicalDecimal<D> {
  if (values.length === 0) throw new RangeError('Mean requires at least one value')
  let sum = BigInt(0)
  for (const value of values) {
    sum += parseCanonical(value, domain).coefficient
    assertCoefficient(sum)
  }
  const intermediate = divideExact(
    { coefficient: sum, scale: DOMAIN_SCALES[domain] },
    { coefficient: BigInt(values.length), scale: 0 },
    INTERMEDIATE_SCALE,
  )
  return formatCanonical(roundToScale(intermediate, DOMAIN_SCALES[domain]), domain)
}

export function percentileCont<T extends CanonicalDecimal>(
  values: readonly T[],
  quantile: '0.50' | '0.95',
  domain: DecimalDomain,
): MeasurementState<T> {
  if (values.length === 0) return missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'Percentile requires at least one value')
  const sorted = values
    .map((value) => ({ value, exact: parseCanonical(value, domain) }))
    .sort((left, right) => compareExact(left.exact, right.exact))
  if (sorted.length === 1) return presentMeasurement(sorted[0].value)

  const qNumerator = quantile === '0.50' ? BigInt(50) : BigInt(95)
  const rankNumerator = qNumerator * BigInt(sorted.length - 1)
  const lowerIndex = Number(rankNumerator / BigInt(100))
  const remainder = rankNumerator % BigInt(100)
  if (remainder === BigInt(0)) return presentMeasurement(sorted[lowerIndex].value)

  const lower = sorted[lowerIndex].exact
  const upper = sorted[lowerIndex + 1].exact
  const difference = upper.coefficient - lower.coefficient
  const weightedDifference = difference * remainder
  assertCoefficient(weightedDifference)
  const interpolation = divideExact(
    { coefficient: weightedDifference, scale: lower.scale },
    { coefficient: BigInt(100), scale: 0 },
    INTERMEDIATE_SCALE,
  )
  const lowerIntermediate = rescaleExact(lower, INTERMEDIATE_SCALE)
  const coefficient = lowerIntermediate.coefficient + interpolation.coefficient
  assertCoefficient(coefficient)
  const result = formatCanonical(roundToScale({ coefficient, scale: INTERMEDIATE_SCALE }, DOMAIN_SCALES[domain]), domain)
  return presentMeasurement(result as T)
}

export function failureProbabilityThreshold(probability: CanonicalDecimal<'PROBABILITY'> | string): bigint {
  const exact = parseCanonical(canonicalizeDecimal(probability, 'PROBABILITY'), 'PROBABILITY')
  const numerator = exact.coefficient * BigInt(4294967296)
  assertCoefficient(numerator)
  return numerator / powerOfTen(exact.scale)
}

function parseCanonical<D extends DecimalDomain>(value: string, domain: D): ExactDecimal {
  const parsed = parseDecimal(value, domain)
  if (parsed.scale !== DOMAIN_SCALES[domain]) throw new Error(`Expected canonical ${domain} scale ${DOMAIN_SCALES[domain]}`)
  return parsed
}

function divideWholeCounts(numerator: string | bigint, denominator: string | bigint, scale: number): ExactDecimal {
  const numeratorCoefficient = parseWholeCount(numerator)
  const denominatorCoefficient = parseWholeCount(denominator)
  return divideExact(
    { coefficient: numeratorCoefficient, scale: 0 },
    { coefficient: denominatorCoefficient, scale: 0 },
    scale,
  )
}

function parseWholeCount(value: string | bigint): bigint {
  const text = typeof value === 'bigint' ? value.toString() : value
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('Count must be a nonnegative integer string or bigint')
  const parsed = BigInt(text)
  assertCoefficient(parsed)
  return parsed
}

function divideExact(numerator: ExactDecimal, denominator: ExactDecimal, resultScale: number): ExactDecimal {
  if (denominator.coefficient === BigInt(0)) throw new RangeError('Division by zero')
  const commonDivisor = greatestCommonDivisor(numerator.coefficient, denominator.coefficient)
  let reducedNumerator = numerator.coefficient / commonDivisor
  let reducedDenominator = denominator.coefficient / commonDivisor
  const exponent = resultScale + denominator.scale - numerator.scale

  if (exponent >= 0) {
    const scaled = scaleByPowerOfTenAfterCancellation(reducedNumerator, reducedDenominator, exponent)
    reducedNumerator = scaled.scaled
    reducedDenominator = scaled.opposite
  } else {
    const scaled = scaleByPowerOfTenAfterCancellation(reducedDenominator, reducedNumerator, -exponent)
    reducedDenominator = scaled.scaled
    reducedNumerator = scaled.opposite
  }

  assertCoefficient(reducedNumerator)
  assertCoefficient(reducedDenominator)
  const coefficient = divideHalfUp(reducedNumerator, reducedDenominator)
  assertCoefficient(coefficient)
  return { coefficient, scale: resultScale }
}

function scaleByPowerOfTenAfterCancellation(
  value: bigint,
  opposite: bigint,
  exponent: number,
): { scaled: bigint; opposite: bigint } {
  let reducedOpposite = opposite
  let remainingTwos = exponent
  let remainingFives = exponent
  while (remainingTwos > 0 && reducedOpposite % BigInt(2) === BigInt(0)) {
    reducedOpposite /= BigInt(2)
    remainingTwos -= 1
  }
  while (remainingFives > 0 && reducedOpposite % BigInt(5) === BigInt(0)) {
    reducedOpposite /= BigInt(5)
    remainingFives -= 1
  }

  let scaled = value
  while (remainingTwos > 0) {
    scaled *= BigInt(2)
    assertCoefficient(scaled)
    remainingTwos -= 1
  }
  while (remainingFives > 0) {
    scaled *= BigInt(5)
    assertCoefficient(scaled)
    remainingFives -= 1
  }
  return { scaled, opposite: reducedOpposite }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left
  let b = right
  while (b !== BigInt(0)) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function rescaleExact(value: ExactDecimal, targetScale: number): ExactDecimal {
  if (value.scale > targetScale) return roundToScale(value, targetScale)
  const coefficient = value.coefficient * powerOfTen(targetScale - value.scale)
  assertCoefficient(coefficient)
  return { coefficient, scale: targetScale }
}

function roundToScale(value: ExactDecimal, targetScale: number): ExactDecimal {
  if (value.scale <= targetScale) return rescaleExact(value, targetScale)
  const divisor = powerOfTen(value.scale - targetScale)
  const coefficient = divideHalfUp(value.coefficient, divisor)
  assertCoefficient(coefficient)
  return { coefficient, scale: targetScale }
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  return remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient
}

function compareExact(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const commonScale = Math.max(left.scale, right.scale)
  const leftCoefficient = left.coefficient * powerOfTen(commonScale - left.scale)
  const rightCoefficient = right.coefficient * powerOfTen(commonScale - right.scale)
  assertCoefficient(leftCoefficient)
  assertCoefficient(rightCoefficient)
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0
}

function formatCanonical<D extends DecimalDomain>(value: ExactDecimal, domain: D): CanonicalDecimal<D> {
  const scale = DOMAIN_SCALES[domain]
  if (value.scale !== scale) throw new Error('Internal decimal scale mismatch')
  assertCoefficient(value.coefficient)
  if (domain === 'PROBABILITY' && value.coefficient > powerOfTen(scale)) throw new RangeError('Probability must be within [0,1]')
  const digits = value.coefficient.toString().padStart(scale + 1, '0')
  const text = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  return text as CanonicalDecimal<D>
}

function powerOfTen(power: number): bigint {
  if (!Number.isInteger(power) || power < 0 || power >= POWERS_OF_TEN.length) throw new RangeError('Unsupported decimal scale')
  return POWERS_OF_TEN[power]
}

function assertCoefficient(coefficient: bigint): void {
  const absolute = coefficient < BigInt(0) ? -coefficient : coefficient
  if (absolute > MAX_COEFFICIENT) throw new RangeError('Decimal coefficient exceeds 10^38 - 1')
}
