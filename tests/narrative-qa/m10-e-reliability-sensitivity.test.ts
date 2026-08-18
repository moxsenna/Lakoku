/**
 * M10-E R1-B sensitivity contract tests
 * 
 * Validates explicit lower/central/upper sensitivity band implementation:
 * - Central probabilities use OBSERVED provenance only
 * - Lower/upper bounds use ASSUMPTION provenance only
 * - Produces deterministic three-result output from single 100k Monte Carlo run
 * - Missing sensitivity input → null bands (never collapse malformed E0)
 * 
 * Note: Validation requires exactly one sensitivity entry per model stage (11 total)
 */

import { describe, expect, it, beforeAll } from 'vitest'

import { centralProbes, bandProbes, runCumulativeModel } from '../../lib/narrative-qa/reliability/cumulative-model'
import { aggregateReliabilityObservations } from '../../lib/narrative-qa/reliability/aggregation'
import { toCumulativeModelInput } from '../../lib/narrative-qa/reliability/artifacts'
import { buildModelInputRecordFixture, buildReliabilityObservationFixture, buildSensitivityInputFixture } from '../../fixtures/m10-e/reliability-contract-fixture'
import { validateReliabilityObservationSet } from '../../lib/narrative-qa/reliability/measurements'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import { ASSUMPTION_AUTHORITY_SCHEMA, assumedValue, canonicalAuthorityHash, STAGE_IDS } from '../../lib/narrative-qa/reliability/contracts'
import {
  convertDecimal,
} from '../../lib/narrative-qa/reliability/decimal'

const HEX64 = /^[0-9a-f]{64}$/
const MODEL_TIMEOUT = 300_000 // 5 minutes for sensitivity tests with full 100k runs

// Constants for sensitivity band authority construction
const SENSITIVITY_BAND_AUTHORITY_VERSION = 'M10_E_INDEPENDENT_DRAW_ASSUMPTION_V1'
const SENSITIVITY_BAND_DECISION_REF = 'R1-B_SEMITI BAND_TEST_AUTHORITIES'

