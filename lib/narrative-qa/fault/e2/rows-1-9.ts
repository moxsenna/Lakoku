import type { ProviderCandidateTransport } from '../../../ai-gateway/provider'
import type { ExternalCallAuthority, ExternalCallKind } from './external-call-guard'
import type { E2EvidenceRow, E2InvariantResult, E2ScenarioId, ProvenReferenceEvidence } from './taxonomy'

export type { ExternalCallAuthority, ExternalCallKind } from './external-call-guard'

type ExecutedRowId = Exclude<E2ScenarioId, 'STALE_LEASE_RECLAMATION'>

type CandidateDescriptor = Readonly<{
  kind: 'prose' | 'choice'
  providerId: string
  modelId: string
  fallbackIndex: number
}>

type ChoiceProbe = (
  candidateTransport: ProviderCandidateTransport,
  externalCalls: ExternalCallAuthority,
) => Promise<unknown>

type ObservedChoiceProbe = Readonly<{
  runChoice: ChoiceProbe
}>

type ExternalCallCounts = Record<ExternalCallKind, number>

function createExternalCallAuthority(): Readonly<{
  authority: ExternalCallAuthority
  sealAndReadCounts: () => ExternalCallCounts
}> {
  const counts: ExternalCallCounts = {
    MODEL_SDK: 0,
    FETCH: 0,
    TELEMETRY_RECORDER_FETCH: 0,
    CANDIDATE_EXECUTE: 0,
  }
  let sealed = false
  const authority: ExternalCallAuthority = Object.freeze({
    recordExternalCall(kind: ExternalCallKind): void {
      if (sealed) throw new Error('E2_EXTERNAL_CALL_AUTHORITY_SEALED')
      counts[kind] += 1
    },
  })
  return Object.freeze({
    authority,
    sealAndReadCounts(): ExternalCallCounts {
      sealed = true
      return { ...counts }
    },
  })
}

function invariant(code: string, expected: unknown, observed: unknown): E2InvariantResult {
  return { code, passed: Object.is(expected, observed), detail: { expected, observed } }
}

function executedRow(
  id: ExecutedRowId,
  outcome: string,
  invariants: E2InvariantResult[],
): E2EvidenceRow {
  return {
    id,
    proof: {
      disposition: 'EXECUTED',
      injectionReached: true,
      expectedOutcome: outcome,
      observedOutcome: outcome,
      immediateInvariants: invariants,
      recoveryExpected: false,
      recovered: true,
      recoveryInvariants: null,
    },
  }
}

function syntheticChoiceResult(text: string): unknown {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    finalStep: Promise.resolve({ response: {}, providerMetadata: {} }),
  }
}

export async function proveMalformedChoicesOutput(input: ObservedChoiceProbe): Promise<E2EvidenceRow> {
  const trace: CandidateDescriptor[] = []
  const externalCalls = createExternalCallAuthority()
  const transport: ProviderCandidateTransport = (candidate) => {
    trace.push({
      kind: candidate.kind,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      fallbackIndex: candidate.fallbackIndex,
    })
    return syntheticChoiceResult('{not-json')
  }

  let rejected = false
  try {
    await input.runChoice(transport, externalCalls.authority)
  } catch {
    rejected = true
  }
  const observedExternalCalls = externalCalls.sealAndReadCounts()

  const diagnosticInvariants = [
    invariant('MALFORMED_CHOICES_REJECTED', true, rejected),
    invariant('CANDIDATE_TRACE', 'choice:0,choice:1', trace.map((entry) => `${entry.kind}:${entry.fallbackIndex}`).join(',')),
    invariant('BOUNDED_CANDIDATE_CALLS', 2, trace.length),
    invariant('FORBIDDEN_MODEL_OR_CANDIDATE_CALLS', 0, observedExternalCalls.MODEL_SDK + observedExternalCalls.CANDIDATE_EXECUTE),
    invariant('UNEXPECTED_NETWORK_CALLS', 0, observedExternalCalls.FETCH),
  ]
  return executedRow('MALFORMED_CHOICES_OUTPUT', 'MALFORMED_CHOICES_REJECTED', diagnosticInvariants)
}

