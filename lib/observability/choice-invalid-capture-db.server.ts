import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type { EncryptedChoiceLexicalEvidence } from './choice-invalid-capture-crypto.server'

export async function writeEncryptedChoiceInvalidCapture(
  record: EncryptedChoiceLexicalEvidence,
): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.rpc('capture_generation_incident_v1', {
    p_capture_id: record.id,
    p_correlation_id: record.correlationId,
    p_incident_key: record.incidentKey,
    p_label_fingerprint: record.labelFingerprint,
    p_version: record.version,
    p_story_id: record.storyId,
    p_chapter_number: record.chapterNumber,
    p_choice_index: record.index,
    p_stage: record.stage,
    p_code: record.code,
    p_ciphertext: record.ciphertext,
    p_nonce: record.nonce,
    p_auth_tag: record.authTag,
    p_expires_at: record.expiresAt,
  })

  if (error) throw new Error('CHOICE_INVALID_CAPTURE_WRITE_FAILED')
}