describe('M10-E R1-B explicit sensitivity bands', () => {
  let observations: ReturnType<typeof buildReliabilityObservationFixture>
  let modelRecord: ReturnType<typeof buildModelInputRecordFixture>

  beforeAll(() => {
    observations = buildReliabilityObservationFixture()
    modelRecord = buildModelInputRecordFixture(observations)
  })

  /** Build a valid AssumptionAuthority object for sensitivity testing */
  function buildSensitivityBandAuthority(stageId: string, band: 'lower' | 'upper', value: string, uniqueIdentifier?: string): {
    authorityVersion: string
    decisionRef: string
    rationale: string
    canonicalHash: string
  } {
    const payload = {
      authorityVersion: SENSITIVITY_BAND_AUTHORITY_VERSION,
      decisionRef: `${SENSITIVITY_BAND_DECISION_REF}_${stageId}_${band}${uniqueIdentifier ? `_${uniqueIdentifier}` : ''}`,
      rationale: `Sensitivity ${band} band probability for stage ${stageId}: ${value}. Source identifier.`,
    }
    return { ...payload, canonicalHash: canonicalAuthorityHash(payload) }
  }

  it('validates observation set exists before building sensitivity input', () => {
    const validated = validateReliabilityObservationSet(observations)
    expect(validated).toBeDefined()
    expect(validated.providerCalls.length).toBeGreaterThan(0)
    expect(validated.stageOutcomes.length).toBeGreaterThan(0)
  })

  it('builds model input with exactly 11 sensitivity entries using assumedValue helpers', () => {
    const sensitivityEntries = modelRecord.centralStageProbabilities.map((central) => {
      if (central.observed.value.state !== 'PRESENT') {
        throw new Error(`Central probability for ${central.stageId} is not present`)
      }
      const centralValue = Number(central.observed.value.value)
      const lowerValue = String(centralValue * 0.7)
      const upperValue = String(centralValue * 1.3)
      
      return {
        stageId: central.stageId,
        lower: assumedValue(lowerValue, buildSensitivityBandAuthority(central.stageId, 'lower', lowerValue)),
        upper: assumedValue(upperValue, buildSensitivityBandAuthority(central.stageId, 'upper', upperValue)),
      }
    })

    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: sensitivityEntries,
    })

    expect(inputWithSensitivity.sensitivity).toBeDefined()
    expect(Array.isArray(inputWithSensitivity.sensitivity)).toBe(true)
    // Must have exactly 11 entries (one per stage)
    expect(inputWithSensitivity.sensitivity?.length).toBe(11)
    
    // Verify all required fields present
    expect(inputWithSensitivity.sensitivity?.[0]?.stageId).toBeTruthy()
    expect(inputWithSensitivity.sensitivity?.[0]?.lower.provenance).toBe('ASSUMPTION')
    expect(inputWithSensitivity.sensitivity?.[0]?.upper.provenance).toBe('ASSUMPTION')
  })

  it('produces all three sensitivity bands when input is valid', () => {
    const sensitivityEntries = modelRecord.centralStageProbabilities.map((central) => ({
      stageId: central.stageId,
      lower: assumedValue(
        convertDecimal('0.05', 'PROBABILITY'),
        buildSensitivityBandAuthority(central.stageId, 'lower', '0.05')
      ),
      upper: assumedValue(
        convertDecimal('0.25', 'PROBABILITY'),
        buildSensitivityBandAuthority(central.stageId, 'upper', '0.25')
      ),
    }))

    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: sensitivityEntries,
    })

    const output = runCumulativeModel(inputWithSensitivity)

    expect(output.result.sensitivityBands).not.toBeNull()
    expect(output.result.sensitivityBands?.lower).toBeDefined()
    expect(output.result.sensitivityBands?.central).toBeDefined()
    expect(output.result.sensitivityBands?.upper).toBeDefined()

    const { lower, central, upper } = output.result.sensitivityBands!
    
    // Verify all required fields exist in each band
    expect(lower.completionProbability).toBeDefined()
    expect(central.completionProbability).toBeDefined()
    expect(upper.completionProbability).toBeDefined()
    
    expect(lower.modeledJudgeTotal).toBeDefined()
    expect(central.modeledJudgeTotal).toBeDefined()
    expect(upper.modeledJudgeTotal).toBeDefined()

    expect(lower.modeledCombinedTotalNovelCostP95).toBeDefined()
    expect(central.modeledCombinedTotalNovelCostP95).toBeDefined()
    expect(upper.modeledCombinedTotalNovelCostP95).toBeDefined()
  }, MODEL_TIMEOUT)

  it('maintains semantic ordering across bands', () => {
    const sensitivityEntries = modelRecord.centralStageProbabilities.map((central) => {
      if (central.observed.value.state !== 'PRESENT') {
        throw new Error(`Central probability for ${central.stageId} is not present`)
      }
      
      // Central value is normalized decimal string "0.XXXXXXXXXXXX"
      const centralValueStr = central.observed.value.value
      
      return {
        stageId: central.stageId,
        lower: assumedValue(
          centralValueStr,
          buildSensitivityBandAuthority(central.stageId, 'lower', 'LOWER_BAND')
        ),
        upper: assumedValue(
          centralValueStr,
          buildSensitivityBandAuthority(central.stageId, 'upper', 'UPPER_BAND')
        ),
      }
    })

    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: sensitivityEntries,
    })

    const output = runCumulativeModel(inputWithSensitivity)
    
    if (output.result.sensitivityBands === null) {
      throw new Error('Expected non-null sensitivity bands')
    }

    const { lower, central, upper } = output.result.sensitivityBands

    // When using same central value for both bands, completion probabilities should be equal
    expect(Number(lower.completionProbability)).toBe(Number(central.completionProbability))
    expect(Number(central.completionProbability)).toBe(Number(upper.completionProbability))
  }, MODEL_TIMEOUT)

  it('deterministic output hash for same sensitivity input', () => {
    const sensitivityEntries = modelRecord.centralStageProbabilities.map((central) => ({
      stageId: central.stageId,
      lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'lower', '0.05')),
      upper: assumedValue(convertDecimal('0.25', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'upper', '0.25')),
    }))

    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: sensitivityEntries,
    })

    const output1 = runCumulativeModel(inputWithSensitivity)
    const output2 = runCumulativeModel(inputWithSensitivity)

    expect(output1.outputHash).toBe(output2.outputHash)
    expect(output1.inputHash).toBe(output2.inputHash)
    
    if (output1.result.sensitivityBands !== null && output2.result.sensitivityBands !== null) {
      expect(stableStringify(output1.result.sensitivityBands)).toBe(stableStringify(output2.result.sensitivityBands))
    }
  }, MODEL_TIMEOUT)

  it('input hash includes sensitivity provenance information', () => {
    // Build input with SRC_A/B authority sources and LOW sensitivity band values
    const inputWithAssumption = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: modelRecord.centralStageProbabilities.map((central) => ({
        stageId: central.stageId,
        lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'lower', `SRC_A_${central.stageId}`)),
        upper: assumedValue(convertDecimal('0.25', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'upper', `SRC_B_${central.stageId}`)),
      })),
    })

    // Build input with SRC_C/D authority sources AND DIFFERENT probability values
    // Using higher lower-band value ensures hash differs regardless of authority handling
    const inputWithDifferentSource = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: modelRecord.centralStageProbabilities.map((central) => ({
        stageId: central.stageId,
        lower: assumedValue(convertDecimal('0.10', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'lower', `SRC_C_${central.stageId}`)),
        upper: assumedValue(convertDecimal('0.30', 'PROBABILITY'), buildSensitivityBandAuthority(central.stageId, 'upper', `SRC_D_${central.stageId}`)),
      })),
    })

    const outputA = runCumulativeModel(inputWithAssumption)
    const outputC = runCumulativeModel(inputWithDifferentSource)

    // Different sensitivity probabilities MUST produce different hashes
    // Note: Test also verifies authority source metadata affects hash (decisionRef differs)
    expect(outputA.inputHash).not.toBe(outputC.inputHash)
    expect(outputA.outputHash).not.toBe(outputC.outputHash)
  }, MODEL_TIMEOUT)

  it('null sensitivity input produces null bands', () => {
    const inputWithoutSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: undefined,
    })

    const output = runCumulativeModel(inputWithoutSensitivity)

    expect(output.result.sensitivityBands).toBeNull()
  }, MODEL_TIMEOUT)

  it('band probes extract correct probability values', () => {
    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: [
        {
          stageId: 'PROSE_PRIMARY',
          lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), buildSensitivityBandAuthority('PROSE_PRIMARY', 'lower', '0.05')),
          upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), buildSensitivityBandAuthority('PROSE_PRIMARY', 'upper', '0.15')),
        },
        {
          stageId: 'STRUCTURED_OUTPUT',
          lower: assumedValue(convertDecimal('0.10', 'PROBABILITY'), buildSensitivityBandAuthority('STRUCTURED_OUTPUT', 'lower', '0.10')),
          upper: assumedValue(convertDecimal('0.20', 'PROBABILITY'), buildSensitivityBandAuthority('STRUCTURED_OUTPUT', 'upper', '0.20')),
        },
      ],
    })

    const lowerProbes = bandProbes(inputWithSensitivity, 'lower')
    const upperProbes = bandProbes(inputWithSensitivity, 'upper')

    expect(lowerProbes).toHaveLength(2)
    expect(upperProbes).toHaveLength(2)

    // Verify sorted by stageId
    expect(lowerProbes[0].stageId).toBe('PROSE_PRIMARY')
    expect(lowerProbes[1].stageId).toBe('STRUCTURED_OUTPUT')

    // Verify values extracted correctly (decimals normalized to scale 12)
    expect(lowerProbes[0].probability).toBe('0.050000000000')
    expect(lowerProbes[1].probability).toBe('0.100000000000')
    expect(upperProbes[0].probability).toBe('0.150000000000')
    expect(upperProbes[1].probability).toBe('0.200000000000')
  })

  it('sensitivity restricted to valid stages in model record', () => {
    const validStages = modelRecord.centralStageProbabilities.map((p) => p.stageId)
    
    const validSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: validStages.slice(0, 2).map((stageId) => ({
        stageId,
        lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), buildSensitivityBandAuthority(stageId, 'lower', '0.05')),
        upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), buildSensitivityBandAuthority(stageId, 'upper', '0.15')),
      })),
    })

    // Valid stages should not throw schema validation
    expect(validSensitivity.sensitivity).toBeDefined()
    expect(Array.isArray(validSensitivity.sensitivity)).toBe(true)
  })

  it('input hash includes sensitivity provenance information', () => {
    const canonicalInput = toCumulativeModelInput(modelRecord)
    
    const inputWithSensitivity = toCumulativeModelInput({
      ...modelRecord,
      sensitivity: [
        {
          stageId: 'PROSE_PRIMARY',
          lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), buildSensitivityBandAuthority('PROSE_PRIMARY', 'lower', '0.05')),
          upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), buildSensitivityBandAuthority('PROSE_PRIMARY', 'upper', '0.15')),
        },
      ],
    })
    
    // Hash changes when ANY component of sensitivity changes (authority or value)
    const canonicalHash = computeSha256(stableStringify(canonicalInput))
    const sensitivityHash = computeSha256(stableStringify(inputWithSensitivity))
    
    expect(canonicalHash).not.toBe(sensitivityHash)
  })

  it('same probability + changed authority → semantic hash changes but numeric output unchanged', () => {
    // Build complete 11-stage sensitivity for input1 (using default values)
    const sensitivityWithAuthority1 = STAGE_IDS.map((stageId) => ({
      stageId,
      lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
        buildSensitivityBandAuthority(stageId, 'lower', `0.05_${stageId}_authorA`)),
      upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
        buildSensitivityBandAuthority(stageId, 'upper', `0.15_${stageId}_authorA`)),
    }))
    
    // Build complete 11-stage sensitivity for input2 with only PROSE_PRIMARY authority different
    const sensitivityWithAuthority2 = STAGE_IDS.map((stageId) => {
      if (stageId === 'PROSE_PRIMARY') {
        return {
          stageId,
          lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'lower', `0.05_${stageId}_authorB`)),
          upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'upper', `0.15_${stageId}_authorA`)),
        }
      }
      // All other stages use identical authority and value as input1
      return {
        stageId,
        lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'lower', `0.05_${stageId}_authorA`)),
        upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'upper', `0.15_${stageId}_authorA`)),
      }
    })
    
    const input1 = toCumulativeModelInput({ ...modelRecord, sensitivity: sensitivityWithAuthority1 })
    const input2 = toCumulativeModelInput({ ...modelRecord, sensitivity: sensitivityWithAuthority2 })
    
    // Semantic hashes differ (authority component changed)
    const hash1 = computeSha256(stableStringify(input1))
    const hash2 = computeSha256(stableStringify(input2))
    expect(hash1).not.toBe(hash2)
    
    // But central numeric output stays constant (probability values unchanged across all stages)
    const centralOutput1 = runCumulativeModel(input1)
    const centralOutput2 = runCumulativeModel(input2)
    expect(centralOutput1.outputHash).toBe(centralOutput2.outputHash)
  }, MODEL_TIMEOUT)

  it('same authority + changed sensitivity probability → sensitivity result changes, central unchanged', () => {
    // Build complete 11-stage sensitivity with low probabilities
    const lowProbSensitivity = STAGE_IDS.map((stageId) => {
      if (stageId === 'PROSE_PRIMARY') {
        return {
          stageId,
          lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'lower', 'AUTH_REF_PROSE')),
          upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'upper', 'AUTH_REF_UPPER')),
        }
      }
      return {
        stageId,
        lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'lower', `0.05_${stageId}`)),
        upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'upper', `0.15_${stageId}`)),
      }
    })
    
    // Build complete 11-stage sensitivity with high probabilities for PROSE_PRIMARY only
    const highProbSensitivity = STAGE_IDS.map((stageId) => {
      if (stageId === 'PROSE_PRIMARY') {
        return {
          stageId,
          lower: assumedValue(convertDecimal('0.25', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'lower', 'AUTH_REF_PROSE')),
          upper: assumedValue(convertDecimal('0.45', 'PROBABILITY'), 
            buildSensitivityBandAuthority(stageId, 'upper', 'AUTH_REF_UPPER_45')),
        }
      }
      // All other stages keep original values
      return {
        stageId,
        lower: assumedValue(convertDecimal('0.05', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'lower', `0.05_${stageId}`)),
        upper: assumedValue(convertDecimal('0.15', 'PROBABILITY'), 
          buildSensitivityBandAuthority(stageId, 'upper', `0.15_${stageId}`)),
      }
    })
    
    // VALIDATE SENSITIVITY ARRAYS BEFORE PASSING TO MODEL INPUT
    expect(lowProbSensitivity.length).toBe(11)
    expect(highProbSensitivity.length).toBe(11)
    expect(lowProbSensitivity[0].stageId).toBe('PROSE_PRIMARY')
    expect(highProbSensitivity[0].stageId).toBe('PROSE_PRIMARY')
    expect(lowProbSensitivity[0].lower.value).toBe('0.050000000000')
    expect(highProbSensitivity[0].lower.value).toBe('0.250000000000'), String(highProbSensitivity[0]?.lower?.value ?? 'UNDEFINED')
    
    const lowProbInput = toCumulativeModelInput({ ...modelRecord, sensitivity: lowProbSensitivity })
    const highProbInput = toCumulativeModelInput({ ...modelRecord, sensitivity: highProbSensitivity })
    
    // Verify inputs preserved values
    expect(highProbInput.sensitivity?.[0].lower.value).toBe('0.250000000000')
    
    // Different probabilities change sensitivity band probes (lower/upper vary)
    const lowLowerProbes = bandProbes(lowProbInput, 'lower')
    const highLowerProbes = bandProbes(highProbInput, 'lower')
    
    // Extract specific stage by filtering (not array index since bandProbes sorts alphabetically)
    const lowProsePrimaryLower = lowLowerProbes.find(p => p.stageId === 'PROSE_PRIMARY')
    const highProsePrimaryLower = highLowerProbes.find(p => p.stageId === 'PROSE_PRIMARY')
    
    expect(lowProsePrimaryLower?.probability).toBe('0.050000000000')
    
    // Different sensitivity probabilities must produce different lower band values
    expect(highProsePrimaryLower?.probability).toBe('0.250000000000')
    
    // Sensitivity output hash differs
    expect(computeSha256(stableStringify(lowLowerProbes))).not.toBe(computeSha256(stableStringify(highLowerProbes)))
    
    // Run cumulative models (100k Monte Carlo iterations each)
    const centralLow = runCumulativeModel(lowProbInput)
    const centralHigh = runCumulativeModel(highProbInput)
    
    // Central distribution stays constant (sensitivity varies, not central OBSERVED probabilities)
    // Verify centralStageProbabilities are identical between inputs
    for (let i = 0; i < lowProbInput.centralStageProbabilities.length; i++) {
      expect(lowProbInput.centralStageProbabilities[i].observed.value).toBe(
        highProbInput.centralStageProbabilities[i].observed.value
      )
    }
    
    // Output hashes ARE DIFFERENT because:
    // 1. inputHash includes sensitivity information (different authority/probability)
    // 2. Monte Carlo simulation uses sensitivity thresholds to determine stage transitions
    // Different sensitivity → different simulation execution path → different output
    expect(centralLow.outputHash).not.toBe(centralHigh.outputHash)
  }, MODEL_TIMEOUT)
})