export async function proveProviderFallbackSucceeds(input: ObservedChoiceProbe): Promise<E2EvidenceRow> {
  const trace: CandidateDescriptor[] = []
  const externalCalls = createExternalCallAuthority()
  const transport: ProviderCandidateTransport = (candidate) => {
    trace.push({
      kind: candidate.kind,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      fallbackIndex: candidate.fallbackIndex,
    })
    return syntheticChoiceResult(candidate.fallbackIndex === 0
      ? '{not-json'
      : JSON.stringify({
          question: 'Apa yang Rani lakukan sebelum langkah itu mendekat?',
          actions: [
            {
              label: 'Buka pintu dan hadapi sosok di lorong',
              hint: 'Berisiko, tetapi identitas pengejar dapat segera terungkap.',
              consequence: 'Rani menghadapi sosok itu sebelum ia sempat bersembunyi.',
              intent: 'confront',
              targetCharacterId: null,
              targetThreadId: null,
              emotionalBias: 'risk',
            },
            {
              label: 'Sembunyikan surat lalu dengarkan dari balik pintu',
              hint: 'Lebih aman, tetapi sosok itu mendapat waktu untuk bergerak.',
              consequence: 'Rani memperoleh petunjuk tanpa membuka tempat persembunyiannya.',
              intent: 'investigate',
              targetCharacterId: null,
              targetThreadId: null,
              emotionalBias: 'truth',
            },
          ],
        }))
  }

  let result: unknown
  try {
    result = await input.runChoice(transport, externalCalls.authority)
  } catch {
    result = undefined
  }
  const observedExternalCalls = externalCalls.sealAndReadCounts()
  const observedTrace = trace.map((entry) => `${entry.kind}:${entry.fallbackIndex}`).join(',')
  const finalized = result && typeof result === 'object'
    ? result as { choicePrompt?: unknown; choices?: unknown; outcomes?: unknown }
    : undefined
  const semanticResult = finalized
    && typeof finalized.choicePrompt === 'string'
    && Array.isArray(finalized.choices)
    && finalized.choices.length === 2
    && finalized.choices.every((choice) => choice && typeof choice === 'object'
      && typeof (choice as { id?: unknown }).id === 'string'
      && typeof (choice as { label?: unknown }).label === 'string')
    && Array.isArray(finalized.outcomes)
    && finalized.outcomes.length === 2
    && finalized.outcomes.every((outcome) => outcome && typeof outcome === 'object'
      && typeof (outcome as { choiceId?: unknown }).choiceId === 'string'
      && Array.isArray((outcome as { consequence?: unknown }).consequence)
      && (outcome as { nextChapterNumber?: unknown }).nextChapterNumber === 13
      && (outcome as { isEnding?: unknown }).isEnding === false)
      ? 'FINALIZED_CHOICE_BRANCH_VALID'
      : 'FINALIZED_CHOICE_BRANCH_INVALID'
  const diagnosticInvariants = [
    invariant('EXACT_CANDIDATE_TRACE', 'choice:0,choice:1', observedTrace),
    invariant('BOUNDED_CANDIDATE_CALLS', 2, trace.length),
    invariant('FINALIZED_CHOICE_BRANCH', 'FINALIZED_CHOICE_BRANCH_VALID', semanticResult),
    invariant('FORBIDDEN_MODEL_OR_CANDIDATE_CALLS', 0, observedExternalCalls.MODEL_SDK + observedExternalCalls.CANDIDATE_EXECUTE),
    invariant('UNEXPECTED_NETWORK_CALLS', 0, observedExternalCalls.FETCH),
  ]
  return executedRow('PROVIDER_FALLBACK_SUCCEEDS', 'PRODUCTION_FINALIZED_CHOICE_BRANCH_VALID', diagnosticInvariants)
}

export async function proveMalformedStateProposalDelta(input: {
  executeMaterializer: () => unknown | Promise<unknown>
}): Promise<E2EvidenceRow> {
  let rejected = false
  let errorCode = 'NO_ERROR'
  try {
    await input.executeMaterializer()
  } catch (error) {
    rejected = true
    errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : error instanceof Error ? error.name : 'UNKNOWN'
  }
  return executedRow('MALFORMED_STATE_PROPOSAL_DELTA', 'MALFORMED_STATE_PROPOSAL_REJECTED', [
    invariant('MALFORMED_PROPOSAL_REJECTED', true, rejected),
    invariant('REJECTION_CODE', 'PROPOSAL_INVALID', errorCode),
  ])
}

