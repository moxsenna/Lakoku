/**
 * Regression test: GATE_REASON_CODES must match ENGINEERING_GATE_DEFECT_REASONS + HOLD reasons.
 * 
 * This prevents drift between TypeScript types (EngineeringGateReason union) and Zod runtime schema.
 * Previously, EngineeringGateReason included reasons not in GATE_REASON_CODES, causing runtime validation errors.
 */
import { describe, it, expect } from 'vitest'
import { GATE_REASON_CODES } from '../../lib/narrative-qa/reliability/contracts'
import { ENGINEERING_GATE_DEFECT_REASONS, ENGINEERING_GATE_HOLD_REASONS } from '../../lib/narrative-qa/reliability/gate'

describe('M10-E Gate Reason Codes Parity', () => {
  it('GATE_REASON_CODES contains all ENGINEERING_GATE_DEFECT_REASONS', () => {
    const defectSet = new Set(ENGINEERING_GATE_DEFECT_REASONS)
    const gateCodesSet = new Set(GATE_REASON_CODES)
    
    for (const reason of ENGINEERING_GATE_DEFECT_REASONS) {
      expect(gateCodesSet).toContain(reason)
    }
    
    // Verify no missing codes (but allow extra codes in schema for future expansion)
    const missingFromGate = Array.from(defectSet).filter(code => !gateCodesSet.has(code))
    expect(missingFromGate).toHaveLength(0)
  })

  it('GATE_REASON_CODES contains all ENGINEERING_GATE_HOLD_REASONS', () => {
    const holdSet = new Set(ENGINEERING_GATE_HOLD_REASONS)
    const gateCodesSet = new Set(GATE_REASON_CODES)
    
    for (const reason of ENGINEERING_GATE_HOLD_REASONS) {
      expect(gateCodesSet).toContain(reason)
    }
    
    // Verify completeness
    const missingFromGate = Array.from(holdSet).filter(code => !gateCodesSet.has(code))
    expect(missingFromGate).toHaveLength(0)
  })

  it('EngineeringGateReason type exactly matches union of DefectReason and HoldReason', () => {
    // Runtime verification using JSON stringification as proxy for enum coverage
    const allReasons = [...ENGINEERING_GATE_DEFECT_REASONS, ...ENGINEERING_GATE_HOLD_REASONS]
    const gateCodesSet = new Set(GATE_REASON_CODES)
    
    // Check each reason is valid
    for (const reason of allReasons) {
      expect(gateCodesSet).toContain(reason)
    }
    
    // No extraneous codes in GATE_REASON_CODES beyond the union
    const extra = Array.from(gateCodesSet).filter(code => 
      !allReasons.includes(code as any)
    )
    expect(extra).toHaveLength(0), `Extraneous codes in GATE_REASON_CODES: ${extra.join(', ')}`
  })
})
