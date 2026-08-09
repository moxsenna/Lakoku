/**
 * M10-D operational obligation. This is not rubric data and does not enter judge input.
 */
export const D_OPS_1 = Object.freeze({
  recordId: 'D-OPS-1',
  title: 'FAILED_REVIEW_REQUIRED blueprint review workflow',
  status: 'OPEN' as const,
  disposition: 'UNRESOLVED' as const,
  isReclassified: false,
  d1Impact: 'Does not block D1 corpus authoring or calibration work.',
  finalPassGate: 'Blocks final D PASS until status is CLOSED or reviewer-approved RECLASSIFIED.',
  requiredClosure: [
    'Close operational review workflow.',
    'Or obtain reviewer-approved RECLASSIFIED disposition with target recorded.',
  ] as const,
})
