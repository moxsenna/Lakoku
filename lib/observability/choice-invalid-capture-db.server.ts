import 'server-only'
import { getDb, rpcOne, single } from '@lakoku/db'
import type { EncryptedChoiceLexicalEvidence } from './choice-invalid-capture-crypto.server'

export async function writeEncryptedChoiceInvalidCapture(
  record: EncryptedChoiceLexicalEvidence,
): Promise<void> {
  // RLS_AUDIT: capture_generation_incident_v1 RPC mencatat insiden validasi pilihan
  const db = getDb()
  const { error } = await single(
    rpcOne(db, 'capture_generation_incident_v1', {
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
    }).execute(),
  )

  if (error) throw new Error('CHOICE_INVALID_CAPTURE_WRITE_FAILED')
}
