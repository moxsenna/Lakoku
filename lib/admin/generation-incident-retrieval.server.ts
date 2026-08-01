import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  decryptChoiceLexicalEvidence,
  type EncryptedChoiceLexicalEvidence,
} from '@/lib/observability/choice-invalid-capture-crypto.server'
import { loadChoiceInvalidCaptureConfig } from '@/lib/observability/choice-invalid-capture-config.server'

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

export type EncryptedGenerationIncident = z.infer<typeof EncryptedIncidentRowSchema>

export interface GenerationIncidentDecryptor {
  decryptLabel: (incident: EncryptedGenerationIncident) => Promise<string>
}

type IncidentRpcClient = {
  rpc: (
    name: 'consume_generation_incident_v1',
    args: { p_capture_id: string; p_correlation_id: string },
  ) => Promise<{ data: unknown; error: unknown }>
}

export type GenerationIncidentRetrievalResult =
  | { status: 'found'; label: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'unavailable' }

const productionDecryptor: GenerationIncidentDecryptor = {
  async decryptLabel(incident): Promise<string> {
    const config = loadChoiceInvalidCaptureConfig()
    if (!config) throw new Error('GENERATION_INCIDENT_DECRYPTOR_UNAVAILABLE')
    const label = decryptChoiceLexicalEvidence({
      masterKey: config.masterKey,
      record: {
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
      } satisfies EncryptedChoiceLexicalEvidence,
    })
    if (label === null) throw new Error('GENERATION_INCIDENT_DECRYPT_FAILED')
    return label
  },
}

function isOwnerRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; details?: unknown; code?: unknown }
  return candidate.message === 'OWNER_REQUIRED'
    || candidate.details === 'OWNER_REQUIRED'
    || candidate.code === 'OWNER_REQUIRED'
}

export async function retrieveGenerationIncidentLabel(
  lookup: z.infer<typeof GenerationIncidentLookupSchema>,
  deps: {
    client?: IncidentRpcClient
    decryptor?: GenerationIncidentDecryptor
  } = {},
): Promise<GenerationIncidentRetrievalResult> {
  const parsedLookup = GenerationIncidentLookupSchema.parse(lookup)
  const client = deps.client ?? await createClient() as unknown as IncidentRpcClient

  let result: { data: unknown; error: unknown }
  try {
    result = await client.rpc('consume_generation_incident_v1', {
      p_capture_id: parsedLookup.captureId,
      p_correlation_id: parsedLookup.correlationId,
    })
  } catch {
    return { status: 'unavailable' }
  }

  if (result.error) {
    return { status: isOwnerRequiredError(result.error) ? 'forbidden' : 'unavailable' }
  }

  const parsedRows = z.array(EncryptedIncidentRowSchema).safeParse(result.data)
  if (!parsedRows.success) return { status: 'unavailable' }
  if (parsedRows.data.length === 0) return { status: 'not_found' }
  if (parsedRows.data.length !== 1) return { status: 'unavailable' }

  try {
    const label = await (deps.decryptor ?? productionDecryptor).decryptLabel(parsedRows.data[0])
    const parsedLabel = z.string().trim().min(1).max(90).safeParse(label)
    if (!parsedLabel.success) return { status: 'unavailable' }
    return { status: 'found', label: parsedLabel.data }
  } catch {
    return { status: 'unavailable' }
  }
}
