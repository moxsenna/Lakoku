export type AuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type AuditStatus =
  | 'PROVEN_E2E'
  | 'PROVEN_READ_ONLY'
  | 'WRITE_PATH_UNPROVEN'
  | 'CONSUMER_UNPROVEN'
  | 'PARITY_RISK'
  | 'BOUNDED_LOSS_RISK'
  | 'DEAD_PATH_CANDIDATE'
  | 'AMBIGUOUS'

export type EvidenceClass =
  | 'SOURCE_TRACE'
  | 'PURE_CHARACTERIZATION'
  | 'EXISTING_UNIT_TEST'
  | 'EXISTING_DB_TEST'
  | 'SCHEMA_CONTRACT'
  | 'RUNTIME_CONTRACT'

export interface StructuredEvidence {
  source: string
  evidenceClass: EvidenceClass
  observation: string
}

export interface StoryBibleAuditFinding {
  code: string
  severity: AuditSeverity
  domain: string
  status: AuditStatus
  sourceOfTruth: string[]
  producers: string[]
  consumers: string[]
  validators: string[]
  evidence: StructuredEvidence[]
  risk: string
  recommendedFollowUp: string
}

export interface DomainSourceMatrixRow {
  domain: string
  fields: string[]
  sourceOfTruth: string
  createdBy: string[]
  writtenBy: string[]
  readBy: string[]
  promptConsumer: string[]
  validator: string[]
  updateTrigger: string
  persistence: string
  workerPath: string
  legacySyncPath: string
  status: AuditStatus
  evidence: StructuredEvidence[]
}

export type ExecutionStatus = 'SUCCESS' | 'ERROR'
export type AuditVerdict = 'PASS' | 'HOLD'

export interface AuditReportArtifact {
  executionStatus: ExecutionStatus
  auditVerdict: AuditVerdict
  baselineSha: string
  timestamp: string
  summary: {
    blocker: number
    high: number
    medium: number
    low: number
    info: number
    totalFindings: number
  }
  matrix: DomainSourceMatrixRow[]
  findings: StoryBibleAuditFinding[]
}

export interface ContextPressureMilestone {
  chapter: number
  declaredBudget: number
  actualUsed: number
  factsIncluded: number
  factsExcluded: number
  loadBearingIncluded: number
  rollupsIncluded: number
  rollupsExcluded: number
  threadsRetained: number
  timelineRetained: number
  writerLayer3CharLength: number
  detectorsTriggered: string[]
}

export interface ContextPressureReportArtifact {
  executionStatus: ExecutionStatus
  auditVerdict: AuditVerdict
  baselineSha: string
  timestamp: string
  milestones: ContextPressureMilestone[]
  choiceHistoryPressure: {
    chapter: number
    totalChoicesAvailable: number
    visibleChoicesCount: number
    truncatedChoicesCount: number
    duplicatePreviousDetected: boolean
    estimatedTokenPressure: number
    detectorsTriggered: string[]
  }[]
}

export const AUDIT_DOMAINS = [
  'Character',
  'Voice',
  'Facts',
  'Knowledge',
  'Secret',
  'Timeline',
  'Thread',
  'Act Rollup',
  'Blueprint',
  'Story Contract',
  'Reader Route',
  'Choice History',
  'Ending',
  'Plot Debt',
  'Chapter',
  'Checkpoint',
  'Retrieval',
] as const

export type StoryBibleDomain = (typeof AUDIT_DOMAINS)[number]

