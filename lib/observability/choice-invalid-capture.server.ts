import 'server-only'

import { randomUUID } from 'node:crypto'
import type { ChoiceLexicalEvidence } from '@/lib/ai-gateway/model-call-errors'
import type { ProviderCallContext } from './generation-provider-call.contract'
import {
  choiceInvalidCaptureMatches,
  loadChoiceInvalidCaptureWriteConfig,
  type ChoiceInvalidCaptureWriteConfig,
} from './choice-invalid-capture-config.server'
import {
  encryptChoiceLexicalEvidence,
  type EncryptedChoiceLexicalEvidence,
} from './choice-invalid-capture-crypto.server'
import { writeEncryptedChoiceInvalidCapture } from './choice-invalid-capture-db.server'

export type ChoiceInvalidCaptureWriter = (
  record: EncryptedChoiceLexicalEvidence,
) => void | Promise<void>

export type CaptureChoiceInvalidEvidenceDeps = Readonly<{
  writer?: ChoiceInvalidCaptureWriter
  loadConfig?: () => ChoiceInvalidCaptureWriteConfig | null
  createId?: () => string
}>

export async function captureChoiceInvalidEvidence(
  context: ProviderCallContext,
  evidence: ChoiceLexicalEvidence,
  deps: CaptureChoiceInvalidEvidenceDeps = {},
): Promise<void> {
  const config = (deps.loadConfig ?? loadChoiceInvalidCaptureWriteConfig)()
  const writer = deps.writer ?? writeEncryptedChoiceInvalidCapture
  if (!config || context.chapterNumber === null) return
  if (!choiceInvalidCaptureMatches(config, context.storyId, context.chapterNumber)) return

  const choice = evidence.choices[0]
  if (!choice) return
  const record = encryptChoiceLexicalEvidence({
    masterKey: config.masterKey,
    identity: {
      id: (deps.createId ?? randomUUID)(),
      correlationId: context.correlationId,
      storyId: context.storyId,
      chapterNumber: context.chapterNumber,
      index: choice.index,
      stage: 'FINAL_BRANCH_SCHEMA',
      code: 'CHOICE_NOT_ACTIONABLE',
      expiresAt: config.expiresAt,
    },
    label: choice.label,
  })
  await writer(record)
}
