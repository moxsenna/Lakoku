import 'server-only'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  M10GSemanticAttempt,
  M10GSemanticIdentity,
} from '../contracts/m10-g-semantic-contract'
import {
  M10GSemanticAttemptSchema,
  M10GSemanticIdentitySchema,
} from '../contracts/m10-g-semantic-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

export interface M10GSemanticCaptureWriter {
  write(attempt: M10GSemanticAttempt): void
}

export function createM10GSemanticCaptureWriter(path: string): M10GSemanticCaptureWriter {
  mkdirSync(dirname(path), { recursive: true })
  return Object.freeze({
    write(attempt: M10GSemanticAttempt): void {
      const parsed = M10GSemanticAttemptSchema.parse(attempt)
      appendFileSync(path, `${stableStringify(parsed)}\n`, { encoding: 'utf8', flag: 'a' })
    },
  })
}

export function validateM10GSemanticCaptureJsonl(
  bytes: Uint8Array,
  expected: { identity: M10GSemanticIdentity; authorityHash: string },
): M10GSemanticAttempt[] {
  const identity = M10GSemanticIdentitySchema.parse(expected.identity)
  const text = Buffer.from(bytes).toString('utf8')
  if (!text.endsWith('\n')) throw new Error('M10-G semantic capture JSONL must end with newline')
  const records = text.split('\n').filter(Boolean).map((line, index) => {
    let raw: unknown
    try {
      raw = JSON.parse(line) as unknown
    } catch {
      throw new Error(`M10-G semantic capture JSONL invalid at line ${index + 1}`)
    }
    const attempt = M10GSemanticAttemptSchema.parse(raw)
    const { attemptId, ...payload } = attempt
    if (computeSha256(stableStringify(payload)) !== attemptId) {
      throw new Error(`M10-G semantic capture attempt hash mismatch at line ${index + 1}`)
    }
    if (stableStringify(attempt.identity) !== stableStringify(identity)
      || attempt.authorityHash !== expected.authorityHash) {
      throw new Error(`M10-G semantic capture provenance mismatch at line ${index + 1}`)
    }
    return attempt
  })
  const keys = records.map((attempt) => `${attempt.caseId}:${attempt.sampleIndex}`)
  if (new Set(keys).size !== keys.length) throw new Error('M10-G semantic capture contains duplicate attempt provenance')
  return records
}
