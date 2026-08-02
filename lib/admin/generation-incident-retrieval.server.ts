import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  decryptChoiceLexicalEvidence,
  type EncryptedChoiceLexicalEvidence,
} from '@/lib/observability/choice-invalid-capture-crypto.server'
import { loadChoiceInvalidCaptureDecryptConfig } from '@/lib/observability/choice-invalid-capture-config.server'

export const GenerationIncidentLookupSchema = z.object({
  captureId: z.string().uuid(),
  correlationId: z.string().uuid(),
}).strict()

const EncryptedIncidentRowSchema = z.object({
  capture_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  incident_key: z.string().min(43).max(128),
  label_fingerprint: z.string().min(40).max(128),
  version: z.number().int().positive(),
  story_id: z.string().min(1).max(200),
  chapter_number: z.number().int().min(1).max(50),
  choice_index: z.number().int().min(0).max(31),
  stage: z.literal('FINAL_BRANCH_SCHEMA'),
  code: z.literal('CHOICE_NOT_ACTIONABLE'),
  expires_at: z.string().datetime({ offset: true }),
  ciphertext: z.string().min(1).max(4096),
  nonce: z.string().min(16).max(32),
  auth_tag: z.string().min(16).max(64),
}).strict()

const ClaimedIncidentRowSchema = EncryptedIncidentRowSchema.extend({
  claim_expires_at: z.string().datetime({ offset: true }),
}).strict()

export type EncryptedGenerationIncident = z.infer<typeof EncryptedIncidentRowSchema>

export interface GenerationIncidentDecryptor {
  decryptLabel: (incident: EncryptedGenerationIncident) => Promise<string>
}

export type RetrievalStage =
  | 'CLAIM'
  | 'ROW_SCHEMA'
  | 'DECRYPT_CONFIG'
  | 'DECRYPT'
  | 'FINALIZE'
  | 'RELEASE'

export type RetrievalOutcome =
  | 'SUCCESS'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'

export type GenerationIncidentRetrievalTelemetry = (event: Readonly<{
  stage: RetrievalStage
  outcome: RetrievalOutcome
}>) => void

type IncidentRpcName =
  | 'claim_generation_incident_v1'
  | 'finalize_generation_incident_v1'
  | 'release_generation_incident_claim_v1'

type IncidentLookupRpcArgs = {
  p_capture_id: string
  p_correlation_id: string
}

type IncidentClaimMutationRpcArgs = IncidentLookupRpcArgs & {
  p_claim_token: string
}

type IncidentRpcClient = {
  rpc: (
    name: IncidentRpcName,
    args: IncidentLookupRpcArgs | IncidentClaimMutationRpcArgs,
  ) => Promise<{ data: unknown; error: unknown }>
}

export type GenerationIncidentRetrievalResult =
  | { status: 'found'; label: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'unavailable' }

const defaultTelemetry: GenerationIncidentRetrievalTelemetry = (event) => {
  console.info('generation_incident_retrieval_stage', event)
}

function emitTelemetry(
  telemetry: GenerationIncidentRetrievalTelemetry,
  stage: RetrievalStage,
  outcome: RetrievalOutcome,
): void {
  try {
    telemetry({ stage, outcome })
  } catch {
    // Telemetry must never alter one-time evidence retrieval behavior.
  }
}

function isOwnerRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; details?: unknown; code?: unknown }
  return candidate.message === 'OWNER_REQUIRED'
    || candidate.details === 'OWNER_REQUIRED'
    || candidate.code === 'OWNER_REQUIRED'
}

async function releaseClaimBestEffort(
  client: IncidentRpcClient,
  args: IncidentClaimMutationRpcArgs,
): Promise<boolean> {
  try {
    const result = await client.rpc('release_generation_incident_claim_v1', args)
    return result.error === null && result.data === true
  } catch {
    return false
  }
}

async function releaseAndEmit(
  client: IncidentRpcClient,
  args: IncidentClaimMutationRpcArgs,
  telemetry: GenerationIncidentRetrievalTelemetry,
): Promise<void> {
  const released = await releaseClaimBestEffort(client, args)
  emitTelemetry(telemetry, 'RELEASE', released ? 'SUCCESS' : 'UNAVAILABLE')
}

function asEncryptedRecord(incident: EncryptedGenerationIncident): EncryptedChoiceLexicalEvidence {
  return {
    incidentKey: incident.incident_key,
    version: incident.version,
    id: incident.capture_id,
    correlationId: incident.correlation_id,
    storyId: incident.story_id,
    chapterNumber: incident.chapter_number,
    index: incident.choice_index,
    stage: incident.stage,
    code: incident.code,
    expiresAt: incident.expires_at,
    nonce: incident.nonce,
    ciphertext: incident.ciphertext,
    authTag: incident.auth_tag,
    labelFingerprint: incident.label_fingerprint,
  }
}