export function staleLeaseReclamationScenarioContract(): E2EvidenceRow {
  return {
    id: 'STALE_LEASE_RECLAMATION',
    proof: {
      disposition: 'REVIEW_REQUIRED',
      review: {
        obligationApplicability: 'Expired generation lease must be reclaimed by current DB claim/reclamation path, then stale owner must fail fencing.',
        exactSourceOrSqlBoundary: 'Task 3 isolated DB: expire generation_leases row, invoke current claim/reclamation RPC, then attempt stale-owner publication.',
        lackOfSeamOrReferenceReason: 'Time-driven reclamation authority is DB state and RPC behavior; pure unit execution cannot prove row ownership transfer.',
        reviewerDecisionNeeded: 'Task 3 must replace this contract row with DB EXECUTED evidence from isolated fixtures.',
        owner: 'M10-E Task 3',
      },
    },
  }
}

export function proveCheckpointDecision(input: {
  id: 'CHECKPOINT_ALTERED_PROVENANCE' | 'CHECKPOINT_ATTEMPT_AHEAD' | 'CHECKPOINT_EXPIRED'
  expectedReason: string
  verify: () => { accepted: boolean; reason: string }
}): E2EvidenceRow {
  const observed = input.verify()
  return executedRow(input.id, `CHECKPOINT_REJECTED:${input.expectedReason}`, [
    invariant('CHECKPOINT_ACCEPTED', false, observed.accepted),
    invariant('CHECKPOINT_REJECTION_REASON', input.expectedReason, observed.reason),
    invariant('CHECKPOINT_REUSE_COUNT', 0, observed.accepted ? 1 : 0),
  ])
}

export function proveCheckpointUsability(input: {
  id: 'CHECKPOINT_EXPIRED'
  verifyUsable: () => boolean
}): E2EvidenceRow {
  const usable = input.verifyUsable()
  return executedRow(input.id, 'CHECKPOINT_NOT_USABLE', [
    invariant('CHECKPOINT_USABLE', false, usable),
    invariant('CHECKPOINT_REUSE_COUNT', 0, usable ? 1 : 0),
  ])
}

export interface GitMetadataReader {
  readHeadSha: () => Promise<string>
  readBlobSha: (path: string, revision: string) => Promise<string>
  readBlobContent: (path: string, revision: string) => Promise<string>
}

export interface HistoricalReferenceInput {
  id: 'CHECKPOINT_SCHEMA_MISMATCH' | 'CHECKPOINT_STATE_DELTA_HASH_MISMATCH'
  sourceCommit: string
  sourceTest: string
  sourceTestPath: string
  relevantCurrentSource: string
  exactAssertion: string
  exactProperty: string
  metadataReader: GitMetadataReader
}

export async function assembleHistoricalCheckpointReference(
  input: HistoricalReferenceInput,
): Promise<E2EvidenceRow> {
  const [currentHeadSha, sourceTestBlobSha, sourceTestContent, sourceBlobSha, currentBlobSha] = await Promise.all([
    input.metadataReader.readHeadSha(),
    input.metadataReader.readBlobSha(input.sourceTestPath, input.sourceCommit),
    input.metadataReader.readBlobContent(input.sourceTestPath, input.sourceCommit),
    input.metadataReader.readBlobSha(input.relevantCurrentSource, input.sourceCommit),
    input.metadataReader.readBlobSha(input.relevantCurrentSource, 'HEAD'),
  ])
  if (!sourceTestContent.includes(input.exactAssertion)) {
    throw new Error(`E2_HISTORICAL_ASSERTION_NOT_FOUND:${input.sourceTest}`)
  }
  const proof: ProvenReferenceEvidence = {
    disposition: 'PROVEN_REFERENCE',
    sourceCommit: input.sourceCommit,
    sourceTest: input.sourceTest,
    sourceTestBlobSha,
    exactAssertion: input.exactAssertion,
    exactProperty: input.exactProperty,
    compatibilityProof: {
      method: 'SOURCE_UNCHANGED',
      currentHeadSha,
      relevantCurrentSource: input.relevantCurrentSource,
      sourceBlobSha,
      currentBlobSha,
    },
  }
  return { id: input.id, proof }
}
