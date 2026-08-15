import { describe, expect, it } from 'vitest'
import {
  addDecimals,
  canonicalizeDecimal,
  compareDecimals,
  decimalMean,
  divideDecimals,
  convertDecimal,
  failureProbabilityThreshold,
  multiplyDecimals,
  parseDecimal,
  percentileCont,
  percentageOf,
  ratioOf,
  subtractDecimals,
  sumDecimals,
} from '../../lib/narrative-qa/reliability'

const money = (value: string) => canonicalizeDecimal(value, 'MONEY')
const latency = (value: string) => canonicalizeDecimal(value, 'LATENCY_MILLISECONDS')

describe('M10-E exact decimal authority', () => {
  it('canonicalizes domains with fixed scales and HALF_UP boundaries', () => {
    expect(money('1.2')).toBe('1.20000000')
    expect(convertDecimal('1.234567895', 'MONEY')).toBe('1.23456790')
    expect(convertDecimal('12.3455', 'LATENCY_MILLISECONDS')).toBe('12.346')
    expect(canonicalizeDecimal('0', 'MONEY')).toBe('0.00000000')
    expect(canonicalizeDecimal('0', 'PROBABILITY')).toBe('0.000000000000')
    expect(canonicalizeDecimal('0', 'PERCENTAGE')).toBe('0.000000')
    expect(canonicalizeDecimal('0', 'LATENCY_MILLISECONDS')).toBe('0.000')
    expect(() => money('1.000000001')).toThrow()
  })

  it.each(['-1', '+1', '01', '.5', '1.', '1e2', 'NaN', 'Infinity'])('rejects invalid input %s', (value) => {
    expect(() => parseDecimal(value, 'MONEY')).toThrow()
  })

  it('enforces probability range and coefficient cap', () => {
    expect(canonicalizeDecimal('1', 'PROBABILITY')).toBe('1.000000000000')
    expect(() => canonicalizeDecimal('1.000000000001', 'PROBABILITY')).toThrow()
    expect(() => canonicalizeDecimal('2', 'PROBABILITY')).toThrow()
    expect(canonicalizeDecimal('999999999999999999999999999999.99999999', 'MONEY')).toBe('999999999999999999999999999999.99999999')
    expect(() => canonicalizeDecimal('1000000000000000000000000000000', 'MONEY')).toThrow()
  })

  it('compares, adds, subtracts, multiplies, divides, sums, ratios, percentages, and means exactly', () => {
    expect(compareDecimals(money('1'), money('1.00000000'), 'MONEY')).toBe(0)
    expect(addDecimals(money('1.1'), money('2.2'), 'MONEY')).toBe('3.30000000')
    expect(subtractDecimals(money('3'), money('1.25'), 'MONEY')).toBe('1.75000000')
    expect(() => subtractDecimals(money('1'), money('2'), 'MONEY')).toThrow()
    expect(multiplyDecimals(money('1.25'), money('2'), 'MONEY')).toBe('2.50000000')
    expect(divideDecimals(money('1'), money('8'), 'MONEY')).toBe('0.12500000')
    expect(() => divideDecimals(money('1'), money('0'), 'MONEY')).toThrow()
    expect(sumDecimals([money('0.004'), money('0.004'), money('0.004')], 'MONEY')).toBe('0.01200000')
    expect(ratioOf('1', '3')).toBe('0.333333333333')
    expect(percentageOf('1', '8')).toBe('12.500000')
    expect(decimalMean([money('1'), money('2'), money('2')], 'MONEY')).toBe('1.66666667')
  })

  it('uses percentile_cont interpolation, not nearest rank', () => {
    expect(percentileCont([money('7')], '0.95', 'MONEY')).toEqual({ state: 'PRESENT', value: money('7') })
    expect(percentileCont([money('1'), money('2'), money('3')], '0.50', 'MONEY')).toEqual({ state: 'PRESENT', value: money('2') })
    expect(percentileCont([money('1'), money('3')], '0.50', 'MONEY')).toEqual({ state: 'PRESENT', value: money('2') })
    expect(percentileCont([money('0'), money('10')], '0.95', 'MONEY')).toEqual({ state: 'PRESENT', value: money('9.5') })
    expect(percentileCont([latency('1'), latency('3')], '0.50', 'LATENCY_MILLISECONDS')).toEqual({ state: 'PRESENT', value: latency('2') })
    expect(percentileCont([], '0.95', 'MONEY')).toMatchObject({ state: 'MISSING' })
  })

  it('converts exact probability thresholds at uint32 boundaries', () => {
    expect(failureProbabilityThreshold('0.000000000000')).toBe(BigInt(0))
    expect(failureProbabilityThreshold('1.000000000000')).toBe(BigInt(4294967296))
    expect(failureProbabilityThreshold('0.000000000233')).toBe(BigInt(1))
    expect(failureProbabilityThreshold('0.999999999999')).toBe(BigInt(4294967295))
  })

  it('rejects binary floats and mixed domain scale', () => {
    expect(() => Reflect.apply(canonicalizeDecimal, undefined, [0.1, 'MONEY'])).toThrow()
    expect(() => addDecimals(money('1'), canonicalizeDecimal('1', 'PROBABILITY'), 'MONEY')).toThrow()
    expect(() => Reflect.apply(multiplyDecimals, undefined, ['999999999999999999999999999999.99999999', money('2'), 'MONEY'])).toThrow()
  })
})