export async function retrieveGenerationIncidentLabel(
  lookup: z.infer<typeof GenerationIncidentLookupSchema>,
  deps: {
    client?: IncidentRpcClient
    decryptor?: GenerationIncidentDecryptor
    createClaimToken?: () => string
    telemetry?: GenerationIncidentRetrievalTelemetry
  } = {},
): Promise<GenerationIncidentRetrievalResult> {
  const parsedLookup = GenerationIncidentLookupSchema.parse(lookup)
  const client = deps.client ?? await createClient() as unknown as IncidentRpcClient
  const telemetry = deps.telemetry ?? defaultTelemetry
  const lookupArgs: IncidentLookupRpcArgs = {
    p_capture_id: parsedLookup.captureId,
    p_correlation_id: parsedLookup.correlationId,
  }

  const claimToken = z.string().uuid().parse((deps.createClaimToken ?? randomUUID)())
  const mutationArgs: IncidentClaimMutationRpcArgs = {
    ...lookupArgs,
    p_claim_token: claimToken,
  }

  let claimResult: { data: unknown; error: unknown }
  try {
    claimResult = await client.rpc('claim_generation_incident_v1', mutationArgs)
  } catch {
    emitTelemetry(telemetry, 'CLAIM', 'UNAVAILABLE')
    return { status: 'unavailable' }
  }

  if (claimResult.error) {
    const outcome = isOwnerRequiredError(claimResult.error) ? 'FORBIDDEN' : 'UNAVAILABLE'
    emitTelemetry(telemetry, 'CLAIM', outcome)
    return outcome === 'FORBIDDEN' ? { status: 'forbidden' } : { status: 'unavailable' }
  }

  const parsedRows = z.array(ClaimedIncidentRowSchema).safeParse(claimResult.data)
  if (!parsedRows.success) {
    emitTelemetry(telemetry, 'CLAIM', 'SUCCESS')
    emitTelemetry(telemetry, 'ROW_SCHEMA', 'UNAVAILABLE')
    if (Array.isArray(claimResult.data) && claimResult.data.length > 0) {
      await releaseAndEmit(client, mutationArgs, telemetry)
    }
    return { status: 'unavailable' }
  }
  if (parsedRows.data.length === 0) {
    emitTelemetry(telemetry, 'CLAIM', 'NOT_FOUND')
    return { status: 'not_found' }
  }
  if (parsedRows.data.length !== 1) {
    emitTelemetry(telemetry, 'CLAIM', 'SUCCESS')
    emitTelemetry(telemetry, 'ROW_SCHEMA', 'UNAVAILABLE')
    await releaseAndEmit(client, mutationArgs, telemetry)
    return { status: 'unavailable' }
  }

  emitTelemetry(telemetry, 'CLAIM', 'SUCCESS')
  emitTelemetry(telemetry, 'ROW_SCHEMA', 'SUCCESS')
  const { claim_expires_at: _claimExpiresAt, ...incident } = parsedRows.data[0]

  let decryptedLabel: string
  if (deps.decryptor) {
    try {
      decryptedLabel = await deps.decryptor.decryptLabel(incident)
    } catch {
      emitTelemetry(telemetry, 'DECRYPT', 'UNAVAILABLE')
      await releaseAndEmit(client, mutationArgs, telemetry)
      return { status: 'unavailable' }
    }
  } else {
    const config = loadChoiceInvalidCaptureDecryptConfig()
    if (!config) {
      emitTelemetry(telemetry, 'DECRYPT_CONFIG', 'UNAVAILABLE')
      await releaseAndEmit(client, mutationArgs, telemetry)
      return { status: 'unavailable' }
    }
    emitTelemetry(telemetry, 'DECRYPT_CONFIG', 'SUCCESS')
    try {
      const label = decryptChoiceLexicalEvidence({ masterKey: config.masterKey, record: asEncryptedRecord(incident) })
      if (label === null) throw new Error('GENERATION_INCIDENT_DECRYPT_FAILED')
      decryptedLabel = label
    } catch {
      emitTelemetry(telemetry, 'DECRYPT', 'UNAVAILABLE')
      await releaseAndEmit(client, mutationArgs, telemetry)
      return { status: 'unavailable' }
    }
  }

  const parsedLabel = z.string().trim().min(1).max(90).safeParse(decryptedLabel)
  if (!parsedLabel.success) {
    emitTelemetry(telemetry, 'DECRYPT', 'UNAVAILABLE')
    await releaseAndEmit(client, mutationArgs, telemetry)
    return { status: 'unavailable' }
  }
  emitTelemetry(telemetry, 'DECRYPT', 'SUCCESS')

  let finalizeResult: { data: unknown; error: unknown }
  try {
    finalizeResult = await client.rpc('finalize_generation_incident_v1', mutationArgs)
  } catch {
    emitTelemetry(telemetry, 'FINALIZE', 'UNAVAILABLE')
    await releaseAndEmit(client, mutationArgs, telemetry)
    return { status: 'unavailable' }
  }

  if (finalizeResult.error || finalizeResult.data !== true) {
    const outcome = finalizeResult.error && isOwnerRequiredError(finalizeResult.error)
      ? 'FORBIDDEN'
      : 'UNAVAILABLE'
    emitTelemetry(telemetry, 'FINALIZE', outcome)
    await releaseAndEmit(client, mutationArgs, telemetry)
    return outcome === 'FORBIDDEN' ? { status: 'forbidden' } : { status: 'unavailable' }
  }

  emitTelemetry(telemetry, 'FINALIZE', 'SUCCESS')
  return { status: 'found', label: parsedLabel.data }
}
